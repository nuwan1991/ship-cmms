import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { applyMigrations, discoverMigrations, expandMacros, migrationText, schemaVersions, type MigrationFile } from '../../src/platform/db/migrate.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { makeEnv } from '../helpers.js';

describe('migrations', () => {
  it('applies once, is idempotent, and reports schema versions', () => {
    const db = openDatabase(':memory:');
    const all = discoverMigrations();
    expect(all[0]).toMatchObject({ module: 'platform', id: '0001_core' });
    expect(applyMigrations(db, all)).toHaveLength(all.length);
    expect(applyMigrations(db, all)).toEqual([]);
    expect(schemaVersions(db).platform).toBe(1);
  });

  it('rejects a migration edited after it was applied', () => {
    const db = openDatabase(':memory:');
    const m: MigrationFile = { module: 'platform', id: '0001_x', sql: 'CREATE TABLE sys_x (a TEXT);', checksum: 'aaa' };
    applyMigrations(db, [m]);
    expect(() => applyMigrations(db, [{ ...m, checksum: 'bbb' }])).toThrow(/modified after being applied/);
  });

  it('treats a migration checked out with other line endings as unchanged, but still catches a real change (D77)', () => {
    const db = openDatabase(':memory:');
    const lf = '-- note\nCREATE TABLE sys_eol (a TEXT);\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const fromCrlf = migrationText(crlf);
    expect(fromCrlf.sql).toBe(lf);
    // Applied from a CRLF copy by an older version, which recorded the checksum of the CRLF bytes.
    const legacy = createHash('sha256').update(crlf).digest('hex');
    db.exec('CREATE TABLE IF NOT EXISTS sys_schema_migration (module TEXT NOT NULL, id TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, PRIMARY KEY (module, id))');
    db.exec('CREATE TABLE sys_eol (a TEXT)');
    db.prepare("INSERT INTO sys_schema_migration VALUES ('platform', '0001_eol', ?, 'x')").run(legacy);
    expect(applyMigrations(db, [{ module: 'platform', id: '0001_eol', ...migrationText(lf) }])).toEqual([]);
    expect(applyMigrations(db, [{ module: 'platform', id: '0001_eol', ...fromCrlf }])).toEqual([]);
    expect(() => applyMigrations(db, [{ module: 'platform', id: '0001_eol', ...migrationText(lf.replace('a TEXT', 'b TEXT')) }])).toThrow(/modified after being applied/);
  });

  it('rolls back a failing migration completely', () => {
    const db = openDatabase(':memory:');
    const bad: MigrationFile = { module: 'platform', id: '0001_bad', sql: 'CREATE TABLE sys_ok (a TEXT); CREATE TABLE sys_ok (a TEXT);', checksum: 'c' };
    expect(() => applyMigrations(db, [bad])).toThrow();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sys_ok'").get()).toBeUndefined();
  });

  it('expands sync macros', () => {
    const sql = expandMacros('CREATE TABLE ast_a ({{SYNC_COLUMNS}} n TEXT); {{TRIGGERS_MUTABLE ast_a}}');
    expect(sql).toContain('owner_installation_id TEXT NOT NULL');
    expect(sql).toContain('ast_a_no_delete');
  });
});

describe('database guards', () => {
  it('uses WAL-capable durable settings', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('synchronous', { simple: true })).toBe(2); // FULL
  });

  it('makes audit events append-only and synced records undeletable', () => {
    const { db, ctx } = makeEnv();
    db.prepare("INSERT INTO sys_audit_event (id, owner_installation_id, occurred_at, recorded_at, recorded_by, action, entity_type, actor_user_id, correlation_id, outcome) VALUES (?, ?, 't', 't', 'u', 'a', 'x', 'u', 'c', 'success')").run(uuidv7(), uuidv7());
    expect(() => db.prepare("UPDATE sys_audit_event SET action = 'changed'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM sys_audit_event').run()).toThrow(/append-only/);
    expect(ctx).toBeTypeOf('function');
  });
});
