/** Equipment, repair and temporary-issue register (spec §1.7, FR-E1..E5, D73). */
import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, updateRecord, type Row } from '../../platform/records.js';
import { getAsset, resolveTag } from '../m03-assets/index.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { commandScopeOf, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef } from './numbering.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { assertVisible, visibility, visibleWhere } from './scope.js';
import { commandScope, recordEvent } from './service.js';

const E = 'ofc_equipment';
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const CONDITIONS = ['serviceable', 'unserviceable', 'repairable', 'ber', 'unknown'] as const;
export const STATES = ['in_store', 'in_workshop', 'at_external', 'awaiting_collection', 'returned', 'on_issue'] as const;
export const MOVEMENTS = ['received_for_repair', 'sent_out', 'returned_from_external', 'repair_completed', 'ready_for_collection', 'collected', 'issued', 'returned_from_issue', 'condition'] as const;
type State = (typeof STATES)[number];

/** Which movements are possible from each state, and where they lead. `condition` (a condition check) keeps the state. */
const FLOW: Record<string, { from: readonly State[]; to: State | null }> = {
  received_for_repair: { from: ['in_store', 'returned'], to: 'in_workshop' },
  sent_out: { from: ['in_workshop', 'in_store'], to: 'at_external' },
  returned_from_external: { from: ['at_external'], to: 'in_workshop' },
  repair_completed: { from: ['in_workshop'], to: 'awaiting_collection' },
  ready_for_collection: { from: ['in_workshop', 'in_store'], to: 'awaiting_collection' },
  collected: { from: ['awaiting_collection', 'in_workshop', 'in_store'], to: 'returned' },
  issued: { from: ['in_store', 'returned'], to: 'on_issue' },
  returned_from_issue: { from: ['on_issue'], to: 'in_store' },
  condition: { from: STATES, to: null },
};

const equipFields = {
  equipNo: Text(80), name: z.string().trim().min(1).max(200), makeModel: Text(200), serialNo: Text(120), owningUnit: Text(200), ownerUnitId: z.uuid().nullable().optional(),
  assetTag: Text(40), locationText: Text(200), custodianPersonId: z.uuid().nullable().optional(), responsiblePersonId: z.uuid().nullable().optional(),
  condition: z.enum(CONDITIONS).optional(), remarks: Text(4000),
};
export const EquipCreate = z.strictObject({
  commandId: z.uuid(), ...equipFields,
  /** Record the first movement at the same time, e.g. "received for repair" when a unit brings it in. */
  receivedForRepair: z.boolean().optional(), documentRef: Text(120), defect: Text(2000), allowDuplicate: z.boolean().optional(),
});
export const EquipUpdate = z.strictObject({ expectedVersion: z.number().int().min(1), ...equipFields, name: equipFields.name.optional(), reason: Text(500) });
export const MovementIn = z.strictObject({
  expectedVersion: z.number().int().min(1), kind: z.enum(MOVEMENTS), date: LocalDate.optional(), fromText: Text(200), toText: Text(200), personId: z.uuid().nullable().optional(),
  documentRef: Text(120), expectedReturn: LocalDate.nullable().optional(), condition: z.enum(CONDITIONS).optional(), workOrderId: z.uuid().nullable().optional(), note: Text(2000),
});
export const EquipList = z.strictObject({
  limit: z.coerce.number().int().min(1).max(1000).default(200), offset: z.coerce.number().int().min(0).default(0), q: z.string().trim().min(1).max(80).optional(),
  sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional(), commandId: z.uuid(), state: z.enum(STATES).optional(), condition: z.enum(CONDITIONS).optional(),
  view: z.enum(['all', 'with_us', 'pending_collection', 'overdue_return', 'at_external', 'on_issue', 'in_repair']).default('with_us'), ownerUnitId: z.uuid().optional(),
});

function resolveAssetTag(a: Actor, tag: string | null | undefined): string | null {
  if (!tag) return null;
  const asset = resolveTag(a.wctx.db, tag);
  if (!asset) throw new AppError('VALIDATION_FAILED', `No asset with tag ${tag} in the asset register`);
  return asset.id;
}

export function findEquipmentDuplicates(a: Actor, commandId: string, v: { equipNo?: string | null | undefined; serialNo?: string | null | undefined }, excludeId?: string): Row[] {
  if (!v.equipNo && !v.serialNo) return [];
  return a.wctx.db.prepare(
    `SELECT id, ref_no, equip_no, serial_no, name FROM ${E} WHERE command_id = ? AND deleted_at IS NULL AND id <> COALESCE(?, '')
       AND ((? IS NOT NULL AND lower(trim(equip_no)) = lower(trim(?))) OR (? IS NOT NULL AND lower(trim(serial_no)) = lower(trim(?))))`,
  ).all(commandId, excludeId ?? null, v.equipNo ?? null, v.equipNo ?? null, v.serialNo ?? null, v.serialNo ?? null) as Row[];
}

