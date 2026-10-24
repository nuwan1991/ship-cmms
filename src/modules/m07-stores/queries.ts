/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';
import { getAsset, standardEquivalent } from '../m03-assets/index.js';
import type { StkNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES: Record<StkNoun, string> = {
  part: 'stk_part',
  compatibility: 'stk_part_compatibility',
  location: 'stk_location',
  stock_level: 'stk_stock_level',
  transaction: 'stk_transaction',
  reservation: 'stk_reservation',
  transfer: 'stk_transfer',
};

const safeJson = <T>(s: unknown, fallback: T): T => {
  try { return typeof s === 'string' ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

/** snake_case row → API shape; lines_json becomes `lines`. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'lines_json') out.lines = safeJson(v, []);
    else out[toCamel(k)] = v;
  }
  return out;
}

export function getLive(db: Db, noun: StkNoun, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

export interface Balance { onHand: number; reserved: number; available: number }
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Stock of a part at one location, or summed over every location when `locationId` is omitted. */
export function getBalance(db: Db, partId: string, locationId?: string): Balance {
  const r = db.prepare(`SELECT COALESCE(SUM(on_hand), 0) AS o, COALESCE(SUM(reserved), 0) AS r FROM stk_v_balance WHERE part_id = ? ${locationId ? 'AND location_id = ?' : ''}`)
    .get(...(locationId ? [partId, locationId] : [partId])) as { o: number; r: number };
  return { onHand: round3(r.o), reserved: round3(r.r), available: round3(r.o - r.r) };
}
export const outstandingReservation = (db: Db, refId: string, partId: string, locationId: string): number => {
  const r = db.prepare('SELECT COALESCE(SUM(outstanding), 0) AS n FROM stk_v_reserved_by_ref WHERE ref_id = ? AND part_id = ? AND location_id = ?').get(refId, partId, locationId) as { n: number };
  return round3(r.n);
};
export const netIssued = (db: Db, refId: string, partId: string): number => {
  const r = db.prepare('SELECT COALESCE(SUM(net_quantity), 0) AS n FROM stk_v_issued_by_ref WHERE ref_id = ? AND part_id = ?').get(refId, partId) as { n: number };
  return round3(r.n);
};
export const lastCost = (db: Db, partId: string): { unitCost: number; currency: string | null } | null => {
  const r = db.prepare('SELECT unit_cost, currency FROM stk_v_last_cost WHERE part_id = ?').get(partId) as { unit_cost: number; currency: string | null } | undefined;
  return r ? { unitCost: r.unit_cost, currency: r.currency } : null;
};

// ---------------------------------------------------------------- public lookups

export interface PartInfo { id: string; partNo: string; name: string; unit: string; status: string }
const toPart = (r: Row): PartInfo => ({ id: r.id as string, partNo: r.part_no as string, name: r.name as string, unit: r.unit as string, status: r.status as string });

export function getPart(db: Db, id: string): PartInfo | null {
  const r = getLive(db, 'part', id);
  return r ? toPart(r) : null;
}
export function findPartByNo(db: Db, partNo: string): PartInfo | null {
  const r = db.prepare('SELECT * FROM stk_part WHERE part_no = ? AND deleted_at IS NULL').get(partNo.trim().toUpperCase()) as Row | undefined;
  return r ? toPart(r) : null;
}

/**
 * Parts that fit an asset: listed for the asset itself or for its classification. A row linked to a legacy classification
 * also matches when M03's crosswalk maps that class 1:1 to the asset's class, so parts keep fitting re-pointed assets (D64).
 */
export function partsForAsset(db: Db, assetId: string): PartInfo[] {
  const asset = getAsset(db, assetId);
  if (!asset) return [];
  const classIds = asset.classificationId ? matchingClassifications(db, asset.classificationId) : [];
  const rows = db.prepare(
    `SELECT DISTINCT p.* FROM stk_part p JOIN stk_part_compatibility c ON c.part_id = p.id AND c.deleted_at IS NULL
      WHERE p.deleted_at IS NULL AND (c.asset_id = ? OR c.classification_id IN (${classIds.map(() => '?').join(', ')})) ORDER BY p.part_no`,
  ).all(assetId, ...classIds) as Row[];
  return rows.map(toPart);
}

/** The asset's class plus every class used in part compatibility whose standard equivalent is that class. */
function matchingClassifications(db: Db, classificationId: string): string[] {
  const used = db.prepare('SELECT DISTINCT classification_id AS id FROM stk_part_compatibility WHERE classification_id IS NOT NULL AND classification_id <> ? AND deleted_at IS NULL').all(classificationId) as Array<{ id: string }>;
  return [classificationId, ...used.map((r) => r.id).filter((id) => standardEquivalent(db, id) === classificationId)];
}

/** Stock of a part held at a ship or workshop (all its locations). */
export function onHandAtSite(db: Db, partId: string, siteId: string): Balance {
  const r = db.prepare('SELECT COALESCE(SUM(on_hand), 0) AS o, COALESCE(SUM(reserved), 0) AS r FROM stk_v_stock WHERE part_id = ? AND site_id = ?').get(partId, siteId) as { o: number; r: number };
  return { onHand: round3(r.o), reserved: round3(r.r), available: round3(r.o - r.r) };
}

export interface IssuedPart { partId: string; partNo: string; name: string; unit: string; netQuantity: number; netCost: number }
/** Net parts consumed by a record such as a work order (issues minus returns). */
export function partsIssuedTo(db: Db, refId: string): IssuedPart[] {
  const rows = db.prepare(
    `SELECT i.part_id, p.part_no, p.name, p.unit, i.net_quantity, i.net_cost FROM stk_v_issued_by_ref i JOIN stk_part p ON p.id = i.part_id
      WHERE i.ref_id = ? AND i.net_quantity <> 0 ORDER BY p.part_no`,
  ).all(refId) as Row[];
  return rows.map((r) => ({ partId: r.part_id as string, partNo: r.part_no as string, name: r.name as string, unit: r.unit as string, netQuantity: round3(r.net_quantity as number), netCost: round3(r.net_cost as number) }));
}
