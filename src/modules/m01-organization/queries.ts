/** Read side + the public lookups other modules may use (re-exported from index.ts). SQL stays inside the module. */
import type { Db } from '../../platform/db/open.js';
import type { PartyRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { isUtcIso, nowUtc } from '../../platform/time.js';
import { toCamel } from '../../platform/canonical.js';
import type { OrgNoun } from './permissions.js';

export type Row = Record<string, unknown>;

export const TABLES: Record<OrgNoun, string> = {
  fleet: 'org_fleet',
  command: 'org_command',
  ship: 'org_ship',
  ship_command_assignment: 'org_ship_command_assignment',
  department: 'org_department',
  workshop: 'org_workshop',
  external_provider: 'org_external_provider',
  location: 'org_location',
};

const BOOLEAN_FIELDS = new Set(['has_replica']);
const MAX_INSTANT = '9999-12-31T23:59:59.999Z';

/** DB row → API object: camelCase keys, booleans as booleans. */
export function toApi(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), BOOLEAN_FIELDS.has(k) ? v === 1 : v]));
}

export function getLive(db: Db, noun: OrgNoun, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
}

export const exists = (db: Db, sql: string, ...params: unknown[]): boolean => db.prepare(sql).get(...params) !== undefined;

// ---------------------------------------------------------------- public lookups

export interface ShipCommandAt {
  assignmentId: string;
  shipId: string;
  commandId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** Command a ship was attached to at instant `at` (UTC ISO, default now). Interval is [from, to). null = unattached. */
export function getShipCommandAt(db: Db, shipId: string, at: string = nowUtc()): ShipCommandAt | null {
  if (!isUtcIso(at)) throw new AppError('VALIDATION_FAILED', 'at must be a UTC instant like 2026-10-21T17:59:00.000Z');
  const r = db
    .prepare(
      `SELECT id, ship_id, command_id, effective_from, effective_to FROM org_ship_command_assignment
       WHERE ship_id = ? AND deleted_at IS NULL AND effective_from <= ? AND COALESCE(effective_to, ?) > ?
       ORDER BY effective_from DESC LIMIT 1`,
    )
    .get(shipId, at, MAX_INSTANT, at) as Row | undefined;
  return r
    ? { assignmentId: r.id as string, shipId: r.ship_id as string, commandId: r.command_id as string, effectiveFrom: r.effective_from as string, effectiveTo: (r.effective_to as string | null) ?? null }
    : null;
}

export interface ShipSummary {
  id: string;
  code: string;
  name: string;
  status: string;
}

/** Live ships attached to a command at instant `at` (default now). */
export function listShipsByCommand(db: Db, commandId: string, at: string = nowUtc()): ShipSummary[] {
  if (!isUtcIso(at)) throw new AppError('VALIDATION_FAILED', 'at must be a UTC instant like 2026-10-21T17:59:00.000Z');
  return db
    .prepare(
      `SELECT s.id, s.code, s.name, s.status FROM org_ship s
       JOIN org_ship_command_assignment a ON a.ship_id = s.id AND a.deleted_at IS NULL
        AND a.command_id = ? AND a.effective_from <= ? AND COALESCE(a.effective_to, ?) > ?
       WHERE s.deleted_at IS NULL ORDER BY s.code`,
    )
    .all(commandId, at, MAX_INSTANT, at) as ShipSummary[];
}

export interface LocationInfo {
  id: string;
  siteKind: 'ship' | 'workshop';
  siteId: string;
  parentId: string | null;
  code: string;
  name: string;
  kind: string;
  status: string;
  /** Root → this location. */
  path: Array<{ id: string; code: string; name: string }>;
  pathText: string;
}

const MAX_DEPTH = 10;

/** Ids of the ancestors of `id`, nearest first. Stops at a cycle or the depth cap (defensive; services prevent cycles). */
export function ancestorIds(db: Db, id: string | null): string[] {
  const out: string[] = [];
  let cur = id;
  const get = db.prepare('SELECT parent_id FROM org_location WHERE id = ?');
  while (cur && out.length < MAX_DEPTH + 2 && !out.includes(cur)) {
    out.push(cur);
    cur = (get.get(cur) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
  return out;
}
export const LOCATION_MAX_DEPTH = MAX_DEPTH;

export function getLocation(db: Db, id: string): LocationInfo | null {
  const loc = getLive(db, 'location', id);
  if (!loc) return null;
  const chain = ancestorIds(db, id).reverse();
  const names = db.prepare('SELECT id, code, name FROM org_location WHERE id = ?');
  const path = chain.map((x) => names.get(x) as { id: string; code: string; name: string });
  return {
    id,
    siteKind: loc.site_kind as 'ship' | 'workshop',
    siteId: loc.home_scope_id as string,
    parentId: (loc.parent_id as string | null) ?? null,
    code: loc.code as string,
    name: loc.name as string,
    kind: loc.kind as string,
    status: loc.status as string,
    path,
    pathText: path.map((p) => p.name).join(' / '),
  };
}

export interface ResolvedParty {
  kind: PartyRef['kind'];
  id: string;
  code: string;
  name: string;
  status: string | null;
}

const PARTY_TABLE: Record<PartyRef['kind'], string> = {
  command: 'org_command',
  ship: 'org_ship',
  department: 'org_department',
  workshop: 'org_workshop',
  external_provider: 'org_external_provider',
};

/** Resolve a PartyRef (ownership / operating / executing party on repair work) to a live org unit, or null. */
export function resolveParty(db: Db, ref: PartyRef): ResolvedParty | null {
  const r = db.prepare(`SELECT id, code, name, status FROM ${PARTY_TABLE[ref.kind]} WHERE id = ? AND deleted_at IS NULL`).get(ref.id) as
    | { id: string; code: string; name: string; status: string | null }
    | undefined;
  return r ? { kind: ref.kind, id: r.id, code: r.code, name: r.name, status: r.status ?? null } : null;
}

/** Find a live org unit by its unique code (e.g. a ship or department code); used by seeds, imports and scanners in other modules. */
export function findPartyByCode(db: Db, kind: PartyRef['kind'], code: string): ResolvedParty | null {
  const r = db.prepare(`SELECT id, code, name, status FROM ${PARTY_TABLE[kind]} WHERE code = ? AND deleted_at IS NULL`).get(code.trim().toUpperCase()) as
    | { id: string; code: string; name: string; status: string | null }
    | undefined;
  return r ? { kind, id: r.id, code: r.code, name: r.name, status: r.status ?? null } : null;
}

export function resolveParties(db: Db, refs: readonly PartyRef[]): Array<ResolvedParty | null> {
  return refs.map((r) => resolveParty(db, r));
}

/** Find a location of a site by its code (codes are unique per site among live rows). Used by demo seeds. */
export function findLocationByCode(db: Db, siteId: string, code: string): { id: string; code: string; name: string } | null {
  const r = db.prepare('SELECT id, code, name FROM org_location WHERE home_scope_id = ? AND code = ? AND deleted_at IS NULL').get(siteId, code) as { id: string; code: string; name: string } | undefined;
  return r ?? null;
}
