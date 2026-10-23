/**
 * Asset movements are append-only events (install, remove, custody transfer, status change, void). The current state of an asset
 * (where it is installed, who holds it, where it physically is, its status) is DERIVED by folding the events in
 * (occurred_at, id) order; ids are time-ordered so ties are deterministic on every installation. The derived table is
 * rebuildable at any time and is never synchronized (SYNC_RULES §2, D19).
 *
 * Commands entered here are checked against the state at entry time and refuse obvious mistakes. Events that arrive by
 * synchronization are never rejected for state reasons (D20): a position that ends up with two assets is flagged in
 * ast_v_position_conflicts instead.
 */
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import type { EventBus } from '../../platform/events.js';
import { appendEvent, writeAudit, type Row } from '../../platform/records.js';
import { isUtcIso, nowUtc } from '../../platform/time.js';
import { getLocation, resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm } from './permissions.js';
import { exists, getAssetState, getLive, toApi, type AssetState } from './queries.js';
import { MovementCreate, parse, type MovementInput } from './schemas.js';

const FUTURE_TOLERANCE_MS = 5 * 60_000;

interface MovementRow {
  id: string;
  kind: string;
  occurred_at: string;
  position_id: string | null;
  location_id: string | null;
  custody_party_kind: string | null;
  custody_party_id: string | null;
  asset_status: string | null;
  corrects_movement_id: string | null;
}

interface Folded {
  positionId: string | null;
  locationId: string | null;
  custodyKind: string | null;
  custodyId: string | null;
  status: string | null;
  installedSince: string | null;
  lastMovementId: string | null;
  lastOccurredAt: string | null;
}

/** Pure fold of an asset's movement history. Voided movements and void events themselves are skipped. */
export function foldMovements(rows: readonly MovementRow[]): Folded | null {
  const ordered = [...rows].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1));
  const voided = new Set(ordered.filter((r) => r.kind === 'void').map((r) => r.corrects_movement_id));
  const s: Folded = { positionId: null, locationId: null, custodyKind: null, custodyId: null, status: null, installedSince: null, lastMovementId: null, lastOccurredAt: null };
  let any = false;
  for (const r of ordered) {
    if (r.kind === 'void' || voided.has(r.id)) continue;
    any = true;
    if (r.kind === 'install') { s.positionId = r.position_id; s.installedSince = r.occurred_at; }
    if (r.kind === 'remove') { s.positionId = null; s.installedSince = null; }
    if (r.location_id) s.locationId = r.location_id;
    if (r.custody_party_kind && r.custody_party_id) { s.custodyKind = r.custody_party_kind; s.custodyId = r.custody_party_id; }
    if (r.asset_status) s.status = r.asset_status;
    s.lastMovementId = r.id;
    s.lastOccurredAt = r.occurred_at;
  }
  return any ? s : null;
}

const movementsOf = (db: Db, assetId: string): MovementRow[] =>
  db.prepare('SELECT id, kind, occurred_at, position_id, location_id, custody_party_kind, custody_party_id, asset_status, corrects_movement_id FROM ast_asset_movement WHERE asset_id = ?').all(assetId) as MovementRow[];

/** Recompute one asset's derived row from its events (also run after events arrive by synchronization). */
export function refoldAsset(db: Db, assetId: string): void {
  const f = foldMovements(movementsOf(db, assetId));
  if (!f) {
    db.prepare('DELETE FROM ast_asset_current WHERE asset_id = ?').run(assetId);
    return;
  }
  db.prepare(
    `INSERT INTO ast_asset_current (asset_id, position_id, location_id, custody_party_kind, custody_party_id, asset_status, installed_since, last_movement_id, last_occurred_at, rebuilt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET position_id = excluded.position_id, location_id = excluded.location_id, custody_party_kind = excluded.custody_party_kind,
       custody_party_id = excluded.custody_party_id, asset_status = excluded.asset_status, installed_since = excluded.installed_since,
       last_movement_id = excluded.last_movement_id, last_occurred_at = excluded.last_occurred_at, rebuilt_at = excluded.rebuilt_at`,
  ).run(assetId, f.positionId, f.locationId, f.custodyKind, f.custodyId, f.status, f.installedSince, f.lastMovementId, f.lastOccurredAt, nowUtc());
}

