/**
 * Command services for M03: authorization -> validation/business rules -> platform write path (records.ts).
 * Asset identity is permanent: the id and the equipment tag never change, whatever transfers happen afterwards.
 */
import type { z } from 'zod';
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { nextNumber } from '../../platform/ranges.js';
import { createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { appendMovement, checkPositionFree, checkRefs, refoldAsset } from './movements.js';
import { perm, type AstNoun } from './permissions.js';
import { exists, getAssetState, getLive, TABLES, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

type Values = Record<string, unknown>;
type CrudNoun = Exclude<AstNoun, 'asset_movement'>;

export const EQUIPMENT_TAG_SEQUENCE = 'equipment_tag';
const LEVELS = ['system', 'equipment_group', 'equipment', 'component'] as const;

const blocked = (message: string, details?: Values) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const invalid = (message: string, details?: Values) => new AppError('VALIDATION_FAILED', message, details);

const reload = (db: Db, noun: CrudNoun, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ?`).get(id) as Row;
const requireLive = (db: Db, noun: CrudNoun, id: unknown, label: string): Row => {
  const r = typeof id === 'string' ? getLive(db, noun, id) : undefined;
  if (!r) throw missing(label, id);
  return r;
};
const installedAt = (db: Db, positionId: string): boolean => exists(db, 'SELECT 1 FROM ast_asset_current WHERE position_id = ?', positionId);

/** A ship or workshop installation enters data only for the ship it serves (sys_installation.org_unit_id); hub and commands may enter any. */
function assertSiteHeldHere(a: Actor, shipId: string): void {
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== shipId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different ship; enter data where the ship is held', { servedSiteId: r.org_unit_id, requestedSiteId: shipId });
  }
}

const requireShip = (db: Db, id: unknown): void => {
  if (typeof id !== 'string' || !resolveParty(db, { kind: 'ship', id })) throw missing('Ship', id);
};

// ------------------------------------------------------------------ resource definitions

interface Def {
  noun: CrudNoun;
  type: string;
  create: z.ZodType;
  update: z.ZodType;
  hubOnly?: boolean;
  scope(a: Actor, v: Values): ScopeRef;
  unique?(v: Values): Array<Record<string, unknown>>;
  prepare?(a: Actor, v: Values): Values;
  validate?(a: Actor, next: Values, current: Values | null): void;
  beforeTombstone?(a: Actor, current: Values): void;
}

const classificationInUse = (db: Db, id: unknown): boolean =>
  exists(db, 'SELECT 1 FROM ast_position WHERE classification_id = ? AND deleted_at IS NULL', id) ||
  exists(db, 'SELECT 1 FROM ast_asset WHERE classification_id = ? AND deleted_at IS NULL', id) ||
  exists(db, 'SELECT 1 FROM ast_classification WHERE parent_id = ? AND deleted_at IS NULL', id);

const shipScope = (shipId: unknown): ScopeRef => ({ kind: 'ship', ...(typeof shipId === 'string' ? { id: shipId } : {}) });

const DEFS: Record<CrudNoun, Def> = {
  classification: {
    noun: 'classification', type: 'ast.classification', create: S.ClassificationCreate, update: S.ClassificationUpdate, hubOnly: true,
    scope: () => ({ kind: 'fleet' }),
    unique: (v) => [{ code: v.code }],
    validate: (a, next, cur) => {
      if (cur || !next.parent_id) return;
      const parent = requireLive(a.wctx.db, 'classification', next.parent_id, 'Parent classification');
      if (parent.kind !== next.kind) throw invalid('A classification and its parent must be of the same kind');
    },
    beforeTombstone: (a, cur) => { if (classificationInUse(a.wctx.db, cur.id)) throw blocked('Classification is in use by positions, assets or child classifications'); },
  },
  position: {
    noun: 'position', type: 'ast.position', create: S.PositionCreate, update: S.PositionUpdate,
    scope: (_a, v) => shipScope(v.home_scope_id),
    unique: (v) => [{ home_scope_id: v.home_scope_id, position_tag: v.position_tag }],
    prepare: (a, v) => {
      const db = a.wctx.db;
      requireShip(db, v.home_scope_id);
      assertSiteHeldHere(a, v.home_scope_id as string);
      if (!v.parent_id) return { ...v, parent_id: null, level: 'system' };
      const parent = requireLive(db, 'position', v.parent_id, 'Parent position');
      if (parent.home_scope_id !== v.home_scope_id) throw invalid('Parent position belongs to a different ship');
      const next = LEVELS[LEVELS.indexOf(parent.level as (typeof LEVELS)[number]) + 1];
      if (!next) throw invalid('A component cannot have child positions');
      return { ...v, level: next };
    },
    validate: (a, next, cur) => {
      if (next.classification_id) requireLive(a.wctx.db, 'classification', next.classification_id, 'Classification');
      if (cur && cur.status !== 'inactive' && next.status === 'inactive' && installedAt(a.wctx.db, cur.id as string)) throw blocked('An asset is installed here; remove it before making the position inactive');
    },
    beforeTombstone: (a, cur) => {
      const db = a.wctx.db;
      if (exists(db, 'SELECT 1 FROM ast_position WHERE parent_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Position still has child positions');
      if (installedAt(db, cur.id as string)) throw blocked('An asset is installed here; remove it first');
    },
  },
  position_responsibility: {
    noun: 'position_responsibility', type: 'ast.position_responsibility', create: S.ResponsibilityCreate, update: S.ResponsibilityUpdate,
    scope: (_a, v) => shipScope(v.home_scope_id),
    prepare: (a, v) => {
      const pos = requireLive(a.wctx.db, 'position', v.position_id, 'Position');
      return { ...v, home_scope_id: pos.home_scope_id };
    },
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      const pos = requireLive(db, 'position', next.position_id, 'Position');
      // One writer per position tree: only the installation that owns the position records who is responsible for it.
      if (pos.owner_installation_id !== a.wctx.installation.installationId) {
        throw new AppError('NOT_OWNER', 'This position is owned by another installation; responsibility is recorded there', { ownerInstallationId: pos.owner_installation_id });
      }
      if (!resolveParty(db, { kind: 'department', id: next.department_id as string })) throw missing('Department', next.department_id);
      const from = next.effective_from as string;
      const to = (next.effective_to as string | null) ?? null;
      if (to !== null && to <= from) throw invalid('effectiveTo must be after effectiveFrom');
      const clash = db
        .prepare(
          `SELECT id, effective_from, effective_to FROM ast_position_responsibility
           WHERE position_id = ? AND deleted_at IS NULL AND id <> ? AND effective_from < ? AND COALESCE(effective_to, '9999-12-31T23:59:59.999Z') > ?`,
        )
        .get(next.position_id, cur ? cur.id : '', to ?? '9999-12-31T23:59:59.999Z', from) as Row | undefined;
      if (clash) throw invalid('Position responsibilities may not overlap', { rule: 'RESPONSIBILITY_OVERLAP', conflictingId: clash.id, from: clash.effective_from, to: clash.effective_to });
    },
  },
  asset: {
    noun: 'asset', type: 'ast.asset', create: S.AssetCreate, update: S.AssetUpdate,
    scope: (_a, v) => (v.home_scope_id ? shipScope(v.home_scope_id) : { kind: 'fleet' }),
    unique: (v) => (v.manufacturer && v.serial_number ? [{ manufacturer: v.manufacturer, serial_number: v.serial_number }] : []),
    validate: (a, next) => {
      if (next.classification_id) requireLive(a.wctx.db, 'classification', next.classification_id, 'Classification');
    },
    beforeTombstone: (a, cur) => {
      if (getAssetState(a.wctx.db, cur.id as string)?.positionId) throw blocked('Asset is installed; remove it before removing the record');
    },
  },
};

// ------------------------------------------------------------------ plumbing

function snake(input: Values): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'shipId' || k === 'homeShipId') out.home_scope_id = v;
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

/** Translate DB-level guard failures (unique index, overlap and permanence triggers) into contract errors. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    if (err.code === 'SQLITE_CONSTRAINT_TRIGGER' && /overlap/.test(err.message ?? '')) throw invalid('Position responsibilities may not overlap', { rule: 'RESPONSIBILITY_OVERLAP' });
    if (err.code === 'SQLITE_CONSTRAINT_TRIGGER' && /permanent/.test(err.message ?? '')) throw blocked('The asset tag is permanent and cannot be changed');
    throw e;
  }
}

function assertCanWrite(a: Actor, def: Def): void {
  if (def.hubOnly && a.wctx.installation.kind !== 'hub') {
    throw new AppError('NOT_OWNER', `${def.type} is hub-owned reference data; it can only be changed at the hub`, { entityType: def.type });
  }
}

function doCreate(a: Actor, def: Def, input: unknown): Row {
  const values = snake(S.parse(def.create, input) as Values);
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

export function createEntity(a: Actor, noun: Exclude<CrudNoun, 'asset'>, input: unknown): Row {
  const def = DEFS[noun];
  const parsed = snake(S.parse(def.create, input) as Values);
  // Authorization scope for a new responsibility is the ship of its position, which only exists after lookup.
  const scopeValues = noun === 'position_responsibility' ? { home_scope_id: getLive(a.wctx.db, 'position', parsed.position_id as string)?.home_scope_id } : parsed;
  authorize(a, perm(noun, 'create'), def.scope(a, scopeValues));
  assertCanWrite(a, def);
  return toApi(doCreate(a, def, input));
}

export function updateEntity(a: Actor, noun: CrudNoun, id: string, input: unknown): Row {
  const def = DEFS[noun];
  const { expectedVersion, ...rest } = S.parse(def.update, input) as Values & { expectedVersion: number };
  const db = a.wctx.db;
  const cur = getLive(db, noun, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(noun, 'update'), def.scope(a, cur));
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

export function tombstoneEntity(a: Actor, noun: CrudNoun, id: string, input: unknown): Row {
  const def = DEFS[noun];
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, noun, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(noun, 'remove'), def.scope(a, cur));
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

// ------------------------------------------------------------------ assets

/**
 * Register a physical asset: allocates its permanent equipment tag from this installation's own number range (works offline;
 * RANGE_EXHAUSTED when the range is used up), records the registration movement, and optionally installs it straight away.
 */
export function createAsset(a: Actor, input: unknown): { asset: Row; current: ReturnType<typeof getAssetState> } {
  const b = S.parse(S.AssetCreate, input);
  const db = a.wctx.db;
  authorize(a, perm('asset', 'create'), b.homeShipId ? shipScope(b.homeShipId) : { kind: 'fleet' });
  if (b.homeShipId) {
    requireShip(db, b.homeShipId);
    assertSiteHeldHere(a, b.homeShipId);
  }
  const { homeShipId, custody, locationId, positionId, assetStatus, ...fields } = b;
  const values = snake({ ...fields, homeShipId: homeShipId ?? null });
  const def = DEFS.asset;
  const reg = { custody: custody ?? (homeShipId ? { kind: 'ship', id: homeShipId } : null), locationId: locationId ?? null };

  return guard(() =>
    db.transaction(() => {
      def.validate?.(a, values, null);
      assertUnique(db, def, values);
      checkRefs(db, reg);
      if (positionId) checkPositionFree(db, positionId, null);
      const { tag } = nextNumber(db, a.wctx.installation, EQUIPMENT_TAG_SEQUENCE);
      const created = createRecord(a.wctx, def.type, { ...values, asset_tag: tag });
      const w = withReason(a, null);
      appendMovement(w, created, { kind: 'register', ...reg, assetStatus: assetStatus ?? 'in_service' });
      if (positionId) appendMovement(w, created, { kind: 'install', positionId, locationId: reg.locationId });
      refoldAsset(db, created.id as string);
      return { asset: toApi(reload(db, 'asset', created.id)), current: getAssetState(db, created.id as string) };
    })(),
  );
}

// ------------------------------------------------------------------ responsibility handover

/**
 * Hand a position's responsibility to another department from `effectiveFrom`: closes the row in force at that instant and
 * opens the next, atomically. Only responsibility rows change; assets, locations and command attachment are untouched.
 */
export function reassignResponsibility(a: Actor, input: unknown): { closed: Row | null; created: Row } {
  const r = S.parse(S.ResponsibilityReassign, input);
  const db = a.wctx.db;
  const pos = requireLive(db, 'position', r.positionId, 'Position');
  const scope = shipScope(pos.home_scope_id);
  authorize(a, perm('position_responsibility', 'create'), scope);
  authorize(a, perm('position_responsibility', 'update'), scope);
  const w = withReason(a, r.reason);
  return guard(() =>
    db.transaction(() => {
      const later = db.prepare('SELECT id FROM ast_position_responsibility WHERE position_id = ? AND deleted_at IS NULL AND effective_from >= ? LIMIT 1').get(r.positionId, r.effectiveFrom) as { id: string } | undefined;
      if (later) throw blocked('The position already has a responsibility starting at or after that instant', { responsibilityId: later.id });
      const cover = db
        .prepare(
          `SELECT * FROM ast_position_responsibility WHERE position_id = ? AND deleted_at IS NULL AND effective_from < ?
           AND (effective_to IS NULL OR effective_to > ?) LIMIT 1`,
        )
        .get(r.positionId, r.effectiveFrom, r.effectiveFrom) as Row | undefined;
      if (cover && cover.department_id === r.departmentId) throw invalid('That department is already responsible at that instant');
      let closed: Row | null = null;
      if (cover) {
        if (cover.owner_installation_id !== a.wctx.installation.installationId) throw new AppError('NOT_OWNER', 'This responsibility is recorded by another installation');
        updateRecord(w.wctx, 'ast.position_responsibility', cover.id as string, cover.version as number, { effective_to: r.effectiveFrom });
        closed = reload(db, 'position_responsibility', cover.id);
      }
      const created = doCreate(w, DEFS.position_responsibility, { positionId: r.positionId, departmentId: r.departmentId, effectiveFrom: r.effectiveFrom, reason: r.reason ?? null });
      return { closed: closed ? toApi(closed) : null, created: toApi(created) };
    })(),
  );
}

/** Responsibility in force for a position at an instant (default now). */
export function responsibilityAt(db: Db, positionId: string, at: string): Row | null {
  const r = db
    .prepare(
      `SELECT * FROM ast_position_responsibility WHERE position_id = ? AND deleted_at IS NULL AND effective_from <= ?
       AND (effective_to IS NULL OR effective_to > ?) LIMIT 1`,
    )
    .get(positionId, at, at) as Row | undefined;
  return r ? toApi(r) : null;
}

