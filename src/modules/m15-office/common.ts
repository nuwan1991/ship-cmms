/** Shared behaviour for every office record (spec §1.1): scope, today/overdue, filtered lists, audited updates with timeline entries. */
import type { Db } from '../../platform/db/open.js';
import type { ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { DEFAULT_DISPLAY_TZ } from '../../platform/time.js';
import { updateRecord, type Row } from '../../platform/records.js';
import { withReason, type Actor } from './actor.js';
import { recordEvent } from './service.js';

export const PRIORITIES = ['immediate', 'high', 'normal', 'low'] as const;
export const commandScopeOf = (row: Row): ScopeRef => ({ kind: 'command', id: row.command_id as string });

/** Today's calendar date in the office's time zone (overdue is a calendar rule, FR-C10). */
export const todayLocal = (tz: string = DEFAULT_DISPLAY_TZ, at: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** True when the actor holds the permission at that scope (no audit, no throw): for masking and UI hints. */
export const holds = (a: Actor, permission: string, scope: ScopeRef): boolean => a.authz.check(a.principal, permission, scope).allowed;

export const getLiveRow = (db: Db, table: string, id: string): Row | undefined =>
  db.prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
export function mustGet(db: Db, table: string, id: string, label: string): Row {
  const r = getLiveRow(db, table, id);
  if (!r) throw new AppError('NOT_FOUND', `${label} ${id} not found`);
  return r;
}

const snake = (k: string): string => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const asCol = (v: unknown): unknown => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

/**
 * Update an office record. `keyFields` are identity fields (reference numbers, dates, subject): changing them is a correction,
 * which needs a reason and is written to the timeline with old and new values (FR-C7). Status changes are timeline entries too.
 */
export function updateWithHistory(
  a: Actor, entityType: string, cur: Row, input: Record<string, unknown> & { expectedVersion: number; reason?: string | null | undefined },
  opts: { keyFields?: readonly string[]; skip?: readonly string[] } = {},
): Row {
  const { expectedVersion, reason, ...rest } = input;
  const patch: Row = {};
  for (const [k, v] of Object.entries(rest)) if (v !== undefined && !(opts.skip ?? []).includes(k)) patch[snake(k)] = asCol(v);
  const changed = Object.keys(patch).filter((c) => (cur[c] ?? null) !== (patch[c] ?? null));
  const keyCols = (opts.keyFields ?? []).map(snake);
  const corrections = changed.filter((c) => keyCols.includes(c));
  if (corrections.length && !reason) throw new AppError('VALIDATION_FAILED', `A reason is required to correct ${corrections.join(', ')}`);
  const ref = { type: entityType, id: cur.id as string };
  const scope = commandScopeOf(cur);
  return a.wctx.db.transaction(() => {
    const next = updateRecord(withReason(a, reason).wctx, entityType, cur.id as string, expectedVersion, patch);
    for (const c of corrections) recordEvent(a, ref, scope, { kind: 'correction', field: c, from: cur[c], to: patch[c], note: reason ?? null });
    if (changed.includes('status')) recordEvent(a, ref, scope, { kind: patch.status === 'cancelled' ? 'cancel' : 'status', field: 'status', from: cur.status, to: patch.status, note: reason ?? null });
    for (const c of ['action_user_id', 'responsible_user_id', 'assignee_person_id']) if (changed.includes(c)) recordEvent(a, ref, scope, { kind: 'assign', field: c, from: cur[c], to: patch[c], note: reason ?? null });
    for (const c of ['reply_due', 'target_date']) if (changed.includes(c) && !corrections.includes(c)) recordEvent(a, ref, scope, { kind: 'target_date', field: c, from: cur[c], to: patch[c], note: reason ?? null });
    return next;
  })();
}

const like = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
export interface ListQuery { limit: number; offset: number; q?: string | undefined; sort?: string | undefined; dir?: 'asc' | 'desc' | undefined }

/** Filtered, searched, sorted page of a table. `where` and `params` are built by the caller from validated input only. */
export function pageOf(db: Db, table: string, where: string[], params: unknown[], q: ListQuery, search: readonly string[], sortable: Record<string, string>, defaultSort: string) {
  const w = ['deleted_at IS NULL', ...where];
  const p = [...params];
  if (q.q) { w.push(`(${search.map((c) => `COALESCE(${c},'') LIKE ? ESCAPE '\\'`).join(' OR ')})`); for (const _ of search) p.push(like(q.q)); }
  const order = `${sortable[q.sort ?? ''] ?? defaultSort} ${q.dir === 'asc' ? 'ASC' : q.dir === 'desc' ? 'DESC' : ''}, id`;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${w.join(' AND ')}`).get(...p) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...p, q.limit, q.offset) as Row[];
  return { rows, total };
}
