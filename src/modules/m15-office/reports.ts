/**
 * Dashboard (spec §1.2) and the mandatory reports (spec §1.9). Counts and lists use the same filters as the list screens
 * (taskWhere, workOrderWhere, equipmentWhere, supplyWhere, visibility), so the dashboard always matches the lists (FR-D4).
 */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import type { Row } from '../../platform/records.js';
import type { CellValue, SheetOut } from '../m11-excel/index.js';
import { authorize, type Actor } from './actor.js';
import { addDays, todayLocal } from './common.js';
import { equipmentWhere, EquipList } from './equipment.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { visibility, visibleWhere } from './scope.js';
import { commandScope } from './service.js';
import { supplyWhere, SupplyList } from './supply.js';
import { TaskList, taskWhere } from './tasks.js';
import { WoList, workOrderWhere } from './workorders.js';

const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const DashQuery = z.strictObject({
  commandId: z.uuid(), unitId: z.uuid().optional(), personId: z.uuid().optional(), priority: z.enum(['immediate', 'high', 'normal', 'low']).optional(),
  from: LocalDate.optional(), to: LocalDate.optional(),
});
type Dash = z.infer<typeof DashQuery>;

const count = (a: Actor, table: string, w: { where: string[]; params: unknown[] }): number =>
  (a.wctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE deleted_at IS NULL AND ${w.where.join(' AND ')}`).get(...w.params) as { n: number }).n;

function corrWhere(a: Actor, q: Dash, pendingOnly: boolean, overdue = false): { where: string[]; params: unknown[] } {
  const lim = visibleWhere(visibility(a, q.commandId), 'unit_id', ['action_user_id']);
  const where = ['command_id = ?', ...lim.where];
  const params: unknown[] = [q.commandId, ...lim.params];
  if (pendingOnly) where.push('id IN (SELECT id FROM ofc_v_correspondence_pending)');
  if (overdue) { where.push('reply_due < ?'); params.push(todayLocal()); }
  if (q.unitId) { where.push('unit_id = ?'); params.push(q.unitId); }
  if (q.personId) { where.push('action_user_id = ?'); params.push(q.personId); }
  if (q.priority) { where.push('priority = ?'); params.push(q.priority); }
  return { where, params };
}
function hoiWhere(a: Actor, q: Dash, extra: string): { where: string[]; params: unknown[] } {
  const lim = visibleWhere(visibility(a, q.commandId), 'unit_id', ['responsible_user_id']);
  const where = ['command_id = ?', ...lim.where, extra];
  const params: unknown[] = [q.commandId, ...lim.params];
  if (q.unitId) { where.push('unit_id = ?'); params.push(q.unitId); }
  if (q.personId) { where.push('responsible_user_id = ?'); params.push(q.personId); }
  if (extra.includes('?')) params.push(todayLocal());
  return { where, params };
}

/** Each tile: its number and the list screen + filter that shows exactly those records. */
export function dashboard(a: Actor, raw: unknown) {
  const q = parse(DashQuery, raw);
  authorize(a, perm('report', 'view'), commandScope(q.commandId));
  const today = todayLocal();
  const from = q.from ?? addDays(today, -30);
  const to = q.to ?? today;
  const common = { commandId: q.commandId, ...(q.unitId ? { unitId: q.unitId } : {}), ...(q.priority ? { priority: q.priority } : {}) };
  const tw = (view: string, extra: Record<string, unknown> = {}) => taskWhere(a, TaskList.parse({ ...common, view, ...(q.personId ? { assigneePersonId: q.personId } : {}), ...extra }));
  const ww = (view: string) => workOrderWhere(a, WoList.parse({ ...common, view }));
  const tiles = [
    { key: 'active_tasks', n: count(a, 'ofc_task', tw('active')), link: { screen: 'tasks', view: 'active' } },
    { key: 'completed_period', n: count(a, 'ofc_task', tw('done', { from, to })), link: { screen: 'tasks', view: 'done', from, to } },
    { key: 'overdue_tasks', n: count(a, 'ofc_task', tw('overdue')), link: { screen: 'tasks', view: 'overdue' }, warn: true },
    { key: 'attention', n: count(a, 'ofc_task', tw('attention')), link: { screen: 'tasks', view: 'attention' }, warn: true },
    { key: 'awaiting_decision', n: count(a, 'ofc_task', tw('awaiting_verification')) + count(a, 'ofc_task', tw('active', { status: 'awaiting_approval' })) + count(a, 'ofc_work_order', ww('awaiting_approval')) + count(a, 'ofc_work_order', workOrderWhere(a, WoList.parse({ ...common, view: 'all', status: 'completed' }))),
      link: { screen: 'tasks', view: 'awaiting_verification' } },
    { key: 'due_soon', n: count(a, 'ofc_task', tw('due_soon')), link: { screen: 'tasks', view: 'due_soon' } },
    { key: 'outstanding_wo', n: count(a, 'ofc_work_order', ww('outstanding')), link: { screen: 'work-orders', view: 'outstanding' } },
    { key: 'overdue_wo', n: count(a, 'ofc_work_order', ww('overdue')), link: { screen: 'work-orders', view: 'overdue' }, warn: true },
    { key: 'pending_corr', n: count(a, 'ofc_correspondence', corrWhere(a, q, true)), link: { screen: 'correspondence', view: 'pending' } },
    { key: 'overdue_corr', n: count(a, 'ofc_correspondence', corrWhere(a, q, true, true)), link: { screen: 'correspondence', view: 'overdue' }, warn: true },
    { key: 'equip_collection', n: count(a, 'ofc_equipment', equipmentWhere(a, EquipList.parse({ commandId: q.commandId, view: 'pending_collection' }))), link: { screen: 'equipment', view: 'pending_collection' } },
    { key: 'equip_repair', n: count(a, 'ofc_equipment', equipmentWhere(a, EquipList.parse({ commandId: q.commandId, view: 'in_repair' }))), link: { screen: 'equipment', view: 'in_repair' } },
    { key: 'equip_overdue', n: count(a, 'ofc_equipment', equipmentWhere(a, EquipList.parse({ commandId: q.commandId, view: 'overdue_return' }))), link: { screen: 'equipment', view: 'overdue_return' }, warn: true },
    { key: 'supply_open', n: count(a, 'ofc_supply_demand', supplyWhere(a, SupplyList.parse({ commandId: q.commandId, view: 'open' }))), link: { screen: 'supply', view: 'open' } },
    { key: 'supply_overdue', n: count(a, 'ofc_supply_demand', supplyWhere(a, SupplyList.parse({ commandId: q.commandId, view: 'overdue' }))), link: { screen: 'supply', view: 'overdue' }, warn: true },
    { key: 'handover_open', n: count(a, 'ofc_handover_item', hoiWhere(a, q, "status NOT IN ('completed','not_applicable')")), link: { screen: 'handovers' } },
    { key: 'handover_overdue', n: count(a, 'ofc_handover_item', hoiWhere(a, q, "status NOT IN ('completed','not_applicable') AND target_date < ?")), link: { screen: 'handovers' }, warn: true },
  ];
  const db = a.wctx.db;
  const vis = visibility(a, q.commandId);
  const tAll = tw('active');
  const people = db.prepare(
    `SELECT p.id, p.name, p.rank, p.service_no,
       SUM(CASE WHEN t.id IS NOT NULL THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN t.target_date < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN t.target_date BETWEEN ? AND ? THEN 1 ELSE 0 END) AS due_soon
     FROM ofc_person p JOIN (SELECT * FROM ofc_task WHERE deleted_at IS NULL AND ${tAll.where.join(' AND ')}) t ON t.assignee_person_id = p.id
     WHERE p.command_id = ? GROUP BY p.id ORDER BY overdue DESC, active DESC, p.name`,
  ).all(today, today, addDays(today, 7), ...tAll.params, q.commandId) as Row[];
  const upcoming = db.prepare(`SELECT id, ref_no, title, target_date, assignee_person_id, priority, 'task' AS kind FROM ofc_task WHERE deleted_at IS NULL AND ${tw('due_soon').where.join(' AND ')} ORDER BY target_date LIMIT 15`).all(...tw('due_soon').params) as Row[];
  const done = tw('done', { from, to });
  const recent = db.prepare(`SELECT id, ref_no, title, status, COALESCE(closed_at, completed_at) AS done_at, assignee_person_id FROM ofc_task WHERE deleted_at IS NULL AND ${done.where.join(' AND ')} ORDER BY COALESCE(closed_at, completed_at) DESC, updated_at DESC LIMIT 10`).all(...done.params) as Row[];
  return { asOf: today, period: { from, to }, scope: vis.all ? 'office' : 'own_units', tiles, people, upcoming, recent };
}

// ---------------------------------------------------------------- reports

export const REPORTS = ['daily_outstanding', 'weekly_progress', 'monthly_summary', 'overdue_tasks', 'pending_correspondence', 'handover_completion', 'equipment_pending', 'workshop_progress', 'personnel_allocation', 'supply_status'] as const;
export type ReportCode = (typeof REPORTS)[number];
export const ReportQuery = z.strictObject({ commandId: z.uuid(), from: LocalDate.optional(), to: LocalDate.optional(), unitId: z.uuid().optional(), personId: z.uuid().optional() });
export interface ReportSection { title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, CellValue>> }
export interface Report { code: ReportCode; title: string; period: { from: string; to: string } | null; asOf: string; sections: ReportSection[] }

const TITLES: Record<ReportCode, string> = {
  daily_outstanding: 'Daily outstanding action report', weekly_progress: 'Weekly work progress report', monthly_summary: 'Monthly office activity summary',
  overdue_tasks: 'Overdue task report', pending_correspondence: 'Pending correspondence report', handover_completion: 'Handover completion report',
  equipment_pending: 'Equipment pending repair / return report', workshop_progress: 'Workshop work progress report', personnel_allocation: 'Personnel task allocation report',
  supply_status: 'Supply demand status report',
};
const PRIORITY_ORDER = "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END";
const cols = (spec: string): Array<{ key: string; label: string }> => spec.split('|').map((c) => { const [key, label] = c.split(':'); return { key: key!, label: label ?? key! }; });
const days = (from: string | null | undefined, to: string): number | null => (from ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : null);
const label = (v: unknown): string => String(v ?? '').replace(/_/g, ' ');

export function runReport(a: Actor, code: string, raw: unknown): Report {
  if (!(REPORTS as readonly string[]).includes(code)) throw new AppError('NOT_FOUND', `Unknown report ${code}`);
  const q = parse(ReportQuery, raw);
  authorize(a, perm('report', 'view'), commandScope(q.commandId));
  const db = a.wctx.db;
  const today = todayLocal();
  const c = code as ReportCode;
  const defaultFrom = c === 'weekly_progress' ? addDays(today, -6) : c === 'monthly_summary' ? `${today.slice(0, 8)}01` : addDays(today, -30);
  const from = q.from ?? defaultFrom;
  const to = q.to ?? today;
  if (from > to) throw new AppError('VALIDATION_FAILED', 'From is after To');
  const vis = visibility(a, q.commandId);
  const unitNames = new Map((db.prepare('SELECT id, code, name FROM ofc_org_unit WHERE command_id = ?').all(q.commandId) as Row[]).map((u) => [u.id as string, `${u.code as string}`]));
  const persons = new Map((db.prepare('SELECT id, rank, name FROM ofc_person WHERE command_id = ?').all(q.commandId) as Row[]).map((p) => [p.id as string, `${p.rank ? `${p.rank as string} ` : ''}${p.name as string}`]));
  const who = (id: unknown) => (id ? persons.get(id as string) ?? '' : '');
  const unit = (id: unknown) => (id ? unitNames.get(id as string) ?? '' : '');
  const latest = (type: string, id: unknown): string => {
    const e = db.prepare("SELECT note FROM ofc_record_event WHERE record_type = ? AND record_id = ? AND note IS NOT NULL AND kind IN ('progress','comment','status') ORDER BY occurred_at DESC, id DESC LIMIT 1").get(type, id) as { note: string } | undefined;
    return e?.note ?? '';
  };
  const filt = { commandId: q.commandId, ...(q.unitId ? { unitId: q.unitId } : {}) };
  const tasks = (view: string, extra: Record<string, unknown> = {}, order = 'target_date') => {
    const w = taskWhere(a, TaskList.parse({ ...filt, view, ...(q.personId ? { assigneePersonId: q.personId } : {}), ...extra }));
    return db.prepare(`SELECT * FROM ofc_task WHERE deleted_at IS NULL AND ${w.where.join(' AND ')} ORDER BY ${order}, ref_no`).all(...w.params) as Row[];
  };
  const wos = (view: string, extra: Record<string, unknown> = {}) => {
    const w = workOrderWhere(a, WoList.parse({ ...filt, view, ...extra }));
    return db.prepare(`SELECT * FROM ofc_work_order WHERE deleted_at IS NULL AND ${w.where.join(' AND ')} ORDER BY ${PRIORITY_ORDER}, request_date, ref_no`).all(...w.params) as Row[];
  };
  const pendingLetters = () => {
    const w = corrWhere(a, { commandId: q.commandId, ...(q.unitId ? { unitId: q.unitId } : {}), ...(q.personId ? { personId: q.personId } : {}) }, true);
    return (db.prepare(`SELECT * FROM ofc_correspondence WHERE deleted_at IS NULL AND ${w.where.join(' AND ')} ORDER BY reply_due, ref_no`).all(...w.params) as Row[])
      .map((r) => (r.classification === 'restricted' && !vis.all ? { ...r, subject: '[Restricted]' } : r));
  };
  const taskRow = (t: Row) => ({
    ref: t.ref_no as string, title: t.title as string, responsible: who(t.assignee_person_id), unit: unit(t.unit_id), priority: label(t.priority), target: (t.target_date as string) ?? '',
    overdue: t.target_date && (t.target_date as string) < today && !['completed', 'closed', 'cancelled'].includes(t.status as string) ? days(t.target_date as string, today) : null,
    status: label(t.status), latest: latest('ofc.task', t.id), remarks: [t.delay_reason ? `Delay: ${t.delay_reason as string}` : '', (t.remarks as string) ?? ''].filter(Boolean).join(' · '),
  });
  const sections: ReportSection[] = [];
  const TASK_COLS = cols('ref:Ref no.|title:Task|responsible:Responsible|unit:Section|priority:Priority|target:Target date|overdue:Days overdue|status:Status|latest:Latest action|remarks:Remarks');

  switch (c) {
    case 'daily_outstanding': {
      const rows: Array<Record<string, CellValue>> = [];
      for (const t of tasks('active')) { const r = taskRow(t); rows.push({ type: 'Task', ref: r.ref, subject: r.title, responsible: r.responsible, unit: r.unit, due: r.target, overdue: r.overdue, status: r.status, remarks: [r.latest, r.remarks].filter(Boolean).join(' · ') }); }
      for (const l of pendingLetters()) rows.push({ type: 'Letter (reply)', ref: `${l.ref_no as string}${l.official_ref ? ` / ${l.official_ref as string}` : ''}`, subject: l.subject as string, responsible: who(l.action_user_id), unit: unit(l.unit_id), due: (l.reply_due as string) ?? '', overdue: l.reply_due && (l.reply_due as string) < today ? days(l.reply_due as string, today) : null, status: label(l.status), remarks: (l.remarks as string) ?? '' });
      for (const w of wos('outstanding')) rows.push({ type: 'Work order', ref: w.ref_no as string, subject: w.title as string, responsible: who(w.supervisor_person_id), unit: unit(w.unit_id), due: (w.target_date as string) ?? '', overdue: w.target_date && (w.target_date as string) < today ? days(w.target_date as string, today) : null, status: label(w.status), remarks: [w.delay_reason, w.remarks].filter(Boolean).join(' · ') });
      rows.sort((x, y) => (Number(y.overdue ?? -1) - Number(x.overdue ?? -1)) || String(x.due || '9999').localeCompare(String(y.due || '9999')));
      sections.push({ title: `Outstanding actions (${rows.length}, of which ${rows.filter((r) => r.overdue != null && Number(r.overdue) > 0).length} overdue)`, columns: cols('type:Type|ref:Ref no.|subject:Subject|responsible:Responsible|unit:Section|due:Due|overdue:Days overdue|status:Status|remarks:Latest action / remarks'), rows });
      break;
    }
    case 'overdue_tasks':
      sections.push({ title: 'Overdue tasks', columns: TASK_COLS, rows: tasks('overdue').map(taskRow) });
      break;
    case 'weekly_progress':
    case 'workshop_progress': {
      const inPeriod = (r: Row, col: string) => !!r[col] && (r[col] as string).slice(0, 10) >= from && (r[col] as string).slice(0, 10) <= to;
      if (c === 'weekly_progress') {
        const all = tasks('all', {}, 'ref_no');
        const touched = all.filter((t) => inPeriod(t, 'created_at') || inPeriod(t, 'completed_at') || inPeriod(t, 'closed_at') || inPeriod(t, 'updated_at'));
        sections.push({ title: 'Summary', columns: cols('measure:Measure|value:Count'), rows: [
          { measure: 'Tasks opened', value: all.filter((t) => inPeriod(t, 'created_at')).length }, { measure: 'Tasks completed', value: all.filter((t) => inPeriod(t, 'completed_at')).length },
          { measure: 'Tasks closed (verified)', value: all.filter((t) => inPeriod(t, 'closed_at')).length }, { measure: 'Tasks still open', value: all.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status as string)).length },
          { measure: 'Overdue now', value: all.filter((t) => taskRow(t).overdue != null).length },
        ] });
        sections.push({ title: 'Tasks with activity in the period', columns: TASK_COLS, rows: touched.map(taskRow) });
      }
      const allWo = wos('all').filter((w) => w.status !== 'cancelled');
      const touchedWo = allWo.filter((w) => !['closed'].includes(w.status as string) || inPeriod(w, 'closed_at') || inPeriod(w, 'updated_at'));
      if (c === 'workshop_progress') {
        const byUnit = new Map<string, Record<string, number>>();
        for (const w of allWo) { const k = unit(w.unit_id) || '(not assigned)'; const m = byUnit.get(k) ?? {}; m[w.status as string] = (m[w.status as string] ?? 0) + 1; byUnit.set(k, m); }
        const st = ['requested', 'under_review', 'approved', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external', 'completed', 'verified', 'closed'];
        sections.push({ title: 'Work orders by workshop and status', columns: cols(`unit:Section / workshop|${st.map((s) => `${s}:${label(s)}`).join('|')}`), rows: [...byUnit.entries()].map(([k, m]) => ({ unit: k, ...Object.fromEntries(st.map((s) => [s, m[s] ?? 0])) })) });
      }
      sections.push({ title: c === 'weekly_progress' ? 'Work orders with activity in the period' : 'Work orders', columns: cols('ref:Ref no.|title:Work order|requesting:Requesting unit|unit:Workshop|supervisor:Supervisor|requested:Requested|target:Target|status:Status|latest:Latest action / remarks'),
        rows: touchedWo.map((w) => ({ ref: w.ref_no as string, title: w.title as string, requesting: (w.requesting_unit as string) ?? '', unit: unit(w.unit_id), supervisor: who(w.supervisor_person_id), requested: w.request_date as string, target: (w.target_date as string) ?? '', status: label(w.status), latest: [latest('ofc.work_order', w.id), w.delay_reason ? `Delay: ${w.delay_reason as string}` : '', (w.remarks as string) ?? ''].filter(Boolean).join(' · ') })) });
      break;
    }
    case 'monthly_summary': {
      const lim = (unitCol: string, pcols: string[]) => visibleWhere(vis, unitCol, pcols);
      const n = (table: string, unitCol: string, pcols: string[], cond: string, ...p: unknown[]) => {
        const l = lim(unitCol, pcols);
        const extra = q.unitId ? [`${unitCol} = ?`] : [];
        return count(a, table, { where: ['command_id = ?', ...l.where, cond, ...extra], params: [q.commandId, ...l.params, ...p, ...(q.unitId ? [q.unitId] : [])] });
      };
      const d = (col: string) => `substr(${col},1,10) BETWEEN ? AND ?`;
      const moves = (kind: string) => (db.prepare('SELECT COUNT(*) AS n FROM ofc_equipment_movement WHERE command_id = ? AND kind = ? AND movement_date BETWEEN ? AND ?').get(q.commandId, kind, from, to) as { n: number }).n;
      sections.push({ title: 'Office activity', columns: cols('area:Area|measure:Measure|value:Count'), rows: [
        { area: 'Correspondence', measure: 'Incoming registered', value: n('ofc_correspondence', 'unit_id', ['action_user_id'], `kind IN ('incoming','signal') AND ${d('COALESCE(received_date, letter_date, created_at)')}`, from, to) },
        { area: 'Correspondence', measure: 'Outgoing dispatched', value: n('ofc_correspondence', 'unit_id', ['action_user_id'], `kind = 'outgoing' AND status IN ('dispatched','acknowledged') AND ${d('COALESCE(sent_date, created_at)')}`, from, to) },
        { area: 'Correspondence', measure: 'Awaiting reply at end of period', value: n('ofc_correspondence', 'unit_id', ['action_user_id'], 'id IN (SELECT id FROM ofc_v_correspondence_pending)') },
        { area: 'Tasks', measure: 'Opened', value: n('ofc_task', 'unit_id', ['assignee_person_id'], d('created_at'), from, to) },
        { area: 'Tasks', measure: 'Completed', value: n('ofc_task', 'unit_id', ['assignee_person_id'], d('completed_at'), from, to) },
        { area: 'Tasks', measure: 'Closed (verified)', value: n('ofc_task', 'unit_id', ['assignee_person_id'], d('closed_at'), from, to) },
        { area: 'Tasks', measure: 'Overdue now', value: n('ofc_task', 'unit_id', ['assignee_person_id'], "status NOT IN ('completed','closed','cancelled') AND target_date < ?", today) },
        { area: 'Work orders', measure: 'Requested', value: n('ofc_work_order', 'unit_id', ['supervisor_person_id'], d('request_date'), from, to) },
        { area: 'Work orders', measure: 'Completed', value: n('ofc_work_order', 'unit_id', ['supervisor_person_id'], d('completed_at'), from, to) },
        { area: 'Work orders', measure: 'Closed', value: n('ofc_work_order', 'unit_id', ['supervisor_person_id'], d('closed_at'), from, to) },
        { area: 'Work orders', measure: 'Outstanding now', value: n('ofc_work_order', 'unit_id', ['supervisor_person_id'], "status NOT IN ('completed','verified','closed','cancelled')") },
        { area: 'Equipment', measure: 'Received for repair', value: moves('received_for_repair') },
        { area: 'Equipment', measure: 'Returned to owners', value: moves('collected') },
        { area: 'Handover', measure: 'Items completed', value: n('ofc_handover_item', 'unit_id', ['responsible_user_id'], `status IN ('completed','not_applicable') AND ${d('updated_at')}`, from, to) },
        { area: 'Supply', measure: 'Demands raised', value: n('ofc_supply_demand', 'unit_id', [], 'demand_date BETWEEN ? AND ?', from, to) },
      ] });
      const opened = n('ofc_task', 'unit_id', ['assignee_person_id'], d('created_at'), from, to);
      const closed = n('ofc_task', 'unit_id', ['assignee_person_id'], d('completed_at'), from, to);
      sections[0]!.rows.push({ area: 'Tasks', measure: 'Completion rate (completed / opened, %)', value: opened ? Math.round((closed / opened) * 100) : null });
      break;
    }
    case 'pending_correspondence':
      sections.push({ title: 'Letters awaiting reply', columns: cols('ref:Ref no.|official:Official ref|date:Letter date|received:Received|from:From|subject:Subject|action:Action officer|due:Reply due|age:Days since received|overdue:Days overdue|status:Status|remarks:Remarks'),
        rows: pendingLetters().map((l) => ({ ref: l.ref_no as string, official: (l.official_ref as string) ?? '', date: (l.letter_date as string) ?? '', received: (l.received_date as string) ?? '', from: (l.originator as string) ?? '', subject: l.subject as string,
          action: who(l.action_user_id), due: (l.reply_due as string) ?? '', age: days((l.received_date ?? l.letter_date) as string | null, today), overdue: l.reply_due && (l.reply_due as string) < today ? days(l.reply_due as string, today) : null, status: label(l.status), remarks: (l.remarks as string) ?? '' })) });
      break;
    case 'handover_completion': {
      const packets = db.prepare('SELECT * FROM ofc_handover_packet WHERE command_id = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(q.commandId) as Row[];
      sections.push({ title: 'Handovers', columns: cols('ref:Ref no.|appointment:Appointment|from:Handed over by|to:Taken over by|date:Handover date|total:Items|done:Completed|pct:% complete|urgent:Urgent open|overdue:Overdue'),
        rows: packets.map((p) => {
          const s = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('completed','not_applicable') THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status NOT IN ('completed','not_applicable') AND urgent = 1 THEN 1 ELSE 0 END) AS urgent, SUM(CASE WHEN status NOT IN ('completed','not_applicable') AND target_date < ? THEN 1 ELSE 0 END) AS overdue FROM ofc_handover_item WHERE packet_id = ? AND deleted_at IS NULL").get(today, p.id) as Row;
          const total = Number(s.total), done = Number(s.done ?? 0);
          return { ref: p.ref_no as string, appointment: p.appointment as string, from: p.from_name as string, to: p.to_name as string, date: (p.handover_date as string) ?? '', total, done, pct: total ? Math.round((done / total) * 100) : 0, urgent: Number(s.urgent ?? 0), overdue: Number(s.overdue ?? 0) };
        }) });
      const w = hoiWhere(a, { commandId: q.commandId, ...(q.unitId ? { unitId: q.unitId } : {}), ...(q.personId ? { personId: q.personId } : {}) }, "status NOT IN ('completed','not_applicable')");
      const open = db.prepare(`SELECT i.*, p.ref_no AS packet_ref FROM ofc_handover_item i JOIN ofc_handover_packet p ON p.id = i.packet_id WHERE i.deleted_at IS NULL AND ${w.where.map((x) => x.replace(/\b(command_id|unit_id|responsible_user_id|status|target_date)\b/g, 'i.$1')).join(' AND ')} ORDER BY i.urgent DESC, i.target_date, i.ref_no`).all(...w.params) as Row[];
      sections.push({ title: 'Open handover items', columns: cols('packet:Handover|ref:Ref no.|annex:Annex|subject:Subject|previous:Status at handover|status:Current status|responsible:Responsible|target:Target|latest:Latest action|remarks:Remarks'),
        rows: open.map((i) => ({ packet: i.packet_ref as string, ref: i.ref_no as string, annex: (i.annex_ref as string) ?? '', subject: `${i.subject as string}${i.urgent ? ' (URGENT)' : ''}`, previous: (i.previous_status as string) ?? '', status: label(i.status), responsible: who(i.responsible_user_id), target: (i.target_date as string) ?? '', latest: (i.latest_action as string) ?? '', remarks: (i.remarks as string) ?? '' })) });
      break;
    }
    case 'equipment_pending': {
      const w = equipmentWhere(a, EquipList.parse({ commandId: q.commandId, view: 'with_us' }));
      const rows = db.prepare(`SELECT * FROM ofc_equipment WHERE deleted_at IS NULL AND ${w.where.join(' AND ')} ORDER BY state, expected_return, ref_no`).all(...w.params) as Row[];
      sections.push({ title: 'Equipment not yet returned to its owner', columns: cols('ref:Ref no.|no:Equipment no.|name:Equipment|serial:Serial|owner:Owning unit|state:Where it is|location:Location / custodian|condition:Condition|since:Since|expected:Expected return|overdue:Days overdue|remarks:Remarks'),
        rows: rows.map((e) => ({ ref: e.ref_no as string, no: (e.equip_no as string) ?? '', name: `${e.name as string}${e.make_model ? ` (${e.make_model as string})` : ''}`, serial: (e.serial_no as string) ?? '', owner: (e.owning_unit as string) ?? unit(e.owner_unit_id), state: label(e.state),
          location: [e.location_text, who(e.custodian_person_id)].filter(Boolean).join(' · '), condition: label(e.condition), since: (e.last_movement_at as string) ?? '', expected: (e.expected_return as string) ?? '',
          overdue: ['at_external', 'on_issue'].includes(e.state as string) && e.expected_return && (e.expected_return as string) < today ? days(e.expected_return as string, today) : null, remarks: (e.remarks as string) ?? '' })) });
      break;
    }
    case 'personnel_allocation': {
      const ppl = (db.prepare("SELECT * FROM ofc_person WHERE command_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY name").all(q.commandId) as Row[])
        .filter((p) => (vis.all || vis.units.includes(p.unit_id as string) || p.id === vis.personId) && (!q.unitId || p.unit_id === q.unitId) && (!q.personId || p.id === q.personId));
      const all = tasks('all', {}, 'ref_no');
      const wosAll = wos('outstanding');
      sections.push({ title: 'Allocation per person', columns: cols('name:Name|unit:Section|active:Active tasks|overdue:Overdue|awaiting:Awaiting verification|completed:Completed in period|wo:Open work orders (supervisor/crew)|duty:Duty status'),
        rows: ppl.map((p) => {
          const mine = all.filter((t) => t.assignee_person_id === p.id);
          return {
            name: who(p.id), unit: unit(p.unit_id), active: mine.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status as string)).length,
            overdue: mine.filter((t) => taskRow(t).overdue != null).length, awaiting: mine.filter((t) => t.status === 'completed').length,
            completed: mine.filter((t) => t.completed_at && (t.completed_at as string) >= from && (t.completed_at as string) <= to).length,
            wo: wosAll.filter((w) => w.supervisor_person_id === p.id || String(w.crew_json).includes(p.id as string)).length, duty: label(p.duty_status),
          };
        }) });
      sections.push({ title: 'Open tasks by person', columns: TASK_COLS, rows: all.filter((t) => !['completed', 'closed', 'cancelled'].includes(t.status as string)).sort((x, y) => who(x.assignee_person_id).localeCompare(who(y.assignee_person_id))).map(taskRow) });
      break;
    }
    case 'supply_status': {
      const w = supplyWhere(a, SupplyList.parse({ commandId: q.commandId, view: 'open', ...(q.unitId ? { unitId: q.unitId } : {}) }));
      const rows = db.prepare(`SELECT s.*, w.ref_no AS wo_ref FROM ofc_supply_demand s LEFT JOIN ofc_work_order w ON w.id = s.work_order_id WHERE s.deleted_at IS NULL AND ${w.where.map((x) => x.replace(/\b(command_id|unit_id|closed|expected_date|stage)\b/g, 's.$1')).join(' AND ')} ORDER BY s.stage, s.stage_date`).all(...w.params) as Row[];
      const byStage = new Map<string, number>();
      for (const r of rows) byStage.set(r.stage as string, (byStage.get(r.stage as string) ?? 0) + 1);
      sections.push({ title: 'Open demands by stage', columns: cols('stage:Stage|n:Demands'), rows: [...byStage.entries()].map(([stage, n]) => ({ stage, n })) });
      sections.push({ title: 'Open demands', columns: cols('ref:Ref no.|supply:Supply ref|date:Demand date|item:Item|qty:Qty|wo:Work order|stage:Stage|since:Stage date|days:Days in stage|expected:Expected|overdue:Days overdue|remarks:Remarks'),
        rows: rows.map((r) => ({ ref: r.ref_no as string, supply: (r.supply_ref as string) ?? '', date: r.demand_date as string, item: `${r.item as string}${r.part_no ? ` (${r.part_no as string})` : ''}`, qty: (r.quantity as number) ?? null,
          wo: (r.wo_ref as string) ?? '', stage: r.stage as string, since: r.stage_date as string, days: days(r.stage_date as string, today), expected: (r.expected_date as string) ?? '',
          overdue: r.expected_date && (r.expected_date as string) < today ? days(r.expected_date as string, today) : null, remarks: (r.remarks as string) ?? '' })) });
      break;
    }
  }
  const periodic = ['weekly_progress', 'monthly_summary', 'personnel_allocation'].includes(c);
  return { code: c, title: TITLES[c], period: periodic ? { from, to } : null, asOf: today, sections };
}

/** Excel version of a report: one sheet per section, a header block with office, title, period, generated by/at (FR-X3). */
export function reportSheets(r: Report, generatedBy: string, filterNote: string): SheetOut[] {
  return r.sections.map((s, i) => ({
    name: `${i + 1} ${s.title}`.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    rows: [
      ['SLE (E&T) II – North'], [r.title], [r.period ? `Period ${r.period.from} to ${r.period.to}` : `As of ${r.asOf}`], [`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}${filterNote ? ` · ${filterNote}` : ''}`], [s.title], [],
      s.columns.map((c) => c.label), ...s.rows.map((row) => s.columns.map((c) => row[c.key] ?? null)),
    ],
    widths: s.columns.map((c) => Math.min(60, Math.max(10, c.label.length + 2, ...s.rows.slice(0, 200).map((row) => String(row[c.key] ?? '').length + 2)))),
  }));
}
