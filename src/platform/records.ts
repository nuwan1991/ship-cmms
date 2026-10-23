/**
 * The ONLY sanctioned write path for synchronized tables. In one transaction it:
 *   1. enforces who may write (record class + owner installation),
 *   2. enforces optimistic concurrency (expectedVersion),
 *   3. writes the row with version/timestamps/actor,
 *   4. appends the audit envelope,
 *   5. appends the change-log entry that synchronization ships.
 * Modules call this from their command services AFTER authorization and workflow checks.
 * Synced rows are never deleted: tombstoneRecord sets deleted_at.
 */
import type { Db } from './db/open.js';
import { STANDARD_EVENT_COLUMNS, STANDARD_SYNC_COLUMNS } from './db/migrate.js';
import type { ActorSnapshot } from './contracts.js';
import type { EntityDef, EntityRegistry } from './entity-registry.js';
import type { LocalIdentity } from './identity.js';
import { AppError } from './errors.js';
import { isUuid, uuidv7 } from './ids.js';
import { payloadHash } from './canonical.js';
import { nowUtc } from './time.js';

export type Row = Record<string, unknown>;

export interface WriteContext {
  db: Db;
  registry: EntityRegistry;
  installation: LocalIdentity;
  actor: { userId: string; snapshot?: ActorSnapshot | null };
  correlationId: string;
  reason?: string;
  /** Role assignment / offline grant that allowed this action (from Authorizer). */
  authorityBasis?: Record<string, unknown>;
  /** Actual time the action occurred if it is being entered later (UTC). Defaults to now. */
  occurredAt?: string;
}

const COL_RE = /^[a-z][a-z0-9_]*$/;
const columnCache = new WeakMap<Db, Map<string, Set<string>>>();

function columnsOf(db: Db, table: string): Set<string> {
  let m = columnCache.get(db);
  if (!m) columnCache.set(db, (m = new Map()));
  let c = m.get(table);
  if (!c) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.length === 0) throw new Error(`Table ${table} does not exist`);
    m.set(table, (c = new Set(rows.map((r) => r.name))));
  }
  return c;
}

