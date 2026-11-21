/** Correspondence register and matters (spec §1.4, FR-K1..K6). */
import { AppError } from '../../platform/errors.js';
import { createRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, type Actor } from './actor.js';
import { commandScopeOf, holds, mustGet, pageOf, todayLocal, updateWithHistory } from './common.js';
import { nextRef, type OfficeSequence } from './numbering.js';
import { perm } from './permissions.js';
import { CORR_STATUS, CorrCreate, CorrList, CorrNoReply, CorrStatus, CorrUpdate, MatterCreate, MatterUpdate, parse } from './schemas.js';
import { commandScope, recordEvent } from './service.js';
import { assertVisible, visibility, visibleWhere } from './scope.js';

const T = 'ofc_correspondence';
const DEFAULT_STATUS = { incoming: 'received', outgoing: 'draft', minute: 'open', signal: 'received', other: 'open' } as const;
const SEQ: Record<string, OfficeSequence> = { incoming: 'ofc_corr_in', signal: 'ofc_corr_in', outgoing: 'ofc_corr_out', minute: 'ofc_minute', other: 'ofc_corr_in' };
const MASKED = ['subject', 'originator', 'recipients', 'remarks', 'official_ref', 'file_ref'];

function requireCommand(a: Actor, commandId: string): void {
  if (!resolveParty(a.wctx.db, { kind: 'command', id: commandId })) throw new AppError('VALIDATION_FAILED', 'Command not found');
}
function checkUnit(a: Actor, commandId: string, unitId: string | null | undefined): void {
  if (!unitId) return;
  const u = a.wctx.db.prepare('SELECT 1 FROM ofc_org_unit WHERE id = ? AND command_id = ? AND deleted_at IS NULL').get(unitId, commandId);
  if (!u) throw new AppError('VALIDATION_FAILED', 'Unit not found in this office');
}

// ---- matters
export function createMatter(a: Actor, input: unknown): Row {
  const v = parse(MatterCreate, input);
  requireCommand(a, v.commandId);
  authorize(a, perm('correspondence', 'create'), commandScope(v.commandId));
  checkUnit(a, v.commandId, v.unitId);
  return createRecord(a.wctx, 'ofc.matter', {
    home_scope_id: v.commandId, command_id: v.commandId, ref_no: nextRef(a.wctx, 'ofc_matter'), title: v.title, file_ref: v.fileRef ?? null, unit_id: v.unitId ?? null, remarks: v.remarks ?? null,
  });
}
export function updateMatter(a: Actor, id: string, input: unknown): Row {
  const v = parse(MatterUpdate, input);
  const cur = mustGet(a.wctx.db, 'ofc_matter', id, 'Matter');
  authorize(a, perm('correspondence', 'update'), commandScopeOf(cur));
  checkUnit(a, cur.command_id as string, v.unitId);
  return updateWithHistory(a, 'ofc.matter', cur, v, { keyFields: ['fileRef'] });
}
export function matterThread(a: Actor, id: string): { matter: Row; letters: Row[] } {
  const matter = mustGet(a.wctx.db, 'ofc_matter', id, 'Matter');
  authorize(a, perm('correspondence', 'view'), commandScopeOf(matter));
  const letters = a.wctx.db.prepare(`SELECT * FROM ${T} WHERE matter_id = ? AND deleted_at IS NULL ORDER BY COALESCE(letter_date, received_date, sent_date, substr(created_at,1,10)), created_at`).all(id) as Row[];
  return { matter, letters: letters.map((l) => maskRow(a, l)) };
}

// ---- correspondence
/** Restricted letters are listed (so the register stays complete) but their content is hidden without view_restricted (A3). */
export function maskRow(a: Actor, r: Row): Row {
  if (r.classification !== 'restricted' || holds(a, perm('correspondence', 'view_restricted'), commandScopeOf(r))) return r;
  const out: Row = { ...r, masked: true };
  for (const k of MASKED) out[k] = k === 'subject' ? '[Restricted]' : null;
  return out;
}

export function findDuplicates(a: Actor, commandId: string, officialRef: string | null | undefined, letterDate: string | null | undefined, excludeId?: string): Row[] {
  if (!officialRef) return [];
  return a.wctx.db.prepare(
    `SELECT id, ref_no, official_ref, letter_date, subject FROM ${T} WHERE command_id = ? AND deleted_at IS NULL AND status <> 'cancelled'
       AND lower(trim(official_ref)) = lower(trim(?)) AND COALESCE(letter_date,'') = COALESCE(?,'') AND id <> COALESCE(?, '')`,
  ).all(commandId, officialRef, letterDate ?? null, excludeId ?? null) as Row[];
}

