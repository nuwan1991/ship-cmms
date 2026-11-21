/** Personnel and responsibility register (spec §1.6, FR-P1..P5). */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { createRecord, updateRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { commandScopeOf, holds, mustGet, todayLocal, updateWithHistory } from './common.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { visibility } from './scope.js';
import { commandScope, recordEvent } from './service.js';

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Version = z.number().int().min(1);
const DUTY = ['available', 'on_leave', 'temporary_duty', 'course', 'sick', 'transferred'] as const;

const personFields = {
  userId: z.string().trim().min(1).max(64).nullable().optional(), serviceNo: Text(40), rank: Text(60), name: z.string().trim().min(1).max(160),
  appointment: Text(160), unitId: z.uuid().nullable().optional(), supervisorPersonId: z.uuid().nullable().optional(), contact: Text(200), remarks: Text(2000),
};
export const PersonCreate = z.strictObject({ commandId: z.uuid(), ...personFields });
export const PersonUpdate = z.strictObject({
  expectedVersion: Version, ...personFields, name: personFields.name.optional(), dutyStatus: z.enum(DUTY).optional(), status: z.enum(['active', 'inactive']).optional(), reason: Text(500),
});
export const ResponsibilityCreate = z.strictObject({ title: z.string().trim().min(1).max(200), unitId: z.uuid().nullable().optional(), validFrom: LocalDate.optional(), remarks: Text(1000), sourceType: Text(40), sourceId: z.uuid().nullable().optional() });
export const ResponsibilityEnd = z.strictObject({ expectedVersion: Version, validTo: LocalDate.optional(), reason: z.string().trim().min(1).max(500) });
export const DutyCreate = z.strictObject({
  dutyStatus: z.enum(['on_leave', 'temporary_duty', 'course', 'sick']), dateFrom: LocalDate, dateTo: LocalDate.nullable().optional(), place: Text(200),
  actingPersonId: z.uuid().nullable().optional(), remarks: Text(1000),
});
export const Reassign = z.strictObject({ toPersonId: z.uuid(), reason: z.string().trim().min(1).max(500), includeHandoverItems: z.boolean().default(true), includeCorrespondence: z.boolean().default(true) });

function checkRefs(a: Actor, commandId: string, v: { unitId?: string | null | undefined; supervisorPersonId?: string | null | undefined }, selfId?: string): void {
  if (v.unitId && !a.wctx.db.prepare('SELECT 1 FROM ofc_org_unit WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(v.unitId, commandId)) throw new AppError('VALIDATION_FAILED', 'Unit not found in this office');
  if (v.supervisorPersonId) {
    if (v.supervisorPersonId === selfId) throw new AppError('VALIDATION_FAILED', 'A person cannot supervise themselves');
    if (!a.wctx.db.prepare('SELECT 1 FROM ofc_person WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(v.supervisorPersonId, commandId)) throw new AppError('VALIDATION_FAILED', 'Supervisor not found in this office');
  }
}
const dupMsg = (e: unknown): never => {
  if (e instanceof Error && /ofc_person.service_no/.test(e.message)) throw new AppError('DUPLICATE', 'That service number is already registered');
  if (e instanceof Error && /ofc_person.user_id/.test(e.message)) throw new AppError('DUPLICATE', 'That user is already linked to another person');
  throw e;
};

export function createPerson(a: Actor, input: unknown): Row {
  const v = parse(PersonCreate, input);
  if (!resolveParty(a.wctx.db, { kind: 'command', id: v.commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm('person', 'create'), commandScope(v.commandId));
  checkRefs(a, v.commandId, v);
  try {
    return createRecord(a.wctx, 'ofc.person', {
      home_scope_id: v.commandId, command_id: v.commandId, user_id: v.userId ?? null, service_no: v.serviceNo ?? null, rank: v.rank ?? null, name: v.name,
      appointment: v.appointment ?? null, unit_id: v.unitId ?? null, supervisor_person_id: v.supervisorPersonId ?? null, contact: v.contact ?? null, remarks: v.remarks ?? null,
    });
  } catch (e) { return dupMsg(e); }
}

export function updatePerson(a: Actor, id: string, input: unknown): Row {
  const v = parse(PersonUpdate, input);
  const cur = mustGet(a.wctx.db, 'ofc_person', id, 'Person');
  authorize(a, perm('person', 'update'), commandScopeOf(cur));
  checkRefs(a, cur.command_id as string, v, id);
  try {
    return updateWithHistory(a, 'ofc.person', cur, v, { keyFields: ['serviceNo', 'name'] });
  } catch (e) { return dupMsg(e); }
}

/** Contact details are shown only with ofc.person.view_contact (FR-P1). */
export const maskPerson = (a: Actor, r: Row): Row => (r.contact && !holds(a, perm('person', 'view_contact'), commandScopeOf(r)) ? { ...r, contact: null } : r);

const OPEN_TASK = "status NOT IN ('completed','closed','cancelled')";
export function listPersons(a: Actor, commandId: string, opts: { includeInactive?: boolean; unitId?: string } = {}): Row[] {
  authorize(a, perm('person', 'view'), commandScope(commandId));
  const today = todayLocal();
  const rows = a.wctx.db.prepare(
    `SELECT p.*,
       (SELECT COUNT(*) FROM ofc_task t WHERE t.assignee_person_id = p.id AND t.deleted_at IS NULL AND t.${OPEN_TASK}) AS active_tasks,
       (SELECT COUNT(*) FROM ofc_task t WHERE t.assignee_person_id = p.id AND t.deleted_at IS NULL AND t.${OPEN_TASK} AND t.target_date < ?) AS overdue_tasks,
       (SELECT COUNT(*) FROM ofc_task t WHERE t.assignee_person_id = p.id AND t.deleted_at IS NULL AND t.status = 'completed') AS awaiting_verify
     FROM ofc_person p WHERE p.command_id = ? AND p.deleted_at IS NULL ${opts.includeInactive ? '' : "AND p.status = 'active'"} ${opts.unitId ? 'AND p.unit_id = ?' : ''}
     ORDER BY p.name`,
  ).all(today, commandId, ...(opts.unitId ? [opts.unitId] : [])) as Row[];
  return rows.map((r) => maskPerson(a, r));
}

/** Person with responsibilities, duty periods, open work and task history (FR-P3, FR-P5). */
export function personDetail(a: Actor, id: string) {
  const p = mustGet(a.wctx.db, 'ofc_person', id, 'Person');
  authorize(a, perm('person', 'view'), commandScopeOf(p));
  const db = a.wctx.db;
  const today = todayLocal();
  const vis = visibility(a, p.command_id as string);
  const tasks = (db.prepare(`SELECT * FROM ofc_task WHERE assignee_person_id = ? AND deleted_at IS NULL ORDER BY CASE WHEN ${OPEN_TASK} THEN 0 ELSE 1 END, target_date`).all(id) as Row[])
    .filter((t) => vis.all || vis.units.includes(t.unit_id as string) || t.assignee_person_id === vis.personId)
    .map((t) => ({ ...t, overdue: !['completed', 'closed', 'cancelled'].includes(t.status as string) && !!t.target_date && (t.target_date as string) < today }));
  // Tasks this person held before being reassigned stay in their history (FR-P5).
  const formerly = db.prepare(
    `SELECT DISTINCT t.id, t.ref_no, t.title, t.status, t.assignee_person_id FROM ofc_record_event e JOIN ofc_task t ON t.id = e.record_id
      WHERE e.record_type = 'ofc.task' AND e.kind = 'assign' AND e.from_value = ? AND t.assignee_person_id IS NOT ?`,
  ).all(id, id) as Row[];
  return {
    person: maskPerson(a, p),
    responsibilities: db.prepare('SELECT * FROM ofc_responsibility WHERE person_id = ? AND deleted_at IS NULL ORDER BY valid_to IS NOT NULL, valid_from DESC').all(id) as Row[],
    duty: db.prepare('SELECT * FROM ofc_duty_period WHERE person_id = ? AND deleted_at IS NULL ORDER BY date_from DESC').all(id) as Row[],
    tasks, formerly,
    handoverItems: db.prepare("SELECT id, ref_no, subject, status, target_date FROM ofc_handover_item WHERE responsible_user_id = ? AND deleted_at IS NULL AND status NOT IN ('completed','not_applicable')").all(id) as Row[],
    correspondence: db.prepare("SELECT id, ref_no, subject, reply_due, classification FROM ofc_v_correspondence_pending WHERE action_user_id = ?").all(id) as Row[],
  };
}

export function addResponsibility(a: Actor, personId: string, input: unknown): Row {
  const p = mustGet(a.wctx.db, 'ofc_person', personId, 'Person');
  authorize(a, perm('person', 'update'), commandScopeOf(p));
  const v = parse(ResponsibilityCreate, input);
  const row = createRecord(a.wctx, 'ofc.responsibility', {
    home_scope_id: p.command_id, command_id: p.command_id, person_id: personId, title: v.title, unit_id: v.unitId ?? null, valid_from: v.validFrom ?? todayLocal(),
    source_type: v.sourceType ?? null, source_id: v.sourceId ?? null, remarks: v.remarks ?? null,
  });
  recordEvent(a, { type: 'ofc.person', id: personId }, commandScopeOf(p), { kind: 'assign', field: 'responsibility', to: v.title });
  return row;
}

/** Responsibilities are ended, never deleted, so who held what and when stays on record. */
export function endResponsibility(a: Actor, id: string, input: unknown): Row {
  const cur = mustGet(a.wctx.db, 'ofc_responsibility', id, 'Responsibility');
  authorize(a, perm('person', 'update'), commandScopeOf(cur));
  const v = parse(ResponsibilityEnd, input);
  const to = v.validTo ?? todayLocal();
  if (to < (cur.valid_from as string)) throw new AppError('VALIDATION_FAILED', 'End date is before the start date');
  const row = updateRecord(withReason(a, v.reason).wctx, 'ofc.responsibility', id, v.expectedVersion, { valid_to: to });
  recordEvent(a, { type: 'ofc.person', id: cur.person_id as string }, commandScopeOf(cur), { kind: 'assign', field: 'responsibility', from: cur.title, to: null, note: v.reason });
  return row;
}

export function addDutyPeriod(a: Actor, personId: string, input: unknown): Row {
  const p = mustGet(a.wctx.db, 'ofc_person', personId, 'Person');
  authorize(a, perm('person', 'update'), commandScopeOf(p));
  const v = parse(DutyCreate, input);
  if (v.dateTo && v.dateTo < v.dateFrom) throw new AppError('VALIDATION_FAILED', 'End date is before the start date');
  if (v.actingPersonId === personId) throw new AppError('VALIDATION_FAILED', 'The acting person must be someone else');
  return a.wctx.db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.duty_period', {
      home_scope_id: p.command_id, command_id: p.command_id, person_id: personId, duty_status: v.dutyStatus, date_from: v.dateFrom, date_to: v.dateTo ?? null,
      place: v.place ?? null, acting_person_id: v.actingPersonId ?? null, remarks: v.remarks ?? null,
    });
    recordEvent(a, { type: 'ofc.person', id: personId }, commandScopeOf(p), { kind: 'status', field: 'duty', to: `${v.dutyStatus} ${v.dateFrom}–${v.dateTo ?? ''}`, note: v.place ?? null });
    return row;
  })();
}

/** Duty status today: an active duty period wins, else the person's own status (available / transferred). */
export function dutyToday(a: Actor, person: Row): string {
  if (person.duty_status === 'transferred') return 'transferred';
  const today = todayLocal();
  const d = a.wctx.db.prepare('SELECT duty_status FROM ofc_duty_period WHERE person_id = ? AND deleted_at IS NULL AND date_from <= ? AND (date_to IS NULL OR date_to >= ?) ORDER BY date_from DESC').get(person.id, today, today) as { duty_status: string } | undefined;
  return d?.duty_status ?? (person.duty_status as string);
}

/**
 * FR-P4/WF6: move every open task (and optionally open handover items and pending letters) of one person to another.
 * Each record gets an "assign" history entry with the reason, so the former owner stays visible.
 */
export function reassignAll(a: Actor, personId: string, input: unknown) {
  const from = mustGet(a.wctx.db, 'ofc_person', personId, 'Person');
  authorize(a, perm('person', 'reassign'), commandScopeOf(from));
  const v = parse(Reassign, input);
  const to = mustGet(a.wctx.db, 'ofc_person', v.toPersonId, 'Person');
  if (to.command_id !== from.command_id || to.status !== 'active') throw new AppError('VALIDATION_FAILED', 'Reassign to an active person of the same office');
  if (to.id === from.id) throw new AppError('VALIDATION_FAILED', 'Choose a different person');
  const db = a.wctx.db;
  return db.transaction(() => {
    const move = (table: string, type: string, col: string, where: string) => {
      const rows = db.prepare(`SELECT * FROM ${table} WHERE ${col} = ? AND deleted_at IS NULL AND ${where}`).all(personId) as Row[];
      for (const r of rows) updateWithHistory(a, type, r, { expectedVersion: r.version as number, [col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())]: to.id, reason: v.reason });
      return rows.length;
    };
    const tasks = move('ofc_task', 'ofc.task', 'assignee_person_id', OPEN_TASK);
    const items = v.includeHandoverItems ? move('ofc_handover_item', 'ofc.handover_item', 'responsible_user_id', "status NOT IN ('completed','not_applicable')") : 0;
    const letters = v.includeCorrespondence ? move('ofc_correspondence', 'ofc.correspondence', 'action_user_id', 'id IN (SELECT id FROM ofc_v_correspondence_pending)') : 0;
    return { tasks, handoverItems: items, correspondence: letters };
  })();
}

export { DUTY as DUTY_STATUSES };
