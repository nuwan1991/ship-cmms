/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';
import type { WrkNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES = {
  defect: 'wrk_defect', repair_case: 'wrk_repair_case', work_order: 'wrk_work_order', job_card: 'wrk_job_card', advisory: 'wrk_advisory',
  labour_entry: 'wrk_labour_entry', finding: 'wrk_finding', test_record: 'wrk_test_record', acceptance: 'wrk_acceptance', handover: 'wrk_handover', status_event: 'wrk_status_event',
} as const satisfies Record<WrkNoun, string>;

const safeJson = <T>(s: unknown, fallback: T): T => {
  try { return typeof s === 'string' ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
};

/** snake_case row → API shape: `*_party_kind/_id` pairs become `{kind,id}` objects, `checklist_json` becomes `checklist`. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'checklist_json') out.checklist = safeJson(v, []);
    else if (k.endsWith('_party_kind')) continue;
    else if (k.endsWith('_party_id')) {
      const stem = k.slice(0, -'_party_id'.length);
      out[`${toCamel(stem)}Party`] = v ? { kind: row[`${stem}_party_kind`], id: v } : null;
    } else out[toCamel(k)] = v;
  }
  return out;
}

export const getLive = (db: Db, noun: WrkNoun, id: string): Row | undefined =>
  db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

// ---------------------------------------------------------------- status axes (derived)

export type SubjectType = 'repair_case' | 'work_order';
export type Axis = 'progress' | 'approval' | 'return_to_service' | 'closure';
export const AXES: readonly Axis[] = ['progress', 'approval', 'return_to_service', 'closure'];
export const INITIAL: Record<Axis, string> = { progress: 'planned', approval: 'not_required', return_to_service: 'not_assessed', closure: 'open' };

export interface AxesState { progress: string; approval: string; returnToService: string; closure: string }

/** Current value on each of the four axes, derived from the latest event per axis (ties broken by id). */
export function currentAxes(db: Db, subjectType: SubjectType, subjectId: string): AxesState {
  const rows = db.prepare('SELECT axis, value FROM wrk_v_status_current WHERE subject_type = ? AND subject_id = ?').all(subjectType, subjectId) as Array<{ axis: Axis; value: string }>;
  const v = { ...INITIAL };
  for (const r of rows) v[r.axis] = r.value;
  return { progress: v.progress, approval: v.approval, returnToService: v.return_to_service, closure: v.closure };
}

// ---------------------------------------------------------------- public lookups

export interface WorkOrderRef {
  id: string;
  woNo: string;
  title: string;
  shipId: string | null;
  assetId: string | null;
  positionId: string | null;
  workType: string;
  repairCaseId: string | null;
}
const toRef = (r: Row): WorkOrderRef => ({
  id: r.id as string, woNo: r.wo_no as string, title: r.title as string, shipId: (r.home_scope_id as string | null) ?? null, assetId: (r.asset_id as string | null) ?? null,
  positionId: (r.position_id as string | null) ?? null, workType: r.work_type as string, repairCaseId: (r.repair_case_id as string | null) ?? null,
});

export function getWorkOrder(db: Db, id: string): (WorkOrderRef & { axes: AxesState }) | null {
  const r = getLive(db, 'work_order', id);
  return r ? { ...toRef(r), axes: currentAxes(db, 'work_order', id) } : null;
}
export function resolveWorkOrderNo(db: Db, woNo: string): WorkOrderRef | null {
  const r = db.prepare('SELECT * FROM wrk_work_order WHERE wo_no = ? AND deleted_at IS NULL').get(woNo.trim().toUpperCase()) as Row | undefined;
  return r ? toRef(r) : null;
}
/** Work orders of an asset that are not closed (for readiness views and for blocking decommissioning in other modules). */
export function openWorkOrdersForAsset(db: Db, assetId: string): WorkOrderRef[] {
  const rows = db.prepare("SELECT w.* FROM wrk_work_order w JOIN wrk_v_work_order_overview o ON o.work_order_id = w.id WHERE w.asset_id = ? AND o.closure <> 'closed' ORDER BY w.id").all(assetId) as Row[];
  return rows.map(toRef);
}
