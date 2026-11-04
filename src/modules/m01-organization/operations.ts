/**
 * Ship operational status and sea deployments (DECISIONS D66).
 *
 * Status is an append-only event stream per ship: a `set` event starts a period that lasts until the next live `set`; a `void`
 * event withdraws a mistaken entry. Any installation may record (the Command or NHQ at the hub, or the ship itself during
 * roll-out), so entries made offline never conflict; who may record is decided only by the role permissions
 * `org.ship_status.record` / `org.ship_status.void`, scoped to the ship (a command-scoped role covers that command's ships).
 *
 * Deployments are owner-mutable records scoped to the ship: the installation that entered one keeps it up to date (return date).
 */
import { z } from 'zod';
import { UtcTimestamp, Uuid, type ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { toCamel } from '../../platform/canonical.js';
import { authorize, withReason, type Actor } from './actor.js';
import { getLive } from './queries.js';
import { parse } from './schemas.js';
import { assertSiteHeldHere } from './service.js';

export type Row = Record<string, unknown>;

export const SHIP_STATUSES = ['operational', 'semi_operational', 'non_operational'] as const;
export type ShipStatus = (typeof SHIP_STATUSES)[number];

/** How far ahead a status change or a deployment may be entered (a refit or a sailing that is already ordered). */
export const MAX_AHEAD_DAYS = 120;

const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Version = z.number().int().min(1);

export const StatusRecord = z.strictObject({
  status: z.enum(SHIP_STATUSES),
  effectiveFrom: UtcTimestamp.optional(),
  reason: Text(500),
  authority: Text(120),
  opdefRef: Text(60),
  opdefCategory: Text(20),
});
export const StatusVoid = z.strictObject({ reason: z.string().trim().min(1).max(500) });
export const DeploymentCreate = z.strictObject({
  shipId: Uuid,
  name: z.string().trim().min(1).max(120),
  area: Text(120),
  sailedAt: UtcTimestamp,
  returnedAt: UtcTimestamp.nullable().optional(),
  remarks: Text(1000),
});
export const DeploymentUpdate = z.strictObject({
  expectedVersion: Version,
  name: z.string().trim().min(1).max(120).optional(),
  area: Text(120),
  sailedAt: UtcTimestamp.optional(),
  returnedAt: UtcTimestamp.nullable().optional(),
  remarks: Text(1000),
});
export const DeploymentTombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

const invalid = (message: string, details?: Row) => new AppError('VALIDATION_FAILED', message, details);
const blocked = (message: string, details?: Row) => new AppError('WORKFLOW_BLOCKED', message, details);
const shipScope = (id: string): ScopeRef => ({ kind: 'ship', id });
const camel = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));
const aheadLimit = (): string => new Date(Date.now() + MAX_AHEAD_DAYS * 86_400_000).toISOString();

function requireShip(db: Db, shipId: string): Row {
  const s = getLive(db, 'ship', shipId);
  if (!s) throw new AppError('DEPENDENCY_MISSING', `Ship ${shipId} does not exist on this installation`, { entity: 'Ship', id: shipId });
  return s;
}

// ------------------------------------------------------------------ status: read side

/** Status period in force for a ship at an instant (default now), or null when none was ever recorded before it. */
export function shipStatusAt(db: Db, shipId: string, at: string = nowUtc()): Row | null {
  const r = db
    .prepare('SELECT * FROM org_v_ship_status_period WHERE ship_id = ? AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from DESC, event_id DESC LIMIT 1')
    .get(shipId, at, at) as Row | undefined;
  return r ? camel(r) : null;
}

/** Every period of one ship, newest first, with voided entries listed separately so the history stays complete. */
export function shipStatusHistory(db: Db, shipId: string): { periods: Row[]; voided: Row[] } {
  const periods = (db.prepare('SELECT * FROM org_v_ship_status_period WHERE ship_id = ? ORDER BY effective_from DESC, event_id DESC').all(shipId) as Row[]).map(camel);
  const voided = (db
    .prepare(
      `SELECT e.id AS event_id, e.status, e.occurred_at AS effective_from, e.reason, e.authority, e.opdef_ref, e.opdef_category,
              v.reason AS void_reason, v.recorded_at AS voided_at, v.recorded_by AS voided_by
       FROM org_ship_status_event e JOIN org_ship_status_event v ON v.kind = 'void' AND v.voids_event_id = e.id
       WHERE e.ship_id = ? AND e.kind = 'set' ORDER BY e.occurred_at DESC`,
    )
    .all(shipId) as Row[]).map(camel);
  return { periods, voided };
}

