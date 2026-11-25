/**
 * Command services for M16: authorization -> validation/business rules -> platform write path (records.ts).
 * A docking moves planned -> in_dock -> undocked -> completed (or planned -> cancelled). Completing it fixes the date the ship is next
 * due in dock. Work-list items may raise an M05 work order, only through createWorkOrder (D75).
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { resolveParty } from '../m01-organization/index.js';
import { getAsset } from '../m03-assets/index.js';
import { createWorkOrder } from '../m05-work/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm } from './permissions.js';
import { dockingView, exists, getLive, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const invalid = (message: string, fields: string[]) => new AppError('VALIDATION_FAILED', message, { fields });
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const shipScope = (shipId: unknown): ScopeRef => ({ kind: 'ship', id: String(shipId) });
const FLEET: ScopeRef = { kind: 'fleet' };
const snake = (input: Record<string, unknown>): Row => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]));
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}
function notFuture(at: string | undefined, field: string): void {
  if (at && Date.parse(at) > Date.now() + 5 * 60_000) throw invalid('The time cannot be in the future', [field]);
}
/** YYYY-MM-DD plus whole months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ docks (hub reference data)

export function createDock(a: Actor, input: unknown): Row {
  const b = S.parse(S.DockCreate, input);
  authorize(a, perm('dock', 'create'), FLEET);
  return guard(() => toApi(createRecord(a.wctx, 'dck.dock', { ...snake(b), capacity_ships: b.capacityShips ?? 1, status: b.status ?? 'active' })));
}
export function updateDock(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.DockUpdate, input);
  authorize(a, perm('dock', 'update'), FLEET);
  if (!getLive(a.wctx.db, 'dock', id)) throw notFound('Dock', id);
  return guard(() => toApi(updateRecord(a.wctx, 'dck.dock', id, expectedVersion, snake(rest))));
}
export function tombstoneDock(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('dock', 'remove'), FLEET);
  if (!getLive(a.wctx.db, 'dock', id)) throw notFound('Dock', id);
  if (exists(a.wctx.db, 'SELECT 1 FROM dck_docking WHERE dock_id = ? AND deleted_at IS NULL', id)) throw blocked('Dockings refer to this dock; mark it inactive instead', { dockId: id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.dock', id, expectedVersion, reason));
}

function activeDock(db: Db, dockId: string): Row {
  const d = getLive(db, 'dock', dockId);
  if (!d) throw missing('Dock', dockId);
  if (d.status !== 'active') throw blocked(`Dock ${String(d.code)} is inactive`, { dockId });
  return d;
}

// ------------------------------------------------------------------ dockings

const OPEN_STATUSES = "('planned','in_dock','undocked')";

/** A ship cannot be planned into two dockings whose planned windows overlap. */
function assertNoShipOverlap(db: Db, shipId: string, from: string, to: string, exceptId: string | null): void {
  const clash = db.prepare(
    `SELECT id, reference, planned_dock_in, planned_undock FROM dck_docking WHERE ship_id = ? AND deleted_at IS NULL AND status IN ${OPEN_STATUSES}
       AND id IS NOT ? AND planned_dock_in <= ? AND ? <= planned_undock LIMIT 1`,
  ).get(shipId, exceptId, to, from) as Row | undefined;
  if (clash) {
    throw blocked(`This ship already has a docking planned from ${String(clash.planned_dock_in)} to ${String(clash.planned_undock)}`, { rule: 'SHIP_DOCKING_OVERLAP', dockingId: clash.id });
  }
}

function requireDocking(db: Db, id: string): Row {
  const d = getLive(db, 'docking', id);
  if (!d) throw notFound('Docking', id);
  return d;
}
function requireStatus(d: Row, allowed: readonly string[], action: string): void {
  if (!allowed.includes(d.status as string)) throw blocked(`A docking that is ${String(d.status).replace('_', ' ')} cannot be ${action}`, { rule: 'DOCKING_STATUS', status: d.status });
}
const view = (db: Db, id: string): Row => dockingView(db, id) ?? {};

