/** Office work orders (spec §1.8, FR-W1..W4, D73): the ten statuses of the requirement, linked to equipment, letters and tasks. */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { createRecord, type Row } from '../../platform/records.js';
import { getWorkOrder } from '../m05-work/index.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, type Actor } from './actor.js';
import { addDays, commandScopeOf, holds, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef } from './numbering.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { assertVisible, visibility, visibleWhere } from './scope.js';
import { commandScope, recordEvent } from './service.js';
import { checkVerifier, myPersonId } from './tasks.js';

const W = 'ofc_work_order';
export const WO_STATUSES = ['requested', 'under_review', 'approved', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external', 'completed', 'verified', 'closed', 'cancelled'] as const;
type WoStatus = (typeof WO_STATUSES)[number];
const TERMINAL = ['closed', 'cancelled'];
const OPEN_SQL = "status NOT IN ('completed','verified','closed','cancelled')";
/** Moves made with setStatus. approve, complete, verify, close and cancel have their own commands. */
const MOVES: Record<string, readonly WoStatus[]> = {
  requested: ['under_review'], under_review: ['requested'], approved: ['assigned'],
  assigned: ['in_progress', 'awaiting_spares', 'awaiting_external'], in_progress: ['awaiting_spares', 'awaiting_external'],
  awaiting_spares: ['in_progress', 'awaiting_external'], awaiting_external: ['in_progress', 'awaiting_spares'],
};

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Version = z.number().int().min(1);
const Priority = z.enum(['immediate', 'high', 'normal', 'low']);
const woFields = {
  title: z.string().trim().min(1).max(200), requestingUnit: Text(200), requestedBy: Text(200), requestDate: LocalDate.optional(), equipmentId: z.uuid().nullable().optional(),
  reportedDefect: Text(4000), unitId: z.uuid().nullable().optional(), priority: Priority.optional(), targetDate: LocalDate.nullable().optional(), materialsRequired: Text(4000),
  externalAgency: Text(200), remarks: Text(4000), wrkWorkOrderId: z.uuid().nullable().optional(),
};
export const WoCreate = z.strictObject({ commandId: z.uuid().optional(), ...woFields, title: woFields.title.optional(), sourceLetterId: z.uuid().optional(), sourceTaskId: z.uuid().optional() });
export const WoUpdate = z.strictObject({ expectedVersion: Version, ...woFields, title: woFields.title.optional(), actionsTaken: Text(8000), delayReason: Text(1000), reason: Text(500) });
export const WoAssign = z.strictObject({ expectedVersion: Version, unitId: z.uuid().optional(), supervisorPersonId: z.uuid().nullable().optional(), crew: z.array(z.uuid()).max(30).optional(), reason: Text(500) });
export const WoStatus = z.strictObject({ expectedVersion: Version, status: z.enum(['requested', 'under_review', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external']), note: Text(2000), externalAgency: Text(200), delayReason: Text(1000) });
export const WoApprove = z.strictObject({ expectedVersion: Version, approvalRef: Text(120), note: Text(2000) });
export const WoComplete = z.strictObject({ expectedVersion: Version, completionDetails: z.string().trim().min(1).max(8000), actionsTaken: Text(8000), delayReason: Text(1000) });
export const WoVerify = z.strictObject({ expectedVersion: Version, note: Text(2000) });
export const WoReason = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });
export const WoList = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0), q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional(), commandId: z.uuid(), status: z.enum(WO_STATUSES).optional(),
  view: z.enum(['outstanding', 'overdue', 'awaiting_approval', 'waiting', 'to_verify', 'done', 'all']).default('outstanding'),
  unitId: z.uuid().optional(), priority: Priority.optional(), equipmentId: z.uuid().optional(), mine: z.enum(['true', 'false']).optional(), from: LocalDate.optional(), to: LocalDate.optional(),
});

