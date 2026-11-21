/** Supply demand tracking (spec §1.8a, FR-S1..S5). The Supply department is outside the unit tree; the office records where each demand stands. */
import { z } from 'zod';
import { uuidv7 } from '../../platform/ids.js';
import { AppError } from '../../platform/errors.js';
import { createRecord, updateRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, type Actor } from './actor.js';
import { commandScopeOf, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef } from './numbering.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { visibility, visibleWhere } from './scope.js';
import { commandScope, recordEvent } from './service.js';

const S = 'ofc_supply_demand';
/** Default stages until the office gives the real ones (A-S). The last two close the demand. */
export const DEFAULT_STAGES = ['Demand raised', 'Forwarded to Supply', 'Under processing', 'Not in stock – local purchase', 'Quotation / tender', 'Order placed', 'Received at Supply', 'Issued / collected', 'Cancelled'];
const CLOSING = ['Issued / collected', 'Cancelled'];

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const fields = {
  supplyRef: Text(80), demandDate: LocalDate.optional(), item: z.string().trim().min(1).max(300), partNo: Text(80), quantity: z.number().positive().max(1e7).nullable().optional(),
  unitOfIssue: Text(20), demandingUnit: Text(200), unitId: z.uuid().nullable().optional(), workOrderId: z.uuid().nullable().optional(), taskId: z.uuid().nullable().optional(),
  equipmentId: z.uuid().nullable().optional(), priority: z.enum(['immediate', 'high', 'normal', 'low']).optional(), stage: z.string().trim().min(1).max(80).optional(),
  stageDate: LocalDate.optional(), expectedDate: LocalDate.nullable().optional(), supplyContact: Text(200), remarks: Text(4000),
};
export const SupplyCreate = z.strictObject({ commandId: z.uuid(), ...fields });
export const SupplyUpdate = z.strictObject({ expectedVersion: z.number().int().min(1), ...fields, item: fields.item.optional(), reason: Text(500) });
export const SupplyStage = z.strictObject({ expectedVersion: z.number().int().min(1), stage: z.string().trim().min(1).max(80), stageDate: LocalDate.optional(), expectedDate: LocalDate.nullable().optional(), note: Text(2000) });
export const SupplyBulk = z.strictObject({ commandId: z.uuid(), rows: z.array(z.unknown()).min(1).max(5000), commit: z.boolean().default(false) });
export const SupplyList = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0), q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional(), commandId: z.uuid(), stage: z.string().max(80).optional(),
  view: z.enum(['open', 'overdue', 'closed', 'all']).default('open'), workOrderId: z.uuid().optional(), unitId: z.uuid().optional(),
});

export function getSetting<T>(a: Actor, commandId: string, key: string, fallback: T): T {
  const r = a.wctx.db.prepare('SELECT value_json FROM ofc_setting WHERE command_id = ? AND key = ? AND deleted_at IS NULL').get(commandId, key) as { value_json: string } | undefined;
  try { return r ? (JSON.parse(r.value_json) as T) : fallback; } catch { return fallback; }
}
export function setSetting(a: Actor, commandId: string, key: string, value: unknown): Row {
  authorize(a, perm('settings', 'update'), commandScope(commandId));
  const cur = a.wctx.db.prepare('SELECT * FROM ofc_setting WHERE command_id = ? AND key = ? AND deleted_at IS NULL').get(commandId, key) as Row | undefined;
  const json = JSON.stringify(value);
  return cur ? updateRecord(a.wctx, 'ofc.setting', cur.id as string, cur.version as number, { value_json: json }) : createRecord(a.wctx, 'ofc.setting', { home_scope_id: commandId, command_id: commandId, key, value_json: json });
}
export const supplyStages = (a: Actor, commandId: string): string[] => getSetting(a, commandId, 'supply_stages', DEFAULT_STAGES);
export function setSupplyStages(a: Actor, commandId: string, input: unknown): string[] {
  const v = parse(z.strictObject({ stages: z.array(z.string().trim().min(1).max(80)).min(2).max(30) }), input);
  if (new Set(v.stages.map((s) => s.toLowerCase())).size !== v.stages.length) throw new AppError('VALIDATION_FAILED', 'Stages must be different');
  setSetting(a, commandId, 'supply_stages', v.stages);
  return v.stages;
}
const isClosing = (stage: string, stages: string[]) => CLOSING.includes(stage) || stage === stages[stages.length - 1] || /cancel|collected|issued/i.test(stage);

function checkStage(a: Actor, commandId: string, stage: string): string {
  const stages = supplyStages(a, commandId);
  const hit = stages.find((s) => s.toLowerCase() === stage.toLowerCase());
  if (!hit) throw new AppError('VALIDATION_FAILED', `Unknown stage "${stage}". Stages: ${stages.join(', ')}`);
  return hit;
}
function checkLinks(a: Actor, commandId: string, v: { workOrderId?: string | null | undefined; taskId?: string | null | undefined; equipmentId?: string | null | undefined; unitId?: string | null | undefined }): void {
  for (const [id, table, label] of [[v.workOrderId, 'ofc_work_order', 'Work order'], [v.taskId, 'ofc_task', 'Task'], [v.equipmentId, 'ofc_equipment', 'Equipment'], [v.unitId, 'ofc_org_unit', 'Unit']] as const) {
    if (id && mustGet(a.wctx.db, table, id, label).command_id !== commandId) throw new AppError('VALIDATION_FAILED', `${label} belongs to another office`);
  }
}

