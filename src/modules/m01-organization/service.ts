/**
 * Command services for M01: authorization -> validation/business rules -> platform write path.
 * All synced writes go through platform/records.ts (ownership, versioning, audit, change log).
 */
import type { z } from 'zod';
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm, type OrgNoun } from './permissions.js';
import { ancestorIds, exists, getLive, LOCATION_MAX_DEPTH, TABLES, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

type Values = Record<string, unknown>;

interface Def {
  noun: OrgNoun;
  type: string;
  create: z.ZodType;
  update: z.ZodType;
  /** Authorization scope derived from the (new or merged) values. */
  scope(v: Values): ScopeRef;
  /** Uniqueness among live rows. Each set must be unique on its own. */
  unique?(v: Values): Array<Record<string, unknown>>;
  /** Business rules on the resulting record. `current` is null on create. */
  validate?(a: Actor, next: Values, current: Values | null): void;
  prepare?(a: Actor, v: Values): Values;
  beforeTombstone?(a: Actor, current: Values): void;
}

const blocked = (message: string, details?: Values) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const invalid = (message: string, details?: Values) => new AppError('VALIDATION_FAILED', message, details);

const currentOrFuture = (db: Db, col: 'ship_id' | 'command_id', id: string): boolean =>
  exists(db, `SELECT 1 FROM org_ship_command_assignment WHERE ${col} = ? AND deleted_at IS NULL AND (effective_to IS NULL OR effective_to > ?)`, id, nowUtc());

/** Re-read after a write so responses include database defaults (status, hasReplica, effectiveTo ...). Includes tombstoned rows. */
const reload = (db: Db, noun: OrgNoun, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ?`).get(id) as Row;

const requireLive = (db: Db, noun: OrgNoun, id: unknown, label: string): Row => {
  const r = typeof id === 'string' ? getLive(db, noun, id) : undefined;
  if (!r) throw missing(label, id);
  return r;
};

// ------------------------------------------------------------------ resource definitions

const DEFS: Record<OrgNoun, Def> = {
  fleet: {
    noun: 'fleet', type: 'org.fleet', create: S.FleetCreate, update: S.FleetUpdate,
    scope: () => ({ kind: 'fleet' }),
    unique: (v) => [{ code: v.code }],
    validate: (a, _n, cur) => {
      if (!cur && exists(a.wctx.db, 'SELECT 1 FROM org_fleet WHERE deleted_at IS NULL')) throw new AppError('DUPLICATE', 'A fleet already exists; there is a single fleet root');
    },
  },
  command: {
    noun: 'command', type: 'org.command', create: S.CommandCreate, update: S.CommandUpdate,
    scope: () => ({ kind: 'fleet' }),
    unique: (v) => [{ code: v.code }],
    validate: (a, next, cur) => {
      if (cur && cur.status !== 'inactive' && next.status === 'inactive' && currentOrFuture(a.wctx.db, 'command_id', cur.id as string)) {
        throw blocked('Command still has current or future ship assignments; reassign the ships first');
      }
    },
    beforeTombstone: (a, cur) => {
      const db = a.wctx.db;
      if (currentOrFuture(db, 'command_id', cur.id as string)) throw blocked('Command has current or future ship assignments');
      if (exists(db, 'SELECT 1 FROM org_workshop WHERE command_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Command still has workshops');
    },
  },
  ship: {
    noun: 'ship', type: 'org.ship', create: S.ShipCreate, update: S.ShipUpdate,
    scope: (v) => ({ kind: 'ship', ...(typeof v.id === 'string' ? { id: v.id } : {}) }),
    unique: (v) => [{ code: v.code }, ...(v.pennant_no ? [{ pennant_no: v.pennant_no }] : [])],
    prepare: (a, v) => {
      const db = a.wctx.db;
      if (v.fleet_id) {
        requireLive(db, 'fleet', v.fleet_id, 'Fleet');
        return v;
      }
      const fleets = db.prepare('SELECT id FROM org_fleet WHERE deleted_at IS NULL').all() as Array<{ id: string }>;
      if (fleets.length === 0) throw missing('Fleet', '(none)');
      if (fleets.length > 1) throw invalid('fleetId is required when more than one fleet exists');
      return { ...v, fleet_id: fleets[0]!.id };
    },
    beforeTombstone: (a, cur) => {
      const db = a.wctx.db;
      if (exists(db, 'SELECT 1 FROM org_location WHERE home_scope_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Ship still has locations');
      if (exists(db, 'SELECT 1 FROM org_workshop WHERE ship_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Ship still has an onboard workshop');
      if (currentOrFuture(db, 'ship_id', cur.id as string)) throw blocked('Ship has current or future command assignments');
    },
  },
  ship_command_assignment: {
    noun: 'ship_command_assignment', type: 'org.ship_command_assignment', create: S.AssignmentCreate, update: S.AssignmentUpdate,
    scope: (v) => ({ kind: 'ship', ...(typeof v.ship_id === 'string' ? { id: v.ship_id } : {}) }),
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      requireLive(db, 'ship', next.ship_id, 'Ship');
      const cmd = requireLive(db, 'command', next.command_id, 'Command');
      if ((!cur || cur.command_id !== next.command_id) && cmd.status !== 'active') throw blocked('Command is inactive; it cannot receive ships');
      const from = next.effective_from as string;
      const to = (next.effective_to as string | null) ?? null;
      if (to !== null && to <= from) throw invalid('effectiveTo must be after effectiveFrom');
      const clash = db
        .prepare(
          `SELECT id, effective_from, effective_to FROM org_ship_command_assignment
           WHERE ship_id = ? AND deleted_at IS NULL AND id <> ? AND effective_from < ? AND COALESCE(effective_to, '9999-12-31T23:59:59.999Z') > ? LIMIT 1`,
        )
        .get(next.ship_id, cur ? cur.id : '', to ?? '9999-12-31T23:59:59.999Z', from) as Row | undefined;
      if (clash) throw invalid('Ship command assignments may not overlap', { rule: 'ASSIGNMENT_OVERLAP', conflictingAssignmentId: clash.id, from: clash.effective_from, to: clash.effective_to });
    },
  },
  department: {
    noun: 'department', type: 'org.department', create: S.DepartmentCreate, update: S.DepartmentUpdate,
    scope: () => ({ kind: 'fleet' }),
    unique: (v) => [{ code: v.code }],
  },
  workshop: {
    noun: 'workshop', type: 'org.workshop', create: S.WorkshopCreate, update: S.WorkshopUpdate,
    scope: (v) => ({ kind: 'workshop', ...(typeof v.id === 'string' ? { id: v.id } : {}) }),
    unique: (v) => [{ code: v.code }],
    validate: (a, next) => {
      const db = a.wctx.db;
      const { kind, command_id: cmd, ship_id: ship } = next;
      if (kind === 'onboard') {
        if (!ship) throw invalid('An onboard workshop needs shipId');
        if (cmd) throw invalid('An onboard workshop takes its command from its ship; commandId must be empty');
      } else if (kind === 'command') {
        if (!cmd) throw invalid('A command workshop needs commandId');
        if (ship) throw invalid('Only onboard workshops have a shipId');
      } else if (cmd || ship) {
        throw invalid('A specialist workshop serves any command and has neither commandId nor shipId');
      }
      if (cmd) requireLive(db, 'command', cmd, 'Command');
      if (ship) requireLive(db, 'ship', ship, 'Ship');
    },
  },
  external_provider: {
    noun: 'external_provider', type: 'org.external_provider', create: S.ProviderCreate, update: S.ProviderUpdate,
    scope: () => ({ kind: 'fleet' }),
    unique: (v) => [{ code: v.code }],
  },
  location: {
    noun: 'location', type: 'org.location', create: S.LocationCreate, update: S.LocationUpdate,
    scope: (v) => ({ kind: v.site_kind === 'workshop' ? 'workshop' : 'ship', ...(typeof v.home_scope_id === 'string' ? { id: v.home_scope_id } : {}) }),
    unique: (v) => [{ home_scope_id: v.home_scope_id, parent_id: v.parent_id ?? null, code: v.code }],
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      const siteNoun: OrgNoun = next.site_kind === 'workshop' ? 'workshop' : 'ship';
      requireLive(db, siteNoun, next.home_scope_id, siteNoun === 'ship' ? 'Ship' : 'Workshop');
      if (!cur) assertSiteHeldHere(a, next.home_scope_id as string);
      if (next.parent_id) {
        const parent = requireLive(db, 'location', next.parent_id, 'Parent location');
        if (parent.home_scope_id !== next.home_scope_id) throw invalid('Parent location belongs to a different ship or workshop');
        if (cur && ancestorIds(db, next.parent_id as string).includes(cur.id as string)) throw invalid('A location cannot be moved under itself or its own descendant');
        if (ancestorIds(db, next.parent_id as string).length >= LOCATION_MAX_DEPTH) throw invalid(`Locations may be nested at most ${LOCATION_MAX_DEPTH} levels deep`);
      }
    },
    beforeTombstone: (a, cur) => {
      if (exists(a.wctx.db, 'SELECT 1 FROM org_location WHERE parent_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Location still has child locations');
    },
  },
};

/** A ship/workshop installation may only enter locations for the site it serves (sys_installation.org_unit_id). Hub/command may enter any (and own them). */
function assertSiteHeldHere(a: Actor, siteId: string): void {
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== siteId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different ship or workshop; locations are entered where the site is held', { servedSiteId: r.org_unit_id, requestedSiteId: siteId });
  }
}

// ------------------------------------------------------------------ plumbing

function snake(input: Values): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'siteId') out.home_scope_id = v;
    else out[toSnake(k)] = v;
  }
  return out;
}

function assertUnique(db: Db, def: Def, next: Values, selfId?: string): void {
  for (const set of def.unique?.(next) ?? []) {
    const cols = Object.keys(set);
    const sql = `SELECT id FROM ${TABLES[def.noun]} WHERE deleted_at IS NULL AND ${cols.map((c) => `${c} IS ?`).join(' AND ')}${selfId ? ' AND id <> ?' : ''} LIMIT 1`;
    const hit = db.prepare(sql).get(...cols.map((c) => set[c] ?? null), ...(selfId ? [selfId] : [])) as { id: string } | undefined;
    if (hit) throw new AppError('DUPLICATE', `${def.type} with the same ${cols.filter((c) => c !== 'home_scope_id').join(' / ')} already exists`, { fields: cols, existingId: hit.id });
  }
}

/** Translate DB-level guard failures (unique index, overlap trigger) into contract errors. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    if (err.code === 'SQLITE_CONSTRAINT_TRIGGER' && /overlap/.test(err.message ?? '')) throw invalid('Ship command assignments may not overlap', { rule: 'ASSIGNMENT_OVERLAP' });
    throw e;
  }
}

const HUB_NOUNS: ReadonlySet<OrgNoun> = new Set<OrgNoun>(['fleet', 'command', 'ship', 'ship_command_assignment', 'department', 'workshop', 'external_provider']);

/** Fail fast (before business validation) when a non-hub installation tries to write hub-owned reference data. */
function assertCanWrite(a: Actor, def: Def): void {
  if (HUB_NOUNS.has(def.noun) && a.wctx.installation.kind !== 'hub') {
    throw new AppError('NOT_OWNER', `${def.type} is hub-owned reference data; it can only be changed at the hub`, { entityType: def.type });
  }
}

function doCreate(a: Actor, def: Def, input: unknown): Row {
  const parsed = S.parse(def.create, input) as Values;
  const values = snake(parsed);
  const db = a.wctx.db;
  return guard(() =>
    db.transaction(() => {
      const next = def.prepare ? def.prepare(a, values) : values;
      def.validate?.(a, next, null);
      assertUnique(db, def, next);
      return reload(db, def.noun, createRecord(a.wctx, def.type, next).id);
    })(),
  );
}

export function createEntity(a: Actor, noun: OrgNoun, input: unknown): Row {
  const def = DEFS[noun];
  const parsed = S.parse(def.create, input) as Values;
  authorize(a, perm(noun, 'create'), def.scope(snake(parsed)));
  assertCanWrite(a, def);
  return toApi(doCreate(a, def, input));
}

export function updateEntity(a: Actor, noun: OrgNoun, id: string, input: unknown): Row {
  const def = DEFS[noun];
  const { expectedVersion, ...rest } = S.parse(def.update, input) as Values & { expectedVersion: number };
  const db = a.wctx.db;
  const cur = getLive(db, noun, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(noun, 'update'), def.scope(cur));
  assertCanWrite(a, def);
  if (cur.version !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
  const patch = snake(rest);
  return toApi(
    guard(() =>
      db.transaction(() => {
        const next = { ...cur, ...patch };
        def.validate?.(a, next, cur);
        if (def.unique) assertUnique(db, def, next, id);
        updateRecord(a.wctx, def.type, id, expectedVersion, patch);
        return reload(db, noun, id);
      })(),
    ),
  );
}

export function tombstoneEntity(a: Actor, noun: OrgNoun, id: string, input: unknown): Row {
  const def = DEFS[noun];
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, noun, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(noun, 'remove'), def.scope(cur));
  assertCanWrite(a, def);
  if (cur.version !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
  return toApi(
    db.transaction(() => {
      def.beforeTombstone?.(a, cur);
      tombstoneRecord(a.wctx, def.type, id, expectedVersion, reason);
      return reload(db, noun, id);
    })(),
  );
}

/**
 * Move a ship to another command from `effectiveFrom`: closes the assignment in force at that instant and opens
 * the new one, atomically. Only assignments (hub data) change; no ship, location or asset record changes owner.
 */
export function reassignShip(a: Actor, input: unknown): { closed: Row | null; created: Row } {
  const r = S.parse(S.Reassign, input);
  const scope: ScopeRef = { kind: 'ship', id: r.shipId };
  authorize(a, perm('ship_command_assignment', 'create'), scope);
  authorize(a, perm('ship_command_assignment', 'update'), scope);
  assertCanWrite(a, DEFS.ship_command_assignment);
  const w = withReason(a, r.reason);
  const db = a.wctx.db;
  return guard(() =>
    db.transaction(() => {
      requireLive(db, 'ship', r.shipId, 'Ship');
      const later = db
        .prepare('SELECT id FROM org_ship_command_assignment WHERE ship_id = ? AND deleted_at IS NULL AND effective_from >= ? LIMIT 1')
        .get(r.shipId, r.effectiveFrom) as { id: string } | undefined;
      if (later) throw blocked('The ship already has an assignment starting at or after that instant', { assignmentId: later.id });
      const cover = db
        .prepare(
          `SELECT * FROM org_ship_command_assignment WHERE ship_id = ? AND deleted_at IS NULL AND effective_from < ?
           AND (effective_to IS NULL OR effective_to > ?) LIMIT 1`,
        )
        .get(r.shipId, r.effectiveFrom, r.effectiveFrom) as Row | undefined;
      if (cover && cover.command_id === r.commandId) throw invalid('The ship is already attached to that command at that instant');
      let closed: Row | null = null;
      if (cover) {
        updateRecord(w.wctx, 'org.ship_command_assignment', cover.id as string, cover.version as number, { effective_to: r.effectiveFrom });
        closed = reload(db, 'ship_command_assignment', cover.id);
      }
      const created = doCreate(w, DEFS.ship_command_assignment, { shipId: r.shipId, commandId: r.commandId, effectiveFrom: r.effectiveFrom, reason: r.reason ?? null });
      return { closed: closed ? toApi(closed) : null, created: toApi(created) };
    })(),
  );
}