export function createDocking(a: Actor, input: unknown): Row {
  const b = S.parse(S.DockingCreate, input);
  const db = a.wctx.db;
  const ship = resolveParty(db, { kind: 'ship', id: b.shipId });
  if (!ship) throw missing('Ship', b.shipId);
  authorize(a, perm('docking', 'create'), shipScope(b.shipId));
  if (ship.status === 'decommissioned') throw blocked(`${ship.name} is decommissioned`, { shipId: b.shipId });
  if (b.dockId) activeDock(db, b.dockId);
  return db.transaction(() => {
    assertNoShipOverlap(db, b.shipId, b.plannedDockIn, b.plannedUndock, null);
    const row = guard(() => createRecord(a.wctx, 'dck.docking', {
      home_scope_id: b.shipId, ship_id: b.shipId, dock_id: b.dockId ?? null, reference: b.reference ?? null, docking_type: b.dockingType ?? 'routine',
      purpose: b.purpose ?? null, authority: b.authority ?? null, status: 'planned', planned_dock_in: b.plannedDockIn, planned_undock: b.plannedUndock, remarks: b.remarks ?? null,
    }));
    return view(db, row.id as string);
  })();
}

export function updateDocking(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.DockingUpdate, input);
  const db = a.wctx.db;
  const cur = requireDocking(db, id);
  authorize(a, perm('docking', 'update'), shipScope(cur.ship_id));
  requireStatus(cur, ['planned', 'in_dock', 'undocked'], 'changed');
  if (rest.dockId !== undefined && rest.dockId !== cur.dock_id) {
    if (cur.status !== 'planned') throw blocked('The ship is already in dock; the dock cannot be changed', { rule: 'DOCKING_STATUS' });
    if (rest.dockId) activeDock(db, rest.dockId);
  }
  const from = rest.plannedDockIn ?? (cur.planned_dock_in as string);
  const to = rest.plannedUndock ?? (cur.planned_undock as string);
  if (to < from) throw invalid('The planned undocking date cannot be before the planned docking date', ['plannedUndock']);
  return db.transaction(() => {
    assertNoShipOverlap(db, cur.ship_id as string, from, to, id);
    guard(() => updateRecord(a.wctx, 'dck.docking', id, expectedVersion, snake(rest)));
    return view(db, id);
  })();
}

/** The ship has entered the dock. The dock must be active and have room; the ship cannot be in another dock. */
export function dockIn(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.DockIn, input);
  const db = a.wctx.db;
  const cur = requireDocking(db, id);
  authorize(a, perm('docking', 'dock_in'), shipScope(cur.ship_id));
  requireStatus(cur, ['planned'], 'docked in');
  notFuture(b.dockedAt, 'dockedAt');
  const dockId = b.dockId ?? (cur.dock_id as string | null);
  if (!dockId) throw invalid('Choose the dock the ship entered', ['dockId']);
  const dock = activeDock(db, dockId);
  return db.transaction(() => {
    const other = db.prepare("SELECT id FROM dck_docking WHERE ship_id = ? AND id <> ? AND deleted_at IS NULL AND status IN ('in_dock','undocked')").get(cur.ship_id, id) as Row | undefined;
    if (other) throw blocked('This ship has another docking still open; undock and complete it first', { rule: 'SHIP_ALREADY_DOCKED', dockingId: other.id });
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM dck_docking WHERE dock_id = ? AND deleted_at IS NULL AND status = 'in_dock'").get(dockId) as { n: number };
    if (n >= (dock.capacity_ships as number)) throw blocked(`Dock ${String(dock.code)} is full (${n} of ${String(dock.capacity_ships)} ship(s) in dock)`, { rule: 'DOCK_FULL', dockId });
    updateRecord(a.wctx, 'dck.docking', id, b.expectedVersion, { status: 'in_dock', dock_id: dockId, docked_at: b.dockedAt ?? nowUtc() });
    return view(db, id);
  })();
}

/** The ship has left the dock. Outstanding work and survey entries may still be closed before the docking is completed. */
export function undock(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.Undock, input);
  const db = a.wctx.db;
  const cur = requireDocking(db, id);
  authorize(a, perm('docking', 'undock'), shipScope(cur.ship_id));
  requireStatus(cur, ['in_dock'], 'undocked');
  notFuture(b.undockedAt, 'undockedAt');
  const at = b.undockedAt ?? nowUtc();
  if (at < (cur.docked_at as string)) throw invalid('The ship cannot undock before it docked', ['undockedAt']);
  updateRecord(a.wctx, 'dck.docking', id, b.expectedVersion, { status: 'undocked', undocked_at: at });
  return view(db, id);
}

