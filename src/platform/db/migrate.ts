import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Db } from './open.js';
import { MODULES, topoOrder, type ModuleManifest } from '../modules.js';
import { nowUtc } from '../time.js';

/**
 * Forward-only migrations (no down scripts): offline installations upgrade in place,
 * and every upgrade is preceded by a backup (M14). Files: `NNNN_name.sql`.
 * Platform migrations run first, then modules in dependency order.
 * An applied migration whose file later changes is a hard error (checksum).
 */
export interface MigrationFile {
  module: string; // 'platform' | ModuleId
  id: string; // NNNN_name
  sql: string;
  checksum: string;
}

const SYNC_COLUMNS = `id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  owner_installation_id TEXT NOT NULL,
  home_scope_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_installation_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,`;

const EVENT_COLUMNS = `id TEXT PRIMARY KEY NOT NULL,
  owner_installation_id TEXT NOT NULL,
  home_scope_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,`;

export const STANDARD_SYNC_COLUMNS = ['id', 'version', 'owner_installation_id', 'home_scope_id', 'created_at', 'created_by', 'created_installation_id', 'updated_at', 'updated_by', 'deleted_at', 'deleted_by'];
export const STANDARD_EVENT_COLUMNS = ['id', 'owner_installation_id', 'home_scope_id', 'occurred_at', 'recorded_at', 'recorded_by'];

/**
 * SQL macros so module authors cannot forget the sync contract:
 *   {{SYNC_COLUMNS}}            first lines inside CREATE TABLE for owner_mutable / hub_reference tables
 *   {{EVENT_COLUMNS}}           first lines inside CREATE TABLE for append-only event tables
 *   {{TRIGGERS_MUTABLE tbl}}    blocks DELETE (records are tombstoned, never deleted)
 *   {{TRIGGERS_EVENT tbl}}      blocks UPDATE and DELETE (append-only)
 */
export function expandMacros(sql: string): string {
  return sql
    .replaceAll('{{SYNC_COLUMNS}}', SYNC_COLUMNS)
    .replaceAll('{{EVENT_COLUMNS}}', EVENT_COLUMNS)
    .replace(/\{\{TRIGGERS_MUTABLE (\w+)\}\}/g, (_m, t: string) =>
      `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'synced records are tombstoned, never deleted'); END;`)
    .replace(/\{\{TRIGGERS_EVENT (\w+)\}\}/g, (_m, t: string) =>
      `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;\n` +
      `CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'append-only table'); END;`);
}

const srcRoot = (): string => fileURLToPath(new URL('../../', import.meta.url));

function readDir(module: string, dir: string): MigrationFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = readFileSync(join(dir, f), 'utf8');
      return { module, id: f.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

export function discoverMigrations(root: string = srcRoot(), mods: readonly ModuleManifest[] = MODULES): MigrationFile[] {
  const out = readDir('platform', join(root, 'platform', 'db', 'migrations'));
  for (const m of topoOrder(mods)) out.push(...readDir(m.id, join(root, 'modules', m.dir, 'migrations')));
  return out;
}

export function applyMigrations(db: Db, migrations: readonly MigrationFile[]): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS sys_schema_migration (
    module TEXT NOT NULL, id TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL,
    PRIMARY KEY (module, id))`);
  const applied: string[] = [];
  const get = db.prepare('SELECT checksum FROM sys_schema_migration WHERE module = ? AND id = ?');
  const put = db.prepare('INSERT INTO sys_schema_migration (module, id, checksum, applied_at) VALUES (?, ?, ?, ?)');
  for (const m of migrations) {
    const row = get.get(m.module, m.id) as { checksum: string } | undefined;
    if (row) {
      if (row.checksum !== m.checksum) throw new Error(`Migration ${m.module}/${m.id} was modified after being applied`);
      continue;
    }
    db.transaction(() => {
      db.exec(expandMacros(m.sql));
      put.run(m.module, m.id, m.checksum, nowUtc());
    })();
    applied.push(`${m.module}/${m.id}`);
  }
  return applied;
}

/** Highest applied migration number per module; exchanged during sync handshake (SYNC_RULES.md §5). */
export function schemaVersions(db: Db): Record<string, number> {
  const rows = db.prepare('SELECT module, id FROM sys_schema_migration').all() as Array<{ module: string; id: string }>;
  const out: Record<string, number> = {};
  for (const r of rows) out[r.module] = Math.max(out[r.module] ?? 0, Number(r.id.slice(0, 4)));
  return out;
}