function bindable(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

function checkColumns(db: Db, def: EntityDef, keys: string[], reserved: readonly string[]): void {
  const known = columnsOf(db, def.table);
  for (const k of keys) {
    if (!COL_RE.test(k) || !known.has(k)) throw new AppError('VALIDATION_FAILED', `Unknown column ${k} on ${def.type}`);
    if (reserved.includes(k)) throw new AppError('VALIDATION_FAILED', `Column ${k} is managed by the platform`);
  }
}

/** Audit rows replicate to every installation, so secret columns are masked there (never in the sync payload). */
const audited = (def: EntityDef, k: string, v: unknown): unknown => (def.redact?.includes(k) ? '[redacted]' : v);

function schemaVersion(db: Db, module: string): number {
  const r = db.prepare("SELECT MAX(CAST(substr(id, 1, 4) AS INTEGER)) AS v FROM sys_schema_migration WHERE module = ?").get(module) as { v: number | null };
  return r.v ?? 0;
}

function getRow(db: Db, def: EntityDef, id: string): Row | undefined {
  return db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(id) as Row | undefined;
}

function assertWritable(ctx: WriteContext, def: EntityDef, existingOwner?: string): void {
  if (def.recordClass === 'hub_reference') {
    if (ctx.installation.kind !== 'hub') {
      throw new AppError('NOT_OWNER', `${def.type} is hub-owned reference data; it can only be changed at the hub`, { entityType: def.type });
    }
    return;
  }
  if (def.recordClass === 'owner_mutable') {
    if (existingOwner !== undefined && existingOwner !== ctx.installation.installationId) {
      throw new AppError('NOT_OWNER', `Record is owned by another installation; request a handover or submit through its owner`, {
        entityType: def.type,
        ownerInstallationId: existingOwner,
      });
    }
    return;
  }
  throw new Error(`${def.type} (${def.recordClass}) cannot be written through createRecord/updateRecord`);
}

function logChange(ctx: WriteContext, def: EntityDef, row: Row, op: 'upsert' | 'tombstone' | 'event', at: string): void {
  ctx.db
    .prepare(
      `INSERT INTO sys_change_log (change_id, origin_installation_id, entity_type, entity_id, op, version, owner_installation_id,
         home_scope_id, occurred_at, schema_version, payload, payload_hash, logged_at, received_from_installation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      uuidv7(), ctx.installation.installationId, def.type, row.id, op, (row.version as number | undefined) ?? 1,
      row.owner_installation_id, row.home_scope_id ?? null, at, schemaVersion(ctx.db, def.module),
      JSON.stringify(row), payloadHash(row), at,
    );
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityVersion?: number | null;
  changes?: Record<string, [unknown, unknown]> | null;
  outcome?: 'success' | 'denied' | 'failed';
}

/** Append an audit envelope (also usable directly for denials, logins, approvals). */
export function writeAudit(ctx: WriteContext, a: AuditInput): string {
  const def = ctx.registry.get('sys.audit_event');
  const now = nowUtc();
  const row: Row = {
    id: uuidv7(),
    owner_installation_id: ctx.installation.installationId,
    home_scope_id: null,
    occurred_at: ctx.occurredAt ?? now,
    recorded_at: now,
    recorded_by: ctx.actor.userId,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId ?? null,
    entity_version: a.entityVersion ?? null,
    actor_user_id: ctx.actor.userId,
    actor_snapshot: ctx.actor.snapshot ? JSON.stringify(ctx.actor.snapshot) : null,
    correlation_id: ctx.correlationId,
    reason: ctx.reason ?? null,
    authority_basis: ctx.authorityBasis ? JSON.stringify(ctx.authorityBasis) : null,
    changes: a.changes ? JSON.stringify(a.changes) : null,
    outcome: a.outcome ?? 'success',
  };
  const cols = Object.keys(row);
  ctx.db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
  logChange(ctx, def, row, 'event', now);
  return row.id as string;
}

export function createRecord(ctx: WriteContext, entityType: string, values: Row): Row {
  const def = ctx.registry.get(entityType);
  assertWritable(ctx, def);
  const keys = Object.keys(values).filter((k) => k !== 'id' && k !== 'home_scope_id');
  checkColumns(ctx.db, def, keys, STANDARD_SYNC_COLUMNS);
  if (values.id !== undefined && !isUuid(values.id)) throw new AppError('VALIDATION_FAILED', 'id must be a UUID');

  return ctx.db.transaction(() => {
    const now = nowUtc();
    const row: Row = {
      id: values.id ?? uuidv7(),
      version: 1,
      owner_installation_id: ctx.installation.installationId,
      home_scope_id: values.home_scope_id ?? null,
      created_at: now, created_by: ctx.actor.userId, created_installation_id: ctx.installation.installationId,
      updated_at: now, updated_by: ctx.actor.userId, deleted_at: null, deleted_by: null,
      ...Object.fromEntries(keys.map((k) => [k, bindable(values[k])])),
    };
    const cols = Object.keys(row);
    ctx.db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => bindable(row[c])));
    writeAudit(ctx, {
      action: 'create', entityType: def.type, entityId: row.id as string, entityVersion: 1,
      changes: Object.fromEntries(keys.map((k) => [k, [null, audited(def, k, row[k])] as [unknown, unknown]])),
    });
    logChange(ctx, def, row, 'upsert', now);
    return row;
  })();
}

export function updateRecord(ctx: WriteContext, entityType: string, id: string, expectedVersion: number, patch: Row): Row {
  const def = ctx.registry.get(entityType);
  const keys = Object.keys(patch);
  checkColumns(ctx.db, def, keys, [...STANDARD_SYNC_COLUMNS]);
  return ctx.db.transaction(() => {
    const cur = getRow(ctx.db, def, id);
    if (!cur || cur.deleted_at) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
    assertWritable(ctx, def, cur.owner_installation_id as string);
    if (cur.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
    }
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of keys) if (cur[k] !== bindable(patch[k])) changes[k] = [audited(def, k, cur[k]), audited(def, k, bindable(patch[k]))];
    if (Object.keys(changes).length === 0) return cur;
    const now = nowUtc();
    const next: Row = { ...cur, ...Object.fromEntries(Object.keys(changes).map((k) => [k, bindable(patch[k])])), version: expectedVersion + 1, updated_at: now, updated_by: ctx.actor.userId };
    const set = [...Object.keys(changes), 'version', 'updated_at', 'updated_by'];
    ctx.db.prepare(`UPDATE ${def.table} SET ${set.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...set.map((c) => next[c]), id);
    writeAudit(ctx, { action: 'update', entityType: def.type, entityId: id, entityVersion: next.version as number, changes });
    logChange(ctx, def, next, 'upsert', now);
    return next;
  })();
}

