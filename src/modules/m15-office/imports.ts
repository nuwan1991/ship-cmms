/**
 * Bulk registration from existing registers (spec §6, FR-X2): correspondence, personnel and equipment. Same rules as the handover
 * import: preview first, every row validated, duplicates flagged, nothing written until commit and no errors. Imported rows keep
 * their original reference numbers and dates; values are never guessed (an unknown value is a row error).
 */
import { z } from 'zod';
import { uuidv7 } from '../../platform/ids.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, updateRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, type Actor } from './actor.js';
import { todayLocal } from './common.js';
import { findDuplicates } from './correspondence.js';
import { findEquipmentDuplicates } from './equipment.js';
import { nextRef, type OfficeSequence } from './numbering.js';
import { perm } from './permissions.js';
import { parse } from './schemas.js';
import { commandScope } from './service.js';

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const Bulk = z.strictObject({ commandId: z.uuid(), rows: z.array(z.unknown()).min(1).max(5000), commit: z.boolean().default(false) });

/** Units and people may be given by code / service number / name in the sheet; resolved here, never guessed. */
function resolvers(a: Actor, commandId: string) {
  const units = a.wctx.db.prepare('SELECT id, code, name FROM ofc_org_unit WHERE command_id = ? AND deleted_at IS NULL').all(commandId) as Row[];
  const people = a.wctx.db.prepare('SELECT id, service_no, name FROM ofc_person WHERE command_id = ? AND deleted_at IS NULL').all(commandId) as Row[];
  const unit = (v: unknown, errors: string[]): string | null => {
    if (v == null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    const hit = units.filter((u) => String(u.code).toLowerCase() === s || String(u.name).toLowerCase() === s);
    if (hit.length !== 1) { errors.push(`Section / workshop "${String(v)}" ${hit.length ? 'is ambiguous' : 'not found'}`); return null; }
    return hit[0]!.id as string;
  };
  const person = (v: unknown, errors: string[]): string | null => {
    if (v == null || v === '') return null;
    const s = String(v).trim().toLowerCase();
    const hit = people.filter((p) => String(p.service_no ?? '').toLowerCase() === s || String(p.name).toLowerCase() === s);
    if (hit.length !== 1) { errors.push(`Person "${String(v)}" ${hit.length ? 'is ambiguous (use the service no.)' : 'not found in the personnel register'}`); return null; }
    return hit[0]!.id as string;
  };
  return { unit, person };
}

interface Checked<T> { row: number; ok: boolean; errors: string[]; warnings: string[]; data?: T }
function run<T>(a: Actor, input: unknown, noun: 'correspondence' | 'person' | 'equipment', schema: z.ZodType<T>, check: (d: T, errors: string[], warnings: string[], seen: Set<string>) => T, write: (d: T, batch: string) => Row) {
  const v = parse(Bulk, input);
  if (!resolveParty(a.wctx.db, { kind: 'command', id: v.commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm(noun, 'create'), commandScope(v.commandId));
  authorize(a, 'ofc.import.run', commandScope(v.commandId));
  const seen = new Set<string>();
  const rows: Array<Checked<T>> = v.rows.map((raw, i) => {
    const r = schema.safeParse(raw);
    if (!r.success) return { row: i + 1, ok: false, errors: r.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`), warnings: [] };
    const errors: string[] = [];
    const warnings: string[] = [];
    const data = check(r.data, errors, warnings, seen);
    return { row: i + 1, ok: errors.length === 0, errors, warnings, data };
  });
  const summary = { rows: rows.length, errors: rows.filter((r) => !r.ok).length, warnings: rows.filter((r) => r.warnings.length).length };
  const report = rows.map(({ row, errors, warnings }) => ({ row, errors, warnings }));
  if (!v.commit || summary.errors) return { committed: false, summary, rows: report };
  const batch = uuidv7();
  const created = a.wctx.db.transaction(() => rows.map((r) => write(r.data as T, batch).ref_no ?? null))();
  return { committed: true, batchId: batch, summary, rows: report, created };
}

// ---- correspondence
const CorrRow = z.strictObject({
  kind: z.enum(['incoming', 'outgoing', 'minute', 'signal', 'other']).default('incoming'), officialRef: Text(80), fileRef: Text(80), letterDate: LocalDate.nullable().optional(),
  receivedDate: LocalDate.nullable().optional(), sentDate: LocalDate.nullable().optional(), originator: Text(200), recipients: Text(500), subject: z.string().trim().min(1).max(300),
  classification: z.enum(['unclassified', 'restricted']).default('unclassified'), priority: z.enum(['immediate', 'high', 'normal', 'low']).default('normal'),
  replyRequired: z.boolean().default(false), replyDue: LocalDate.nullable().optional(), actionOfficer: Text(160), unit: Text(160),
  status: z.enum(['received', 'under_action', 'replied', 'filed', 'draft', 'signed', 'dispatched', 'acknowledged', 'open']).optional(), originalRef: Text(80), remarks: Text(4000),
});
type CorrRowT = z.infer<typeof CorrRow> & { actionUserId?: string | null; unitId?: string | null };
const CORR_STATUS: Record<string, string[]> = {
  incoming: ['received', 'under_action', 'replied', 'filed'], signal: ['received', 'under_action', 'replied', 'filed'], outgoing: ['draft', 'signed', 'dispatched', 'acknowledged'], minute: ['open', 'filed'], other: ['open', 'filed'],
};
const CORR_SEQ: Record<string, OfficeSequence> = { incoming: 'ofc_corr_in', signal: 'ofc_corr_in', outgoing: 'ofc_corr_out', minute: 'ofc_minute', other: 'ofc_corr_in' };
export function importCorrespondence(a: Actor, input: unknown) {
  const commandId = parse(Bulk, input).commandId;
  const r = resolvers(a, commandId);
  return run<CorrRowT>(a, input, 'correspondence', CorrRow, (d, errors, warnings, seen) => {
    const status = d.status ?? (d.kind === 'outgoing' ? 'dispatched' : d.kind === 'incoming' || d.kind === 'signal' ? (d.replyRequired ? 'received' : 'filed') : 'filed');
    if (!CORR_STATUS[d.kind]!.includes(status)) errors.push(`Status ${status} is not valid for ${d.kind}`);
    if (d.replyRequired && !d.replyDue) errors.push('Reply due date is needed when a reply is required');
    const key = `${(d.officialRef ?? '').toLowerCase().trim()}|${d.letterDate ?? ''}`;
    if (d.officialRef) {
      if (findDuplicates(a, commandId, d.officialRef, d.letterDate).length) warnings.push('Already registered (same official reference and date)');
      if (seen.has(key)) warnings.push('Repeated in this upload');
      seen.add(key);
    }
    return { ...d, status, actionUserId: r.person(d.actionOfficer, errors), unitId: r.unit(d.unit, errors) };
  }, (d, batch) => createRecord(a.wctx, 'ofc.correspondence', {
    home_scope_id: commandId, command_id: commandId, ref_no: nextRef(a.wctx, CORR_SEQ[d.kind]!), kind: d.kind, official_ref: d.officialRef ?? null, file_ref: d.fileRef ?? null,
    letter_date: d.letterDate ?? null, received_date: d.receivedDate ?? null, sent_date: d.sentDate ?? null, originator: d.originator ?? null, recipients: d.recipients ?? null, subject: d.subject,
    classification: d.classification, priority: d.priority, reply_required: d.replyRequired ? 1 : 0, reply_due: d.replyDue ?? null, action_user_id: d.actionUserId ?? null, unit_id: d.unitId ?? null,
    status: d.status, original_ref: d.originalRef ?? null, import_batch_id: batch, remarks: d.remarks ?? null,
  }));
}

// ---- personnel
const PersonRow = z.strictObject({
  serviceNo: Text(40), rank: Text(60), name: z.string().trim().min(1).max(160), appointment: Text(160), unit: Text(160), supervisor: Text(160), contact: Text(200), remarks: Text(2000),
});
type PersonRowT = z.infer<typeof PersonRow> & { unitId?: string | null };
export function importPersons(a: Actor, input: unknown) {
  const commandId = parse(Bulk, input).commandId;
  const r = resolvers(a, commandId);
  const pending: Array<{ name: string; supervisor: string }> = [];
  const res = run<PersonRowT>(a, input, 'person', PersonRow, (d, errors, warnings, seen) => {
    if (d.serviceNo) {
      if (a.wctx.db.prepare('SELECT 1 FROM ofc_person WHERE command_id = ? AND service_no = ? AND deleted_at IS NULL').get(commandId, d.serviceNo)) errors.push(`Service no. ${d.serviceNo} is already registered`);
      if (seen.has(d.serviceNo.toLowerCase())) errors.push('Service no. repeated in this upload');
      seen.add(d.serviceNo.toLowerCase());
    } else warnings.push('No service number');
    if (d.supervisor) pending.push({ name: d.serviceNo ?? d.name, supervisor: d.supervisor });
    return { ...d, unitId: r.unit(d.unit, errors) };
  }, (d) => createRecord(a.wctx, 'ofc.person', {
    home_scope_id: commandId, command_id: commandId, user_id: null, service_no: d.serviceNo ?? null, rank: d.rank ?? null, name: d.name, appointment: d.appointment ?? null,
    unit_id: d.unitId ?? null, supervisor_person_id: null, contact: d.contact ?? null, remarks: d.remarks ?? null,
  }));
  // Supervisors may be in the same upload: link them once everyone exists.
  if (res.committed) {
    const r2 = resolvers(a, commandId);
    a.wctx.db.transaction(() => {
      for (const p of pending) {
        const errs: string[] = [];
        const me = r2.person(p.name, errs);
        const sup = r2.person(p.supervisor, errs);
        if (!me || !sup || me === sup) { res.rows.push({ row: 0, errors: [], warnings: [`Supervisor of ${p.name} not linked: ${errs.join('; ') || 'same person'}`] }); continue; }
        const cur = a.wctx.db.prepare('SELECT version FROM ofc_person WHERE id = ?').get(me) as { version: number };
        updateRecord(a.wctx, 'ofc.person', me, cur.version, { supervisor_person_id: sup });
      }
    })();
  }
  return res;
}

// ---- equipment
const EquipRow = z.strictObject({
  equipNo: Text(80), name: z.string().trim().min(1).max(200), makeModel: Text(200), serialNo: Text(120), owningUnit: Text(200), ownerUnit: Text(160),
  condition: z.enum(['serviceable', 'unserviceable', 'repairable', 'ber', 'unknown']).default('unknown'),
  state: z.enum(['in_store', 'in_workshop', 'at_external', 'awaiting_collection', 'on_issue']).default('in_store'), locationText: Text(200),
  expectedReturn: LocalDate.nullable().optional(), sinceDate: LocalDate.nullable().optional(), responsible: Text(160), remarks: Text(4000),
});
type EquipRowT = z.infer<typeof EquipRow> & { ownerUnitId?: string | null; responsiblePersonId?: string | null };
export function importEquipment(a: Actor, input: unknown) {
  const commandId = parse(Bulk, input).commandId;
  const r = resolvers(a, commandId);
  return run<EquipRowT>(a, input, 'equipment', EquipRow, (d, errors, warnings, seen) => {
    if (findEquipmentDuplicates(a, commandId, d).length) warnings.push('Same equipment no. or serial already registered');
    const key = `${d.equipNo ?? ''}|${d.serialNo ?? ''}`.toLowerCase();
    if ((d.equipNo || d.serialNo) && seen.has(key)) warnings.push('Repeated in this upload');
    seen.add(key);
    if (['at_external', 'on_issue'].includes(d.state) && !d.expectedReturn) warnings.push('No expected return date: it will never show as overdue');
    if (['at_external', 'on_issue'].includes(d.state) && !d.locationText) errors.push('Say where it is (location) for equipment that is out');
    return { ...d, ownerUnitId: r.unit(d.ownerUnit, errors), responsiblePersonId: r.person(d.responsible, errors) };
  }, (d, batch) => {
    const since = d.sinceDate ?? todayLocal();
    const row = createRecord(a.wctx, 'ofc.equipment', {
      home_scope_id: commandId, command_id: commandId, ref_no: nextRef(a.wctx, 'ofc_equipment'), equip_no: d.equipNo ?? null, name: d.name, make_model: d.makeModel ?? null,
      serial_no: d.serialNo ?? null, owning_unit: d.owningUnit ?? null, owner_unit_id: d.ownerUnitId ?? null, asset_id: null, location_text: d.locationText ?? null, custodian_person_id: null,
      responsible_person_id: d.responsiblePersonId ?? null, condition: d.condition, state: d.state, expected_return: d.expectedReturn ?? null, last_movement_at: since, remarks: d.remarks ?? null,
    });
    appendEvent(a.wctx, 'ofc.equipment_movement', {
      home_scope_id: commandId, command_id: commandId, equipment_id: row.id, kind: 'registered', movement_date: since, from_text: null, to_text: d.locationText ?? null, person_id: null,
      document_ref: null, expected_return: d.expectedReturn ?? null, condition: d.condition, work_order_id: null, note: `Imported from existing register (batch ${batch.slice(-8)}), state ${d.state}`,
    });
    return row;
  });
}