const crewOf = (r: Row): string[] => { try { return JSON.parse(String(r.crew_json ?? '[]')) as string[]; } catch { return []; } };
const PEOPLE_COLS = ['supervisor_person_id'];
function getVisible(a: Actor, id: string): Row {
  const r = mustGet(a.wctx.db, W, id, 'Work order');
  authorize(a, perm('work_order', 'view'), commandScopeOf(r));
  const v = visibility(a, r.command_id as string);
  if (!v.all && !(v.personId && crewOf(r).includes(v.personId))) assertVisible(a, r, 'unit_id', PEOPLE_COLS, 'This work order');
  return r;
}
function checkPersons(a: Actor, commandId: string, ids: Array<string | null | undefined>): void {
  for (const id of ids) if (id && !a.wctx.db.prepare("SELECT 1 FROM ofc_person WHERE id = ? AND command_id = ? AND deleted_at IS NULL AND status = 'active'").get(id, commandId)) throw new AppError('VALIDATION_FAILED', 'Person not found or not active in this office');
}
function checkUnit(a: Actor, commandId: string, unitId: string | null | undefined): void {
  if (unitId && !a.wctx.db.prepare('SELECT 1 FROM ofc_org_unit WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(unitId, commandId)) throw new AppError('VALIDATION_FAILED', 'Unit not found in this office');
}
const isOverdue = (r: Row, today: string) => !['completed', 'verified', 'closed', 'cancelled'].includes(r.status as string) && !!r.target_date && (r.target_date as string) < today;
const withFlags = (r: Row, today: string): Row => ({ ...r, crew: crewOf(r), overdue: isOverdue(r, today) });

/** FR-W3: from a letter or a task (linked both ways), or entered directly. */
export function createWorkOrder(a: Actor, input: unknown): Row {
  const v = parse(WoCreate, input);
  const db = a.wctx.db;
  const letter = v.sourceLetterId ? mustGet(db, 'ofc_correspondence', v.sourceLetterId, 'Correspondence') : undefined;
  const task = v.sourceTaskId ? mustGet(db, 'ofc_task', v.sourceTaskId, 'Task') : undefined;
  const commandId = v.commandId ?? (letter?.command_id as string | undefined) ?? (task?.command_id as string | undefined);
  if (!commandId || !resolveParty(db, { kind: 'command', id: commandId })) throw new AppError('VALIDATION_FAILED', 'Office (commandId) is required');
  authorize(a, perm('work_order', 'create'), commandScope(commandId));
  checkUnit(a, commandId, v.unitId);
  if (v.equipmentId) { const e = mustGet(db, 'ofc_equipment', v.equipmentId, 'Equipment'); if (e.command_id !== commandId) throw new AppError('VALIDATION_FAILED', 'Equipment belongs to another office'); }
  if (v.wrkWorkOrderId && !getWorkOrder(db, v.wrkWorkOrderId)) throw new AppError('VALIDATION_FAILED', 'Ship work order not found');
  const title = v.title ?? (letter?.subject as string | undefined) ?? (task?.title as string | undefined);
  if (!title) throw new AppError('VALIDATION_FAILED', 'title is required');
  return db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.work_order', {
      home_scope_id: commandId, command_id: commandId, ref_no: nextRef(a.wctx, 'ofc_wo'), title, requesting_unit: v.requestingUnit ?? (letter?.originator as string | undefined) ?? null,
      requested_by: v.requestedBy ?? null, request_date: v.requestDate ?? todayLocal(), equipment_id: v.equipmentId ?? null, reported_defect: v.reportedDefect ?? null,
      unit_id: v.unitId ?? (letter?.unit_id as string | undefined) ?? (task?.unit_id as string | undefined) ?? null, priority: v.priority ?? (letter?.priority as string | undefined) ?? 'normal',
      status: 'requested', crew_json: '[]', target_date: v.targetDate ?? null, materials_required: v.materialsRequired ?? null, external_agency: v.externalAgency ?? null, remarks: v.remarks ?? null, wrk_work_order_id: v.wrkWorkOrderId ?? null,
    });
    const link = (toType: string, toId: unknown) => {
      createRecord(a.wctx, 'ofc.link', { home_scope_id: commandId, from_type: 'ofc.work_order', from_id: row.id, to_type: toType, to_id: toId, link_type: 'originated_from', note: null });
      recordEvent(a, { type: toType, id: toId as string }, commandScope(commandId), { kind: 'link', note: `Work order ${row.ref_no as string} raised` });
    };
    if (letter) link('ofc.correspondence', letter.id);
    if (task) link('ofc.task', task.id);
    if (v.equipmentId) recordEvent(a, { type: 'ofc.equipment', id: v.equipmentId }, commandScope(commandId), { kind: 'link', note: `Work order ${row.ref_no as string}: ${title}` });
    return row;
  })();
}

