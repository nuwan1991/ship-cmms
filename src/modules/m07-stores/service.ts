/**
 * Command services for M07: authorization -> validation/business rules -> platform write path (records.ts).
 * Stock is never edited: every change is a transaction event and balances are derived (D39). Local commands refuse to
 * overdraw stock; events replicated from other installations are never rejected for that reason (D20).
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { nextNumber } from '../../platform/ranges.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { getLocation as getOrgLocation, resolveParty } from '../m01-organization/index.js';
import { getAsset } from '../m03-assets/index.js';
import { getWorkOrder } from '../m05-work/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm, type StkNoun } from './permissions.js';
import { exists, getBalance, getLive, lastCost, netIssued, outstandingReservation, TABLES, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

export const TRANSFER_SEQUENCE = 'transfer_no';
const WO_TYPE = 'wrk.work_order';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const reload = (db: Db, noun: StkNoun, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ?`).get(id) as Row;
const siteScope = (siteId: unknown): ScopeRef => (typeof siteId === 'string' ? { kind: 'ship', id: siteId } : { kind: 'fleet' });
const snake = (input: Record<string, unknown>): Row => Object.fromEntries(Object.entries(input).map(([k, v]) => [toSnake(k), v]));
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}

/** A ship or workshop installation records stock only for the site it serves; the hub and commands may enter any. */
function assertSiteHeldHere(a: Actor, siteId: unknown): void {
  if (typeof siteId !== 'string') return;
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== siteId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different site; record stock where it is held', { servedSiteId: r.org_unit_id, requestedSiteId: siteId });
  }
}
/** Reservation and receipt times may be back-dated (entered after the event) but never in the future. */
function checkMoment(at: string | undefined): void {
  if (at && Date.parse(at) > Date.now() + 5 * 60_000) throw new AppError('VALIDATION_FAILED', 'The time cannot be in the future', { fields: ['occurredAt'] });
}

const requirePart = (db: Db, id: unknown): Row => {
  const p = typeof id === 'string' ? getLive(db, 'part', id) : undefined;
  if (!p) throw missing('Part', id);
  return p;
};
const requireLocation = (db: Db, id: unknown): Row => {
  const l = typeof id === 'string' ? getLive(db, 'location', id) : undefined;
  if (!l) throw missing('Stock location', id);
  return l;
};

// ------------------------------------------------------------------ catalogue (hub reference data)

export function createPart(a: Actor, input: unknown): Row {
  const b = S.parse(S.PartCreate, input);
  authorize(a, perm('part', 'create'), { kind: 'fleet' });
  return guard(() => toApi(createRecord(a.wctx, 'stk.part', { ...snake(b), status: b.status ?? 'active' })));
}
export function updatePart(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.PartUpdate, input);
  authorize(a, perm('part', 'update'), { kind: 'fleet' });
  requirePart(a.wctx.db, id);
  return toApi(updateRecord(a.wctx, 'stk.part', id, expectedVersion, snake(rest)));
}
export function tombstonePart(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('part', 'remove'), { kind: 'fleet' });
  const db = a.wctx.db;
  requirePart(db, id);
  if (exists(db, 'SELECT 1 FROM stk_transaction WHERE part_id = ? UNION ALL SELECT 1 FROM stk_reservation WHERE part_id = ? LIMIT 1', id, id)) {
    throw blocked('This part has stock history; mark it inactive instead of removing it', { partId: id });
  }
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'stk.part', id, expectedVersion, reason));
}

export function addCompatibility(a: Actor, input: unknown): Row {
  const b = S.parse(S.CompatibilityCreate, input);
  authorize(a, perm('compatibility', 'create'), { kind: 'fleet' });
  const db = a.wctx.db;
  requirePart(db, b.partId);
  if (b.classificationId && !exists(db, 'SELECT 1 FROM ast_classification WHERE id = ? AND deleted_at IS NULL', b.classificationId)) throw missing('Classification', b.classificationId);
  if (b.assetId && !getAsset(db, b.assetId)) throw missing('Asset', b.assetId);
  return guard(() => toApi(createRecord(a.wctx, 'stk.part_compatibility', snake(b))));
}
export function removeCompatibility(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('compatibility', 'remove'), { kind: 'fleet' });
  if (!getLive(a.wctx.db, 'compatibility', id)) throw notFound('Compatibility', id);
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'stk.part_compatibility', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ locations and levels

