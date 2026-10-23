import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRecord } from '../../src/platform/records.js';
import { applyMigrations, discoverMigrations } from '../../src/platform/db/migrate.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { backupDirOf, createBackup, listBackups, opsStatus, pruneScheduled, restoreBackup, runIntegrity, upgradeWithBackup, verifyBackupById, verifyBackupFile, startBackupScheduler } from '../../src/modules/m14-operations/index.js';
import { codeOf } from './ast-helpers.js';
import { makeOpsEnv, openReadonly } from './ops-helpers.js';

const fleet = (e: ReturnType<typeof makeOpsEnv>, code = 'F1') => createRecord(e.wctx(), 'org.fleet', { code, name: `Fleet ${code}` });

describe('M14 backup and restore', () => {
  it('makes a consistent backup with a manifest, readable only by its owner, and logs it', () => {
    const e = makeOpsEnv();
    fleet(e);
    const m = createBackup(e.ctx, 'manual', 'tester');
    const path = join(backupDirOf(e.dir), m.fileName);
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.json`)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o077).toBe(0);
    const copy = openReadonly(path);
    expect((copy.prepare('SELECT COUNT(*) AS n FROM org_fleet').get() as { n: number }).n).toBe(1);
    copy.close();
    expect(m.installationCode).toBe('HQ');
    expect(listBackups(e.db)).toHaveLength(1);
    expect(verifyBackupById(e.ctx, listBackups(e.db)[0]!.id as string).ok).toBe(true);
    expect(e.db.prepare('SELECT verify_ok FROM ops_backup_log').get()).toEqual({ verify_ok: 1 });
  });

  it('detects a damaged, altered or missing-manifest backup, and one from a newer application', () => {
    const e = makeOpsEnv();
    const m = createBackup(e.ctx, 'manual', 'tester');
    const path = join(backupDirOf(e.dir), m.fileName);
    // Altered content.
    const bad = join(e.dir, 'altered.sqlite');
    copyFileSync(path, bad); copyFileSync(`${path}.json`, `${bad}.json`);
    const bytes = readFileSync(bad); bytes[bytes.length - 100] = bytes[bytes.length - 100]! ^ 0xff; writeFileSync(bad, bytes);
    expect(verifyBackupFile(bad)).toMatchObject({ ok: false });
    expect(verifyBackupFile(bad).problems.join(' ')).toMatch(/SHA-256/);
    // No manifest.
    const lone = join(e.dir, 'lone.sqlite'); copyFileSync(path, lone);
    expect(verifyBackupFile(lone).problems.join(' ')).toMatch(/Manifest file is missing/);
    // A migration this code does not know.
    const newer = join(e.dir, 'newer.sqlite'); copyFileSync(path, newer); copyFileSync(`${path}.json`, `${newer}.json`);
    const db = openDatabase(newer);
    db.prepare("INSERT INTO sys_schema_migration (module, id, checksum, applied_at) VALUES ('M03', '0099_future', 'x', 'x')").run();
    db.pragma('wal_checkpoint(TRUNCATE)'); db.close();
    const r = verifyBackupFile(newer);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/newer version/);
    expect(verifyBackupFile(join(e.dir, 'nope.sqlite')).problems).toEqual(['File not found']);
  });

  it('restores a backup onto a stopped database, keeps the old one as a safety backup, and logs the restore', () => {
    const e = makeOpsEnv();
    fleet(e, 'F1');
    const m = createBackup(e.ctx, 'manual', 'tester');
    const path = join(backupDirOf(e.dir), m.fileName);
    fleet(e, 'F2'); // newer than the backup
    // While the application holds the database open for writing, restore refuses.
    e.db.exec('BEGIN IMMEDIATE');
    expect(codeOf(() => restoreBackup({ dbFile: e.dbFile, dataDir: e.dir, backupFile: path }))).toBe('WORKFLOW_BLOCKED');
    e.db.exec('ROLLBACK');
    e.db.close();
    const r = restoreBackup({ dbFile: e.dbFile, dataDir: e.dir, backupFile: path });
    expect(r.safetyBackup).toMatch(/pre_restore/);
    const db = openDatabase(e.dbFile);
    expect(db.prepare('SELECT code FROM org_fleet ORDER BY code').all()).toEqual([{ code: 'F1' }]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM ops_restore_log').get() as { n: number }).n).toBe(1);
    db.close();
    // The safety backup still holds what the restore replaced.
    const safety = openReadonly(join(backupDirOf(e.dir), r.safetyBackup!));
    expect(safety.prepare('SELECT code FROM org_fleet ORDER BY code').all()).toEqual([{ code: 'F1' }, { code: 'F2' }]);
    safety.close();
  });

  it('refuses to restore another installation\'s backup unless told it is replacement hardware', () => {
    const a = makeOpsEnv();
    const b = makeOpsEnv();
    const m = createBackup(b.ctx, 'manual', 'tester');
    const path = join(backupDirOf(b.dir), m.fileName);
    a.db.close();
    // Same code "HQ" but a different installation id.
    expect(codeOf(() => restoreBackup({ dbFile: a.dbFile, dataDir: a.dir, backupFile: path }))).toBe('WORKFLOW_BLOCKED');
    const ok = restoreBackup({ dbFile: a.dbFile, dataDir: a.dir, backupFile: path, allowOtherInstallation: true });
    expect(ok.manifest?.installationId).toBe(b.ctx.identity!.installationId);
  });

  it('takes a backup before applying pending migrations, and none on a fresh database', () => {
    const e = makeOpsEnv();
    // Simulate an installation one migration behind.
    e.db.prepare("DELETE FROM sys_schema_migration WHERE module = 'M13'").run();
    e.db.exec('DROP TABLE rpt_notification');
    const r = upgradeWithBackup(e.db, e.dir);
    expect(r.applied).toEqual(['M13/0001_reports']);
    expect(r.backup?.reason).toBe('pre_upgrade');
    expect(existsSync(join(backupDirOf(e.dir), r.backup!.fileName))).toBe(true);
    expect(listBackups(e.db).some((b) => b.reason === 'pre_upgrade')).toBe(true);
    // Nothing pending: nothing backed up.
    expect(upgradeWithBackup(e.db, e.dir).backup).toBeNull();
    // Fresh database: nothing to protect.
    const fresh = openDatabase(join(e.dir, 'fresh.sqlite'));
    expect(upgradeWithBackup(fresh, e.dir).backup).toBeNull();
    expect(discoverMigrations().length).toBeGreaterThan(0);
    fresh.close();
  });

  it('prunes only scheduled backups beyond the number to keep', async () => {
    const e = makeOpsEnv();
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      const m = createBackup(e.ctx, 'scheduled', 'system');
      names.push(m.fileName);
      e.db.prepare('UPDATE ops_backup_log SET created_at = ? WHERE file_name = ?').run(new Date(Date.now() - (10 - i) * 1000).toISOString(), m.fileName);
      await new Promise((r) => setTimeout(r, 1100)); // names carry whole seconds
    }
    createBackup(e.ctx, 'manual', 'tester');
    expect(pruneScheduled(e.ctx, 2)).toBe(2);
    expect(listBackups(e.db).filter((b) => b.reason === 'scheduled')).toHaveLength(2);
    expect(listBackups(e.db).filter((b) => b.reason === 'manual')).toHaveLength(1);
    expect(existsSync(join(backupDirOf(e.dir), names[0]!))).toBe(false);
    expect(existsSync(join(backupDirOf(e.dir), names[3]!))).toBe(true);
  }, 20000);

  it('the scheduler is off when disabled, and skips when a recent backup exists', () => {
    const e = makeOpsEnv();
    const stop = startBackupScheduler(e.ctx, { CMMS_BACKUP_EVERY_HOURS: '0' });
    stop();
    createBackup(e.ctx, 'manual', 'tester');
    const stop2 = startBackupScheduler(e.ctx, { CMMS_BACKUP_EVERY_HOURS: '24' });
    stop2();
    expect(listBackups(e.db)).toHaveLength(1);
  });
});

describe('M14 status and integrity', () => {
  it('warns about a missing, old or unverified backup and a failed integrity check, and clears when fixed', () => {
    const e = makeOpsEnv();
    expect((opsStatus(e.ctx).warnings as Array<{ code: string }>).map((w) => w.code)).toContain('no_backup');
    const m = createBackup(e.ctx, 'manual', 'tester');
    expect((opsStatus(e.ctx).warnings as Array<{ code: string }>).map((w) => w.code)).toEqual(['backup_unverified']);
    verifyBackupById(e.ctx, listBackups(e.db)[0]!.id as string);
    expect(opsStatus(e.ctx).ok).toBe(true);
    e.db.prepare('UPDATE ops_backup_log SET created_at = ? WHERE file_name = ?').run(new Date(Date.now() - 9 * 86_400_000).toISOString(), m.fileName);
    expect((opsStatus(e.ctx).warnings as Array<{ code: string }>).map((w) => w.code)).toEqual(['backup_old']);
  });

  it('finds dangling references, overlapping ranges and overlapping attachments, and reports a clean installation as clean', () => {
    const e = makeOpsEnv();
    expect(runIntegrity(e.ctx, 'tester')).toMatchObject({ ok: true, findings: [] });
    const f = fleet(e).id as string;
    const s1 = createRecord(e.wctx(), 'org.ship', { fleet_id: f, code: 'S1', name: 'Ship 1' }).id as string;
    // A ship whose fleet is not on this installation (as after partial replication).
    createRecord(e.wctx(), 'org.ship', { fleet_id: crypto.randomUUID(), code: 'S2', name: 'Ship 2' });
    const c1 = createRecord(e.wctx(), 'org.command', { code: 'C1', name: 'Command 1' }).id as string;
    const c2 = createRecord(e.wctx(), 'org.command', { code: 'C2', name: 'Command 2' }).id as string;
    e.db.exec('DROP TRIGGER org_ship_command_assignment_no_overlap_ins'); // replication could still leave an overlap that a later check should find
    createRecord(e.wctx(), 'org.ship_command_assignment', { ship_id: s1, command_id: c1, effective_from: '2026-01-01T00:00:00.000Z', effective_to: null });
    createRecord(e.wctx(), 'org.ship_command_assignment', { ship_id: s1, command_id: c2, effective_from: '2026-06-01T00:00:00.000Z', effective_to: null });
    e.db.prepare("INSERT INTO sys_number_sequence (id, version, owner_installation_id, created_at, created_by, created_installation_id, updated_at, updated_by, code, prefix, width) VALUES ('seq1', 1, 'x', 'x', 'x', 'x', 'x', 'x', 'demo', 'D', 4)").run();
    const rangeSql = "INSERT INTO sys_number_range (id, version, owner_installation_id, created_at, created_by, created_installation_id, updated_at, updated_by, sequence_code, allocated_to_installation_id, range_start, range_end) VALUES (?, 1, 'x', 'x', 'x', 'x', 'x', 'x', 'demo', 'a', ?, ?)";
    e.db.prepare(rangeSql).run('r1', 1, 10);
    e.db.exec('DROP TRIGGER sys_number_range_no_overlap'); // a damaged or merged database could hold this
    e.db.prepare(rangeSql).run('r2', 5, 20);
    const r = runIntegrity(e.ctx, 'tester');
    expect(r.ok).toBe(false);
    const codes = r.findings.map((x) => x.code);
    expect(codes).toContain('dangling_reference');
    expect(codes).toContain('number_range_overlap');
    expect(codes).toContain('assignment_overlap');
    expect(r.findings.find((x) => x.code === 'assignment_overlap')!.severity).toBe('warning');
    expect(e.db.prepare('SELECT ok, problem_count FROM ops_integrity_check ORDER BY ran_at DESC LIMIT 1').get()).toMatchObject({ ok: 0 });
  });
});