export function getWorkOrderDetail(a: Actor, id: string): Row {
  const r = getVisible(a, id);
  const db = a.wctx.db;
  const equipment = r.equipment_id ? (db.prepare('SELECT id, ref_no, equip_no, name, serial_no, state FROM ofc_equipment WHERE id = ?').get(r.equipment_id) as Row | undefined) ?? null : null;
  const ship = r.wrk_work_order_id ? getWorkOrder(db, r.wrk_work_order_id as string) : null;
  return { ...withFlags(r, todayLocal()), equipment, shipWorkOrder: ship ? { id: ship.id, woNo: ship.woNo, title: ship.title } : null, permissions: woPermissions(a, r) };
}

function isWorker(a: Actor, r: Row): boolean {
  const me = myPersonId(a, r.command_id as string);
  return !!me && (crewOf(r).includes(me) || r.supervisor_person_id === me);
}
function woPermissions(a: Actor, r: Row): Record<string, boolean> {
  const s = commandScopeOf(r);
  const st = r.status as string;
  const manage = holds(a, perm('work_order', 'assign'), s);
  const update = holds(a, perm('work_order', 'update'), s) && (manage || isWorker(a, r));
  return {
    update: update && !TERMINAL.includes(st) && st !== 'verified', assign: manage && ['approved', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external'].includes(st),
    approve: holds(a, perm('work_order', 'approve'), s) && ['requested', 'under_review'].includes(st),
    complete: update && ['in_progress', 'awaiting_spares', 'awaiting_external', 'assigned'].includes(st),
    verify: st === 'completed' && checkVerifier(a, 'work_order', r.command_id as string, r.unit_id as string | null, crewOf(r)) === null,
    close: st === 'verified' && holds(a, perm('work_order', 'verify'), s), cancel: !TERMINAL.includes(st) && st !== 'verified' && holds(a, perm('work_order', 'cancel'), s),
    reopen: ['completed', 'verified'].includes(st) && holds(a, perm('work_order', 'verify'), s),
  };
}
function requireUpdater(a: Actor, r: Row): void {
  authorize(a, perm('work_order', 'update'), commandScopeOf(r));
  if (!holds(a, perm('work_order', 'assign'), commandScopeOf(r)) && !isWorker(a, r)) throw new AppError('FORBIDDEN', 'Only the crew, the supervisor or a section officer can update this work order');
}
function delayCheck(r: Row, given: string | null | undefined): void {
  if (isOverdue(r, todayLocal()) && !given && !r.delay_reason) throw new AppError('VALIDATION_FAILED', 'The work order is overdue: give the reason for the delay');
}

export function updateWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoUpdate, input);
  const r = getVisible(a, id);
  requireUpdater(a, r);
  if (TERMINAL.includes(r.status as string) || r.status === 'verified') throw new AppError('WORKFLOW_BLOCKED', `The work order is ${r.status as string}`);
  checkUnit(a, r.command_id as string, v.unitId);
  if (v.equipmentId) mustGet(a.wctx.db, 'ofc_equipment', v.equipmentId, 'Equipment');
  if (v.targetDate !== undefined && r.target_date && (!v.targetDate || v.targetDate > (r.target_date as string)) && !v.delayReason && !v.reason) throw new AppError('VALIDATION_FAILED', 'Give the reason for moving the target date later');
  const delay = v.delayReason ?? (v.targetDate !== undefined && v.targetDate !== r.target_date ? v.reason : undefined);
  return updateWithHistory(a, 'ofc.work_order', r, { ...v, ...(delay ? { delayReason: delay } : {}), reason: v.reason ?? v.delayReason ?? null }, { keyFields: ['title', 'requestDate', 'requestingUnit'] });
}

/** Approval records who approved and under which reference; the software right does not itself confer authority (spec §5). */
export function approveWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoApprove, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'approve'), commandScopeOf(r));
  if (!['requested', 'under_review'].includes(r.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'Only a requested or reviewed work order can be approved');
  return updateWithHistory(a, 'ofc.work_order', r, { expectedVersion: v.expectedVersion, status: 'approved', approvedBy: a.principal.userId, approvedAt: todayLocal(), approvalRef: v.approvalRef ?? null, reason: v.note ?? v.approvalRef ?? null });
}