export function createLocation(a: Actor, input: unknown): Row {
  const b = S.parse(S.LocationCreate, input);
  const db = a.wctx.db;
  authorize(a, perm('location', 'create'), siteScope(b.siteId));
  if (b.siteId) {
    if (!resolveParty(db, { kind: 'ship', id: b.siteId }) && !resolveParty(db, { kind: 'workshop', id: b.siteId })) throw missing('Ship or workshop', b.siteId);
    assertSiteHeldHere(a, b.siteId);
  }
  if (b.orgLocationId && getOrgLocation(db, b.orgLocationId)?.siteId !== (b.siteId ?? null)) {
    throw new AppError('VALIDATION_FAILED', 'The physical compartment must belong to the same ship or workshop', { fields: ['orgLocationId'] });
  }
  return guard(() => toApi(createRecord(a.wctx, 'stk.location', { home_scope_id: b.siteId ?? null, code: b.code, name: b.name, kind: b.kind, org_location_id: b.orgLocationId ?? null, status: 'active' })));
}
export function updateLocation(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.LocationUpdate, input);
  const loc = requireLocation(a.wctx.db, id);
  authorize(a, perm('location', 'update'), siteScope(loc.home_scope_id));
  return toApi(updateRecord(a.wctx, 'stk.location', id, expectedVersion, snake(rest)));
}
export function tombstoneLocation(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const loc = requireLocation(db, id);
  authorize(a, perm('location', 'remove'), siteScope(loc.home_scope_id));
  if (exists(db, 'SELECT 1 FROM stk_transaction WHERE location_id = ? UNION ALL SELECT 1 FROM stk_reservation WHERE location_id = ? LIMIT 1', id, id)) {
    throw blocked('This location has stock history; mark it inactive instead of removing it', { locationId: id });
  }
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'stk.location', id, expectedVersion, reason));
}