/** Rebuild the whole derived table (after restore, or after a bulk synchronization). Returns the number of assets folded. */
export function rebuildAssetCurrent(db: Db): number {
  return db.transaction(() => {
    db.prepare('DELETE FROM ast_asset_current').run();
    const ids = db.prepare('SELECT DISTINCT asset_id FROM ast_asset_movement').all() as Array<{ asset_id: string }>;
    for (const { asset_id } of ids) refoldAsset(db, asset_id);
    return ids.length;
  })();
}

export interface MovementValues {
  kind: 'register' | 'install' | 'remove' | 'custody_transfer' | 'status_change' | 'void';
  positionId?: string | null;
  locationId?: string | null;
  custody?: { kind: string; id: string } | null;
  assetStatus?: string | null;
  note?: string | null;
  correctsMovementId?: string | null;
  occurredAt?: string;
}

/** Append one movement event (no validation; callers validate) and audit it. */
export function appendMovement(a: Actor, asset: Row, m: MovementValues): Row {
  const row = appendEvent(a.wctx, 'ast.asset_movement', {
    home_scope_id: asset.home_scope_id ?? null,
    ...(m.occurredAt ? { occurred_at: m.occurredAt } : {}),
    asset_id: asset.id, kind: m.kind, position_id: m.positionId ?? null, location_id: m.locationId ?? null,
    custody_party_kind: m.custody?.kind ?? null, custody_party_id: m.custody?.id ?? null,
    asset_status: m.assetStatus ?? null, note: m.note ?? null, corrects_movement_id: m.correctsMovementId ?? null,
  });
  writeAudit(a.wctx, { action: `asset.${m.kind}`, entityType: 'ast.asset', entityId: asset.id as string, entityVersion: asset.version as number });
  return row;
}

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });

/** References a movement may carry: org location and custody party (both owned by M01, resolved through its public lookups). */
export function checkRefs(db: Db, m: { locationId?: string | null; custody?: { kind: string; id: string } | null }): void {
  if (m.locationId && !getLocation(db, m.locationId)) throw missing('Location', m.locationId);
  if (m.custody && !resolveParty(db, m.custody as Parameters<typeof resolveParty>[1])) throw missing(`Custody ${m.custody.kind}`, m.custody.id);
}

/** Position must exist, be active and be free (nothing else currently installed there). */
export function checkPositionFree(db: Db, positionId: string, assetId: string | null): Row {
  const p = getLive(db, 'position', positionId);
  if (!p) throw missing('Position', positionId);
  if (p.status !== 'active') throw blocked('Position is inactive', { positionId });
  const other = db.prepare('SELECT asset_id FROM ast_asset_current WHERE position_id = ? AND asset_id <> ? LIMIT 1').get(positionId, assetId ?? '') as { asset_id: string } | undefined;
  if (other) throw blocked('Another asset is installed in this position; remove it first', { positionId, occupiedBy: other.asset_id });
  return p;
}

const assetScope = (asset: Row) => (asset.home_scope_id ? ({ kind: 'ship', id: asset.home_scope_id as string } as const) : ({ kind: 'fleet' } as const));