/** Close the docking and fix when the ship is next due in dock. Every work-list item must be done, deferred or cancelled. */
export function completeDocking(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.Complete, input);
  const db = a.wctx.db;
  const cur = requireDocking(db, id);
  authorize(a, perm('docking', 'complete'), shipScope(cur.ship_id));
  requireStatus(cur, ['undocked'], 'completed');
  notFuture(b.completedAt, 'completedAt');
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM dck_work_item WHERE docking_id = ? AND deleted_at IS NULL AND status IN ('open','in_progress')").get(id) as { n: number };
  if (n > 0) throw blocked(`${n} work-list item(s) are still open; mark them done, deferred or cancelled first`, { rule: 'OPEN_WORK_ITEMS', open: n });
  const undockedOn = String(cur.undocked_at).slice(0, 10);
  const nextDueOn = b.nextDueOn ?? addMonths(undockedOn, b.intervalMonths!);
  if (nextDueOn <= undockedOn) throw invalid('The next docking must be due after the ship undocked', ['nextDueOn']);
  updateRecord(a.wctx, 'dck.docking', id, b.expectedVersion, { status: 'completed', completed_at: b.completedAt ?? nowUtc(), next_due_on: nextDueOn, ...(b.remarks !== undefined ? { remarks: b.remarks } : {}) });
  return view(db, id);
}

export function cancelDocking(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.Cancel, input);
  const cur = requireDocking(a.wctx.db, id);
  authorize(a, perm('docking', 'cancel'), shipScope(cur.ship_id));
  requireStatus(cur, ['planned'], 'cancelled');
  updateRecord(withReason(a, b.reason).wctx, 'dck.docking', id, b.expectedVersion, { status: 'cancelled', cancel_reason: b.reason });
  return view(a.wctx.db, id);
}

