/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';

export type Row = Record<string, unknown>;

const BOOLS = new Set(['late_dock_in', 'late_undock', 'action_required', 'mandatory', 'overdue']);

/** snake_case row → API shape; 0/1 flags become booleans. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = BOOLS.has(k) ? v === 1 : v;
  return out;
}

const TABLE = {
  dock: 'dck_dock', docking: 'dck_docking', work_item: 'dck_work_item', req_template: 'dck_req_template', req_template_item: 'dck_req_template_item',
  ship_req_item: 'dck_ship_req_item', requirement: 'dck_requirement',
} as const;
export function getLive(db: Db, noun: keyof typeof TABLE, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLE[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}
export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

/** A docking as the lists show it (with dock, ship and work-list counts), or undefined. */
export function dockingView(db: Db, id: string): Row | undefined {
  const r = db.prepare('SELECT * FROM dck_v_docking WHERE docking_id = ?').get(id) as Row | undefined;
  return r ? toApi(r) : undefined;
}

export interface CurrentDocking { dockingId: string; status: 'in_dock' | 'undocked'; dockId: string; dockedAt: string; plannedUndock: string }
/** The docking a ship is in now (in dock, or undocked but not yet closed), or null. */
export function currentDocking(db: Db, shipId: string): CurrentDocking | null {
  const r = db.prepare("SELECT * FROM dck_docking WHERE ship_id = ? AND deleted_at IS NULL AND status IN ('in_dock','undocked') ORDER BY docked_at DESC, id DESC LIMIT 1").get(shipId) as Row | undefined;
  return r ? { dockingId: r.id as string, status: r.status as CurrentDocking['status'], dockId: r.dock_id as string, dockedAt: r.docked_at as string, plannedUndock: r.planned_undock as string } : null;
}

export type DueState = 'in_dock' | 'undocked' | 'never' | 'overdue' | 'due_soon' | 'ok';
export interface ShipDockingDue { shipId: string; dueState: DueState; nextDueOn: string | null; lastUndockedAt: string | null; nextPlannedDockIn: string | null; currentDockingId: string | null }
/** A ship's docking state: when it is next due in dock, when it last undocked, and whether it is in dock now. Null for an unknown ship. */
export function dockingDueForShip(db: Db, shipId: string): ShipDockingDue | null {
  const r = db.prepare('SELECT * FROM dck_v_ship_due WHERE ship_id = ?').get(shipId) as Row | undefined;
  if (!r) return null;
  return {
    shipId, dueState: r.due_state as DueState, nextDueOn: (r.next_due_on as string | null) ?? null, lastUndockedAt: (r.last_undocked_at as string | null) ?? null,
    nextPlannedDockIn: (r.next_planned_dock_in as string | null) ?? null, currentDockingId: (r.current_docking_id as string | null) ?? null,
  };
}
