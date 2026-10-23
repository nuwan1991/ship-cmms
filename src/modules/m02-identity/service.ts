/** Command services for M02: authorization -> validation/business rules -> platform write path (records.ts). */
import type { z } from 'zod';
import { toCamel, toSnake } from '../../platform/canonical.js';
import type { AppContext } from '../../platform/app-context.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { resolveParty } from '../m01-organization/index.js';
import type { Actor } from './actor.js';
import { revokeUserSessions } from './auth.js';
import { authorize } from './guard.js';
import { isValidRolePermission, perm } from './permissions.js';
import * as S from './schemas.js';

export type Row = Record<string, unknown>;
type Values = Record<string, unknown>;

export const RESOURCES = ['user', 'role', 'role_permission', 'role_assignment', 'user_installation', 'offline_grant', 'gate_policy'] as const;
export type Resource = (typeof RESOURCES)[number];

export const TABLES: Record<Resource | 'approval' | 'revocation', string> = {
  user: 'idn_user', role: 'idn_role', role_permission: 'idn_role_permission', role_assignment: 'idn_role_assignment',
  user_installation: 'idn_user_installation', offline_grant: 'idn_offline_grant', gate_policy: 'idn_gate_policy',
  approval: 'idn_approval', revocation: 'idn_authority_revocation',
};

const JSON_COLUMNS = new Set(['actor_snapshot', 'authority_basis', 'changes']);
const BOOL_COLUMNS = new Set(['ratified', 'pending_confirmation', 'authority_disputed', 'needs_review']);
const HIDDEN = new Set(['password_hash']);

/** DB row -> API JSON: camelCase keys, parsed JSON columns, real booleans, no secrets. */
export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (HIDDEN.has(k)) continue;
    out[toCamel(k)] = JSON_COLUMNS.has(k) && typeof v === 'string' ? JSON.parse(v) : BOOL_COLUMNS.has(k) ? v === 1 : v;
  }
  return out;
}