/** FR-E1 quick registration; optionally received for repair in the same step (WF3). */
export function createEquipment(a: Actor, input: unknown): Row {
  const v = parse(EquipCreate, input);
  if (!resolveParty(a.wctx.db, { kind: 'command', id: v.commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm('equipment', 'create'), commandScope(v.commandId));
  const assetId = resolveAssetTag(a, v.assetTag);
  const dups = findEquipmentDuplicates(a, v.commandId, v);
  if (dups.length && !v.allowDuplicate) throw new AppError('DUPLICATE', `Equipment with that number or serial is already registered as ${dups.map((d) => d.ref_no).join(', ')}`, { duplicates: dups });
  const today = todayLocal();
  return a.wctx.db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.equipment', {
      home_scope_id: v.commandId, command_id: v.commandId, ref_no: nextRef(a.wctx, 'ofc_equipment'), equip_no: v.equipNo ?? null, name: v.name, make_model: v.makeModel ?? null,
      serial_no: v.serialNo ?? null, owning_unit: v.owningUnit ?? null, owner_unit_id: v.ownerUnitId ?? null, asset_id: assetId, location_text: v.locationText ?? null,
      custodian_person_id: v.custodianPersonId ?? null, responsible_person_id: v.responsiblePersonId ?? null, condition: v.condition ?? 'unknown',
      state: v.receivedForRepair ? 'in_workshop' : 'in_store', last_movement_at: today, remarks: v.remarks ?? null,
    });
    appendEvent(a.wctx, 'ofc.equipment_movement', {
      home_scope_id: v.commandId, command_id: v.commandId, equipment_id: row.id, kind: v.receivedForRepair ? 'received_for_repair' : 'registered', movement_date: today,
      from_text: v.receivedForRepair ? (v.owningUnit ?? null) : null, to_text: v.locationText ?? null, person_id: v.custodianPersonId ?? null, document_ref: v.documentRef ?? null,
      expected_return: null, condition: v.condition ?? null, work_order_id: null, note: v.defect ?? null,
    });
    return row;
  })();
}

export function updateEquipment(a: Actor, id: string, input: unknown): Row {
  const v = parse(EquipUpdate, input);
  const cur = mustGet(a.wctx.db, E, id, 'Equipment');
  authorize(a, perm('equipment', 'update'), commandScopeOf(cur));
  const { assetTag, ...rest } = v;
  const patch: Record<string, unknown> = { ...rest };
  if (assetTag !== undefined) patch.assetId = resolveAssetTag(a, assetTag);
  if (v.equipNo !== undefined || v.serialNo !== undefined) {
    const dups = findEquipmentDuplicates(a, cur.command_id as string, { equipNo: v.equipNo ?? (cur.equip_no as string | null), serialNo: v.serialNo ?? (cur.serial_no as string | null) }, id);
    if (dups.length) throw new AppError('DUPLICATE', `That number or serial is already registered as ${dups.map((d) => d.ref_no).join(', ')}`, { duplicates: dups });
  }
  return updateWithHistory(a, 'ofc.equipment', cur, patch as typeof v, { keyFields: ['equipNo', 'serialNo', 'name', 'makeModel'], skip: ['condition'] });
}