export function assignWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoAssign, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'assign'), commandScopeOf(r));
  if (['requested', 'under_review'].includes(r.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'Approve the work order before assigning it');
  if (TERMINAL.includes(r.status as string) || ['completed', 'verified'].includes(r.status as string)) throw new AppError('WORKFLOW_BLOCKED', `The work order is ${r.status as string}`);
  checkUnit(a, r.command_id as string, v.unitId);
  checkPersons(a, r.command_id as string, [v.supervisorPersonId, ...(v.crew ?? [])]);
  const unitId = v.unitId ?? (r.unit_id as string | null);
  if (!unitId) throw new AppError('VALIDATION_FAILED', 'Choose the section or workshop');
  const crew = v.crew ?? crewOf(r);
  const changedPeople = r.status !== 'approved' && (v.crew !== undefined || v.supervisorPersonId !== undefined || (v.unitId && v.unitId !== r.unit_id));
  if (changedPeople && !v.reason) throw new AppError('VALIDATION_FAILED', 'Give the reason for reassigning the work');
  return a.wctx.db.transaction(() => {
    const next = updateWithHistory(a, 'ofc.work_order', r, {
      expectedVersion: v.expectedVersion, unitId, ...(v.supervisorPersonId !== undefined ? { supervisorPersonId: v.supervisorPersonId } : {}), crewJson: JSON.stringify([...new Set(crew)]),
      status: r.status === 'approved' ? 'assigned' : (r.status as string), reason: v.reason ?? null,
    });
    if (v.crew) recordEvent(a, { type: 'ofc.work_order', id }, commandScopeOf(r), { kind: 'assign', field: 'crew', from: crewOf(r).length, to: crew.length, note: v.reason ?? null });
    return next;
  })();
}

export function setWorkOrderStatus(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoStatus, input);
  const r = getVisible(a, id);
  if (['requested', 'under_review'].includes(v.status) || ['requested', 'under_review'].includes(r.status as string)) authorize(a, perm('work_order', 'assign'), commandScopeOf(r));
  else requireUpdater(a, r);
  if (!(MOVES[r.status as string] ?? []).includes(v.status)) throw new AppError('WORKFLOW_BLOCKED', `A work order cannot go from ${String(r.status)} to ${v.status}`);
  if (v.status === 'awaiting_external' && !v.externalAgency && !r.external_agency) throw new AppError('VALIDATION_FAILED', 'Name the external agency or workshop');
  delayCheck(r, v.delayReason);
  return updateWithHistory(a, 'ofc.work_order', r, {
    expectedVersion: v.expectedVersion, status: v.status, ...(v.externalAgency ? { externalAgency: v.externalAgency } : {}), ...(v.delayReason ? { delayReason: v.delayReason } : {}), reason: v.note ?? null,
  });
}

export function completeWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoComplete, input);
  const r = getVisible(a, id);
  requireUpdater(a, r);
  if (!['assigned', 'in_progress', 'awaiting_spares', 'awaiting_external'].includes(r.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'Only work in progress can be completed');
  delayCheck(r, v.delayReason);
  return updateWithHistory(a, 'ofc.work_order', r, {
    expectedVersion: v.expectedVersion, status: 'completed', completionDetails: v.completionDetails, completedAt: todayLocal(), ...(v.actionsTaken ? { actionsTaken: v.actionsTaken } : {}),
    ...(v.delayReason ? { delayReason: v.delayReason } : {}), reason: v.completionDetails,
  });
}

/** FR-W1 verify: same rule as tasks (in-charge / officer of the workshop or above; never the crew or supervisor who did it). */
export function verifyWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoVerify, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'verify'), commandScopeOf(r));
  if (r.status !== 'completed') throw new AppError('WORKFLOW_BLOCKED', 'Only completed work can be verified');
  const workers = [...crewOf(r), r.supervisor_person_id as string | null];
  const why = checkVerifier(a, 'work_order', r.command_id as string, r.unit_id as string | null, workers, v.note);
  if (why) throw new AppError('FORBIDDEN', why);
  return updateWithHistory(a, 'ofc.work_order', r, { expectedVersion: v.expectedVersion, status: 'verified', verifiedBy: a.principal.userId, verifiedAt: todayLocal(), verifyNote: v.note ?? null, reason: v.note ?? null });
}