export function setStockLevel(a: Actor, input: unknown): Row {
  const b = S.parse(S.LevelCreate, input);
  const db = a.wctx.db;
  const loc = requireLocation(db, b.locationId);
  requirePart(db, b.partId);
  authorize(a, perm('stock_level', 'create'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  return guard(() => toApi(createRecord(a.wctx, 'stk.stock_level', { home_scope_id: loc.home_scope_id ?? null, part_id: b.partId, location_id: b.locationId, min_level: b.minLevel, reorder_qty: b.reorderQty ?? null })));
}
export function updateStockLevel(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.LevelUpdate, input);
  const cur = getLive(a.wctx.db, 'stock_level', id);
  if (!cur) throw notFound('Stock level', id);
  authorize(a, perm('stock_level', 'update'), siteScope(cur.home_scope_id));
  return toApi(updateRecord(a.wctx, 'stk.stock_level', id, expectedVersion, snake(rest)));
}
export function tombstoneStockLevel(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const cur = getLive(a.wctx.db, 'stock_level', id);
  if (!cur) throw notFound('Stock level', id);
  authorize(a, perm('stock_level', 'remove'), siteScope(cur.home_scope_id));
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'stk.stock_level', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ stock movements

interface Movement { part: Row; loc: Row; kind: 'receipt' | 'issue' | 'return' | 'transfer_out' | 'transfer_in' | 'adjustment'; delta: number; extra?: Row; occurredAt?: string }
function writeTxn(a: Actor, m: Movement): Row {
  return appendEvent(a.wctx, 'stk.transaction', {
    home_scope_id: m.loc.home_scope_id ?? null, part_id: m.part.id, location_id: m.loc.id, kind: m.kind, quantity: Math.abs(m.delta), qty_delta: m.delta,
    ...(m.occurredAt ? { occurred_at: m.occurredAt } : {}), ...(m.extra ?? {}),
  });
}
const txnOut = (r: Row): Row => toApi(r);
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Stock that can be taken now: on hand less what is reserved for OTHER references. */
function usableFor(db: Db, partId: string, locId: string, refId?: string): number {
  const b = getBalance(db, partId, locId);
  const own = refId ? outstandingReservation(db, refId, partId, locId) : 0;
  return round3(b.onHand - (b.reserved - own));
}
const insufficient = (part: Row, loc: Row, wanted: number, usable: number) =>
  blocked(`Not enough ${String(part.part_no)} at ${String(loc.code)}: ${usable} available, ${wanted} wanted`, { partId: part.id, locationId: loc.id, available: usable, wanted });

function workOrderFor(a: Actor, workOrderId: string, loc: Row) {
  const wo = getWorkOrder(a.wctx.db, workOrderId);
  if (!wo) throw missing('Work order', workOrderId);
  if (wo.axes.closure === 'closed') throw blocked(`Work order ${wo.woNo} is closed; reopen it before moving stock against it`, { workOrderId });
  if (wo.shipId && loc.home_scope_id && wo.shipId !== loc.home_scope_id) throw blocked(`Work order ${wo.woNo} belongs to a different ship than this stock location`, { workOrderId });
  return wo;
}

export function receiveStock(a: Actor, input: unknown): Row {
  const b = S.parse(S.Receive, input);
  const db = a.wctx.db;
  const part = requirePart(db, b.partId), loc = requireLocation(db, b.locationId);
  authorize(a, perm('transaction', 'receive'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  checkMoment(b.occurredAt);
  if (part.status !== 'active') throw blocked(`Part ${String(part.part_no)} is inactive`, { partId: part.id });
  if (loc.status !== 'active') throw blocked(`Location ${String(loc.code)} is inactive`, { locationId: loc.id });
  if (b.currency && b.unitCost === undefined) throw new AppError('VALIDATION_FAILED', 'A currency needs a unit cost', { fields: ['currency'] });
  return txnOut(writeTxn(a, { part, loc, kind: 'receipt', delta: b.quantity, occurredAt: b.occurredAt, extra: { unit_cost: b.unitCost ?? null, currency: b.currency ?? null, reference: b.reference ?? null, note: b.note ?? null } }));
}

/** Issue stock, normally to a work order (which also consumes that work order's own reservation). */
export function issueStock(a: Actor, input: unknown): Row {
  const b = S.parse(S.Issue, input);
  const db = a.wctx.db;
  const part = requirePart(db, b.partId), loc = requireLocation(db, b.locationId);
  authorize(a, perm('transaction', 'issue'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  checkMoment(b.occurredAt);
  if (b.workOrderId) workOrderFor(a, b.workOrderId, loc);
  return db.transaction(() => {
    const usable = usableFor(db, b.partId, b.locationId, b.workOrderId);
    if (b.quantity > usable) throw insufficient(part, loc, b.quantity, usable);
    const cost = lastCost(db, b.partId);
    const t = writeTxn(a, {
      part, loc, kind: 'issue', delta: -b.quantity, occurredAt: b.occurredAt,
      extra: { unit_cost: cost?.unitCost ?? null, currency: cost?.currency ?? null, ref_type: b.workOrderId ? WO_TYPE : null, ref_id: b.workOrderId ?? null, reference: b.reference ?? null, note: b.note ?? null },
    });
    if (b.workOrderId) {
      const own = outstandingReservation(db, b.workOrderId, b.partId, b.locationId);
      if (own > 0) appendEvent(a.wctx, 'stk.reservation', { home_scope_id: loc.home_scope_id ?? null, part_id: b.partId, location_id: b.locationId, kind: 'release', quantity: Math.min(own, b.quantity), ref_type: WO_TYPE, ref_id: b.workOrderId, note: 'Consumed by issue' });
    }
    return txnOut(t);
  })();
}
/** Public convenience for callers that think in work orders (other modules, imports). */
export const issueToWorkOrder = (a: Actor, i: { workOrderId: string; partId: string; locationId: string; quantity: number; note?: string }): Row => issueStock(a, i);

/** Unused parts coming back. When tied to a work order, no more can return than the work order drew. */
export function returnStock(a: Actor, input: unknown): Row {
  const b = S.parse(S.Return, input);
  const db = a.wctx.db;
  const part = requirePart(db, b.partId), loc = requireLocation(db, b.locationId);
  authorize(a, perm('transaction', 'return'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  checkMoment(b.occurredAt);
  if (loc.status !== 'active') throw blocked(`Location ${String(loc.code)} is inactive`, { locationId: loc.id });
  if (b.workOrderId) {
    const wo = getWorkOrder(db, b.workOrderId);
    if (!wo) throw missing('Work order', b.workOrderId);
    const drawn = netIssued(db, b.workOrderId, b.partId);
    if (b.quantity > drawn) throw blocked(`Only ${drawn} of ${String(part.part_no)} is currently issued to ${wo.woNo}`, { workOrderId: b.workOrderId, issued: drawn, wanted: b.quantity });
  }
  const cost = lastCost(db, b.partId);
  return txnOut(writeTxn(a, {
    part, loc, kind: 'return', delta: b.quantity, occurredAt: b.occurredAt,
    extra: { unit_cost: cost?.unitCost ?? null, currency: cost?.currency ?? null, ref_type: b.workOrderId ? WO_TYPE : null, ref_id: b.workOrderId ?? null, reference: b.reference ?? null, note: b.note ?? null },
  }));
}

/** Stock-take correction. A new signed event with a mandatory reason; the earlier events are never touched. */
export function adjustStock(a: Actor, input: unknown): Row {
  const b = S.parse(S.Adjust, input);
  const db = a.wctx.db;
  const part = requirePart(db, b.partId), loc = requireLocation(db, b.locationId);
  authorize(a, perm('transaction', 'adjust'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  checkMoment(b.occurredAt);
  return db.transaction(() => {
    const bal = getBalance(db, b.partId, b.locationId);
    if (b.delta < 0 && bal.onHand + b.delta < -1e-9) throw blocked(`Cannot remove ${-b.delta} of ${String(part.part_no)}: only ${bal.onHand} on hand at ${String(loc.code)}`, { onHand: bal.onHand });
    return txnOut(writeTxn(a, { part, loc, kind: 'adjustment', delta: b.delta, occurredAt: b.occurredAt, extra: { note: b.reason, reference: 'stock adjustment' } }));
  })();
}

// ------------------------------------------------------------------ reservations

export function reserveStock(a: Actor, input: unknown): Row {
  const b = S.parse(S.Reserve, input);
  const db = a.wctx.db;
  const part = requirePart(db, b.partId), loc = requireLocation(db, b.locationId);
  authorize(a, perm('reservation', 'reserve'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  workOrderFor(a, b.workOrderId, loc);
  return db.transaction(() => {
    const avail = getBalance(db, b.partId, b.locationId).available;
    if (b.quantity > avail) throw insufficient(part, loc, b.quantity, avail);
    return toApi(appendEvent(a.wctx, 'stk.reservation', { home_scope_id: loc.home_scope_id ?? null, part_id: b.partId, location_id: b.locationId, kind: 'reserve', quantity: b.quantity, ref_type: WO_TYPE, ref_id: b.workOrderId, note: b.note ?? null }));
  })();
}
export function releaseReservation(a: Actor, input: unknown): Row {
  const b = S.parse(S.Release, input);
  const db = a.wctx.db;
  requirePart(db, b.partId);
  const loc = requireLocation(db, b.locationId);
  authorize(a, perm('reservation', 'release'), siteScope(loc.home_scope_id));
  assertSiteHeldHere(a, loc.home_scope_id);
  return db.transaction(() => {
    const out = outstandingReservation(db, b.workOrderId, b.partId, b.locationId);
    const qty = b.quantity ?? out;
    if (out <= 0) throw blocked('Nothing is reserved for this work order at this location', { workOrderId: b.workOrderId });
    if (qty > out) throw blocked(`Only ${out} is reserved; cannot release ${qty}`, { reserved: out });
    return toApi(appendEvent(a.wctx, 'stk.reservation', { home_scope_id: loc.home_scope_id ?? null, part_id: b.partId, location_id: b.locationId, kind: 'release', quantity: qty, ref_type: WO_TYPE, ref_id: b.workOrderId, note: b.note ?? null }));
  })();
}

// ------------------------------------------------------------------ transfers

type Line = { partId: string; quantity: number };
const linesOf = (t: Row): Line[] => JSON.parse(String(t.lines_json)) as Line[];
const transferState = (db: Db, id: string): Row | undefined => db.prepare('SELECT * FROM stk_v_transfer_state WHERE transfer_id = ?').get(id) as Row | undefined;

/** Take stock out of one location for another; the receiving side records its own arrival. All lines or none. */
export function dispatchTransfer(a: Actor, input: unknown): Row {
  const b = S.parse(S.Dispatch, input);
  const db = a.wctx.db;
  const from = requireLocation(db, b.fromLocationId), to = requireLocation(db, b.toLocationId);
  if (from.id === to.id) throw new AppError('VALIDATION_FAILED', 'Source and destination must differ', { fields: ['toLocationId'] });
  authorize(a, perm('transfer', 'dispatch'), siteScope(from.home_scope_id));
  assertSiteHeldHere(a, from.home_scope_id);
  checkMoment(b.dispatchedAt);
  if (to.status !== 'active') throw blocked(`Location ${String(to.code)} is inactive`, { locationId: to.id });
  return db.transaction(() => {
    const parts = b.lines.map((l) => ({ line: l, part: requirePart(db, l.partId) }));
    for (const { line, part } of parts) {
      const usable = usableFor(db, line.partId, from.id as string);
      if (line.quantity > usable) throw insufficient(part, from, line.quantity, usable);
    }
    const { tag } = nextNumber(db, a.wctx.installation, TRANSFER_SEQUENCE);
    const at = b.dispatchedAt ?? nowUtc();
    const t = createRecord(a.wctx, 'stk.transfer', {
      home_scope_id: from.home_scope_id ?? null, transfer_no: tag, from_location_id: from.id, to_location_id: to.id,
      lines_json: b.lines, status: 'dispatched', dispatched_at: at, note: b.note ?? null,
    });
    for (const { line, part } of parts) {
      const cost = lastCost(db, line.partId);
      writeTxn(a, { part, loc: from, kind: 'transfer_out', delta: -line.quantity, occurredAt: at, extra: { transfer_id: t.id, reference: tag, unit_cost: cost?.unitCost ?? null, currency: cost?.currency ?? null } });
    }
    return toApi(t);
  })();
}

/** Record arrival of a dispatched transfer at its destination (by the installation that holds the destination). */
export function receiveTransfer(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ReceiveTransfer, input ?? {});
  const db = a.wctx.db;
  const t = transferState(db, id);
  if (!t) throw notFound('Transfer', id);
  const to = requireLocation(db, t.to_location_id);
  authorize(a, perm('transfer', 'receive'), siteScope(to.home_scope_id));
  assertSiteHeldHere(a, to.home_scope_id);
  checkMoment(b.receivedAt);
  return db.transaction(() => {
    const cur = transferState(db, id);
    if (cur?.state !== 'in_transit') throw blocked(`Transfer ${String(t.transfer_no)} is ${String(cur?.state)}; it can no longer be received`, { transferId: id, state: cur?.state });
    const lines = linesOf(cur);
    const parts = lines.map((l) => ({ line: l, part: requirePart(db, l.partId) }));
    for (const { line, part } of parts) {
      writeTxn(a, { part, loc: to, kind: 'transfer_in', delta: line.quantity, occurredAt: b.receivedAt, extra: { transfer_id: id, reference: t.transfer_no, note: b.note ?? null } });
    }
    return toApi(transferState(db, id) as Row);
  })();
}

/** Called back by the dispatching installation while the transfer is still in transit: stock returns to the source. */
export function cancelTransfer(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.CancelTransfer, input);
  const db = a.wctx.db;
  const t = getLive(db, 'transfer', id);
  if (!t) throw notFound('Transfer', id);
  const from = requireLocation(db, t.from_location_id);
  authorize(a, perm('transfer', 'cancel'), siteScope(from.home_scope_id));
  return db.transaction(() => {
    const st = transferState(db, id);
    if (st?.state !== 'in_transit') throw blocked(`Transfer ${String(t.transfer_no)} is ${String(st?.state)}; only a transfer in transit can be cancelled`, { transferId: id, state: st?.state });
    updateRecord(withReason(a, reason).wctx, 'stk.transfer', id, expectedVersion, { status: 'cancelled', cancel_reason: reason });
    for (const l of linesOf(t)) {
      writeTxn(a, { part: requirePart(db, l.partId), loc: from, kind: 'transfer_in', delta: l.quantity, extra: { transfer_id: id, reference: t.transfer_no, note: `Cancelled: ${reason}` } });
    }
    return toApi(transferState(db, id) ?? reload(db, 'transfer', id));
  })();
}
