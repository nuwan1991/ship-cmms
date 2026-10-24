/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';
import { getAsset, standardEquivalent } from '../m03-assets/index.js';
import type { PmNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES: Record<PmNoun, string> = {
  task_template: 'pm_task_template', plan: 'pm_plan', meter: 'pm_meter', meter_reading: 'pm_meter_reading', calibration: 'pm_calibration_record', due: 'pm_v_due',
};
const safeJson = <T>(s: unknown, fallback: T): T => {
  try { return typeof s === 'string' ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};
const BOOLS = new Set(['overdue', 'due_soon']);

/** snake_case row → API shape; checklist_json becomes `checklist`; 0/1 flags of the due view become booleans. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'checklist_json') out.checklist = safeJson(v, []);
    else out[toCamel(k)] = BOOLS.has(k) ? v === 1 : v;
  }
  return out;
}
export function getLive(db: Db, noun: 'task_template' | 'plan' | 'meter', id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

/**
 * Task templates that suit an asset: those for its classification, and those for a legacy classification that M03's crosswalk
 * maps 1:1 to it, so templates keep matching assets re-pointed to the standard class (D64). API shape, ordered by code.
 */
export function templatesForAsset(db: Db, assetId: string): Row[] {
  const cls = getAsset(db, assetId)?.classificationId;
  if (!cls) return [];
  const rows = db.prepare('SELECT * FROM pm_task_template WHERE classification_id IS NOT NULL AND deleted_at IS NULL ORDER BY code, id').all() as Row[];
  const fits = new Map<string, boolean>([[cls, true]]);
  const matches = (id: string): boolean => {
    if (!fits.has(id)) fits.set(id, standardEquivalent(db, id) === cls);
    return fits.get(id)!;
  };
  return rows.filter((r) => matches(r.classification_id as string)).map(toApi);
}

export interface MeterValue { meterId: string; cumulative: number; reading: number; readAt: string }
/** Latest cumulative value of a meter (survives meter replacement), or null before the first reading. */
export function currentMeterValue(db: Db, meterId: string): MeterValue | null {
  const r = db.prepare('SELECT * FROM pm_v_meter_current WHERE meter_id = ?').get(meterId) as Row | undefined;
  return r ? { meterId, cumulative: r.cumulative as number, reading: r.reading as number, readAt: r.read_at as string } : null;
}

export interface DueItem {
  source: 'plan' | 'calibration'; refId: string; title: string; assetId: string | null; positionId: string | null; shipId: string | null;
  basis: string; dueOn: string | null; remainingHours: number | null; overdue: boolean; dueSoon: boolean; workOrderId: string | null;
}
/** Everything due or coming due for one equipment item: its planned maintenance and its calibration. */
export function dueForAsset(db: Db, assetId: string): DueItem[] {
  const rows = db.prepare('SELECT * FROM pm_v_due WHERE asset_id = ? ORDER BY due_on IS NULL, due_on, ref_id').all(assetId) as Row[];
  return rows.map((r) => ({
    source: r.source as DueItem['source'], refId: r.ref_id as string, title: r.title as string, assetId: (r.asset_id as string | null) ?? null, positionId: (r.position_id as string | null) ?? null,
    shipId: (r.ship_id as string | null) ?? null, basis: r.basis as string, dueOn: (r.due_on as string | null) ?? null, remainingHours: (r.remaining_hours as number | null) ?? null,
    overdue: r.overdue === 1, dueSoon: r.due_soon === 1, workOrderId: (r.work_order_id as string | null) ?? null,
  }));
}
