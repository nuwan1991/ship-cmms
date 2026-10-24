/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';
import type { AstNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES: Record<AstNoun, string> = {
  classification: 'ast_classification',
  classification_map: 'ast_classification_map',
  position: 'ast_position',
  position_responsibility: 'ast_position_responsibility',
  asset: 'ast_asset',
  asset_movement: 'ast_asset_movement',
};

export const toApi = (row: Row): Row => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v]));

export function getLive(db: Db, noun: AstNoun, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

// ---------------------------------------------------------------- public lookups

export interface AssetInfo {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  classificationId: string | null;
  homeShipId: string | null;
}
const toAsset = (r: Row): AssetInfo => ({
  id: r.id as string, assetTag: r.asset_tag as string, name: r.name as string, serialNumber: (r.serial_number as string | null) ?? null,
  manufacturer: (r.manufacturer as string | null) ?? null, model: (r.model as string | null) ?? null,
  classificationId: (r.classification_id as string | null) ?? null, homeShipId: (r.home_scope_id as string | null) ?? null,
});

export function getAsset(db: Db, id: string): AssetInfo | null {
  const r = getLive(db, 'asset', id);
  return r ? toAsset(r) : null;
}

/** Resolve a printed/scanned equipment tag (case-insensitive) to the asset. Tags are never reused, so a tombstoned asset still resolves to null here. */
export function resolveTag(db: Db, tag: string): AssetInfo | null {
  const r = db.prepare('SELECT * FROM ast_asset WHERE asset_tag = ? AND deleted_at IS NULL').get(tag.trim().toUpperCase()) as Row | undefined;
  return r ? toAsset(r) : null;
}

/** First live asset with this exact name (demo seeds and lookups by name); null when none. */
export function findAssetByName(db: Db, name: string): AssetInfo | null {
  const r = db.prepare('SELECT * FROM ast_asset WHERE name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(name) as Row | undefined;
  return r ? toAsset(r) : null;
}

export interface PositionInfo {
  id: string;
  shipId: string;
  parentId: string | null;
  level: 'system' | 'equipment_group' | 'equipment' | 'component';
  positionTag: string;
  name: string;
  classificationId: string | null;
  status: string;
  /** Root → this position. */
  path: Array<{ id: string; positionTag: string; name: string; level: string }>;
  pathText: string;
}

const MAX_DEPTH = 8;

/** Ids of `id` and its ancestors, nearest first. Defensive against cycles. */
export function positionChain(db: Db, id: string | null): string[] {
  const out: string[] = [];
  let cur = id;
  const get = db.prepare('SELECT parent_id FROM ast_position WHERE id = ?');
  while (cur && out.length < MAX_DEPTH && !out.includes(cur)) {
    out.push(cur);
    cur = (get.get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return out;
}

export function getPosition(db: Db, id: string): PositionInfo | null {
  const p = getLive(db, 'position', id);
  if (!p) return null;
  const names = db.prepare('SELECT id, position_tag, name, level FROM ast_position WHERE id = ?');
  const path = positionChain(db, id).reverse().map((x) => {
    const n = names.get(x) as { id: string; position_tag: string; name: string; level: string };
    return { id: n.id, positionTag: n.position_tag, name: n.name, level: n.level };
  });
  return {
    id, shipId: p.home_scope_id as string, parentId: (p.parent_id as string | null) ?? null, level: p.level as PositionInfo['level'],
    positionTag: p.position_tag as string, name: p.name as string, classificationId: (p.classification_id as string | null) ?? null,
    status: p.status as string, path, pathText: path.map((x) => x.name).join(' / '),
  };
}

export interface AssetState {
  assetId: string;
  positionId: string | null;
  locationId: string | null;
  custody: { kind: string; id: string } | null;
  assetStatus: string | null;
  installedSince: string | null;
  lastOccurredAt: string | null;
}
export function getAssetState(db: Db, assetId: string): AssetState | null {
  const c = db.prepare('SELECT * FROM ast_asset_current WHERE asset_id = ?').get(assetId) as Row | undefined;
  if (!c) return null;
  return {
    assetId, positionId: (c.position_id as string | null) ?? null, locationId: (c.location_id as string | null) ?? null,
    custody: c.custody_party_kind ? { kind: c.custody_party_kind as string, id: c.custody_party_id as string } : null,
    assetStatus: (c.asset_status as string | null) ?? null, installedSince: (c.installed_since as string | null) ?? null,
    lastOccurredAt: (c.last_occurred_at as string | null) ?? null,
  };
}

export interface CurrentInstallation {
  assetId: string;
  positionId: string;
  positionTag: string;
  shipId: string;
  installedSince: string | null;
  locationId: string | null;
}
/** Where the asset is installed right now, or null when it is not installed (stored, in a workshop, removed). */
export function currentInstallation(db: Db, assetId: string): CurrentInstallation | null {
  const r = db
    .prepare(
      `SELECT c.asset_id, c.position_id, c.installed_since, c.location_id, p.position_tag, p.home_scope_id AS ship_id
         FROM ast_asset_current c JOIN ast_position p ON p.id = c.position_id WHERE c.asset_id = ? AND c.position_id IS NOT NULL`,
    )
    .get(assetId) as Row | undefined;
  return r
    ? { assetId, positionId: r.position_id as string, positionTag: r.position_tag as string, shipId: r.ship_id as string, installedSince: (r.installed_since as string | null) ?? null, locationId: (r.location_id as string | null) ?? null }
    : null;
}

/** The asset currently installed in a position (the first if replicated events left several; see ast_v_position_conflicts). */
export function assetAtPosition(db: Db, positionId: string): AssetInfo | null {
  const r = db.prepare('SELECT a.* FROM ast_asset_current c JOIN ast_asset a ON a.id = c.asset_id WHERE c.position_id = ? AND a.deleted_at IS NULL ORDER BY c.installed_since, a.id LIMIT 1').get(positionId) as Row | undefined;
  return r ? toAsset(r) : null;
}
