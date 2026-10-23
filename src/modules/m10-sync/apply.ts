/**
 * Applying one received change under the record-class rules of SYNC_RULES §2.
 * Never throws for data reasons: the outcome says applied / duplicate / rejected / quarantined.
 */
import type { AppContext } from '../../platform/app-context.js';
import { payloadHash } from '../../platform/canonical.js';
import { SyncChange } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { uuidv7 } from '../../platform/ids.js';
import { nowUtc } from '../../platform/time.js';

export type Outcome =
  | { status: 'applied' }
  | { status: 'duplicate' }
  | { status: 'rejected'; code: string; message: string }
  | { status: 'quarantined'; code: string; message: string };

export interface Source { installationId: string; isHub: boolean }
type Row = Record<string, unknown>;

const columnCache = new WeakMap<Db, Map<string, Set<string>>>();
function columnsOf(db: Db, table: string): Set<string> {
  let m = columnCache.get(db);
  if (!m) columnCache.set(db, (m = new Map()));
  let c = m.get(table);
  if (!c) m.set(table, (c = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name))));
  return c;
}

export function localSchemaVersion(db: Db, module: string): number {
  const r = db.prepare('SELECT MAX(CAST(substr(id, 1, 4) AS INTEGER)) AS v FROM sys_schema_migration WHERE module = ?').get(module) as { v: number | null };
  return r.v ?? 0;
}

const param = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);

function quarantine(db: Db, c: SyncChange, source: Source, code: string, detail: string, localVersion: number | null, status: 'open' | 'resolved' = 'open'): void {
  db.prepare(
    `INSERT OR IGNORE INTO syn_conflict (id, change_id, code, detail, entity_type, entity_id, incoming_version, local_version, origin_installation_id,
       received_from_installation_id, change_json, status, detected_at, resolved_at, resolved_by, resolution)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(uuidv7(), c.changeId, code, detail, c.entityType, c.entityId, c.version, localVersion, c.originInstallationId, source.installationId, JSON.stringify(c), status, nowUtc(),
    status === 'resolved' ? nowUtc() : null, status === 'resolved' ? 'system' : null, status === 'resolved' ? 'Hub data wins' : null);
}

function logReceived(db: Db, c: SyncChange, source: Source): void {
  db.prepare(
    `INSERT INTO sys_change_log (change_id, origin_installation_id, entity_type, entity_id, op, version, owner_installation_id, home_scope_id, occurred_at,
       schema_version, payload, payload_hash, logged_at, received_from_installation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(c.changeId, c.originInstallationId, c.entityType, c.entityId, c.op, c.version, c.ownerInstallationId, c.homeScopeId, c.occurredAt, c.schemaVersion,
    JSON.stringify(c.payload), c.payloadHash, nowUtc(), source.installationId);
}

function writeRow(db: Db, table: string, payload: Row, exists: boolean): void {
  const known = columnsOf(db, table);
  const cols = Object.keys(payload).filter((k) => known.has(k));
  if (exists) {
    const set = cols.filter((k) => k !== 'id');
    db.prepare(`UPDATE ${table} SET ${set.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...set.map((k) => param(payload[k])), payload.id);
  } else {
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => param(payload[k])));
  }
}

export function applyChange(ctx: AppContext, raw: unknown, source: Source): Outcome {
  const parsed = SyncChange.safeParse(raw);
  if (!parsed.success) return { status: 'rejected', code: 'VALIDATION_FAILED', message: parsed.error.issues[0]?.message ?? 'Malformed change' };
  const c = parsed.data;
  const db = ctx.db;
  if (db.prepare('SELECT 1 FROM sys_change_log WHERE change_id = ?').get(c.changeId)) return { status: 'duplicate' };
  if (payloadHash(c.payload) !== c.payloadHash) return { status: 'rejected', code: 'INTEGRITY', message: 'Payload hash does not match the payload' };
  if (c.payload.id !== c.entityId) return { status: 'rejected', code: 'VALIDATION_FAILED', message: 'Payload id does not match entityId' };

  if (!ctx.entities.has(c.entityType)) {
    quarantine(db, c, source, 'UNKNOWN_ENTITY', `This installation does not know ${c.entityType}; upgrade it`, null);
    return { status: 'quarantined', code: 'UNKNOWN_ENTITY', message: `Unknown entity ${c.entityType}` };
  }
  const def = ctx.entities.get(c.entityType);
  const localSv = localSchemaVersion(db, def.module);
  if (c.schemaVersion > localSv) {
    quarantine(db, c, source, 'SCHEMA_NEWER', `Change was written by schema ${c.schemaVersion}; this installation has ${localSv}. Upgrade, then retry`, null);
    return { status: 'quarantined', code: 'SCHEMA_NEWER', message: 'Sender schema is newer' };
  }
  if (localSv - c.schemaVersion > 1) return { status: 'rejected', code: 'SCHEMA_OLD', message: `Sender schema ${c.schemaVersion} is more than one step behind ${localSv}` };

  // Who may have written this.
  if (def.recordClass === 'hub_reference') {
    if (!source.isHub) return { status: 'rejected', code: 'NOT_OWNER', message: `${c.entityType} is hub-owned reference data` };
  } else {
    if (c.ownerInstallationId !== c.originInstallationId) return { status: 'rejected', code: 'NOT_OWNER', message: 'Origin is not the record owner' };
    if (!source.isHub && c.originInstallationId !== source.installationId) return { status: 'rejected', code: 'NOT_OWNER', message: 'A replica may only send its own records' };
  }
  if ((def.recordClass === 'event') !== (c.op === 'event')) return { status: 'rejected', code: 'VALIDATION_FAILED', message: `Operation ${c.op} does not fit ${def.recordClass}` };

  try {
    return db.transaction((): Outcome => {
      const local = db.prepare(`SELECT * FROM ${def.table} WHERE id = ?`).get(c.entityId) as Row | undefined;
      if (def.recordClass === 'event') {
        if (local) {
          if (payloadHash(local) === c.payloadHash) return { status: 'duplicate' };
          quarantine(db, c, source, 'INTEGRITY', 'Same event id with different content', null);
          return { status: 'quarantined', code: 'INTEGRITY', message: 'Event id reused with different content' };
        }
        writeRow(db, def.table, c.payload, false);
      } else if (!local) {
        writeRow(db, def.table, c.payload, false);
      } else {
        const lv = local.version as number;
        if (lv < c.version) writeRow(db, def.table, c.payload, true);
        else if (lv === c.version && payloadHash(local) === c.payloadHash) return { status: 'duplicate' };
        else if (lv > c.version) return { status: 'duplicate' }; // an older state arriving late; the newer one is already here
        else if (def.recordClass === 'hub_reference') {
          quarantine(db, c, source, 'HUB_OVERWRITE', 'A local copy differed from the hub at the same version; the hub copy replaced it', lv, 'resolved');
          writeRow(db, def.table, c.payload, true);
        } else {
          quarantine(db, c, source, 'FORK', 'Two different records claim the same version; the owner decides which stands', lv);
          return { status: 'quarantined', code: 'FORK', message: 'Version fork' };
        }
      }
      logReceived(db, c, source);
      return { status: 'applied' };
    })();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    quarantine(db, c, source, 'APPLY_FAILED', msg, null);
    return { status: 'quarantined', code: 'APPLY_FAILED', message: msg };
  }
}