export function moveAsset(a: Actor, events: EventBus, assetId: string, input: unknown): { movement: Row; current: AssetState | null } {
  const m: MovementInput = parse(MovementCreate, input);
  const db = a.wctx.db;
  const asset = getLive(db, 'asset', assetId);
  if (!asset) throw new AppError('NOT_FOUND', `ast.asset ${assetId} not found`);
  authorize(a, perm('asset_movement', m.kind === 'void' ? 'void' : 'create'), assetScope(asset));

  const now = nowUtc();
  const occurredAt = m.occurredAt ?? now;
  if (!isUtcIso(occurredAt)) throw new AppError('VALIDATION_FAILED', 'occurredAt must be a UTC instant');
  if (Date.parse(occurredAt) > Date.parse(now) + FUTURE_TOLERANCE_MS) throw new AppError('VALIDATION_FAILED', 'occurredAt is in the future');
  const w = withReason(a, m.note);

  const result = db.transaction(() => {
    const rows = movementsOf(db, assetId);
    const state = foldMovements(rows);
    if (!state) throw blocked('Asset has no registration movement');
    const live = rows.filter((r) => r.kind !== 'void' && !rows.some((v) => v.kind === 'void' && v.corrects_movement_id === r.id));
    const latest = live.map((r) => r.occurred_at).sort().at(-1) ?? '';

    let values: MovementValues;
    if (m.kind === 'void') {
      const target = rows.find((r) => r.id === m.correctsMovementId);
      if (!target) throw new AppError('NOT_FOUND', `movement ${m.correctsMovementId} not found for this asset`);
      if (target.kind === 'register' || target.kind === 'void') throw blocked(`A ${target.kind} movement cannot be voided`);
      if (!live.some((r) => r.id === target.id)) throw blocked('That movement is already voided');
      values = { kind: 'void', correctsMovementId: target.id, note: m.note, occurredAt };
    } else {
      if (occurredAt < latest) throw blocked('That is earlier than the latest recorded movement; void the later movement or enter the movement at its true time after it', { latest });
      checkRefs(db, { locationId: m.locationId ?? null, custody: m.custody ?? null });
      if (m.kind === 'install') {
        if (state.positionId) throw blocked('Asset is already installed; remove it first', { positionId: state.positionId });
        checkPositionFree(db, m.positionId, assetId);
      } else if (m.kind === 'remove') {
        if (!state.positionId) throw blocked('Asset is not installed');
      } else if (m.kind === 'custody_transfer') {
        if (state.custodyKind === m.custody.kind && state.custodyId === m.custody.id) throw new AppError('VALIDATION_FAILED', 'Asset is already in that custody');
      } else if (m.kind === 'status_change') {
        if (state.status === m.assetStatus) throw new AppError('VALIDATION_FAILED', 'Asset already has that status');
      }
      values = {
        kind: m.kind, occurredAt, note: m.note ?? null, locationId: m.locationId ?? null, custody: m.custody ?? null, assetStatus: m.assetStatus ?? null,
        ...(m.kind === 'install' ? { positionId: m.positionId } : {}),
      };
    }
    const movement = appendMovement(w, asset, values);
    refoldAsset(db, assetId);
    return movement;
  })();

  events.publish({ type: 'ast.asset.moved', occurredAt, payload: { assetId, kind: m.kind, movementId: result.id } });
  return { movement: toApi(result), current: getAssetState(db, assetId) };
}

/** Movements newest-recorded first, with void links so the UI can show corrections. */
export function listMovements(db: Db, assetId: string, opts: { limit: number; cursor?: string }): { items: Row[]; nextCursor: string | null } {
  const rows = db
    .prepare(`SELECT * FROM ast_asset_movement WHERE asset_id = ? ${opts.cursor ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT ?`)
    .all(assetId, ...(opts.cursor ? [opts.cursor] : []), opts.limit + 1) as Row[];
  const page = rows.slice(0, opts.limit);
  const voidedIds = new Set((db.prepare("SELECT corrects_movement_id AS c FROM ast_asset_movement WHERE asset_id = ? AND kind = 'void'").all(assetId) as Array<{ c: string }>).map((r) => r.c));
  return {
    items: page.map((r) => ({ ...toApi(r), voided: voidedIds.has(r.id as string) })),
    nextCursor: rows.length > opts.limit ? (page[page.length - 1]?.id as string) : null,
  };
}

export const hasMovements = (db: Db, assetId: string): boolean => exists(db, 'SELECT 1 FROM ast_asset_movement WHERE asset_id = ?', assetId);
