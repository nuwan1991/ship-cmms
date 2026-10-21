import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, verifySyncedTables, writeAudit } from '../../src/platform/records.js';
import { hubIdentity, makeEnv, shipIdentity } from '../helpers.js';

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : `non-AppError: ${(e as Error).message}`;
  }
  return undefined;
};

describe('write path', () => {
  it('creates with version 1, audit envelope and change-log entry in one transaction', () => {
    const { db, ctx } = makeEnv();
    const row = createRecord(ctx(shipIdentity), 'ast.thing', { name: 'Pump', home_scope_id: null });
    expect(row).toMatchObject({ version: 1, owner_installation_id: shipIdentity.installationId, created_by: 'user-1' });

    const audit = db.prepare("SELECT * FROM sys_audit_event WHERE entity_id = ?").get(row.id) as Record<string, string>;
    expect(audit).toMatchObject({ action: 'create', actor_user_id: 'user-1', outcome: 'success' });
    expect(JSON.parse(audit.actor_snapshot!)).toEqual({ displayName: 'Test User' });

    const log = db.prepare("SELECT * FROM sys_change_log WHERE entity_id = ?").get(row.id) as Record<string, unknown>;
    expect(log).toMatchObject({ op: 'upsert', version: 1, entity_type: 'ast.thing', received_from_installation_id: null });
    expect(JSON.parse(log.payload as string).name).toBe('Pump');
  });

  it('increments version, records field diffs, and enforces optimistic concurrency', () => {
    const { db, ctx } = makeEnv();
    const c = ctx(shipIdentity);
    const row = createRecord(c, 'ast.thing', { name: 'A' });
    const v2 = updateRecord(c, 'ast.thing', row.id as string, 1, { name: 'B' });
    expect(v2.version).toBe(2);
    expect(code(() => updateRecord(c, 'ast.thing', row.id as string, 1, { name: 'C' }))).toBe('VERSION_CONFLICT');
    const changes = JSON.parse((db.prepare("SELECT changes FROM sys_audit_event WHERE action='update'").get() as { changes: string }).changes);
    expect(changes).toEqual({ name: ['A', 'B'] });
  });

  it('allows only the owner installation to change an owner_mutable record', () => {
    const { ctx } = makeEnv();
    const row = createRecord(ctx(shipIdentity), 'ast.thing', { name: 'Owned by ship' });
    expect(code(() => updateRecord(ctx(hubIdentity), 'ast.thing', row.id as string, 1, { name: 'x' }))).toBe('NOT_OWNER');
  });

  it('allows only the hub to write hub_reference data', () => {
    const { ctx } = makeEnv();
    const seq = { code: 'equipment_tag', prefix: 'SLN-EQ', width: 8 };
    expect(code(() => createRecord(ctx(shipIdentity), 'sys.number_sequence', seq))).toBe('NOT_OWNER');
    expect(code(() => createRecord(ctx(hubIdentity), 'sys.number_sequence', seq))).toBeUndefined();
  });

  it('tombstones instead of deleting, and requires a reason', () => {
    const { db, ctx } = makeEnv();
    const c = ctx(shipIdentity);
    const row = createRecord(c, 'ast.thing', { name: 'Gone' });
    expect(code(() => tombstoneRecord(c, 'ast.thing', row.id as string, 1, ' '))).toBe('VALIDATION_FAILED');
    const t = tombstoneRecord(c, 'ast.thing', row.id as string, 1, 'duplicate entry');
    expect(t.deleted_at).toBeTruthy();
    expect((db.prepare("SELECT op FROM sys_change_log WHERE entity_id = ? ORDER BY seq DESC").get(row.id) as { op: string }).op).toBe('tombstone');
    expect(() => db.prepare('DELETE FROM ast_thing').run()).toThrow(/tombstoned/);
    expect(code(() => updateRecord(c, 'ast.thing', row.id as string, 2, { name: 'x' }))).toBe('NOT_FOUND');
  });

  it('rejects unknown and platform-managed columns', () => {
    const { ctx } = makeEnv();
    expect(code(() => createRecord(ctx(shipIdentity), 'ast.thing', { nope: 1 }))).toBe('VALIDATION_FAILED');
    expect(code(() => createRecord(ctx(shipIdentity), 'ast.thing', { name: 'x', version: 9 }))).toBe('VALIDATION_FAILED');
    expect(code(() => createRecord(ctx(shipIdentity), 'ast.thing', { name: 'x; DROP TABLE ast_thing' }))).toBeUndefined(); // values are bound, not interpolated
  });

  it('appends immutable events with actual time preserved', () => {
    const { db, ctx } = makeEnv();
    const c = { ...ctx(shipIdentity), occurredAt: '2026-10-01T08:00:00.000Z' };
    const thing = createRecord(c, 'ast.thing', { name: 'T' });
    const ev = appendEvent(c, 'ast.thing_event', { thing_id: thing.id, note: 'inspected' });
    expect(ev.occurred_at).toBe('2026-10-01T08:00:00.000Z');
    expect(ev.recorded_at).not.toBe(ev.occurred_at);
    expect(() => db.prepare("UPDATE ast_thing_event SET note = 'edited'").run()).toThrow(/append-only/);
    expect((db.prepare("SELECT op FROM sys_change_log WHERE entity_id = ?").get(ev.id) as { op: string }).op).toBe('event');
  });

  it('records denied actions in the audit trail', () => {
    const { db, ctx } = makeEnv();
    writeAudit(ctx(shipIdentity), { action: 'approve', entityType: 'wrk.job_card', outcome: 'denied' });
    expect((db.prepare("SELECT outcome FROM sys_audit_event WHERE action = 'approve'").get() as { outcome: string }).outcome).toBe('denied');
  });

  it('flags registered tables that lack the sync contract', () => {
    const { db, registry } = makeEnv();
    expect(verifySyncedTables(db, registry)).toEqual([]);
    db.exec('CREATE TABLE ast_bad (id TEXT PRIMARY KEY)');
    registry.register({ type: 'ast.bad', module: 'M03', table: 'ast_bad', recordClass: 'owner_mutable', distribution: 'record' });
    const problems = verifySyncedTables(db, registry);
    expect(problems).toContain('ast.bad: missing column version');
    expect(problems).toContain('ast.bad: missing ast_bad_no_delete trigger');
  });

  it('validates registry dependencies', () => {
    const { registry } = makeEnv();
    expect(registry.validate()).toEqual([]);
    registry.register({ type: 'ast.orphan', module: 'M03', table: 'ast_orphan', recordClass: 'owner_mutable', requires: ['ast.missing'], distribution: 'record' });
    expect(registry.validate()).toContain('ast.orphan requires unregistered ast.missing');
    expect(() => registry.register({ type: 'org.x', module: 'M03', table: 'org_x', recordClass: 'local', distribution: 'record' })).toThrow(/must start with/);
  });
});