/** Every live ship with its status and deployment in force now; optionally the ships of one command. */
export function currentShipStatuses(db: Db, opts: { commandId?: string | undefined; shipId?: string | undefined } = {}): Row[] {
  const where: string[] = [];
  const p: unknown[] = [];
  if (opts.commandId) { where.push('command_id = ?'); p.push(opts.commandId); }
  if (opts.shipId) { where.push('ship_id = ?'); p.push(opts.shipId); }
  return (db.prepare(`SELECT * FROM org_v_ship_status_current ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ship_name`).all(...p) as Row[]).map(camel);
}

// ------------------------------------------------------------------ status: commands

/** Record that a ship is operational, semi-operational or non-operational from `effectiveFrom` (default now). */
export function recordShipStatus(a: Actor, shipId: string, input: unknown): Row {
  const b = parse(StatusRecord, input);
  const db = a.wctx.db;
  requireShip(db, shipId);
  authorize(a, 'org.ship_status.record', shipScope(shipId));
  assertSiteHeldHere(a, shipId);
  const at = b.effectiveFrom ?? nowUtc();
  if (at > aheadLimit()) throw invalid(`A status change may be entered at most ${MAX_AHEAD_DAYS} days ahead`);
  if (b.status !== 'operational' && !b.reason) throw invalid('Give the reason the ship is not fully operational', { rule: 'STATUS_REASON_REQUIRED' });
  const inForce = shipStatusAt(db, shipId, at);
  if (inForce && inForce.status === b.status && (inForce.opdefRef ?? null) === (b.opdefRef ?? null) && (inForce.reason ?? null) === (b.reason ?? null)) {
    throw blocked(`The ship is already ${b.status.replace('_', '-')} at that time`, { rule: 'STATUS_UNCHANGED', since: inForce.effectiveFrom });
  }
  return db.transaction(() => {
    const row = appendEvent(a.wctx, 'org.ship_status_event', {
      home_scope_id: shipId, occurred_at: at, ship_id: shipId, kind: 'set', status: b.status,
      reason: b.reason ?? null, authority: b.authority ?? null, opdef_ref: b.opdefRef ?? null, opdef_category: b.opdefCategory ?? null,
    });
    writeAudit(withReason(a, b.reason).wctx, { action: 'ship_status.record', entityType: 'org.ship_status_event', entityId: row.id as string, changes: { status: [inForce?.status ?? null, b.status] } });
    return camel(row);
  })();
}

/** Withdraw a mistaken status entry. The entry stays in history, marked as voided; the periods close up around it. */
export function voidShipStatus(a: Actor, eventId: string, input: unknown): Row {
  const b = parse(StatusVoid, input);
  const db = a.wctx.db;
  const ev = db.prepare("SELECT * FROM org_ship_status_event WHERE id = ? AND kind = 'set'").get(eventId) as Row | undefined;
  if (!ev) throw new AppError('NOT_FOUND', `Status entry ${eventId} not found`);
  const shipId = ev.ship_id as string;
  authorize(a, 'org.ship_status.void', shipScope(shipId));
  assertSiteHeldHere(a, shipId);
  if (db.prepare("SELECT 1 FROM org_ship_status_event WHERE kind = 'void' AND voids_event_id = ?").get(eventId)) throw blocked('This entry was already withdrawn');
  return db.transaction(() => {
    const row = appendEvent(a.wctx, 'org.ship_status_event', { home_scope_id: shipId, ship_id: shipId, kind: 'void', voids_event_id: eventId, reason: b.reason });
    writeAudit(withReason(a, b.reason).wctx, { action: 'ship_status.void', entityType: 'org.ship_status_event', entityId: eventId });
    return camel(row);
  })();
}

// ------------------------------------------------------------------ deployments

const reloadDeployment = (db: Db, id: string): Row => camel(db.prepare('SELECT * FROM org_deployment WHERE id = ?').get(id) as Row);

/** The deployment in force for a ship at an instant (default now), or null when it is not deployed. */
export function deploymentAt(db: Db, shipId: string, at: string = nowUtc()): Row | null {
  const r = db
    .prepare('SELECT * FROM org_deployment WHERE ship_id = ? AND deleted_at IS NULL AND sailed_at <= ? AND (returned_at IS NULL OR returned_at > ?) ORDER BY sailed_at DESC LIMIT 1')
    .get(shipId, at, at) as Row | undefined;
  return r ? camel(r) : null;
}

