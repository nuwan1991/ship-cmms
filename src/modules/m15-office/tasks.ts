/** Tasks and actions (spec §1.5, FR-T1..T6). */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { createRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { getWorkOrder } from '../m05-work/index.js';
import { authorize, type Actor } from './actor.js';
import { addDays, commandScopeOf, holds, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef } from './numbering.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { assertVisible, personOfUser, visibility, visibleWhere } from './scope.js';
import { commandScope, recordEvent } from './service.js';

const T = 'ofc_task';
export const TASK_STATUSES = ['not_started', 'assigned', 'in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold', 'completed', 'closed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
const TERMINAL = ['completed', 'closed', 'cancelled'];
const WORKING = ['in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold'];
/** Allowed moves through setStatus. complete/close/reopen/cancel have their own commands with their own checks. */
const MOVES: Record<string, readonly string[]> = {
  not_started: ['assigned', 'in_progress'], assigned: ['in_progress', ...WORKING], in_progress: WORKING, awaiting_info: WORKING, awaiting_approval: WORKING, on_hold: WORKING,
};
const SOURCES: Record<string, string> = { 'ofc.correspondence': 'ofc_correspondence', 'ofc.handover_item': 'ofc_handover_item' };
/** Source record as a row: office records directly, work orders through M05's public lookup (MODULE_MAP rule 2). */
function loadSource(a: Actor, type: string, id: string): Row | undefined {
  if (type === 'wrk.work_order') { const w = getWorkOrder(a.wctx.db, id); return w ? { id: w.id, ref_no: w.woNo, subject: w.title } : undefined; }
  return a.wctx.db.prepare(`SELECT * FROM ${SOURCES[type]!} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Version = z.number().int().min(1);
const Priority = z.enum(['immediate', 'high', 'normal', 'low']);
export const TaskCreate = z.strictObject({
  commandId: z.uuid().optional(), parentId: z.uuid().optional(), title: z.string().trim().min(1).max(200).optional(), description: Text(4000),
  unitId: z.uuid().nullable().optional(), assigneePersonId: z.uuid().nullable().optional(), priority: Priority.optional(), startDate: LocalDate.nullable().optional(),
  targetDate: LocalDate.nullable().optional(), remarks: Text(4000),
  source: z.strictObject({ type: z.enum(['ofc.correspondence', 'ofc.handover_item', 'wrk.work_order']), id: z.uuid() }).optional(),
});
export const TaskUpdate = z.strictObject({
  expectedVersion: Version, title: z.string().trim().min(1).max(200).optional(), description: Text(4000), unitId: z.uuid().nullable().optional(), priority: Priority.optional(),
  startDate: LocalDate.nullable().optional(), targetDate: LocalDate.nullable().optional(), progressPct: z.number().int().min(0).max(100).nullable().optional(),
  delayReason: Text(1000), remarks: Text(4000), reason: Text(500),
});
export const TaskAssign = z.strictObject({ expectedVersion: Version, assigneePersonId: z.uuid(), reason: Text(500) });
export const TaskStatusIn = z.strictObject({ expectedVersion: Version, status: z.enum(['assigned', 'in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold']), note: Text(2000), delayReason: Text(1000) });
export const TaskComplete = z.strictObject({ expectedVersion: Version, note: z.string().trim().min(1).max(4000), delayReason: Text(1000) });
export const TaskClose = z.strictObject({ expectedVersion: Version, note: Text(2000) });
export const TaskReason = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });
export const TaskList = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0), q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional(), commandId: z.uuid(), status: z.enum(TASK_STATUSES).optional(),
  view: z.enum(['active', 'overdue', 'due_soon', 'awaiting_verification', 'attention', 'done', 'all']).default('active'),
  assigneePersonId: z.uuid().optional(), unitId: z.uuid().optional(), priority: Priority.optional(), mine: z.enum(['true', 'false']).optional(),
  parentId: z.uuid().optional(), topLevel: z.enum(['true', 'false']).optional(), from: LocalDate.optional(), to: LocalDate.optional(),
});

const isOverdue = (r: Row, today: string): boolean => !TERMINAL.includes(r.status as string) && !!r.target_date && (r.target_date as string) < today;
const withFlags = (r: Row, today: string): Row => ({ ...r, overdue: isOverdue(r, today), daysOverdue: isOverdue(r, today) ? Math.round((Date.parse(today) - Date.parse(r.target_date as string)) / 86_400_000) : 0 });

function getVisible(a: Actor, id: string): Row {
  const t = mustGet(a.wctx.db, T, id, 'Task');
  authorize(a, perm('task', 'view'), commandScopeOf(t));
  assertVisible(a, t, 'unit_id', ['assignee_person_id'], 'This task');
  return t;
}
function checkPerson(a: Actor, commandId: string, personId: string | null | undefined): Row | undefined {
  if (!personId) return undefined;
  const p = a.wctx.db.prepare('SELECT * FROM ofc_person WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(personId, commandId) as Row | undefined;
  if (!p) throw new AppError('VALIDATION_FAILED', 'Person not found in this office');
  if (p.status !== 'active' || p.duty_status === 'transferred') throw new AppError('VALIDATION_FAILED', `${p.name as string} is not active in this office`);
  return p;
}
function checkUnit(a: Actor, commandId: string, unitId: string | null | undefined): void {
  if (unitId && !a.wctx.db.prepare('SELECT 1 FROM ofc_org_unit WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(unitId, commandId)) throw new AppError('VALIDATION_FAILED', 'Unit not found in this office');
}
export const myPersonId = (a: Actor, commandId: string): string | null => (personOfUser(a, commandId)?.id as string | undefined) ?? null;

/** FR-T1: manual, from a letter, from a handover item, from a work order, or as a subtask. The source is linked and its details carried over. */
export function createTask(a: Actor, input: unknown): Row {
  const v = parse(TaskCreate, input);
  const db = a.wctx.db;
  let parent: Row | undefined;
  let commandId = v.commandId;
  if (v.parentId) {
    parent = getVisible(a, v.parentId);
    if (parent.parent_id) throw new AppError('VALIDATION_FAILED', 'Subtasks have one level only');
    if (TERMINAL.includes(parent.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'The main task is already finished');
    commandId = parent.command_id as string;
  }
  let src: Row | undefined;
  if (v.source) {
    src = loadSource(a, v.source.type, v.source.id);
    if (!src) throw new AppError('NOT_FOUND', 'The record to create the task from was not found');
    if (v.source.type.startsWith('ofc.')) commandId = commandId ?? (src.command_id as string);
  }
  if (!commandId || !resolveParty(db, { kind: 'command', id: commandId })) throw new AppError('VALIDATION_FAILED', 'Office (commandId) is required');
  const scope = commandScope(commandId);
  authorize(a, perm('task', 'create'), scope);
  const canAssign = holds(a, perm('task', 'assign'), scope);
  const me = myPersonId(a, commandId);
  // Technical staff may only add subtasks to their own tasks, for themselves (spec §3).
  if (!canAssign && (!parent || parent.assignee_person_id !== me || (v.assigneePersonId && v.assigneePersonId !== me))) {
    throw new AppError('FORBIDDEN', 'Only a supervisor can create and assign tasks; you can add subtasks to your own tasks');
  }
  checkUnit(a, commandId, v.unitId);
  const assignee = checkPerson(a, commandId, v.assigneePersonId ?? (!canAssign ? me : null));
  const title = v.title ?? (src ? String(src.subject ?? src.title ?? '') : '');
  if (!title) throw new AppError('VALIDATION_FAILED', 'title is required');
  const unitId = v.unitId !== undefined ? v.unitId : ((parent?.unit_id ?? src?.unit_id ?? assignee?.unit_id ?? null) as string | null);
  const target = v.targetDate !== undefined ? v.targetDate : ((src?.reply_due ?? src?.target_date ?? parent?.target_date ?? null) as string | null);
  if (parent?.target_date && target && target > (parent.target_date as string)) throw new AppError('VALIDATION_FAILED', `A subtask cannot be due after its main task (${parent.target_date as string})`);
  return db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.task', {
      home_scope_id: commandId, command_id: commandId, ref_no: nextRef(a.wctx, 'ofc_task'), parent_id: parent?.id ?? null, title, description: v.description ?? null,
      unit_id: unitId, assignee_person_id: assignee?.id ?? null, assigned_by: assignee ? a.principal.userId : null,
      priority: v.priority ?? (src?.priority as string | undefined) ?? (parent?.priority as string | undefined) ?? 'normal', start_date: v.startDate ?? null, target_date: target,
      status: assignee ? 'assigned' : 'not_started', source_type: v.source?.type ?? null, source_id: v.source?.id ?? null, remarks: v.remarks ?? null,
    });
    const ref = { type: 'ofc.task', id: row.id as string };
    if (assignee) recordEvent(a, ref, scope, { kind: 'assign', field: 'assignee_person_id', to: assignee.id, note: assignee.name as string });
    if (v.source) {
      createRecord(a.wctx, 'ofc.link', { home_scope_id: commandId, from_type: 'ofc.task', from_id: row.id, to_type: v.source.type, to_id: v.source.id, link_type: 'originated_from', note: null });
      if (v.source.type.startsWith('ofc.')) recordEvent(a, v.source, scope, { kind: 'link', note: `Task ${row.ref_no as string} created` });
      // Letters keep the documents: the task shows them through the link; a letter under action moves to "under action" (FR-K4).
      if (v.source.type === 'ofc.correspondence' && src?.status === 'received') updateWithHistory(a, 'ofc.correspondence', src, { expectedVersion: src.version as number, status: 'under_action' });
    }
    return row;
  })();
}

export function getTask(a: Actor, id: string): Row {
  const t = getVisible(a, id);
  const today = todayLocal();
  const subtasks = (a.wctx.db.prepare(`SELECT * FROM ${T} WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at`).all(id) as Row[]).map((s) => withFlags(s, today));
  const s = t.source_type ? loadSource(a, t.source_type as string, t.source_id as string) : undefined;
  const source = s ? { type: t.source_type, id: s.id, ref_no: s.ref_no, subject: s.subject } : null;
  const parent = t.parent_id ? (a.wctx.db.prepare(`SELECT id, ref_no, title FROM ${T} WHERE id = ?`).get(t.parent_id) as Row) : null;
  return { ...withFlags(t, today), subtasks, source, parent, permissions: taskPermissions(a, t) };
}

/** What the signed-in user may do with this task; the UI shows only these buttons (the server checks again). */
function taskPermissions(a: Actor, t: Row): Record<string, boolean> {
  const scope = commandScopeOf(t);
  const me = myPersonId(a, t.command_id as string);
  const mine = !!me && t.assignee_person_id === me;
  const update = holds(a, perm('task', 'update'), scope) && (mine || holds(a, perm('task', 'assign'), scope));
  const open = !TERMINAL.includes(t.status as string);
  let verify = false;
  try { verify = t.status === 'completed' && verifierCheck(a, t) === null; } catch { verify = false; }
  return {
    update: update && open, assign: holds(a, perm('task', 'assign'), scope) && open, complete: update && open && !!t.assignee_person_id,
    close: verify, reopen: ['completed', 'closed'].includes(t.status as string) && holds(a, perm('task', 'reopen'), scope),
    cancel: open && holds(a, perm('task', 'cancel'), scope), subtask: open && !t.parent_id && (holds(a, perm('task', 'assign'), scope) || mine),
  };
}

function requireUpdater(a: Actor, t: Row): void {
  const scope = commandScopeOf(t);
  authorize(a, perm('task', 'update'), scope);
  const me = myPersonId(a, t.command_id as string);
  if (t.assignee_person_id !== me && !holds(a, perm('task', 'assign'), scope)) throw new AppError('FORBIDDEN', 'Only the assignee or a supervisor can update this task');
}
const requireOpen = (t: Row): void => { if (TERMINAL.includes(t.status as string)) throw new AppError('WORKFLOW_BLOCKED', `The task is ${t.status as string}`); };
/** FR-T2: once a task is overdue, or its target date moves later, a delay reason is required. */
function needsDelayReason(t: Row, newTarget: string | null | undefined, given: string | null | undefined): void {
  const today = todayLocal();
  const later = newTarget !== undefined && !!t.target_date && (!newTarget || newTarget > (t.target_date as string));
  if ((isOverdue(t, today) || later) && !given && !t.delay_reason) throw new AppError('VALIDATION_FAILED', later ? 'Give the reason for moving the target date later' : 'The task is overdue: give the reason for the delay');
}

export function updateTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskUpdate, input);
  const t = getVisible(a, id);
  requireUpdater(a, t);
  requireOpen(t);
  checkUnit(a, t.command_id as string, v.unitId);
  if (v.targetDate !== undefined) {
    const later = !!t.target_date && (!v.targetDate || v.targetDate > (t.target_date as string));
    if (later && !v.delayReason && !v.reason) throw new AppError('VALIDATION_FAILED', 'Give the reason for moving the target date later');
    if (t.parent_id && v.targetDate) {
      const p = mustGet(a.wctx.db, T, t.parent_id as string, 'Task');
      if (p.target_date && v.targetDate > (p.target_date as string)) throw new AppError('VALIDATION_FAILED', `A subtask cannot be due after its main task (${p.target_date as string})`);
    }
  }
  const delay = v.delayReason ?? (v.targetDate !== undefined && v.targetDate !== t.target_date ? v.reason : undefined);
  return updateWithHistory(a, 'ofc.task', t, { ...v, ...(delay ? { delayReason: delay } : {}), reason: v.reason ?? v.delayReason ?? null }, { keyFields: ['title'] });
}

export function assignTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskAssign, input);
  const t = getVisible(a, id);
  authorize(a, perm('task', 'assign'), commandScopeOf(t));
  requireOpen(t);
  if (t.assignee_person_id === v.assigneePersonId) return t;
  if (t.assignee_person_id && !v.reason) throw new AppError('VALIDATION_FAILED', 'Give the reason for reassigning the task');
  checkPerson(a, t.command_id as string, v.assigneePersonId);
  const status = t.status === 'not_started' ? 'assigned' : (t.status as string);
  return updateWithHistory(a, 'ofc.task', t, { expectedVersion: v.expectedVersion, assigneePersonId: v.assigneePersonId, assignedBy: a.principal.userId, status, reason: v.reason ?? null });
}

export function setTaskStatus(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskStatusIn, input);
  const t = getVisible(a, id);
  requireUpdater(a, t);
  requireOpen(t);
  if (!(MOVES[t.status as string] ?? []).includes(v.status)) throw new AppError('WORKFLOW_BLOCKED', `A task cannot go from ${t.status as string} to ${v.status}`);
  if (v.status === 'assigned' && !t.assignee_person_id) throw new AppError('WORKFLOW_BLOCKED', 'Assign the task to someone first');
  needsDelayReason(t, undefined, v.delayReason);
  return a.wctx.db.transaction(() => {
    const next = updateWithHistory(a, 'ofc.task', t, { expectedVersion: v.expectedVersion, status: v.status, ...(v.delayReason ? { delayReason: v.delayReason } : {}), reason: v.note ?? null });
    return next;
  })();
}

/** FR-T5: the assignee completes; a main task cannot be completed while a subtask is open. */
export function completeTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskComplete, input);
  const t = getVisible(a, id);
  requireUpdater(a, t);
  requireOpen(t);
  if (!t.assignee_person_id) throw new AppError('WORKFLOW_BLOCKED', 'Assign the task before completing it');
  const open = (a.wctx.db.prepare(`SELECT COUNT(*) AS n FROM ${T} WHERE parent_id = ? AND deleted_at IS NULL AND status NOT IN ('completed','closed','cancelled')`).get(id) as { n: number }).n;
  if (open) throw new AppError('WORKFLOW_BLOCKED', `${open} subtask(s) are still open`);
  needsDelayReason(t, undefined, v.delayReason);
  return a.wctx.db.transaction(() => {
    recordEvent(a, { type: 'ofc.task', id }, commandScopeOf(t), { kind: 'progress', note: v.note });
    return updateWithHistory(a, 'ofc.task', t, {
      expectedVersion: v.expectedVersion, status: 'completed', completionNote: v.note, completedAt: todayLocal(), completedBy: a.principal.userId, progressPct: 100,
      ...(v.delayReason ? { delayReason: v.delayReason } : {}),
    });
  })();
}

/**
 * Who may verify and close (FR-T4, A5): never the assignee; otherwise the in-charge or officer of the task's unit or of a unit above it.
 * When the unit's rule is "officer_required", only its officer (deputy) or someone above the unit. Holders of ofc.scope.all (the OIC)
 * may always verify; closing their own task needs a self-closure note. Returns null when allowed, else the reason.
 */
function verifierCheck(a: Actor, t: Row, note?: string | null): string | null {
  return checkVerifier(a, 'task', t.command_id as string, t.unit_id as string | null, [t.assignee_person_id as string | null], note);
}

/** Shared by tasks and work orders. `workers` are the people who did the work: none of them may verify it. */
export function checkVerifier(a: Actor, noun: 'task' | 'work_order', commandId: string, unitId: string | null, workers: Array<string | null>, note?: string | null): string | null {
  const scope = commandScope(commandId);
  if (!holds(a, perm(noun, 'verify'), scope)) return 'You do not hold the verification permission';
  const me = myPersonId(a, commandId);
  const oic = holds(a, 'ofc.scope.all', scope);
  if (me && workers.includes(me)) return oic && note ? null : 'You cannot verify your own work';
  if (oic) return null;
  const uid = a.principal.userId;
  let unit = unitId ? mustGet(a.wctx.db, 'ofc_org_unit', unitId, 'Unit') : undefined;
  if (!unit) return 'No section or workshop is set; only the officer in charge can verify it';
  const own = unit;
  if (own.verify_rule === 'officer_required' ? own.deputy_user_id === uid || (!own.deputy_user_id && own.head_user_id === uid) : own.head_user_id === uid || own.deputy_user_id === uid) return null;
  for (let guard = 0; unit.parent_id && guard < 10; guard++) {
    unit = mustGet(a.wctx.db, 'ofc_org_unit', unit.parent_id as string, 'Unit');
    if (unit.head_user_id === uid || unit.deputy_user_id === uid) return null;
  }
  return own.verify_rule === 'officer_required' ? `The officer of ${own.name as string} or someone above must verify this` : `The in-charge of ${own.name as string} or someone above must verify this`;
}

export function closeTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskClose, input);
  const t = getVisible(a, id);
  authorize(a, perm('task', 'verify'), commandScopeOf(t));
  if (t.status !== 'completed') throw new AppError('WORKFLOW_BLOCKED', 'Only a completed task can be verified and closed');
  const why = verifierCheck(a, t, v.note);
  if (why) throw new AppError('FORBIDDEN', why);
  const self = myPersonId(a, t.command_id as string) === t.assignee_person_id;
  return updateWithHistory(a, 'ofc.task', t, {
    expectedVersion: v.expectedVersion, status: 'closed', closedAt: todayLocal(), closedBy: a.principal.userId, verifyNote: self ? `Self-closure: ${v.note ?? ''}` : (v.note ?? null), reason: v.note ?? null,
  });
}

export function reopenTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskReason, input);
  const t = getVisible(a, id);
  authorize(a, perm('task', 'reopen'), commandScopeOf(t));
  if (!['completed', 'closed'].includes(t.status as string)) throw new AppError('WORKFLOW_BLOCKED', 'Only a completed or closed task can be reopened');
  return a.wctx.db.transaction(() => {
    recordEvent(a, { type: 'ofc.task', id }, commandScopeOf(t), { kind: 'reopen', note: v.reason });
    return updateWithHistory(a, 'ofc.task', t, { expectedVersion: v.expectedVersion, status: 'in_progress', closedAt: null, closedBy: null, verifyNote: null, reason: v.reason });
  })();
}

export function cancelTask(a: Actor, id: string, input: unknown): Row {
  const v = parse(TaskReason, input);
  const t = getVisible(a, id);
  authorize(a, perm('task', 'cancel'), commandScopeOf(t));
  requireOpen(t);
  const open = (a.wctx.db.prepare(`SELECT COUNT(*) AS n FROM ${T} WHERE parent_id = ? AND deleted_at IS NULL AND status NOT IN ('completed','closed','cancelled')`).get(id) as { n: number }).n;
  if (open) throw new AppError('WORKFLOW_BLOCKED', `Cancel or finish the ${open} open subtask(s) first`);
  return updateWithHistory(a, 'ofc.task', t, { expectedVersion: v.expectedVersion, status: 'cancelled', reason: v.reason });
}

const SORT: Record<string, string> = {
  refNo: 'ref_no', title: 'title', targetDate: "COALESCE(target_date,'9999')", status: 'status', updatedAt: 'updated_at',
  priority: "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END",
};
/** One query behind the task list, the dashboard tiles and the reports, so they always agree (FR-D4). */
export function taskWhere(a: Actor, v: z.infer<typeof TaskList>, dueSoonDays = 7): { where: string[]; params: unknown[] } {
  const today = todayLocal();
  const vis = visibility(a, v.commandId);
  const lim = visibleWhere(vis, 'unit_id', ['assignee_person_id']);
  const where = ['command_id = ?', ...lim.where];
  const params: unknown[] = [v.commandId, ...lim.params];
  const open = "status NOT IN ('completed','closed','cancelled')";
  switch (v.view) {
    case 'active': where.push(open); break;
    case 'overdue': where.push(open, 'target_date < ?'); params.push(today); break;
    case 'due_soon': where.push(open, 'target_date >= ? AND target_date <= ?'); params.push(today, addDays(today, dueSoonDays)); break;
    case 'awaiting_verification': where.push("status = 'completed'"); break;
    case 'attention': where.push(open, "(priority = 'immediate' OR target_date < ?)"); params.push(addDays(today, -14)); break;
    case 'done': where.push("status IN ('completed','closed')"); break;
    case 'all': break;
  }
  for (const [val, col] of [[v.status, 'status'], [v.assigneePersonId, 'assignee_person_id'], [v.unitId, 'unit_id'], [v.priority, 'priority'], [v.parentId, 'parent_id']] as const) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  if (v.topLevel === 'true') where.push('parent_id IS NULL');
  if (v.mine === 'true') { where.push('assignee_person_id = ?'); params.push(vis.personId ?? '-'); }
  const dateCol = v.view === 'done' ? "COALESCE(closed_at, completed_at)" : "COALESCE(target_date, substr(created_at,1,10))";
  if (v.from) { where.push(`${dateCol} >= ?`); params.push(v.from); }
  if (v.to) { where.push(`${dateCol} <= ?`); params.push(v.to); }
  return { where, params };
}

export function listTasks(a: Actor, raw: unknown) {
  const v = parse(TaskList, raw);
  authorize(a, perm('task', 'view'), commandScope(v.commandId));
  const { where, params } = taskWhere(a, v);
  const { rows, total } = pageOf(a.wctx.db, T, where, params, v, ['ref_no', 'title', 'description', 'remarks', 'delay_reason'], SORT, "CASE WHEN target_date IS NULL THEN 1 ELSE 0 END, target_date, CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END");
  const today = todayLocal();
  const counts = new Map((a.wctx.db.prepare(`SELECT parent_id, COUNT(*) AS n, SUM(CASE WHEN status IN ('completed','closed','cancelled') THEN 1 ELSE 0 END) AS done FROM ${T} WHERE parent_id IS NOT NULL AND deleted_at IS NULL AND command_id = ? GROUP BY parent_id`).all(v.commandId) as Row[]).map((r) => [r.parent_id as string, r]));
  return { total, items: rows.map((r) => ({ ...withFlags(r, today), subtaskCount: (counts.get(r.id as string)?.n as number) ?? 0, subtaskDone: (counts.get(r.id as string)?.done as number) ?? 0 }) as Row) };
}