const exists = (db: Db, sql: string, ...p: unknown[]): boolean => db.prepare(sql).get(...p) !== undefined;
const getLive = (db: Db, r: Resource, id: string): Row | undefined => db.prepare(`SELECT * FROM ${TABLES[r]} WHERE id = ? AND deleted_at IS NULL`).get(id) as Row | undefined;
const reload = (db: Db, r: Resource, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[r]} WHERE id = ?`).get(id) as Row;
const blocked = (m: string) => new AppError('WORKFLOW_BLOCKED', m);
const invalid = (m: string, d?: Values) => new AppError('VALIDATION_FAILED', m, d);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });

function requireLive(db: Db, r: Resource, id: unknown, label: string): Row {
  const row = typeof id === 'string' ? getLive(db, r, id) : undefined;
  if (!row) throw missing(label, id);
  return row;
}

function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}

/** Identity reference data is written at the hub only (NOT_OWNER elsewhere), checked before business validation. */
function assertHub(a: Actor, type: string): void {
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', `${type} is hub-owned reference data; it can only be changed at the hub`, { entityType: type });
}

const snake = (input: Values): Values => Object.fromEntries(Object.entries(input).map(([k, v]) => [toSnake(k), v]));

// ------------------------------------------------------------------ resource definitions

interface Def {
  type: string;
  create: z.ZodType;
  update?: z.ZodType;
  unique?(v: Values, selfId?: string): Array<Record<string, unknown>>;
  prepare?(a: Actor, v: Values): Values;
  validate?(a: Actor, next: Values, cur: Values | null): void;
  beforeTombstone?(a: Actor, cur: Values): void;
}

const DEFS: Record<Resource, Def> = {
  user: {
    type: 'idn.user', create: S.UserCreate, update: S.UserUpdate,
    unique: (v) => (v.service_number ? [{ service_number: v.service_number }] : []),
    beforeTombstone: (a, cur) => {
      const db = a.wctx.db;
      if (exists(db, 'SELECT 1 FROM idn_credential WHERE user_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('User still has a credential; deactivate the user instead');
      if (exists(db, 'SELECT 1 FROM idn_role_assignment WHERE user_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('User still has role assignments');
    },
  },
  role: {
    type: 'idn.role', create: S.RoleCreate, update: S.RoleUpdate,
    unique: (v) => [{ code: v.code }],
    beforeTombstone: (a, cur) => {
      if (exists(a.wctx.db, 'SELECT 1 FROM idn_role_assignment WHERE role_id = ? AND deleted_at IS NULL', cur.id)) throw blocked('Role still has assignments');
    },
  },
  role_permission: {
    type: 'idn.role_permission', create: S.RolePermissionCreate,
    unique: (v) => [{ role_id: v.role_id, permission: v.permission }],
    validate: (a, next) => {
      requireLive(a.wctx.db, 'role', next.role_id, 'Role');
      if (!isValidRolePermission(String(next.permission))) throw invalid('permission must be a code like org.ship.view, a prefix wildcard like org.*, or *');
    },
  },
  role_assignment: {
    type: 'idn.role_assignment', create: S.AssignmentCreate, update: S.AssignmentUpdate,
    prepare: (_a, v) => ({ ...v, valid_from: v.valid_from ?? nowUtc(), valid_until: v.valid_until ?? null, scope_id: v.scope_id ?? null }),
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      requireLive(db, 'user', next.user_id, 'User');
      requireLive(db, 'role', next.role_id, 'Role');
      if (next.scope_kind === 'fleet') {
        if (next.scope_id) throw invalid('A fleet-wide assignment has no scopeId');
      } else {
        if (!next.scope_id) throw invalid(`scopeId is required for ${String(next.scope_kind)} scope`);
        if (!cur && !resolveParty(db, { kind: next.scope_kind as 'command', id: next.scope_id as string })) throw missing(String(next.scope_kind), next.scope_id);
      }
      if (next.valid_until && (next.valid_until as string) <= (next.valid_from as string)) throw invalid('validUntil must be after validFrom');
    },
  },
  user_installation: {
    type: 'idn.user_installation', create: S.UserInstallationCreate, update: S.UserInstallationUpdate,
    unique: (v) => [{ user_id: v.user_id, installation_id: v.installation_id }],
    prepare: (_a, v) => ({ ...v, lease_expires_at: v.lease_expires_at ?? null }),
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      requireLive(db, 'user', next.user_id, 'User');
      if (!cur && !exists(db, 'SELECT 1 FROM sys_installation WHERE id = ? AND deleted_at IS NULL', next.installation_id)) throw missing('Installation', next.installation_id);
    },
  },
  offline_grant: {
    type: 'idn.offline_grant', create: S.OfflineGrantCreate, update: S.OfflineGrantUpdate,
    prepare: (_a, v) => ({ ...v, installation_id: v.installation_id ?? null, role_id: v.role_id ?? null }),
    validate: (a, next, cur) => {
      const db = a.wctx.db;
      if (cur) return;
      if (next.installation_id && !exists(db, 'SELECT 1 FROM sys_installation WHERE id = ? AND deleted_at IS NULL', next.installation_id)) throw missing('Installation', next.installation_id);
      if (next.role_id) requireLive(db, 'role', next.role_id, 'Role');
    },
  },
  gate_policy: {
    type: 'idn.gate_policy', create: S.GatePolicyCreate, update: S.GatePolicyUpdate,
    unique: (v) => [{ gate_code: v.gate_code }],
  },
};

function assertUnique(db: Db, r: Resource, next: Values, selfId?: string): void {
  for (const set of DEFS[r].unique?.(next) ?? []) {
    const cols = Object.keys(set);
    const hit = db.prepare(`SELECT id FROM ${TABLES[r]} WHERE deleted_at IS NULL AND ${cols.map((c) => `${c} IS ?`).join(' AND ')}${selfId ? ' AND id <> ?' : ''} LIMIT 1`).get(...cols.map((c) => set[c] ?? null), ...(selfId ? [selfId] : [])) as { id: string } | undefined;
    if (hit) throw new AppError('DUPLICATE', `${DEFS[r].type} with the same ${cols.join(' / ')} already exists`, { fields: cols, existingId: hit.id });
  }
}

const appendRevocation = (a: Actor, v: { userId: string; roleAssignmentId?: string | null; kind: 'revoke' | 'reinstate'; effectiveAt: string; reason: string }): Row =>
  appendEvent(a.wctx, 'idn.authority_revocation', {
    user_id: v.userId, role_assignment_id: v.roleAssignmentId ?? null, kind: v.kind, effective_at: v.effectiveAt, issued_at: nowUtc(), reason: v.reason,
  });

// ------------------------------------------------------------------ commands

export function createResource(a: Actor, r: Resource, input: unknown): Row {
  const def = DEFS[r];
  const parsed = snake(S.parse(def.create, input) as Values);
  authorize(a, perm(r, 'create'));
  assertHub(a, def.type);
  const db = a.wctx.db;
  return guard(() =>
    db.transaction(() => {
      const next = def.prepare ? def.prepare(a, parsed) : parsed;
      def.validate?.(a, next, null);
      assertUnique(db, r, next);
      return toApi(reload(db, r, createRecord(a.wctx, def.type, next).id));
    })(),
  );
}

export function updateResource(a: Actor, ctx: AppContext, r: Resource, id: string, input: unknown): Row {
  const def = DEFS[r];
  if (!def.update) throw new AppError('NOT_FOUND', `${def.type} cannot be edited; remove and recreate it`);
  const { expectedVersion, ...rest } = S.parse(def.update, input) as Values & { expectedVersion: number };
  const db = a.wctx.db;
  const cur = getLive(db, r, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(r, 'update'));
  assertHub(a, def.type);
  if (cur.version !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
  const patch = snake(rest);
  return toApi(
    guard(() =>
      db.transaction(() => {
        const next = { ...cur, ...patch };
        def.validate?.(a, next, cur);
        assertUnique(db, r, next, id);
        updateRecord(a.wctx, def.type, id, expectedVersion, patch);
        if (r === 'user' && patch.status && patch.status !== cur.status) {
          // Deactivation withdraws authority from now on; reactivation restores it. Both are events, so late arrivals sort by effective time.
          const inactive = patch.status === 'inactive';
          appendRevocation(a, { userId: id, kind: inactive ? 'revoke' : 'reinstate', effectiveAt: nowUtc(), reason: inactive ? 'User deactivated' : 'User reactivated' });
          if (inactive) revokeUserSessions(ctx, id);
        }
        return reload(db, r, id);
      })(),
    ),
  );
}

export function tombstoneResource(a: Actor, r: Resource, id: string, input: unknown): Row {
  const def = DEFS[r];
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, r, id);
  if (!cur) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
  authorize(a, perm(r, 'remove'));
  assertHub(a, def.type);
  if (cur.version !== expectedVersion) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
  return toApi(
    db.transaction(() => {
      def.beforeTombstone?.(a, cur);
      tombstoneRecord(a.wctx, def.type, id, expectedVersion, reason);
      return reload(db, r, id);
    })(),
  );
}

/** Replace a role's permission set in one transaction (adds and tombstones only the difference). */
export function setRolePermissions(a: Actor, roleId: string, input: unknown): { permissions: string[] } {
  const { permissions } = S.parse(S.RolePermissionSet, input);
  authorize(a, perm('role_permission', 'update'));
  assertHub(a, 'idn.role_permission');
  const db = a.wctx.db;
  const want = new Set(permissions);
  for (const p of want) if (!isValidRolePermission(p)) throw invalid(`Not a valid permission: ${p}`, { permission: p });
  return db.transaction(() => {
    requireLive(db, 'role', roleId, 'Role');
    const have = db.prepare('SELECT id, version, permission FROM idn_role_permission WHERE role_id = ? AND deleted_at IS NULL').all(roleId) as Array<{ id: string; version: number; permission: string }>;
    for (const h of have) if (!want.has(h.permission)) tombstoneRecord({ ...a.wctx, reason: 'Role permissions replaced' }, 'idn.role_permission', h.id, h.version, 'Role permissions replaced');
    const kept = new Set(have.map((h) => h.permission));
    for (const p of want) if (!kept.has(p)) createRecord(a.wctx, 'idn.role_permission', { role_id: roleId, permission: p });
    return { permissions: [...want].sort() };
  })();
}

/** Withdraw (or restore) authority. Allowed at any installation: a ship's administrator must be able to act without the hub. */
export function createRevocation(a: Actor, ctx: AppContext, input: unknown): Row {
  const b = S.parse(S.RevocationCreate, input);
  authorize(a, perm('revocation', 'create'));
  const db = a.wctx.db;
  if (!exists(db, 'SELECT 1 FROM idn_user WHERE id = ?', b.userId)) throw missing('User', b.userId);
  if (b.roleAssignmentId) {
    const ra = db.prepare('SELECT user_id FROM idn_role_assignment WHERE id = ?').get(b.roleAssignmentId) as { user_id: string } | undefined;
    if (!ra) throw missing('Role assignment', b.roleAssignmentId);
    if (ra.user_id !== b.userId) throw invalid('That assignment belongs to a different user');
  }
  const now = nowUtc();
  const kind = b.kind ?? 'revoke';
  const effectiveAt = b.effectiveAt ?? now;
  const row = db.transaction(() => {
    const ev = appendRevocation(a, { userId: b.userId, roleAssignmentId: b.roleAssignmentId ?? null, kind, effectiveAt, reason: b.reason });
    writeAudit({ ...a.wctx, reason: b.reason }, { action: `authority.${kind}`, entityType: 'idn.user', entityId: b.userId });
    return ev;
  })();
  if (kind === 'revoke' && effectiveAt <= now) revokeUserSessions(ctx, b.userId);
  ctx.events.publish({ type: 'idn.authority.changed', occurredAt: effectiveAt, payload: { userId: b.userId, roleAssignmentId: b.roleAssignmentId ?? null, kind } });
  return toApi(row);
}