function values(a: Actor, commandId: string, v: z.infer<typeof SupplyCreate>, batch: string | null): Row {
  const stages = supplyStages(a, commandId);
  const stage = checkStage(a, commandId, v.stage ?? stages[0]!);
  const today = todayLocal();
  return {
    home_scope_id: commandId, command_id: commandId, supply_ref: v.supplyRef ?? null, demand_date: v.demandDate ?? today, item: v.item, part_no: v.partNo ?? null, quantity: v.quantity ?? null,
    unit_of_issue: v.unitOfIssue ?? null, demanding_unit: v.demandingUnit ?? null, unit_id: v.unitId ?? null, work_order_id: v.workOrderId ?? null, task_id: v.taskId ?? null, equipment_id: v.equipmentId ?? null,
    priority: v.priority ?? 'normal', stage, stage_date: v.stageDate ?? v.demandDate ?? today, expected_date: v.expectedDate ?? null, supply_contact: v.supplyContact ?? null,
    closed: isClosing(stage, stages) ? 1 : 0, import_batch_id: batch, remarks: v.remarks ?? null,
  };
}

export function createDemand(a: Actor, input: unknown): Row {
  const v = parse(SupplyCreate, input);
  if (!resolveParty(a.wctx.db, { kind: 'command', id: v.commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm('supply', 'create'), commandScope(v.commandId));
  checkLinks(a, v.commandId, v);
  if (v.supplyRef && a.wctx.db.prepare(`SELECT 1 FROM ${S} WHERE command_id = ? AND supply_ref = ? AND deleted_at IS NULL`).get(v.commandId, v.supplyRef)) throw new AppError('DUPLICATE', `Supply reference ${v.supplyRef} is already registered`);
  return a.wctx.db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.supply_demand', { ...values(a, v.commandId, v, null), ref_no: nextRef(a.wctx, 'ofc_supply') });
    if (v.workOrderId) recordEvent(a, { type: 'ofc.work_order', id: v.workOrderId }, commandScope(v.commandId), { kind: 'link', note: `Supply demand ${row.ref_no as string}: ${v.item}` });
    return row;
  })();
}

export function updateDemand(a: Actor, id: string, input: unknown): Row {
  const v = parse(SupplyUpdate, input);
  const cur = mustGet(a.wctx.db, S, id, 'Supply demand');
  authorize(a, perm('supply', 'update'), commandScopeOf(cur));
  checkLinks(a, cur.command_id as string, v);
  const { stage, stageDate, ...rest } = v;
  if (stage !== undefined && stage !== cur.stage) throw new AppError('VALIDATION_FAILED', 'Change the stage with "Update stage" so its date is recorded');
  void stageDate;
  return updateWithHistory(a, 'ofc.supply_demand', cur, rest, { keyFields: ['supplyRef', 'demandDate', 'item', 'partNo', 'quantity'] });
}

/** FR-S2: each stage change is a history entry with its date, so time spent in each stage can be measured. */
export function setStage(a: Actor, id: string, input: unknown): Row {
  const v = parse(SupplyStage, input);
  const cur = mustGet(a.wctx.db, S, id, 'Supply demand');
  authorize(a, perm('supply', 'update'), commandScopeOf(cur));
  const stage = checkStage(a, cur.command_id as string, v.stage);
  const date = v.stageDate ?? todayLocal();
  if (date < (cur.stage_date as string)) throw new AppError('VALIDATION_FAILED', `The stage date cannot be before the previous stage (${cur.stage_date as string})`);
  return applyStage(a, cur, v.expectedVersion, stage, date, v.expectedDate, v.note ?? null);
}
function applyStage(a: Actor, cur: Row, version: number, stage: string, date: string, expected: string | null | undefined, note: string | null): Row {
  const stages = supplyStages(a, cur.command_id as string);
  return a.wctx.db.transaction(() => {
    const next = updateWithHistory(a, 'ofc.supply_demand', cur, {
      expectedVersion: version, stage, stageDate: date, closed: isClosing(stage, stages) ? 1 : 0, ...(expected !== undefined ? { expectedDate: expected } : {}), reason: note,
    } as never);
    if (stage !== cur.stage) recordEvent(a, { type: 'ofc.supply_demand', id: cur.id as string }, commandScopeOf(cur), { kind: 'status', field: 'stage', from: cur.stage, to: stage, note: `${date}${note ? ` · ${note}` : ''}` });
    return next;
  })();
}