export function createCorrespondence(a: Actor, input: unknown): Row {
  const v = parse(CorrCreate, input);
  requireCommand(a, v.commandId);
  authorize(a, perm('correspondence', 'create'), commandScope(v.commandId));
  checkUnit(a, v.commandId, v.unitId);
  const status = v.status ?? DEFAULT_STATUS[v.kind];
  if (!CORR_STATUS[v.kind].includes(status) || status === 'cancelled') throw new AppError('VALIDATION_FAILED', `Status ${status} is not valid for ${v.kind} correspondence`);
  let matterId = v.matterId ?? null;
  let replyTo: Row | undefined;
  if (v.replyToId) {
    replyTo = mustGet(a.wctx.db, T, v.replyToId, 'Correspondence');
    if (replyTo.command_id !== v.commandId) throw new AppError('VALIDATION_FAILED', 'The letter being answered belongs to another office');
    matterId = matterId ?? (replyTo.matter_id as string | null);
  }
  if (matterId) {
    const m = mustGet(a.wctx.db, 'ofc_matter', matterId, 'Matter');
    if (m.command_id !== v.commandId) throw new AppError('VALIDATION_FAILED', 'Matter belongs to another office');
  }
  if (v.replyRequired && !v.replyDue && v.kind !== 'outgoing') throw new AppError('VALIDATION_FAILED', 'Set the reply due date when a reply is required');
  const dups = findDuplicates(a, v.commandId, v.officialRef, v.letterDate);
  if (dups.length && !v.allowDuplicate) {
    throw new AppError('DUPLICATE', `A letter with reference ${v.officialRef ?? ''} dated ${v.letterDate ?? '(no date)'} is already registered as ${dups.map((d) => d.ref_no).join(', ')}`, { duplicates: dups });
  }
  return a.wctx.db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.correspondence', {
      home_scope_id: v.commandId, command_id: v.commandId, ref_no: nextRef(a.wctx, SEQ[v.kind]!), kind: v.kind,
      official_ref: v.officialRef ?? null, file_ref: v.fileRef ?? null, letter_date: v.letterDate ?? null, received_date: v.receivedDate ?? null, sent_date: v.sentDate ?? null,
      originator: v.originator ?? null, recipients: v.recipients ?? null, subject: v.subject, classification: v.classification ?? 'unclassified', priority: v.priority ?? 'normal',
      reply_required: v.replyRequired ? 1 : 0, reply_due: v.replyDue ?? null, action_user_id: v.actionUserId ?? null, unit_id: v.unitId ?? null, status,
      dispatch_mode: v.dispatchMode ?? null, matter_id: matterId, reply_to_id: v.replyToId ?? null, original_ref: v.originalRef ?? null, remarks: v.remarks ?? null,
    });
    if (replyTo) {
      createRecord(a.wctx, 'ofc.link', { home_scope_id: v.commandId, from_type: 'ofc.correspondence', from_id: row.id, to_type: 'ofc.correspondence', to_id: replyTo.id, link_type: 'reply_to', note: null });
      recordEvent(a, { type: 'ofc.correspondence', id: replyTo.id as string }, commandScope(v.commandId), { kind: 'link', note: `Reply registered: ${row.ref_no as string}` });
    }
    return row;
  })();
}

export function getCorrespondence(a: Actor, id: string): Row {
  const r = mustGet(a.wctx.db, T, id, 'Correspondence');
  authorize(a, perm('correspondence', 'view'), commandScopeOf(r));
  assertVisible(a, r, 'unit_id', ['action_user_id'], 'This letter');
  const replies = a.wctx.db.prepare(`SELECT id, ref_no, kind, status, sent_date, subject, classification, command_id FROM ${T} WHERE reply_to_id = ? AND deleted_at IS NULL ORDER BY created_at`).all(id) as Row[];
  const pending = a.wctx.db.prepare('SELECT 1 FROM ofc_v_correspondence_pending WHERE id = ?').get(id) !== undefined;
  return { ...maskRow(a, r), pending, overdue: pending && !!r.reply_due && (r.reply_due as string) < todayLocal(), replies: replies.map((x) => maskRow(a, x)) };
}

const KEY_FIELDS = ['officialRef', 'letterDate', 'receivedDate', 'sentDate', 'subject', 'originator', 'recipients'];
export function updateCorrespondence(a: Actor, id: string, input: unknown): Row {
  const v = parse(CorrUpdate, input);
  const cur = mustGet(a.wctx.db, T, id, 'Correspondence');
  const scope = commandScopeOf(cur);
  authorize(a, perm('correspondence', 'update'), scope);
  if (cur.classification === 'restricted' || v.classification === 'restricted') authorize(a, perm('correspondence', 'view_restricted'), scope);
  if (cur.status === 'cancelled') throw new AppError('WORKFLOW_BLOCKED', 'Cancelled correspondence cannot be changed');
  checkUnit(a, cur.command_id as string, v.unitId);
  if (v.matterId) mustGet(a.wctx.db, 'ofc_matter', v.matterId, 'Matter');
  if (v.officialRef !== undefined || v.letterDate !== undefined) {
    const dups = findDuplicates(a, cur.command_id as string, v.officialRef !== undefined ? v.officialRef : (cur.official_ref as string | null), v.letterDate !== undefined ? v.letterDate : (cur.letter_date as string | null), id);
    if (dups.length) throw new AppError('DUPLICATE', `That reference and date are already registered as ${dups.map((d) => d.ref_no).join(', ')}`, { duplicates: dups });
  }
  return updateWithHistory(a, 'ofc.correspondence', cur, v, { keyFields: KEY_FIELDS });
}