/** FR-E2/E3: record a movement; the equipment's state, place, custodian and expected return follow it. Nothing is overwritten without a movement. */
export function recordMovement(a: Actor, id: string, input: unknown): Row {
  const v = parse(MovementIn, input);
  const cur = mustGet(a.wctx.db, E, id, 'Equipment');
  authorize(a, perm('equipment', 'record'), commandScopeOf(cur));
  const flow = FLOW[v.kind]!;
  if (!flow.from.includes(cur.state as State)) throw new AppError('WORKFLOW_BLOCKED', `Cannot record "${v.kind.replace(/_/g, ' ')}" while the equipment is ${String(cur.state).replace(/_/g, ' ')}`);
  if ((v.kind === 'issued' || v.kind === 'sent_out') && !v.toText && !v.personId) throw new AppError('VALIDATION_FAILED', 'Say to whom or where it goes');
  if (v.kind === 'issued' && !v.expectedReturn) throw new AppError('VALIDATION_FAILED', 'Set the expected return date for a temporary issue');
  if (v.kind === 'condition' && !v.condition) throw new AppError('VALIDATION_FAILED', 'Choose the condition');
  const date = v.date ?? todayLocal();
  if (date > todayLocal()) throw new AppError('VALIDATION_FAILED', 'The movement date cannot be in the future');
  if (v.workOrderId) mustGet(a.wctx.db, 'ofc_work_order', v.workOrderId, 'Work order');
  return a.wctx.db.transaction(() => {
    appendEvent(a.wctx, 'ofc.equipment_movement', {
      home_scope_id: cur.command_id, command_id: cur.command_id, equipment_id: id, kind: v.kind, movement_date: date, from_text: v.fromText ?? null, to_text: v.toText ?? null,
      person_id: v.personId ?? null, document_ref: v.documentRef ?? null, expected_return: v.expectedReturn ?? null, condition: v.condition ?? null, work_order_id: v.workOrderId ?? null, note: v.note ?? null,
    });
    const patch: Row = { last_movement_at: date };
    if (flow.to) patch.state = flow.to;
    if (v.condition) patch.condition = v.condition;
    if (['sent_out', 'issued'].includes(v.kind)) { patch.expected_return = v.expectedReturn ?? null; patch.location_text = v.toText ?? null; patch.custodian_person_id = v.personId ?? null; }
    if (['returned_from_external', 'returned_from_issue', 'received_for_repair'].includes(v.kind)) { patch.expected_return = null; patch.location_text = v.toText ?? null; patch.custodian_person_id = v.personId ?? null; }
    if (v.kind === 'collected') { patch.expected_return = null; patch.location_text = v.toText ?? (cur.owning_unit as string | null); patch.custodian_person_id = null; }
    const next = updateRecord(withReason(a, v.note).wctx, 'ofc.equipment', id, v.expectedVersion, patch);
    recordEvent(a, { type: 'ofc.equipment', id }, commandScopeOf(cur), { kind: 'status', field: 'movement', from: cur.state, to: v.kind, note: [v.toText, v.documentRef, v.note].filter(Boolean).join(' · ') || null });
    return next;
  })();
}

export function equipmentDetail(a: Actor, id: string) {
  const e = mustGet(a.wctx.db, E, id, 'Equipment');
  authorize(a, perm('equipment', 'view'), commandScopeOf(e));
  assertVisible(a, e, 'owner_unit_id', ['responsible_person_id', 'custodian_person_id'], 'This equipment');
  const db = a.wctx.db;
  const asset = e.asset_id ? getAsset(db, e.asset_id as string) : null;
  return {
    equipment: withFlags(e, todayLocal()),
    movements: db.prepare('SELECT * FROM ofc_equipment_movement WHERE equipment_id = ? ORDER BY movement_date, occurred_at').all(id) as Row[],
    workOrders: db.prepare('SELECT id, ref_no, title, status, target_date FROM ofc_work_order WHERE equipment_id = ? AND deleted_at IS NULL ORDER BY request_date DESC').all(id) as Row[],
    asset: asset ? { id: asset.id, tag: asset.assetTag, name: asset.name } : null,
  };
}

const OUT = ['at_external', 'on_issue'];
const withFlags = (r: Row, today: string): Row => ({ ...r, overdueReturn: OUT.includes(r.state as string) && !!r.expected_return && (r.expected_return as string) < today });

export function equipmentWhere(a: Actor, v: z.infer<typeof EquipList>): { where: string[]; params: unknown[] } {
  const today = todayLocal();
  const lim = visibleWhere(visibility(a, v.commandId), 'owner_unit_id', ['responsible_person_id', 'custodian_person_id']);
  const where = ['command_id = ?', ...lim.where];
  const params: unknown[] = [v.commandId, ...lim.params];
  switch (v.view) {
    case 'with_us': where.push("state <> 'returned'"); break;
    case 'pending_collection': where.push("state = 'awaiting_collection'"); break;
    case 'overdue_return': where.push("state IN ('at_external','on_issue') AND expected_return < ?"); params.push(today); break;
    case 'at_external': where.push("state = 'at_external'"); break;
    case 'on_issue': where.push("state = 'on_issue'"); break;
    case 'in_repair': where.push("state IN ('in_workshop','at_external')"); break;
    case 'all': break;
  }
  for (const [val, col] of [[v.state, 'state'], [v.condition, 'condition'], [v.ownerUnitId, 'owner_unit_id']] as const) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  return { where, params };
}

export function listEquipment(a: Actor, raw: unknown) {
  const v = parse(EquipList, raw);
  authorize(a, perm('equipment', 'view'), commandScope(v.commandId));
  const { where, params } = equipmentWhere(a, v);
  const sort = { refNo: 'ref_no', name: 'name', expectedReturn: "COALESCE(expected_return,'9999')", lastMovement: 'last_movement_at', state: 'state' };
  const { rows, total } = pageOf(a.wctx.db, E, where, params, v, ['ref_no', 'equip_no', 'name', 'make_model', 'serial_no', 'owning_unit', 'location_text', 'remarks'], sort, 'last_movement_at DESC');
  const today = todayLocal();
  return { total, items: rows.map((r) => withFlags(r, today)) };
}
