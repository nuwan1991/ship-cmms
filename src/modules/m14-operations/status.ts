import { existsSync, statSync, statfsSync } from 'node:fs';
import type { AppContext } from '../../platform/app-context.js';
import { schemaVersions } from '../../platform/db/migrate.js';
import { discoverMigrations } from '../../platform/db/migrate.js';
import { toCamel } from '../../platform/canonical.js';
import { nowUtc } from '../../platform/time.js';
import { backupDirOf } from './backup.js';

type Row = Record<string, unknown>;
const startedAt = nowUtc();
const DAY = 86_400_000;
const camel = (r: Row | undefined): Row | null => (r ? Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v])) : null);

export interface Warning { code: string; message: string }

export function opsStatus(ctx: AppContext, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const db = ctx.db;
  const warnDays = Number(env.CMMS_BACKUP_WARN_DAYS ?? 7);
  const size = (p: string): number => (p !== ':memory:' && existsSync(p) ? statSync(p).size : 0);
  const lastBackup = db.prepare('SELECT * FROM ops_backup_log WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 1').get() as Row | undefined;
  const lastVerified = db.prepare('SELECT * FROM ops_backup_log WHERE removed_at IS NULL AND verified_at IS NOT NULL ORDER BY verified_at DESC LIMIT 1').get() as Row | undefined;
  const lastCheck = db.prepare('SELECT id, ran_at, ok, problem_count FROM ops_integrity_check ORDER BY ran_at DESC LIMIT 1').get() as Row | undefined;
  const lastRestore = db.prepare('SELECT restored_at, restored_from, safety_backup FROM ops_restore_log ORDER BY restored_at DESC LIMIT 1').get() as Row | undefined;
  const done = new Set((db.prepare('SELECT module, id FROM sys_schema_migration').all() as Array<{ module: string; id: string }>).map((r) => `${r.module}/${r.id}`));
  const pending = discoverMigrations().filter((m) => !done.has(`${m.module}/${m.id}`)).length;
  let freeBytes: number | null = null;
  try {
    const dir = ctx.config.dbFile === ':memory:' ? process.cwd() : ctx.config.dbFile;
    const s = statfsSync(dir);
    freeBytes = Number(s.bavail) * Number(s.bsize);
  } catch { /* not available on this platform */ }

  const warnings: Warning[] = [];
  if (ctx.config.dbFile !== ':memory:') {
    if (!lastBackup) warnings.push({ code: 'no_backup', message: 'No backup has been made yet.' });
    else if (Date.now() - Date.parse(String(lastBackup.created_at)) > warnDays * DAY) warnings.push({ code: 'backup_old', message: `The last backup is more than ${warnDays} days old.` });
    if (lastBackup && !lastVerified) warnings.push({ code: 'backup_unverified', message: 'No backup has ever been verified. Verify one to be sure it can be restored.' });
    if (lastVerified && lastVerified.verify_ok === 0) warnings.push({ code: 'backup_bad', message: 'The last verified backup is damaged.' });
  }
  if (lastCheck && lastCheck.ok === 0) warnings.push({ code: 'integrity', message: 'The last integrity check found errors.' });
  if (freeBytes !== null && freeBytes < 500_000_000) warnings.push({ code: 'disk_low', message: 'Less than 500 MB of disk space is free.' });
  if (pending > 0) warnings.push({ code: 'migrations_pending', message: `${pending} database change(s) are not applied.` });

  return {
    installation: ctx.identity, startedAt, serverTime: nowUtc(), node: process.version, platform: process.platform,
    mode: process.env.CMMS_RUN_MODE ?? (process.argv[1]?.includes('/dist/') || process.argv[1]?.includes('\\dist\\') ? 'compiled' : 'development'),
    database: { file: ctx.config.dbFile, bytes: size(ctx.config.dbFile), walBytes: size(`${ctx.config.dbFile}-wal`), freeDiskBytes: freeBytes, schemaVersions: schemaVersions(db), pendingMigrations: pending },
    backups: { directory: backupDirOf(ctx.config.dataDir), count: (db.prepare('SELECT COUNT(*) AS n FROM ops_backup_log WHERE removed_at IS NULL').get() as { n: number }).n, last: camel(lastBackup), lastVerified: camel(lastVerified) },
    integrity: camel(lastCheck), lastRestore: camel(lastRestore), warnings, ok: warnings.length === 0,
  };
}