export function setCorrespondenceStatus(a: Actor, id: string, input: unknown): Row {
  const v = parse(CorrStatus, input);
  const cur = mustGet(a.wctx.db, T, id, 'Correspondence');
  const scope = commandScopeOf(cur);
  if (!CORR_STATUS[cur.kind as keyof typeof CORR_STATUS].includes(v.status)) throw new AppError('VALIDATION_FAILED', `Status ${v.status} is not valid for ${cur.kind as string} correspondence`);
  if (cur.status === 'cancelled') throw new AppError('WORKFLOW_BLOCKED', 'Cancelled correspondence cannot change status');
  if (v.status === 'cancelled') {
    authorize(a, perm('correspondence', 'cancel'), scope);
    if (!v.reason) throw new AppError('VALIDATION_FAILED', 'A reason is required to cancel');
  } else authorize(a, perm('correspondence', 'update'), scope);
  const patch: Row = { status: v.status };
  if (v.status === 'dispatched' && !cur.sent_date) patch.sent_date = todayLocal();
  const next = updateWithHistory(a, 'ofc.correspondence', cur, { expectedVersion: v.expectedVersion, reason: v.reason ?? v.note ?? null, ...{ status: v.status, sentDate: patch.sent_date as string | undefined } });
  if (v.note && v.reason) recordEvent(a, { type: 'ofc.correspondence', id }, scope, { kind: 'comment', note: v.note });
  return next;
}

export function markNoReplyNeeded(a: Actor, id: string, input: unknown): Row {
  const v = parse(CorrNoReply, input);
  const cur = mustGet(a.wctx.db, T, id, 'Correspondence');
  authorize(a, perm('correspondence', 'update'), commandScopeOf(cur));
  if (!cur.reply_required) throw new AppError('WORKFLOW_BLOCKED', 'This correspondence does not require a reply');
  const next = updateWithHistory(a, 'ofc.correspondence', cur, { expectedVersion: v.expectedVersion, noReplyReason: v.reason, reason: v.reason }, {});
  recordEvent(a, { type: 'ofc.correspondence', id }, commandScopeOf(cur), { kind: 'status', field: 'reply', to: 'no reply needed', note: v.reason });
  return next;
}

const SORT: Record<string, string> = { refNo: 'ref_no', date: 'COALESCE(letter_date, received_date, sent_date)', replyDue: 'reply_due', subject: 'subject', status: 'status', priority: "CASE priority WHEN 'immediate' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END" };
export function listCorrespondence(a: Actor, raw: unknown) {
  const v = parse(CorrList, raw);
  authorize(a, perm('correspondence', 'view'), commandScope(v.commandId));
  const lim = visibleWhere(visibility(a, v.commandId), 'unit_id', ['action_user_id']);
  const where: string[] = ['command_id = ?', ...lim.where];
  const params: unknown[] = [v.commandId, ...lim.params];
  const eq: Array<[unknown, string]> = [[v.kind, 'kind'], [v.status, 'status'], [v.matterId, 'matter_id'], [v.actionUserId, 'action_user_id'], [v.unitId, 'unit_id'], [v.priority, 'priority']];
  for (const [val, col] of eq) if (val !== undefined) { where.push(`${col} = ?`); params.push(val); }
  if (v.pending !== undefined) where.push(`id ${v.pending ? '' : 'NOT '}IN (SELECT id FROM ofc_v_correspondence_pending)`);
  if (v.overdue) { where.push('id IN (SELECT id FROM ofc_v_correspondence_pending WHERE reply_due < ?)'); params.push(todayLocal()); }
  // Text search must not reveal restricted content to users who cannot see it.
  if (v.q && !holds(a, perm('correspondence', 'view_restricted'), commandScope(v.commandId))) where.push("classification <> 'restricted'");
  const dateCol = 'COALESCE(letter_date, received_date, sent_date, substr(created_at,1,10))';
  if (v.from) { where.push(`${dateCol} >= ?`); params.push(v.from); }
  if (v.to) { where.push(`${dateCol} <= ?`); params.push(v.to); }
  const { rows, total } = pageOf(a.wctx.db, T, where, params, v, ['ref_no', 'official_ref', 'subject', 'originator', 'recipients', 'remarks', 'file_ref'], SORT, 'COALESCE(letter_date, received_date, sent_date) DESC');
  const pendingIds = new Set((a.wctx.db.prepare('SELECT id FROM ofc_v_correspondence_pending WHERE command_id = ?').all(v.commandId) as Array<{ id: string }>).map((r) => r.id));
  const today = todayLocal();
  return {
    total,
    items: rows.map((r) => {
      const pending = pendingIds.has(r.id as string);
      return { ...maskRow(a, r), pending, overdue: pending && !!r.reply_due && (r.reply_due as string) < today } as Row;
    }),
  };
}
