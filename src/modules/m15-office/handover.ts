/** Handover / takeover register (spec §1.3, FR-H1..H5). */
import { uuidv7 } from '../../platform/ids.js';
import { AppError } from '../../platform/errors.js';
import { createRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, type Actor } from './actor.js';
import { commandScopeOf, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef } from './numbering.js';
import { perm } from './permissions.js';
import { ItemAction, ItemBulk, ItemCreate, ItemList, ItemUpdate, PacketCreate, PacketUpdate, parse } from './schemas.js';
import { commandScope, recordEvent } from './service.js';
import { visibility, visibleWhere } from './scope.js';
import type { z } from 'zod';

const P = 'ofc_handover_packet';
const I = 'ofc_handover_item';
const DONE = "('completed','not_applicable')";

export function createPacket(a: Actor, input: unknown): Row {
  const v = parse(PacketCreate, input);
  if (!resolveParty(a.wctx.db, { kind: 'command', id: v.commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm('handover', 'create'), commandScope(v.commandId));
  return createRecord(a.wctx, 'ofc.handover_packet', {
    home_scope_id: v.commandId, command_id: v.commandId, ref_no: nextRef(a.wctx, 'ofc_handover'), appointment: v.appointment, unit_id: v.unitId ?? null,
    from_name: v.fromName, from_user_id: v.fromUserId ?? null, to_name: v.toName, to_user_id: v.toUserId ?? null, handover_date: v.handoverDate ?? null,
    takeover_date: v.takeoverDate ?? null, document_ref: v.documentRef ?? null, remarks: v.remarks ?? null,
  });
}

export function updatePacket(a: Actor, id: string, input: unknown): Row {
  const v = parse(PacketUpdate, input);
  const cur = mustGet(a.wctx.db, P, id, 'Handover');
  authorize(a, perm('handover', 'update'), commandScopeOf(cur));
  if (v.status === 'completed') {
    const open = (a.wctx.db.prepare(`SELECT COUNT(*) AS n FROM ${I} WHERE packet_id = ? AND deleted_at IS NULL AND status NOT IN ${DONE}`).get(id) as { n: number }).n;
    if (open) throw new AppError('WORKFLOW_BLOCKED', `${open} handover item(s) are still open`);
  }
  return updateWithHistory(a, 'ofc.handover_packet', cur, v, { keyFields: ['documentRef', 'handoverDate', 'takeoverDate', 'fromName', 'toName'] });
}

export function listPackets(a: Actor, commandId: string): Row[] {
  authorize(a, perm('handover', 'view'), commandScope(commandId));
  return a.wctx.db.prepare(
    `SELECT p.*, COUNT(i.id) AS item_count, SUM(CASE WHEN i.status IN ${DONE} THEN 1 ELSE 0 END) AS done_count,
            SUM(CASE WHEN i.status NOT IN ${DONE} AND i.urgent = 1 THEN 1 ELSE 0 END) AS urgent_open
       FROM ${P} p LEFT JOIN ${I} i ON i.packet_id = p.id AND i.deleted_at IS NULL
      WHERE p.command_id = ? AND p.deleted_at IS NULL GROUP BY p.id ORDER BY COALESCE(p.takeover_date, p.handover_date) DESC, p.created_at DESC`,
  ).all(commandId) as Row[];
}

export function getPacket(a: Actor, id: string): Row {
  const p = mustGet(a.wctx.db, P, id, 'Handover');
  authorize(a, perm('handover', 'view'), commandScopeOf(p));
  return p;
}

function itemValues(packet: Row, v: z.infer<typeof ItemCreate>, batchId: string | null): Row {
  return {
    home_scope_id: packet.command_id, command_id: packet.command_id, packet_id: packet.id, annex_ref: v.annexRef ?? null, category: v.category,
    subject: v.subject, description: v.description ?? null, previous_status: v.previousStatus ?? null, status: v.status ?? 'open', priority: v.priority ?? 'normal',
    urgent: v.urgent ? 1 : 0, responsible_user_id: v.responsibleUserId ?? null, unit_id: v.unitId ?? null, target_date: v.targetDate ?? null,
    original_ref: v.originalRef ?? null, import_batch_id: batchId, remarks: v.remarks ?? null,
  };
}

export function createItem(a: Actor, packetId: string, input: unknown): Row {
  const packet = mustGet(a.wctx.db, P, packetId, 'Handover');
  authorize(a, perm('handover', 'create'), commandScopeOf(packet));
  const v = parse(ItemCreate, input);
  return createRecord(a.wctx, 'ofc.handover_item', { ...itemValues(packet, v, null), ref_no: nextRef(a.wctx, 'ofc_handover_item') });
}

export function updateItem(a: Actor, id: string, input: unknown): Row {
  const v = parse(ItemUpdate, input);
  const cur = mustGet(a.wctx.db, I, id, 'Handover item');
  authorize(a, perm('handover', 'update'), commandScopeOf(cur));
  if (v.previousStatus !== undefined && v.previousStatus !== cur.previous_status && !v.reason) {
    throw new AppError('VALIDATION_FAILED', 'Previous status is copied from the handover document; a reason is required to correct it');
  }
  return updateWithHistory(a, 'ofc.handover_item', cur, v, { keyFields: ['annexRef', 'subject', 'previousStatus', 'originalRef'] });
}

/** Record an action on an item: a progress entry in the timeline that also becomes the item's "latest action" (FR-H2). */
export function addItemAction(a: Actor, id: string, input: unknown): Row {
  const v = parse(ItemAction, input);
  const cur = mustGet(a.wctx.db, I, id, 'Handover item');
  authorize(a, perm('handover', 'update'), commandScopeOf(cur));
  return a.wctx.db.transaction(() => {
    recordEvent(a, { type: 'ofc.handover_item', id }, commandScopeOf(cur), { kind: 'progress', note: v.note });
    const status = v.status ?? (cur.status === 'open' ? 'in_progress' : (cur.status as string));
    return updateWithHistory(a, 'ofc.handover_item', cur, { expectedVersion: v.expectedVersion, latestAction: v.note, latestActionAt: todayLocal(), status });
  })();
}

const ISORT: Record<string, string> = { refNo: 'ref_no', annexRef: 'annex_ref', targetDate: 'target_date', status: 'status', subject: 'subject', priority: "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END" };
export function listItems(a: Actor, packetId: string, raw: unknown) {
  const packet = getPacket(a, packetId);
  const v = parse(ItemList, raw);
  const lim = visibleWhere(visibility(a, packet.command_id as string), 'unit_id', ['responsible_user_id']);
  const where = ['packet_id = ?', ...lim.where];
  const params: unknown[] = [packet.id, ...lim.params];
  for (const [val, col] of [[v.status, 'status'], [v.category, 'category'], [v.responsibleUserId, 'responsible_user_id'], [v.priority, 'priority']] as const) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  if (v.urgent !== undefined) { where.push('urgent = ?'); params.push(v.urgent ? 1 : 0); }
  if (v.open !== undefined) where.push(`status ${v.open ? 'NOT ' : ''}IN ${DONE}`);
  const today = todayLocal();
  if (v.overdue) { where.push(`status NOT IN ${DONE} AND target_date < ?`); params.push(today); }
  const { rows, total } = pageOf(a.wctx.db, I, where, params, v, ['ref_no', 'annex_ref', 'subject', 'description', 'remarks', 'latest_action', 'original_ref'], ISORT, 'COALESCE(annex_ref, ref_no)');
  return { total, items: rows.map((r) => ({ ...r, overdue: !['completed', 'not_applicable'].includes(r.status as string) && !!r.target_date && (r.target_date as string) < today }) as Row) };
}

/**
 * Bulk registration from existing records (FR-H3). Preview first: every row is validated and checked for duplicates
 * (same annex reference and subject in this handover, or in the batch itself). Nothing is written unless commit is true and no row has errors.
 */
export function bulkItems(a: Actor, packetId: string, input: unknown) {
  const packet = mustGet(a.wctx.db, P, packetId, 'Handover');
  authorize(a, perm('handover', 'create'), commandScopeOf(packet));
  const v = parse(ItemBulk, input);
  const existing = new Set((a.wctx.db.prepare(`SELECT lower(COALESCE(annex_ref,'')) || '|' || lower(subject) AS k FROM ${I} WHERE packet_id = ? AND deleted_at IS NULL`).all(packetId) as Array<{ k: string }>).map((r) => r.k));
  const seen = new Set<string>();
  const rows = v.rows.map((raw, i) => {
    const r = ItemCreate.safeParse(raw);
    if (!r.success) return { row: i + 1, ok: false as const, errors: r.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`), warnings: [] as string[] };
    const k = `${(r.data.annexRef ?? '').toLowerCase()}|${r.data.subject.toLowerCase()}`;
    const warnings: string[] = [];
    if (existing.has(k)) warnings.push('Already registered in this handover (same annex reference and subject)');
    if (seen.has(k)) warnings.push('Repeated in this upload');
    seen.add(k);
    return { row: i + 1, ok: true as const, errors: [] as string[], warnings, data: r.data };
  });
  const errors = rows.filter((r) => !r.ok).length;
  const summary = { rows: rows.length, errors, warnings: rows.filter((r) => r.warnings.length).length };
  if (!v.commit || errors) return { committed: false, summary, rows: rows.map(({ row, errors: e, warnings }) => ({ row, errors: e, warnings })) };
  const batchId = uuidv7();
  const created = a.wctx.db.transaction(() =>
    rows.map((r) => createRecord(a.wctx, 'ofc.handover_item', { ...itemValues(packet, (r as { data: z.infer<typeof ItemCreate> }).data, batchId), ref_no: nextRef(a.wctx, 'ofc_handover_item') }).ref_no),
  )();
  return { committed: true, batchId, summary, created };
}

/** FR-H5: progress of one handover by status and category, with open urgent and overdue items. */
export function handoverReport(a: Actor, packetId: string) {
  const packet = getPacket(a, packetId);
  const db = a.wctx.db;
  const today = todayLocal();
  const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM ${I} WHERE packet_id = ? AND deleted_at IS NULL GROUP BY status`).all(packetId) as Row[];
  const byCategory = db.prepare(
    `SELECT category, COUNT(*) AS total, SUM(CASE WHEN status IN ${DONE} THEN 1 ELSE 0 END) AS done FROM ${I} WHERE packet_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY category`,
  ).all(packetId) as Row[];
  const total = byStatus.reduce((n, r) => n + (r.n as number), 0);
  const done = byStatus.filter((r) => ['completed', 'not_applicable'].includes(r.status as string)).reduce((n, r) => n + (r.n as number), 0);
  const attention = db.prepare(
    `SELECT * FROM ${I} WHERE packet_id = ? AND deleted_at IS NULL AND status NOT IN ${DONE} AND (urgent = 1 OR priority = 'immediate' OR target_date < ?)
      ORDER BY urgent DESC, target_date`,
  ).all(packetId, today) as Row[];
  return {
    packet, asOf: today, total, done, percentComplete: total ? Math.round((done / total) * 100) : 0,
    byStatus, byCategory, attention: attention.map((r) => ({ ...r, overdue: !!r.target_date && (r.target_date as string) < today })),
  };
}
