/**
 * Daily crew attendance. The in-charge of a workshop marks each of its people once a day; officers see the same figures
 * rolled up to the section and the department. Leave, sick, course and duty periods already in the personnel register
 * are offered as the day's mark, so only the exceptions need changing.
 */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { createRecord, updateRecord, type Row } from '../../platform/records.js';
import { authorize, type Actor } from './actor.js';
import { daysBetween, todayLocal } from './common.js';
import { perm } from './permissions.js';
import { unitAndDescendants, unitTree } from './queries.js';
import { parse } from './schemas.js';
import { visibility } from './scope.js';
import { commandScope } from './service.js';

const A = 'ofc_attendance';
export const ATTENDANCE_STATUSES = ['present', 'late', 'leave', 'sick', 'duty', 'course', 'absent', 'off'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
/** Counted as "at work" for the attendance percentage. */
export const AT_WORK: readonly AttendanceStatus[] = ['present', 'late'];
/** A duty period in the personnel register suggests the day's mark. */
const FROM_DUTY: Record<string, AttendanceStatus> = { on_leave: 'leave', sick: 'sick', course: 'course', temporary_duty: 'duty' };
const MAX_RANGE_DAYS = 366;

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const SheetQuery = z.strictObject({ commandId: z.uuid(), unitId: z.uuid(), date: LocalDate.optional() });
export const MarkInput = z.strictObject({
  commandId: z.uuid(), date: LocalDate,
  entries: z.array(z.strictObject({ personId: z.uuid(), status: z.enum(ATTENDANCE_STATUSES), remarks: z.string().trim().max(300).nullable().optional() })).min(1).max(500),
});
export const SummaryQuery = z.strictObject({ commandId: z.uuid(), from: LocalDate.optional(), to: LocalDate.optional(), date: LocalDate.optional() });

/** Units the user may work with: everything with ofc.scope.all, otherwise their own unit, the units they lead, and below. */
function visibleUnits(a: Actor, commandId: string): Set<string> | null {
  const v = visibility(a, commandId);
  return v.all ? null : new Set(v.units);
}
function assertUnit(a: Actor, commandId: string, unitId: string): Row {
  const u = a.wctx.db.prepare('SELECT * FROM ofc_org_unit WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(unitId, commandId) as Row | undefined;
  if (!u) throw new AppError('NOT_FOUND', 'Unit not found in this office');
  const vis = visibleUnits(a, commandId);
  if (vis && !vis.has(unitId)) throw new AppError('FORBIDDEN', 'This unit belongs to another section or workshop');
  return u;
}
const activeStaffSql = "p.command_id = ? AND p.deleted_at IS NULL AND p.status = 'active' AND p.duty_status <> 'transferred'";

/** The day's sheet for a unit and the units under it: each person with their mark, or the suggested mark when not yet marked. */
export function attendanceSheet(a: Actor, input: unknown) {
  const q = parse(SheetQuery, input);
  authorize(a, perm('attendance', 'view'), commandScope(q.commandId));
  const unit = assertUnit(a, q.commandId, q.unitId);
  const date = q.date ?? todayLocal();
  const db = a.wctx.db;
  const units = unitAndDescendants(db, q.unitId);
  const paths = new Map(unitTree(db, q.commandId, true).map((u) => [u.id as string, u.path as string]));
  const people = db.prepare(
    `SELECT p.id, p.rank, p.name, p.service_no, p.unit_id, a.id AS att_id, a.version AS att_version, a.status, a.remarks, a.marked_by_name, a.updated_at AS marked_at,
            (SELECT d.duty_status FROM ofc_duty_period d WHERE d.person_id = p.id AND d.deleted_at IS NULL AND d.date_from <= ? AND (d.date_to IS NULL OR d.date_to >= ?) ORDER BY d.date_from DESC LIMIT 1) AS duty
       FROM ofc_person p LEFT JOIN ${A} a ON a.person_id = p.id AND a.att_date = ? AND a.deleted_at IS NULL
      WHERE ${activeStaffSql} AND p.unit_id IN (${units.map(() => '?').join(',')})
      ORDER BY p.unit_id, p.name`,
  ).all(date, date, date, q.commandId, ...units) as Row[];
  let canRecord = true;
  try { authorize(a, perm('attendance', 'record'), commandScope(q.commandId)); } catch { canRecord = false; }
  return {
    date, unit: { id: unit.id, code: unit.code, name: unit.name }, canRecord, future: date > todayLocal(),
    rows: people.map((p) => ({
      personId: p.id, rank: p.rank, name: p.name, serviceNo: p.service_no, unitId: p.unit_id, unitPath: paths.get(p.unit_id as string) ?? null,
      status: p.status ?? null, remarks: p.remarks ?? null, markedBy: p.marked_by_name ?? null, markedAt: p.marked_at ?? null,
      suggested: (p.status as string | null) ?? FROM_DUTY[p.duty as string] ?? 'present',
    })),
  };
}

/** Save the marks for one day (new or corrected). Each person must be active and in a unit the user may see. */
export function markAttendance(a: Actor, input: unknown) {
  const v = parse(MarkInput, input);
  authorize(a, perm('attendance', 'record'), commandScope(v.commandId));
  if (v.date > todayLocal()) throw new AppError('VALIDATION_FAILED', 'Attendance cannot be marked for a future date');
  if (new Set(v.entries.map((e) => e.personId)).size !== v.entries.length) throw new AppError('VALIDATION_FAILED', 'A person appears twice');
  const db = a.wctx.db;
  const vis = visibleUnits(a, v.commandId);
  const by = a.principal.displayName ?? null;
  let created = 0, changed = 0;
  db.transaction(() => {
    for (const e of v.entries) {
      const p = db.prepare(`SELECT p.id, p.unit_id, p.name FROM ofc_person p WHERE p.id = ? AND ${activeStaffSql}`).get(e.personId, v.commandId) as Row | undefined;
      if (!p) throw new AppError('VALIDATION_FAILED', 'Person not found or not active in this office');
      if (vis && !(p.unit_id && vis.has(p.unit_id as string))) throw new AppError('FORBIDDEN', `${String(p.name)} belongs to another section or workshop`);
      const cur = db.prepare(`SELECT * FROM ${A} WHERE person_id = ? AND att_date = ? AND deleted_at IS NULL`).get(e.personId, v.date) as Row | undefined;
      const remarks = e.remarks ?? null;
      if (!cur) {
        createRecord(a.wctx, 'ofc.attendance', { home_scope_id: v.commandId, command_id: v.commandId, person_id: e.personId, unit_id: p.unit_id ?? null, att_date: v.date, status: e.status, remarks, marked_by_name: by });
        created++;
      } else if (cur.status !== e.status || (cur.remarks ?? null) !== remarks) {
        updateRecord(a.wctx, 'ofc.attendance', cur.id as string, cur.version as number, { status: e.status, remarks, marked_by_name: by });
        changed++;
      }
    }
  })();
  return { date: v.date, created, changed, unchanged: v.entries.length - created - changed };
}

type Counts = Record<AttendanceStatus, number> & { strength: number; marked: number; notMarked: number; atWork: number };
const emptyCounts = (): Counts => ({ ...(Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>), strength: 0, marked: 0, notMarked: 0, atWork: 0 });
const addInto = (to: Counts, from: Counts) => { for (const k of Object.keys(to) as Array<keyof Counts>) to[k] += from[k]; };

/**
 * Attendance by unit for one day or a period, each unit with its own people and the total of everything under it,
 * so a workshop rolls up into its section and the section into its department. Over a period the figures are man-days.
 */
export function attendanceSummary(a: Actor, input: unknown) {
  const q = parse(SummaryQuery, input);
  authorize(a, perm('attendance', 'view'), commandScope(q.commandId));
  const from = q.from ?? q.date ?? todayLocal();
  const to = q.to ?? q.date ?? from;
  if (to < from) throw new AppError('VALIDATION_FAILED', 'The end date is before the start date');
  const days = daysBetween(from, to) + 1;
  if (days > MAX_RANGE_DAYS) throw new AppError('VALIDATION_FAILED', `Choose at most ${MAX_RANGE_DAYS} days`);
  const db = a.wctx.db;
  const tree = unitTree(db, q.commandId);
  const own = new Map<string, Counts>(tree.map((u) => [u.id as string, emptyCounts()]));
  for (const r of db.prepare(`SELECT p.unit_id, COUNT(*) AS n FROM ofc_person p WHERE ${activeStaffSql} GROUP BY p.unit_id`).all(q.commandId) as Array<{ unit_id: string | null; n: number }>) {
    const c = r.unit_id ? own.get(r.unit_id) : undefined;
    if (c) c.strength += r.n;
  }
  for (const r of db.prepare(`SELECT unit_id, status, COUNT(*) AS n FROM ${A} WHERE command_id = ? AND deleted_at IS NULL AND att_date BETWEEN ? AND ? GROUP BY unit_id, status`).all(q.commandId, from, to) as Array<{ unit_id: string | null; status: AttendanceStatus; n: number }>) {
    const c = r.unit_id ? own.get(r.unit_id) : undefined;
    if (!c) continue;
    c[r.status] += r.n;
    c.marked += r.n;
    if (AT_WORK.includes(r.status)) c.atWork += r.n;
  }
  // Not marked: today's people of the unit, for each day of the period, without a mark that day.
  for (const r of db.prepare(
    `SELECT p.unit_id, COUNT(a.id) AS n FROM ofc_person p JOIN ${A} a ON a.person_id = p.id AND a.deleted_at IS NULL AND a.att_date BETWEEN ? AND ?
      WHERE ${activeStaffSql} GROUP BY p.unit_id`,
  ).all(from, to, q.commandId) as Array<{ unit_id: string | null; n: number }>) {
    const c = r.unit_id ? own.get(r.unit_id) : undefined;
    if (c) c.notMarked -= r.n;
  }
  for (const c of own.values()) c.notMarked = Math.max(0, c.notMarked + c.strength * days);

  const kids = new Map<string, string[]>();
  for (const u of tree) if (u.parent_id) kids.set(u.parent_id as string, [...(kids.get(u.parent_id as string) ?? []), u.id as string]);
  const total = new Map<string, Counts>();
  const sum = (id: string): Counts => {
    const hit = total.get(id);
    if (hit) return hit;
    const t = emptyCounts();
    addInto(t, own.get(id) ?? emptyCounts());
    for (const k of kids.get(id) ?? []) addInto(t, sum(k));
    total.set(id, t);
    return t;
  };
  const vis = visibleUnits(a, q.commandId);
  const office = emptyCounts();
  for (const u of tree) if (!u.parent_id || !own.has(u.parent_id as string)) addInto(office, sum(u.id as string));
  return {
    from, to, days, statuses: ATTENDANCE_STATUSES, atWork: AT_WORK,
    units: tree.filter((u) => !vis || vis.has(u.id as string)).map((u) => ({
      id: u.id, code: u.code, name: u.name, level: u.level, depth: u.depth, path: u.path, parentId: u.parent_id ?? null,
      own: own.get(u.id as string), total: sum(u.id as string),
    })),
    office: vis ? null : office,
  };
}