/**
 * FR-S4 paste import: rows copied from the logistics system. A row whose Supply reference is already registered updates that demand's stage
 * (and expected date); others create new demands. Preview first; nothing is written unless commit is true and no row has errors.
 */
export function bulkDemands(a: Actor, input: unknown) {
  const v = parse(SupplyBulk, input);
  authorize(a, perm('supply', 'create'), commandScope(v.commandId));
  authorize(a, perm('supply', 'update'), commandScope(v.commandId));
  const db = a.wctx.db;
  const stages = supplyStages(a, v.commandId);
  const seen = new Set<string>();
  const rows = v.rows.map((raw, i) => {
    const r = SupplyCreate.omit({ commandId: true }).safeParse(raw);
    if (!r.success) return { row: i + 1, ok: false as const, action: 'error', errors: r.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`), warnings: [] as string[] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const stage = r.data.stage ? stages.find((s) => s.toLowerCase() === r.data.stage!.toLowerCase()) : stages[0];
    if (!stage) errors.push(`Unknown stage "${r.data.stage}"`);
    const key = r.data.supplyRef?.toLowerCase();
    if (key && seen.has(key)) errors.push('Supply reference repeated in this paste');
    if (key) seen.add(key);
    const existing = r.data.supplyRef ? (db.prepare(`SELECT * FROM ${S} WHERE command_id = ? AND supply_ref = ? AND deleted_at IS NULL`).get(v.commandId, r.data.supplyRef) as Row | undefined) : undefined;
    if (!r.data.supplyRef) warnings.push('No Supply reference: it cannot be updated by a later paste');
    let action = existing ? (existing.stage === stage && (r.data.expectedDate === undefined || r.data.expectedDate === existing.expected_date) ? 'unchanged' : 'update') : 'create';
    if (existing && stage && r.data.stageDate && r.data.stageDate < (existing.stage_date as string)) { warnings.push('Older than the stage already recorded: skipped'); action = 'unchanged'; }
    return { row: i + 1, ok: errors.length === 0, action, errors, warnings, data: { ...r.data, stage }, existing };
  });
  const summary = {
    rows: rows.length, errors: rows.filter((r) => !r.ok).length, create: rows.filter((r) => r.ok && r.action === 'create').length,
    update: rows.filter((r) => r.ok && r.action === 'update').length, unchanged: rows.filter((r) => r.ok && r.action === 'unchanged').length,
  };
  const report = rows.map(({ row, action, errors, warnings }) => ({ row, action, errors, warnings }));
  if (!v.commit || summary.errors) return { committed: false, summary, rows: report };
  const batch = uuidv7();
  db.transaction(() => {
    for (const r of rows) {
      if (!('data' in r) || !r.ok) continue;
      if (r.action === 'create') createRecord(a.wctx, 'ofc.supply_demand', { ...values(a, v.commandId, { commandId: v.commandId, ...r.data } as z.infer<typeof SupplyCreate>, batch), ref_no: nextRef(a.wctx, 'ofc_supply') });
      else if (r.action === 'update' && r.existing) applyStage(a, r.existing, r.existing.version as number, r.data.stage!, r.data.stageDate ?? todayLocal(), r.data.expectedDate, 'Updated from logistics system paste');
    }
  })();
  return { committed: true, batchId: batch, summary, rows: report };
}

export function supplyWhere(a: Actor, v: z.infer<typeof SupplyList>): { where: string[]; params: unknown[] } {
  const lim = visibleWhere(visibility(a, v.commandId), 'unit_id', []);
  const where = ['command_id = ?', ...lim.where];
  const params: unknown[] = [v.commandId, ...lim.params];
  if (v.view === 'open') where.push('closed = 0');
  if (v.view === 'closed') where.push('closed = 1');
  if (v.view === 'overdue') { where.push('closed = 0 AND expected_date < ?'); params.push(todayLocal()); }
  for (const [val, col] of [[v.stage, 'stage'], [v.workOrderId, 'work_order_id'], [v.unitId, 'unit_id']] as const) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  return { where, params };
}

export function listDemands(a: Actor, raw: unknown) {
  const v = parse(SupplyList, raw);
  authorize(a, perm('supply', 'view'), commandScope(v.commandId));
  const { where, params } = supplyWhere(a, v);
  const sort = { refNo: 'ref_no', supplyRef: 'supply_ref', demandDate: 'demand_date', stage: 'stage', stageDate: 'stage_date', expectedDate: "COALESCE(expected_date,'9999')" };
  const { rows, total } = pageOf(a.wctx.db, S, where, params, v, ['ref_no', 'supply_ref', 'item', 'part_no', 'demanding_unit', 'remarks'], sort, 'demand_date DESC');
  const today = todayLocal();
  const days = (from: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86_400_000);
  return { total, stages: supplyStages(a, v.commandId), items: rows.map((r) => ({ ...r, daysInStage: days(r.stage_date as string), overdue: !r.closed && !!r.expected_date && (r.expected_date as string) < today }) as Row) };
}
