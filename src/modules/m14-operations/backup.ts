/**
 * Backup, verify, prune and restore of this installation's single database file.
 * A backup is a consistent point-in-time copy made while the application keeps running (VACUUM INTO), with a manifest and a SHA-256.
 * It holds everything including the signing key and password hashes, so the files are created readable by the owner only and must be kept as carefully as the machine itself.
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '../../platform/app-context.js';
import { applyMigrations, discoverMigrations, schemaVersions } from '../../platform/db/migrate.js';
import type { Db } from '../../platform/db/open.js';
import { openDatabase } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { nowUtc } from '../../platform/time.js';

export type Reason = 'manual' | 'scheduled' | 'pre_upgrade' | 'pre_restore';
export interface Manifest {
  format: 1; fileName: string; sha256: string; bytes: number; reason: Reason; createdAt: string; createdBy: string;
  installationId: string | null; installationCode: string | null; installationKind: string | null; schemaVersions: Record<string, number>;
}
type Row = Record<string, unknown>;

export const backupDirOf = (dataDir: string): string => join(dataDir || join(tmpdir(), 'cmms-backups'), 'backups');
const stamp = (iso: string): string => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

export function sha256File(path: string): string {
  const h = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let pos = 0; ; ) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      pos += n;
    }
  } finally { closeSync(fd); }
  return h.digest('hex');
}

/** Write a consistent copy of `db` into `dir` and its manifest next to it. Does not touch ops tables (they may not exist yet during an upgrade). */
export function writeBackupFile(db: Db, dir: string, reason: Reason, userId: string): Manifest {
  mkdirSync(dir, { recursive: true });
  const id = getLocalIdentity(db);
  const createdAt = nowUtc();
  const fileName = `cmms-${id?.code ?? 'new'}-${stamp(createdAt)}-${reason}.sqlite`;
  const path = join(dir, fileName);
  if (existsSync(path)) throw new AppError('DUPLICATE', 'A backup with this name already exists; wait a second and retry');
  db.prepare('VACUUM INTO ?').run(path);
  chmodSync(path, 0o600);
  const fd = openSync(path, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
  const manifest: Manifest = {
    format: 1, fileName, sha256: sha256File(path), bytes: statSync(path).size, reason, createdAt, createdBy: userId,
    installationId: id?.installationId ?? null, installationCode: id?.code ?? null, installationKind: id?.kind ?? null, schemaVersions: schemaVersions(db),
  };
  writeFileSync(`${path}.json`, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
}

const hasOpsTables = (db: Db): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ops_backup_log'").get();

export function logBackup(db: Db, m: Manifest): string {
  const id = uuidv7();
  db.prepare('INSERT INTO ops_backup_log (id, file_name, bytes, sha256, reason, schema_versions, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, m.fileName, m.bytes, m.sha256, m.reason, JSON.stringify(m.schemaVersions), m.createdAt, m.createdBy);
  return id;
}

export function createBackup(ctx: AppContext, reason: Reason, userId: string): Manifest {
  if (ctx.config.dbFile === ':memory:' && !ctx.config.dataDir) throw new AppError('WORKFLOW_BLOCKED', 'An in-memory database cannot be backed up');
  const m = writeBackupFile(ctx.db, backupDirOf(ctx.config.dataDir), reason, userId);
  logBackup(ctx.db, m);
  return m;
}

export interface VerifyResult { ok: boolean; problems: string[]; manifest: Manifest | null }

/** Check a backup file without touching the live database: hash, manifest, SQLite integrity, identity and schema. */
export function verifyBackupFile(path: string): VerifyResult {
  const problems: string[] = [];
  let manifest: Manifest | null = null;
  if (!existsSync(path)) return { ok: false, problems: ['File not found'], manifest };
  if (existsSync(`${path}.json`)) {
    try { manifest = JSON.parse(readFileSync(`${path}.json`, 'utf8')) as Manifest; } catch { problems.push('Manifest is unreadable'); }
  } else problems.push('Manifest file is missing');
  if (manifest) {
    if (statSync(path).size !== manifest.bytes) problems.push('File size differs from the manifest');
    if (sha256File(path) !== manifest.sha256) problems.push('File content differs from the manifest (SHA-256 mismatch): the backup is damaged or was changed');
  }
  let db: Database.Database | null = null;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const ic = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (ic.length !== 1 || ic[0]!.integrity_check !== 'ok') problems.push(`SQLite integrity check failed: ${ic.slice(0, 3).map((r) => r.integrity_check).join('; ')}`);
    const ident = db.prepare('SELECT installation_id FROM sys_local_identity WHERE singleton = 1').get() as { installation_id: string } | undefined;
    if (manifest && (ident?.installation_id ?? null) !== manifest.installationId) problems.push('Installation in the file differs from the manifest');
    const known = new Set(discoverMigrations().map((m) => `${m.module}/${m.id}`));
    const unknown = (db.prepare('SELECT module, id FROM sys_schema_migration').all() as Array<{ module: string; id: string }>).filter((r) => !known.has(`${r.module}/${r.id}`));
    if (unknown.length) problems.push(`The backup was made by a newer version of the application (${unknown.length} unknown migration${unknown.length === 1 ? '' : 's'}); install that version first`);
  } catch (e) {
    problems.push(`Cannot open as a database: ${e instanceof Error ? e.message : String(e)}`);
  } finally { db?.close(); }
  return { ok: problems.length === 0, problems, manifest };
}

export function verifyBackupById(ctx: AppContext, id: string): VerifyResult {
  const row = ctx.db.prepare('SELECT * FROM ops_backup_log WHERE id = ?').get(id) as Row | undefined;
  if (!row || row.removed_at) throw new AppError('NOT_FOUND', 'No such backup');
  const r = verifyBackupFile(join(backupDirOf(ctx.config.dataDir), String(row.file_name)));
  ctx.db.prepare('UPDATE ops_backup_log SET verified_at = ?, verify_ok = ?, verify_detail = ? WHERE id = ?').run(nowUtc(), r.ok ? 1 : 0, r.ok ? null : r.problems.join('; '), id);
  return r;
}

export function listBackups(db: Db): Row[] {
  return db.prepare('SELECT * FROM ops_backup_log WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 500').all() as Row[];
}

/** Keep the newest `keep` scheduled backups; manual, pre-upgrade and pre-restore backups are never removed automatically. */
export function pruneScheduled(ctx: AppContext, keep: number): number {
  const old = ctx.db.prepare("SELECT id, file_name FROM ops_backup_log WHERE reason = 'scheduled' AND removed_at IS NULL ORDER BY created_at DESC LIMIT -1 OFFSET ?").all(Math.max(1, keep)) as Array<{ id: string; file_name: string }>;
  for (const o of old) {
    const p = join(backupDirOf(ctx.config.dataDir), o.file_name);
    rmSync(p, { force: true }); rmSync(`${p}.json`, { force: true });
    ctx.db.prepare('UPDATE ops_backup_log SET removed_at = ? WHERE id = ?').run(nowUtc(), o.id);
  }
  return old.length;
}

/**
 * Apply pending migrations, first taking a backup when there is existing data to protect.
 * The backup file is named before the change; it is entered in the log afterwards (the log table may be one of the migrations).
 */
export function upgradeWithBackup(db: Db, dataDir: string, inMemory = false): { applied: string[]; backup: Manifest | null } {
  const files = discoverMigrations();
  const done = new Set<string>();
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sys_schema_migration'").get()) {
    for (const r of db.prepare('SELECT module, id FROM sys_schema_migration').all() as Array<{ module: string; id: string }>) done.add(`${r.module}/${r.id}`);
  }
  const pending = files.filter((f) => !done.has(`${f.module}/${f.id}`));
  let backup: Manifest | null = null;
  if (pending.length > 0 && done.size > 0 && !inMemory) backup = writeBackupFile(db, backupDirOf(dataDir), 'pre_upgrade', 'system');
  const applied = applyMigrations(db, files);
  if (backup && hasOpsTables(db)) logBackup(db, backup);
  return { applied, backup };
}

export interface RestoreOptions { dbFile: string; dataDir: string; backupFile: string; allowOtherInstallation?: boolean }
export interface RestoreResult { safetyBackup: string | null; restoredFrom: string; manifest: Manifest | null; applied: string[] }

/** Replace the database with a verified backup. The application must be stopped; the current database is kept as a pre-restore backup first. */
export function restoreBackup(o: RestoreOptions): RestoreResult {
  const v = verifyBackupFile(o.backupFile);
  if (!v.ok) throw new AppError('VALIDATION_FAILED', `The backup cannot be used: ${v.problems.join('; ')}`);
  let safety: string | null = null;
  if (existsSync(o.dbFile)) {
    const cur = openDatabase(o.dbFile);
    try {
      cur.pragma('busy_timeout = 0');
      cur.exec('BEGIN EXCLUSIVE'); // fails at once if the application is still running
      cur.exec('ROLLBACK');
      const ident = getLocalIdentity(cur);
      if (ident && v.manifest?.installationId && ident.installationId !== v.manifest.installationId && !o.allowOtherInstallation) {
        throw new AppError('WORKFLOW_BLOCKED', `This backup belongs to a different installation (${v.manifest.installationCode}). Restoring it here would give this machine that identity. Use --allow-other-installation only to replace failed hardware`);
      }
      safety = writeBackupFile(cur, backupDirOf(o.dataDir), 'pre_restore', 'system').fileName;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('WORKFLOW_BLOCKED', `The database is in use. Stop the application first (${e instanceof Error ? e.message : String(e)})`);
    } finally { cur.close(); }
  }
  const tmp = `${o.dbFile}.restoring`;
  mkdirSync(join(o.dbFile, '..'), { recursive: true });
  copyFileSync(o.backupFile, tmp);
  const fd = openSync(tmp, 'r+'); try { fsyncSync(fd); } finally { closeSync(fd); }
  rmSync(`${o.dbFile}-wal`, { force: true }); rmSync(`${o.dbFile}-shm`, { force: true });
  renameSync(tmp, o.dbFile);
  const db = openDatabase(o.dbFile);
  try {
    const applied = applyMigrations(db, discoverMigrations());
    db.prepare('INSERT INTO ops_restore_log (id, restored_from, restored_at, backup_created_at, source_installation_id, safety_backup, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuidv7(), o.backupFile, nowUtc(), v.manifest?.createdAt ?? null, v.manifest?.installationId ?? null, safety, o.allowOtherInstallation ? 'Restored onto different hardware' : null);
    return { safetyBackup: safety, restoredFrom: o.backupFile, manifest: v.manifest, applied };
  } finally { db.close(); }
}

/** Backup files found on disk (also those not in the log, such as after a restore). */
export function filesOnDisk(dataDir: string): string[] {
  const dir = backupDirOf(dataDir);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort() : [];
}