export function closeWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoVerify, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'verify'), commandScopeOf(r));
  if (r.status !== 'verified') throw new AppError('WORKFLOW_BLOCKED', 'Verify the work before closing the work order');
  return updateWithHistory(a, 'ofc.work_order', r, { expectedVersion: v.expectedVersion, status: 'closed', closedAt: todayLocal(), reason: v.note ?? null });
}

export function reopenWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoReason, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'verify'), commandScopeOf(r));
  if (!['completed', 'verified'].includes(r.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'Only completed or verified work can be sent back');
  recordEvent(a, { type: 'ofc.work_order', id }, commandScopeOf(r), { kind: 'reopen', note: v.reason });
  return updateWithHistory(a, 'ofc.work_order', r, { expectedVersion: v.expectedVersion, status: 'in_progress', verifiedBy: null, verifiedAt: null, reason: v.reason });
}

export function cancelWorkOrder(a: Actor, id: string, input: unknown): Row {
  const v = parse(WoReason, input);
  const r = getVisible(a, id);
  authorize(a, perm('work_order', 'cancel'), commandScopeOf(r));
  if (TERMINAL.includes(r.status as string) || r.status === 'verified') throw new AppError('WORKFLOW_BLOCKED', `The work order is ${r.status as string}`);
  return updateWithHistory(a, 'ofc.work_order', r, { expectedVersion: v.expectedVersion, status: 'cancelled', reason: v.reason });
}

/** One filter behind the list, dashboard and reports (FR-D4). */
export function workOrderWhere(a: Actor, v: z.infer<typeof WoList>): { where: string[]; params: unknown[] } {
  const today = todayLocal();
  const vis = visibility(a, v.commandId);
  const lim = visibleWhere(vis, 'unit_id', PEOPLE_COLS);
  const crewCond = vis.all || !vis.personId ? null : 'EXISTS (SELECT 1 FROM json_each(crew_json) WHERE value = ?)';
  const where = ['command_id = ?', ...(crewCond && lim.where.length ? [`(${lim.where[0]} OR ${crewCond})`] : lim.where)];
  const params: unknown[] = [v.commandId, ...lim.params, ...(crewCond && lim.where.length ? [vis.personId] : [])];
  switch (v.view) {
    case 'outstanding': where.push(OPEN_SQL); break;
    case 'overdue': where.push(OPEN_SQL, 'target_date < ?'); params.push(today); break;
    case 'awaiting_approval': where.push("status IN ('requested','under_review')"); break;
    case 'waiting': where.push("status IN ('awaiting_spares','awaiting_external')"); break;
    case 'to_verify': where.push("status IN ('completed','verified')"); break;
    case 'done': where.push("status IN ('verified','closed')"); break;
    case 'all': break;
  }
  for (const [val, col] of [[v.status, 'status'], [v.unitId, 'unit_id'], [v.priority, 'priority'], [v.equipmentId, 'equipment_id']] as const) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  if (v.mine === 'true') { where.push("(supervisor_person_id = ? OR EXISTS (SELECT 1 FROM json_each(crew_json) WHERE value = ?))"); params.push(vis.personId ?? '-', vis.personId ?? '-'); }
  if (v.from) { where.push('request_date >= ?'); params.push(v.from); }
  if (v.to) { where.push('request_date <= ?'); params.push(v.to); }
  return { where, params };
}

export function listWorkOrders(a: Actor, raw: unknown) {
  const v = parse(WoList, raw);
  authorize(a, perm('work_order', 'view'), commandScope(v.commandId));
  const { where, params } = workOrderWhere(a, v);
  const sort = { refNo: 'ref_no', title: 'title', targetDate: "COALESCE(target_date,'9999')", requestDate: 'request_date', status: 'status', priority: "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END" };
  const { rows, total } = pageOf(a.wctx.db, W, where, params, v, ['ref_no', 'title', 'requesting_unit', 'reported_defect', 'remarks', 'materials_required', 'external_agency'], sort, "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, request_date");
  const today = todayLocal();
  return { total, items: rows.map((r) => withFlags(r, today)) };
}
export { addDays, OPEN_SQL as WO_OPEN_SQL };
