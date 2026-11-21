/** M15 commands. Every write: authorize at the office's command scope, then write through platform records (audited, versioned). */
import { createHash } from 'node:crypto';
import type { ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, type Row } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm } from './permissions.js';
import { getUnit, unitAndDescendants } from './queries.js';
import { AttachmentUpload, AttachTo, Comment, LinkCreate, MAX_ATTACHMENT_BYTES, parse, Remove, UnitCreate, UnitUpdate, type UnitLevel } from './schemas.js';

export const commandScope = (commandId: string): ScopeRef => ({ kind: 'command', id: commandId });

/** Allowed parent level for each level. A section is optional, so a workshop may sit directly under a department (A1). */
const PARENT_LEVELS: Record<UnitLevel, readonly (UnitLevel | null)[]> = {
  department: [null],
  section: ['department'],
  workshop: ['department', 'section'],
  subsection: ['workshop'],
};

function checkParent(a: Actor, commandId: string, level: UnitLevel, parentId: string | null, selfId?: string): void {
  const allowed = PARENT_LEVELS[level];
  if (!parentId) {
    if (!allowed.includes(null)) throw new AppError('VALIDATION_FAILED', `A ${level} must sit under a ${allowed.join(' or ')}`);
    return;
  }
  const p = getUnit(a.wctx.db, parentId);
  if (!p || p.command_id !== commandId) throw new AppError('VALIDATION_FAILED', 'Parent unit not found in this office');
  if (!allowed.includes(p.level as UnitLevel)) throw new AppError('VALIDATION_FAILED', `A ${level} cannot sit under a ${p.level as string}; allowed: ${allowed.map((x) => x ?? 'top level').join(', ')}`);
  if (selfId && unitAndDescendants(a.wctx.db, selfId).includes(parentId)) throw new AppError('VALIDATION_FAILED', 'A unit cannot be moved under itself');
}

