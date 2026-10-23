/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';
import type { QrNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES: Record<QrNoun, string> = {
  label: 'qr_label',
  label_print: 'qr_label_print',
  survey_template: 'qr_survey_template',
  survey: 'qr_survey',
  survey_item: 'qr_survey_item',
};

const safeJson = <T>(s: unknown, fallback: T): T => {
  try { return typeof s === 'string' ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

/** snake_case row → API shape; the two JSON columns become `items` and `answers`. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'items_json') out.items = safeJson(v, []);
    else if (k === 'answers_json') out.answers = safeJson(v, {});
    else out[toCamel(k)] = v;
  }
  return out;
}

export function getLive(db: Db, noun: QrNoun, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

// ---------------------------------------------------------------- public lookups

export interface LabelInfo {
  id: string;
  labelNo: string;
  state: 'reserved' | 'assigned' | 'void';
  assetId: string | null;
}
const toLabel = (r: Row): LabelInfo => ({ id: r.id as string, labelNo: r.label_no as string, state: r.state as LabelInfo['state'], assetId: (r.asset_id as string | null) ?? null });

/** Resolve a scanned label number (case-insensitive). Voided labels still resolve, with state `void`, so a stale sticker is recognised as such. */
export function resolveLabel(db: Db, labelNo: string): LabelInfo | null {
  const r = db.prepare('SELECT * FROM qr_label WHERE label_no = ? AND deleted_at IS NULL').get(labelNo.trim().toUpperCase()) as Row | undefined;
  return r ? toLabel(r) : null;
}

/** The label currently stuck on an asset, if any (at most one assigned label per asset). */
export function labelForAsset(db: Db, assetId: string): LabelInfo | null {
  const r = db.prepare("SELECT * FROM qr_label WHERE asset_id = ? AND state = 'assigned' AND deleted_at IS NULL").get(assetId) as Row | undefined;
  return r ? toLabel(r) : null;
}