/** Remove a docking entered by mistake: only while planned or cancelled, and only with no work list or survey entries. */
export function tombstoneDocking(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = requireDocking(db, id);
  authorize(a, perm('docking', 'remove'), shipScope(cur.ship_id));
  requireStatus(cur, ['planned', 'cancelled'], 'removed');
  if (exists(db, 'SELECT 1 FROM dck_work_item WHERE docking_id = ? AND deleted_at IS NULL', id)) throw blocked('This docking has a work list; cancel the docking instead', { dockingId: id });
  if (exists(db, 'SELECT 1 FROM dck_survey_record WHERE docking_id = ?', id)) throw blocked('This docking has survey records; cancel the docking instead', { dockingId: id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.docking', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ work list

function requireShipAsset(db: Db, assetId: string, shipId: string): void {
  const asset = getAsset(db, assetId);
  if (!asset) throw missing('Asset', assetId);
  if (asset.homeShipId !== shipId) throw invalid('The equipment belongs to a different ship', ['assetId']);
}

export function addWorkItem(a: Actor, dockingId: string, input: unknown): Row {
  const b = S.parse(S.ItemCreate, input);
  const db = a.wctx.db;
  const d = requireDocking(db, dockingId);
  authorize(a, perm('work_item', 'create'), shipScope(d.ship_id));
  requireStatus(d, ['planned', 'in_dock', 'undocked'], 'given new work');
  if (b.assetId) requireShipAsset(db, b.assetId, d.ship_id as string);
  return db.transaction(() => {
    const { n } = db.prepare('SELECT COALESCE(MAX(item_no), 0) AS n FROM dck_work_item WHERE docking_id = ?').get(dockingId) as { n: number };
    return guard(() => toApi(createRecord(a.wctx, 'dck.work_item', {
      home_scope_id: d.ship_id, docking_id: dockingId, item_no: n + 1, category: b.category, title: b.title, description: b.description ?? null,
      asset_id: b.assetId ?? null, executed_by: b.executedBy ?? null, note: b.note ?? null, status: 'open',
    })));
  })();
}

function itemAndDocking(db: Db, id: string): { item: Row; docking: Row } {
  const item = getLive(db, 'work_item', id);
  if (!item) throw notFound('Work-list item', id);
  return { item, docking: requireDocking(db, item.docking_id as string) };
}

export function updateWorkItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, completedAt, ...rest } = S.parse(S.ItemUpdate, input);
  const db = a.wctx.db;
  const { item, docking } = itemAndDocking(db, id);
  authorize(a, perm('work_item', 'update'), shipScope(docking.ship_id));
  requireStatus(docking, ['planned', 'in_dock', 'undocked'], 'changed');
  if (rest.assetId) requireShipAsset(db, rest.assetId, docking.ship_id as string);
  notFuture(completedAt, 'completedAt');
  const patch = snake(rest);
  const status = rest.status ?? (item.status as string);
  if (status === 'done') {
    if (item.status !== 'done' || completedAt) patch.completed_at = completedAt ?? nowUtc();
  } else if (item.completed_at) patch.completed_at = null;
  return toApi(updateRecord(a.wctx, 'dck.work_item', id, expectedVersion, patch));
}

export function tombstoneWorkItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const { item, docking } = itemAndDocking(a.wctx.db, id);
  authorize(a, perm('work_item', 'remove'), shipScope(docking.ship_id));
  requireStatus(docking, ['planned', 'in_dock', 'undocked'], 'changed');
  if (item.work_order_id) throw blocked('A work order was raised for this item; cancel the item instead', { workOrderId: item.work_order_id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.work_item', id, expectedVersion, reason));
}

/** Raise an M05 work order for a work-list item (once). The item moves to in progress. */
export function raiseWorkOrder(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ItemWorkOrder, input ?? {});
  const db = a.wctx.db;
  const { item, docking } = itemAndDocking(db, id);
  authorize(a, perm('work_item', 'update'), shipScope(docking.ship_id));
  requireStatus(docking, ['planned', 'in_dock', 'undocked'], 'given new work');
  if (item.work_order_id) throw blocked('A work order was already raised for this item', { workOrderId: item.work_order_id });
  if (item.status === 'done' || item.status === 'cancelled') throw blocked(`The item is ${String(item.status)}`, { status: item.status });
  return db.transaction(() => {
    const label = docking.reference ? `Docking ${String(docking.reference)}` : `Docking ${String(docking.planned_dock_in)}`;
    const wo = createWorkOrder(a, {
      title: `${label} item ${String(item.item_no)}: ${String(item.title)}`.slice(0, 160), description: item.description ?? null, workType: 'corrective',
      shipId: docking.ship_id, ...(item.asset_id ? { assetId: item.asset_id } : {}), ...(b.priority ? { priority: b.priority } : {}),
      requestedDue: b.requestedDue ?? docking.planned_undock,
    });
    const row = updateRecord(a.wctx, 'dck.work_item', id, item.version as number, { work_order_id: wo.id, ...(item.status === 'open' ? { status: 'in_progress' } : {}) });
    return { ...toApi(row), workOrderNo: wo.woNo };
  })();
}

// ------------------------------------------------------------------ underwater survey

export function recordSurvey(a: Actor, dockingId: string, input: unknown): Row {
  const b = S.parse(S.Survey, input);
  const db = a.wctx.db;
  const d = requireDocking(db, dockingId);
  authorize(a, perm('survey', 'create'), shipScope(d.ship_id));
  requireStatus(d, ['in_dock', 'undocked'], 'surveyed (the ship must be in dock)');
  notFuture(b.surveyedAt, 'surveyedAt');
  const at = b.surveyedAt ?? nowUtc();
  if (at < (d.docked_at as string)) throw invalid('The survey cannot be before the ship docked', ['surveyedAt']);
  return toApi(appendEvent(a.wctx, 'dck.survey_record', {
    home_scope_id: d.ship_id, occurred_at: at, docking_id: dockingId, area: b.area, condition: b.condition, finding: b.finding,
    measurement: b.measurement ?? null, surveyed_by: b.surveyedBy ?? null, action_required: b.actionRequired ? 1 : 0,
  }));
}