export function createUnit(a: Actor, input: unknown): Row {
  const v = parse(UnitCreate, input);
  const cmd = resolveParty(a.wctx.db, { kind: 'command', id: v.commandId });
  if (!cmd) throw new AppError('VALIDATION_FAILED', 'Command not found');
  authorize(a, perm('org_unit', 'create'), commandScope(v.commandId));
  checkParent(a, v.commandId, v.level, v.parentId ?? null);
  try {
    return createRecord(a.wctx, 'ofc.org_unit', {
      home_scope_id: v.commandId, command_id: v.commandId, parent_id: v.parentId ?? null, level: v.level, code: v.code, name: v.name,
      head_user_id: v.headUserId ?? null, deputy_user_id: v.deputyUserId ?? null, verify_rule: v.verifyRule ?? 'in_charge', sort_order: v.sortOrder ?? 0,
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE/.test(e.message)) throw new AppError('DUPLICATE', `Unit code ${v.code} is already used in this office`);
    throw e;
  }
}

export function updateUnit(a: Actor, id: string, input: unknown): Row {
  const v = parse(UnitUpdate, input);
  const cur = getUnit(a.wctx.db, id);
  if (!cur) throw new AppError('NOT_FOUND', `Unit ${id} not found`);
  const commandId = cur.command_id as string;
  authorize(a, perm('org_unit', 'update'), commandScope(commandId));
  if (v.parentId !== undefined) checkParent(a, commandId, cur.level as UnitLevel, v.parentId, id);
  if (v.status === 'inactive') {
    const live = a.wctx.db.prepare("SELECT 1 FROM ofc_org_unit WHERE parent_id = ? AND deleted_at IS NULL AND status = 'active'").get(id);
    if (live) throw new AppError('WORKFLOW_BLOCKED', 'Deactivate or move the units under it first');
  }
  const patch: Row = {};
  const map: Record<string, string> = { parentId: 'parent_id', code: 'code', name: 'name', headUserId: 'head_user_id', deputyUserId: 'deputy_user_id', verifyRule: 'verify_rule', sortOrder: 'sort_order', status: 'status' };
  for (const [k, col] of Object.entries(map)) if ((v as Record<string, unknown>)[k] !== undefined) patch[col] = (v as Record<string, unknown>)[k];
  return updateRecord(withReason(a, v.reason).wctx, 'ofc.org_unit', id, v.expectedVersion, patch);
}

/** Office scope of any record: the M15 tables carry home_scope_id = command id. Other modules' records are checked by their own module. */
export function scopeOfRecord(a: Actor, ref: { type: string; id: string }): ScopeRef | undefined {
  const def = a.wctx.registry.all().find((d) => d.type === ref.type);
  if (!def) throw new AppError('VALIDATION_FAILED', `Unknown record type ${ref.type}`);
  const row = a.wctx.db.prepare(`SELECT home_scope_id FROM ${def.table} WHERE id = ?`).get(ref.id) as { home_scope_id: string | null } | undefined;
  if (!row) throw new AppError('NOT_FOUND', `${ref.type} ${ref.id} not found`);
  if (!def.type.startsWith('ofc.')) return undefined;
  return row.home_scope_id ? commandScope(row.home_scope_id) : undefined;
}

function event(a: Actor, ref: { type: string; id: string }, scope: ScopeRef | undefined, e: { kind: string; note?: string | null; field?: string; from?: unknown; to?: unknown }): Row {
  return appendEvent(a.wctx, 'ofc.record_event', {
    home_scope_id: scope?.id ?? null, record_type: ref.type, record_id: ref.id, kind: e.kind, field: e.field ?? null,
    from_value: e.from == null ? null : String(e.from), to_value: e.to == null ? null : String(e.to), note: e.note ?? null,
    actor_name: (a.wctx.actor.snapshot as { displayName?: string } | undefined)?.displayName ?? a.wctx.actor.userId,
  });
}
export { event as recordEvent };

export function createLink(a: Actor, input: unknown): Row {
  const v = parse(LinkCreate, input);
  const scope = scopeOfRecord(a, v.from) ?? scopeOfRecord(a, v.to);
  scopeOfRecord(a, v.to);
  authorize(a, perm('link', 'create'), scope);
  const dup = a.wctx.db.prepare('SELECT 1 FROM ofc_link WHERE from_type=? AND from_id=? AND to_type=? AND to_id=? AND link_type=? AND deleted_at IS NULL').get(v.from.type, v.from.id, v.to.type, v.to.id, v.linkType);
  if (dup) throw new AppError('DUPLICATE', 'These records are already linked');
  return a.wctx.db.transaction(() => {
    const row = createRecord(a.wctx, 'ofc.link', { home_scope_id: scope?.id ?? null, from_type: v.from.type, from_id: v.from.id, to_type: v.to.type, to_id: v.to.id, link_type: v.linkType, note: v.note ?? null });
    for (const [self, other] of [[v.from, v.to], [v.to, v.from]] as const) event(a, self, scope, { kind: 'link', note: `${v.linkType}: ${other.type} ${other.id}` });
    return row;
  })();
}

export function removeLink(a: Actor, id: string, input: unknown): Row {
  const v = parse(Remove, input);
  const cur = a.wctx.db.prepare('SELECT * FROM ofc_link WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
  if (!cur) throw new AppError('NOT_FOUND', `Link ${id} not found`);
  const scope = cur.home_scope_id ? commandScope(cur.home_scope_id as string) : undefined;
  authorize(a, perm('link', 'remove'), scope);
  return tombstoneRecord(a.wctx, 'ofc.link', id, v.expectedVersion, v.reason);
}

export function uploadAttachment(a: Actor, input: unknown): Row {
  const v = parse(AttachmentUpload, input);
  const scope = v.record ? scopeOfRecord(a, v.record) : undefined;
  authorize(a, perm('attachment', 'create'), scope);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v.contentBase64)) throw new AppError('VALIDATION_FAILED', 'contentBase64 is not valid base64');
  const bytes = Buffer.from(v.contentBase64, 'base64');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError('VALIDATION_FAILED', `File is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return a.wctx.db.transaction(() => {
    a.wctx.db.prepare('INSERT OR IGNORE INTO ofc_attachment_content (sha256, bytes) VALUES (?, ?)').run(sha256, bytes);
    const row = createRecord(a.wctx, 'ofc.attachment', {
      home_scope_id: scope?.id ?? null, file_name: v.fileName, mime_type: v.mimeType, size_bytes: bytes.length, sha256, title: v.title ?? null, classification: v.classification,
    });
    if (v.record) attachInner(a, row.id as string, v.record, scope, v.fileName);
    return row;
  })();
}

function attachInner(a: Actor, attachmentId: string, record: { type: string; id: string }, scope: ScopeRef | undefined, fileName: string): Row {
  const dup = a.wctx.db.prepare('SELECT 1 FROM ofc_attachment_link WHERE attachment_id=? AND record_type=? AND record_id=? AND deleted_at IS NULL').get(attachmentId, record.type, record.id);
  if (dup) throw new AppError('DUPLICATE', 'Already attached to this record');
  const row = createRecord(a.wctx, 'ofc.attachment_link', { home_scope_id: scope?.id ?? null, attachment_id: attachmentId, record_type: record.type, record_id: record.id });
  event(a, record, scope, { kind: 'attachment', note: `Attached ${fileName}` });
  return row;
}

export function attachExisting(a: Actor, attachmentId: string, input: unknown): Row {
  const v = parse(AttachTo, input);
  const att = a.wctx.db.prepare('SELECT * FROM ofc_attachment WHERE id = ? AND deleted_at IS NULL').get(attachmentId) as Row | undefined;
  if (!att) throw new AppError('NOT_FOUND', `Attachment ${attachmentId} not found`);
  const scope = scopeOfRecord(a, v.record);
  authorize(a, perm('attachment', 'create'), scope);
  return a.wctx.db.transaction(() => attachInner(a, attachmentId, v.record, scope, att.file_name as string))();
}

export function detachAttachment(a: Actor, linkId: string, input: unknown): Row {
  const v = parse(Remove, input);
  const cur = a.wctx.db.prepare('SELECT l.*, a.file_name FROM ofc_attachment_link l JOIN ofc_attachment a ON a.id = l.attachment_id WHERE l.id = ? AND l.deleted_at IS NULL').get(linkId) as Row | undefined;
  if (!cur) throw new AppError('NOT_FOUND', `Attachment link ${linkId} not found`);
  const scope = cur.home_scope_id ? commandScope(cur.home_scope_id as string) : undefined;
  authorize(a, perm('attachment', 'remove'), scope);
  return a.wctx.db.transaction(() => {
    const row = tombstoneRecord(a.wctx, 'ofc.attachment_link', linkId, v.expectedVersion, v.reason);
    event(a, { type: cur.record_type as string, id: cur.record_id as string }, scope, { kind: 'attachment', note: `Removed ${cur.file_name as string}: ${v.reason}` });
    return row;
  })();
}

/** File bytes; restricted files need ofc.attachment.view_restricted (AT-15). */
export function readAttachment(a: Actor, id: string): { meta: Row; bytes: Buffer } {
  const meta = a.wctx.db.prepare('SELECT * FROM ofc_attachment WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
  if (!meta) throw new AppError('NOT_FOUND', `Attachment ${id} not found`);
  const scope = meta.home_scope_id ? commandScope(meta.home_scope_id as string) : undefined;
  authorize(a, perm('attachment', meta.classification === 'restricted' ? 'view_restricted' : 'view'), scope);
  const c = a.wctx.db.prepare('SELECT bytes FROM ofc_attachment_content WHERE sha256 = ?').get(meta.sha256) as { bytes: Buffer } | undefined;
  if (!c) throw new AppError('NOT_FOUND', 'The file content is not held at this installation');
  return { meta, bytes: c.bytes };
}

export function addComment(a: Actor, input: unknown): Row {
  const v = parse(Comment, input);
  const scope = scopeOfRecord(a, v.record);
  authorize(a, perm('timeline', 'comment'), scope);
  return event(a, v.record, scope, { kind: v.kind, note: v.note });
}