function checkDeployment(db: Db, next: Row, selfId: string | null): void {
  const from = next.sailed_at as string;
  const to = (next.returned_at as string | null) ?? null;
  if (to !== null && to <= from) throw invalid('The return must be after the sailing', { rule: 'DEPLOYMENT_DATES' });
  if (from > aheadLimit()) throw invalid(`A deployment may be entered at most ${MAX_AHEAD_DAYS} days ahead`);
  if (to !== null && to > aheadLimit()) throw invalid(`An expected return may be at most ${MAX_AHEAD_DAYS} days ahead; leave it empty until the ship returns`);
  const clash = db
    .prepare(
      `SELECT id, name, sailed_at, returned_at FROM org_deployment WHERE ship_id = ? AND deleted_at IS NULL AND id <> ?
       AND sailed_at < ? AND COALESCE(returned_at, '9999-12-31T23:59:59.999Z') > ? LIMIT 1`,
    )
    .get(next.ship_id, selfId ?? '', to ?? '9999-12-31T23:59:59.999Z', from) as Row | undefined;
  if (clash) throw invalid(`The ship is already deployed then (${String(clash.name)})`, { rule: 'DEPLOYMENT_OVERLAP', conflictingDeploymentId: clash.id, sailedAt: clash.sailed_at, returnedAt: clash.returned_at });
}

export function createDeployment(a: Actor, input: unknown): Row {
  const b = parse(DeploymentCreate, input);
  const db = a.wctx.db;
  requireShip(db, b.shipId);
  authorize(a, 'org.deployment.create', shipScope(b.shipId));
  assertSiteHeldHere(a, b.shipId);
  const values: Row = { ship_id: b.shipId, name: b.name, area: b.area ?? null, sailed_at: b.sailedAt, returned_at: b.returnedAt ?? null, remarks: b.remarks ?? null };
  return db.transaction(() => {
    checkDeployment(db, values, null);
    return reloadDeployment(db, createRecord(a.wctx, 'org.deployment', { ...values, home_scope_id: b.shipId }).id as string);
  })();
}

function liveDeployment(db: Db, id: string): Row {
  const cur = db.prepare('SELECT * FROM org_deployment WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
  if (!cur) throw new AppError('NOT_FOUND', `Deployment ${id} not found`);
  return cur;
}
function requireOwner(a: Actor, cur: Row): void {
  if (cur.owner_installation_id !== a.wctx.installation.installationId) {
    throw new AppError('NOT_OWNER', 'This deployment was entered at another installation; it is updated there', { ownerInstallationId: cur.owner_installation_id });
  }
}

export function updateDeployment(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = parse(DeploymentUpdate, input);
  const db = a.wctx.db;
  const cur = liveDeployment(db, id);
  authorize(a, 'org.deployment.update', shipScope(cur.ship_id as string));
  requireOwner(a, cur);
  if (cur.version !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
  const patch: Row = {};
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.area !== undefined) patch.area = rest.area;
  if (rest.sailedAt !== undefined) patch.sailed_at = rest.sailedAt;
  if (rest.returnedAt !== undefined) patch.returned_at = rest.returnedAt;
  if (rest.remarks !== undefined) patch.remarks = rest.remarks;
  return db.transaction(() => {
    checkDeployment(db, { ...cur, ...patch }, id);
    updateRecord(a.wctx, 'org.deployment', id, expectedVersion, patch);
    return reloadDeployment(db, id);
  })();
}

export function tombstoneDeployment(a: Actor, id: string, input: unknown): Row {
  const b = parse(DeploymentTombstone, input);
  const db = a.wctx.db;
  const cur = liveDeployment(db, id);
  authorize(a, 'org.deployment.remove', shipScope(cur.ship_id as string));
  requireOwner(a, cur);
  tombstoneRecord(a.wctx, 'org.deployment', id, b.expectedVersion, b.reason);
  return reloadDeployment(db, id);
}

export function getDeployment(db: Db, id: string): Row | null {
  const r = db.prepare('SELECT * FROM org_v_deployment WHERE deployment_id = ?').get(id) as Row | undefined;
  return r ? camel(r) : null;
}