export function tombstoneRecord(ctx: WriteContext, entityType: string, id: string, expectedVersion: number, reason: string): Row {
  if (!reason.trim()) throw new AppError('VALIDATION_FAILED', 'A reason is required to remove a record');
  const def = ctx.registry.get(entityType);
  return ctx.db.transaction(() => {
    const cur = getRow(ctx.db, def, id);
    if (!cur || cur.deleted_at) throw new AppError('NOT_FOUND', `${def.type} ${id} not found`);
    assertWritable(ctx, def, cur.owner_installation_id as string);
    if (cur.version !== expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion });
    }
    const now = nowUtc();
    const next: Row = { ...cur, deleted_at: now, deleted_by: ctx.actor.userId, version: expectedVersion + 1, updated_at: now, updated_by: ctx.actor.userId };
    ctx.db.prepare(`UPDATE ${def.table} SET deleted_at = ?, deleted_by = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
      .run(now, ctx.actor.userId, next.version, now, ctx.actor.userId, id);
    writeAudit({ ...ctx, reason }, { action: 'tombstone', entityType: def.type, entityId: id, entityVersion: next.version as number });
    logChange(ctx, def, next, 'tombstone', now);
    return next;
  })();
}

/** Append-only events (stock transactions, readings, approvals, custody moves). Corrections are new events. */
export function appendEvent(ctx: WriteContext, entityType: string, values: Row): Row {
  const def = ctx.registry.get(entityType);
  if (def.recordClass !== 'event') throw new Error(`${def.type} is not an event entity`);
  const keys = Object.keys(values).filter((k) => k !== 'id' && k !== 'home_scope_id' && k !== 'occurred_at');
  checkColumns(ctx.db, def, keys, STANDARD_EVENT_COLUMNS);
  return ctx.db.transaction(() => {
    const now = nowUtc();
    const row: Row = {
      id: values.id ?? uuidv7(),
      owner_installation_id: ctx.installation.installationId,
      home_scope_id: values.home_scope_id ?? null,
      occurred_at: (values.occurred_at as string | undefined) ?? ctx.occurredAt ?? now,
      recorded_at: now,
      recorded_by: ctx.actor.userId,
      ...Object.fromEntries(keys.map((k) => [k, bindable(values[k])])),
    };
    const cols = Object.keys(row);
    ctx.db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => bindable(row[c])));
    logChange(ctx, def, row, 'event', now);
    return row;
  })();
}

/** Startup/test check: every registered synced table carries the standard columns and guard triggers. */
export function verifySyncedTables(db: Db, registry: EntityRegistry): string[] {
  const problems: string[] = [];
  const triggers = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>).map((r) => r.name));
  for (const d of registry.all()) {
    if (d.recordClass === 'derived' || d.recordClass === 'local') continue;
    let cols: Set<string>;
    try {
      cols = columnsOf(db, d.table);
    } catch {
      problems.push(`${d.type}: table ${d.table} missing`);
      continue;
    }
    const need = d.recordClass === 'event' ? STANDARD_EVENT_COLUMNS : STANDARD_SYNC_COLUMNS;
    for (const c of need) if (!cols.has(c)) problems.push(`${d.type}: missing column ${c}`);
    if (!triggers.has(`${d.table}_no_delete`)) problems.push(`${d.type}: missing ${d.table}_no_delete trigger`);
    if (d.recordClass === 'event' && !triggers.has(`${d.table}_no_update`)) problems.push(`${d.type}: missing ${d.table}_no_update trigger`);
  }
  return problems;
}
