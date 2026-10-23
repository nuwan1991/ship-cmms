import { describe, expect, it } from 'vitest';
import { ensureTagSequence } from '../../src/modules/m03-assets/seed.js';
import { assetAtPosition, currentInstallation, foldMovements, getAsset, getPosition, rebuildAssetCurrent, refoldAsset, resolveTag, responsibilityAt, AST_PERMISSIONS } from '../../src/modules/m03-assets/index.js';
import { moveAsset } from '../../src/modules/m03-assets/movements.js';
import { createAsset, createEntity, reassignResponsibility, tombstoneEntity, updateEntity } from '../../src/modules/m03-assets/service.js';
import { appendEvent, verifySyncedTables } from '../../src/platform/records.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { denyOnly } from './org-helpers.js';
import { DAY, HOUR, codeOf, iso, makeAstEnv, sql, type AstEnv } from './ast-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;

function tree(env: AstEnv, shipId = env.shipId, a = env.hubActor()) {
  const sys = createEntity(a, 'position', { shipId, positionTag: '2', name: 'Electrical power' });
  const group = createEntity(a, 'position', { shipId, parentId: id(sys), positionTag: '2.1', name: 'Generating set 1' });
  const engine = createEntity(a, 'position', { shipId, parentId: id(group), positionTag: '2.1.1', name: 'Generator engine' });
  const alt = createEntity(a, 'position', { shipId, parentId: id(group), positionTag: '2.1.2', name: 'Alternator' });
  const bearing = createEntity(a, 'position', { shipId, parentId: id(alt), positionTag: '2.1.2.1', name: 'Drive-end bearing' });
  return { sys: id(sys), group: id(group), engine: id(engine), alt: id(alt), bearing: id(bearing) };
}
const newAsset = (env: AstEnv, over: Record<string, unknown> = {}, a = env.hubActor()) =>
  createAsset(a, { name: 'Generator engine', homeShipId: env.shipId, ...over }).asset;

describe('registration', () => {
  it('registers all entities with a clean registry and synced-table check', () => {
    const env = makeAstEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('ast.asset_current').recordClass).toBe('derived');
    expect(env.ctx.entities.get('ast.asset_movement').recordClass).toBe('event');
  });
  it('publishes well-formed permission codes, with movements as events (no update/remove)', () => {
    for (const p of AST_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(AST_PERMISSIONS).toContain('ast.asset_movement.void');
    expect(AST_PERMISSIONS).not.toContain('ast.asset_movement.update');
    expect(AST_PERMISSIONS).not.toContain('ast.asset_movement.remove');
  });
});

describe('permanent identity and equipment tags', () => {
  it('issues sequential tags from the installation range, keeping tag, serial and position tag separate', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a1 = newAsset(env, { manufacturer: 'Acme', serialNumber: 'SN-1', positionId: t.engine });
    const a2 = newAsset(env, { name: 'Alternator', manufacturer: 'Acme', serialNumber: 'SN-2' });
    expect(a1.assetTag).toBe('SLN-EQ-00000001');
    expect(a2.assetTag).toBe('SLN-EQ-00000002');
    expect(a1.serialNumber).toBe('SN-1');
    expect(currentInstallation(env.ctx.db, id(a1))?.positionId).toBe(t.engine);
    expect(getPosition(env.ctx.db, t.engine)?.positionTag).toBe('2.1.1');
    expect(a1.assetTag).not.toBe(getPosition(env.ctx.db, t.engine)?.positionTag);
    expect(resolveTag(env.ctx.db, ' sln-eq-00000001 ')?.id).toBe(id(a1));
  });

  it('ships issue offline from their own granted range; ranges never overlap', () => {
    const env = makeAstEnv({ hubRange: 3 });
    const ship = env.shipActor(env.shipId);
    env.grant(ship.wctx.installation.installationId, 2);
    const hubTags = [1, 2, 3].map(() => newAsset(env).assetTag);
    const shipTags = [1, 2].map(() => newAsset(env, {}, ship).assetTag);
    expect(hubTags).toEqual(['SLN-EQ-00000001', 'SLN-EQ-00000002', 'SLN-EQ-00000003']);
    expect(shipTags).toEqual(['SLN-EQ-00000004', 'SLN-EQ-00000005']);
    expect(sql(env, 'SELECT owner_installation_id o FROM ast_asset WHERE asset_tag = ?', 'SLN-EQ-00000004')[0]!.o).toBe(ship.wctx.installation.installationId);
  });

  it('stops with RANGE_EXHAUSTED and leaves no half-created asset; DEPENDENCY_MISSING without a sequence', () => {
    const env = makeAstEnv({ hubRange: 1 });
    newAsset(env);
    expect(codeOf(() => newAsset(env))).toBe('RANGE_EXHAUSTED');
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_asset')[0]!.n).toBe(1);
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_asset_movement')[0]!.n).toBe(1);
    // Fresh database without the sequence synchronized yet.
    const bare = makeAstEnv({ hubRange: 0 });
    bare.ctx.db.exec("DELETE FROM sys_number_sequence WHERE code = 'equipment_tag'".replace('DELETE FROM', 'UPDATE').replace("WHERE", "SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE"));
    expect(codeOf(() => newAsset(bare))).toBe('DEPENDENCY_MISSING');
  });

  it('never lets the tag change, and transfers leave id, tag and record version untouched', () => {
    const env = makeAstEnv();
    const a = newAsset(env);
    expect(codeOf(() => updateEntity(env.hubActor(), 'asset', id(a), { expectedVersion: 1, assetTag: 'SLN-EQ-99999999' }))).toBe('VALIDATION_FAILED');
    expect(() => env.ctx.db.prepare("UPDATE ast_asset SET asset_tag = 'X' WHERE id = ?").run(id(a))).toThrow(/permanent/);
    const workshop = { kind: 'ship' as const, id: env.ship2Id };
    moveAsset(env.hubActor(), env.ctx.events, id(a), { kind: 'custody_transfer', custody: workshop });
    moveAsset(env.hubActor(), env.ctx.events, id(a), { kind: 'custody_transfer', custody: { kind: 'department', id: env.meId } });
    const row = sql(env, 'SELECT id, asset_tag, version FROM ast_asset WHERE id = ?', id(a))[0]!;
    expect(row).toMatchObject({ id: id(a), asset_tag: a.assetTag, version: 1 });
    expect(sql(env, "SELECT COUNT(*) n FROM ast_asset_movement WHERE kind = 'custody_transfer'")[0]!.n).toBe(2);
  });

  it('rejects a second asset with the same manufacturer and serial number, and unknown references', () => {
    const env = makeAstEnv();
    newAsset(env, { manufacturer: 'Acme', serialNumber: 'SN-1' });
    expect(codeOf(() => newAsset(env, { manufacturer: 'Acme', serialNumber: 'SN-1' }))).toBe('DUPLICATE');
    newAsset(env, { manufacturer: 'Other', serialNumber: 'SN-1' });
    newAsset(env, { serialNumber: 'SN-1' });
    newAsset(env, { serialNumber: 'SN-1' });
    const missing = '0190c0de-0000-7000-8000-000000000001';
    expect(codeOf(() => newAsset(env, { homeShipId: missing }))).toBe('DEPENDENCY_MISSING');
    expect(codeOf(() => newAsset(env, { classificationId: missing }))).toBe('DEPENDENCY_MISSING');
    expect(codeOf(() => newAsset(env, { positionId: missing }))).toBe('DEPENDENCY_MISSING');
    expect(codeOf(() => newAsset(env, { locationId: missing }))).toBe('DEPENDENCY_MISSING');
  });
});

describe('position tree', () => {
  it('derives the level from the parent and stops below the component level', () => {
    const env = makeAstEnv();
    const t = tree(env);
    expect(sql(env, 'SELECT level FROM ast_position WHERE id IN (?,?,?,?,?) ORDER BY position_tag', t.sys, t.group, t.engine, t.alt, t.bearing).map((r) => r.level)).toEqual(['system', 'equipment_group', 'equipment', 'equipment', 'component']);
    expect(codeOf(() => createEntity(env.hubActor(), 'position', { shipId: env.shipId, parentId: t.bearing, positionTag: '9', name: 'Too deep' }))).toBe('VALIDATION_FAILED');
    expect(getPosition(env.ctx.db, t.bearing)?.pathText).toBe('Electrical power / Generating set 1 / Alternator / Drive-end bearing');
  });

  it('keeps position tags unique per ship, parents on the same ship, and refuses removal while in use', () => {
    const env = makeAstEnv();
    const t = tree(env);
    expect(codeOf(() => createEntity(env.hubActor(), 'position', { shipId: env.shipId, positionTag: '2', name: 'Again' }))).toBe('DUPLICATE');
    createEntity(env.hubActor(), 'position', { shipId: env.ship2Id, positionTag: '2', name: 'Same tag, other ship' });
    expect(codeOf(() => createEntity(env.hubActor(), 'position', { shipId: env.ship2Id, parentId: t.sys, positionTag: '2.9', name: 'Wrong ship' }))).toBe('VALIDATION_FAILED');

    const p = (idv: string) => sql(env, 'SELECT version v FROM ast_position WHERE id = ?', idv)[0]!.v as number;
    expect(codeOf(() => tombstoneEntity(env.hubActor(), 'position', t.group, { expectedVersion: p(t.group), reason: 'x' }))).toBe('WORKFLOW_BLOCKED'); // has children
    newAsset(env, { positionId: t.engine });
    expect(codeOf(() => tombstoneEntity(env.hubActor(), 'position', t.engine, { expectedVersion: p(t.engine), reason: 'x' }))).toBe('WORKFLOW_BLOCKED'); // asset installed
    expect(codeOf(() => updateEntity(env.hubActor(), 'position', t.engine, { expectedVersion: p(t.engine), status: 'inactive' }))).toBe('WORKFLOW_BLOCKED');
    expect(tombstoneEntity(env.hubActor(), 'position', t.bearing, { expectedVersion: p(t.bearing), reason: 'Removed from drawing' }).deletedAt).toBeTruthy();
  });
});

describe('installation, removal and custody (derived state)', () => {
  it('folds install, remove, custody and status changes into the current state', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const ev = env.ctx.events;
    expect(getAsset(env.ctx.db, id(a))?.assetTag).toBe(a.assetTag);
    expect(assetAtPosition(env.ctx.db, t.engine)?.id).toBe(id(a));
    moveAsset(env.hubActor(), ev, id(a), { kind: 'remove', note: 'Landed for overhaul' });
    expect(currentInstallation(env.ctx.db, id(a))).toBeNull();
    moveAsset(env.hubActor(), ev, id(a), { kind: 'custody_transfer', custody: { kind: 'department', id: env.eeId } });
    const r = moveAsset(env.hubActor(), ev, id(a), { kind: 'status_change', assetStatus: 'under_repair' });
    expect(r.current).toMatchObject({ positionId: null, custody: { kind: 'department', id: env.eeId }, assetStatus: 'under_repair' });
    moveAsset(env.hubActor(), ev, id(a), { kind: 'install', positionId: t.alt, note: 'Moved to the alternator position' });
    expect(currentInstallation(env.ctx.db, id(a))?.positionId).toBe(t.alt);
    expect(sql(env, 'SELECT asset_status s FROM ast_v_asset_overview WHERE asset_id = ?', id(a))[0]!.s).toBe('under_repair');
  });

  it('refuses obvious mistakes when entered locally', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const b = newAsset(env, { name: 'Other' });
    const mv = (assetId: string, input: object) => codeOf(() => moveAsset(env.hubActor(), env.ctx.events, assetId, input));
    expect(mv(id(a), { kind: 'install', positionId: t.alt })).toBe('WORKFLOW_BLOCKED'); // already installed
    expect(mv(id(b), { kind: 'install', positionId: t.engine })).toBe('WORKFLOW_BLOCKED'); // position occupied
    expect(mv(id(b), { kind: 'remove' })).toBe('WORKFLOW_BLOCKED'); // not installed
    expect(mv(id(a), { kind: 'status_change', assetStatus: 'in_service' })).toBe('VALIDATION_FAILED'); // unchanged
    expect(mv(id(a), { kind: 'custody_transfer', custody: { kind: 'ship', id: env.shipId } })).toBe('VALIDATION_FAILED'); // already there
    expect(mv(id(a), { kind: 'custody_transfer', custody: { kind: 'workshop', id: '0190c0de-0000-7000-8000-000000000002' } })).toBe('DEPENDENCY_MISSING');
    expect(mv(id(a), { kind: 'install' })).toBe('VALIDATION_FAILED'); // positionId required
    expect(mv('0190c0de-0000-7000-8000-000000000003', { kind: 'remove' })).toBe('NOT_FOUND');
    expect(mv(id(a), { kind: 'remove', occurredAt: iso(HOUR) })).toBe('VALIDATION_FAILED'); // future
    expect(mv(id(a), { kind: 'remove', occurredAt: iso(-2 * DAY) })).toBe('WORKFLOW_BLOCKED'); // before the latest movement
  });

  it('corrects mistakes with void events; history is never edited', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env);
    const ev = env.ctx.events;
    const inst = moveAsset(env.hubActor(), ev, id(a), { kind: 'install', positionId: t.engine });
    const before = JSON.stringify(sql(env, 'SELECT * FROM ast_asset_movement WHERE id = ?', id(inst.movement)));
    const voided = moveAsset(env.hubActor(), ev, id(a), { kind: 'void', correctsMovementId: id(inst.movement), note: 'Wrong position' });
    expect(voided.current?.positionId).toBeNull();
    expect(JSON.stringify(sql(env, 'SELECT * FROM ast_asset_movement WHERE id = ?', id(inst.movement)))).toBe(before);
    expect(() => env.ctx.db.prepare('UPDATE ast_asset_movement SET note = ?').run('x')).toThrow(/append-only/);
    expect(() => env.ctx.db.prepare('DELETE FROM ast_asset_movement').run()).toThrow(/append-only/);
    // The position is free again and the right install can be entered.
    expect(moveAsset(env.hubActor(), ev, id(a), { kind: 'install', positionId: t.alt }).current?.positionId).toBe(t.alt);
    const code = (input: object) => codeOf(() => moveAsset(env.hubActor(), ev, id(a), input));
    expect(code({ kind: 'void', correctsMovementId: id(inst.movement), note: 'again' })).toBe('WORKFLOW_BLOCKED'); // already voided
    expect(code({ kind: 'void', correctsMovementId: id(voided.movement), note: 'x' })).toBe('WORKFLOW_BLOCKED'); // void of a void
    const reg = sql(env, "SELECT id FROM ast_asset_movement WHERE kind = 'register'")[0]!.id as string;
    expect(code({ kind: 'void', correctsMovementId: reg, note: 'x' })).toBe('WORKFLOW_BLOCKED');
    expect(code({ kind: 'void', correctsMovementId: '0190c0de-0000-7000-8000-000000000004', note: 'x' })).toBe('NOT_FOUND');
    expect(code({ kind: 'void', correctsMovementId: reg })).toBe('VALIDATION_FAILED'); // a note is required
  });

  it('the derived table is rebuildable from events and equals the incremental result', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const b = newAsset(env, { name: 'Alternator' });
    moveAsset(env.hubActor(), env.ctx.events, id(b), { kind: 'status_change', assetStatus: 'in_store' });
    const snap = () => JSON.stringify(sql(env, 'SELECT asset_id, position_id, location_id, custody_party_kind, custody_party_id, asset_status, installed_since, last_movement_id FROM ast_asset_current ORDER BY asset_id'));
    const before = snap();
    env.ctx.db.exec('DELETE FROM ast_asset_current');
    expect(rebuildAssetCurrent(env.ctx.db)).toBe(2);
    expect(snap()).toBe(before);
    expect(foldMovements([])).toBeNull();
    void a;
  });

  it('flags, but never rejects, a position that replicated events left with two assets (D20)', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const b = newAsset(env, { name: 'Other' });
    // An install recorded at another installation arrives by synchronization: appended as-is, then folded.
    appendEvent(env.hubActor().wctx, 'ast.asset_movement', { asset_id: id(b), home_scope_id: env.shipId, kind: 'install', position_id: t.engine, occurred_at: iso(1000) });
    refoldAsset(env.ctx.db, id(b));
    expect(sql(env, 'SELECT position_id, asset_count FROM ast_v_position_conflicts')).toEqual([{ position_id: t.engine, asset_count: 2 }]);
    expect(assetAtPosition(env.ctx.db, t.engine)?.id).toBe(id(a)); // deterministic: earliest install is shown first
  });

  it('refuses to remove the record of an installed asset, and tombstoned assets stop resolving', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const ver = () => sql(env, 'SELECT version v FROM ast_asset WHERE id = ?', id(a))[0]!.v as number;
    expect(codeOf(() => tombstoneEntity(env.hubActor(), 'asset', id(a), { expectedVersion: ver(), reason: 'scrapped' }))).toBe('WORKFLOW_BLOCKED');
    moveAsset(env.hubActor(), env.ctx.events, id(a), { kind: 'remove' });
    tombstoneEntity(env.hubActor(), 'asset', id(a), { expectedVersion: ver(), reason: 'scrapped' });
    expect(resolveTag(env.ctx.db, a.assetTag as string)).toBeNull();
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_asset WHERE asset_tag = ?', a.assetTag)[0]!.n).toBe(1); // the number is retired, never reused
    expect(newAsset(env).assetTag).toBe('SLN-EQ-00000002');
  });
});

describe('department responsibility', () => {
  it('keeps responsibility separate per position and per period; overlaps are rejected', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = env.hubActor();
    const t0 = '2025-01-01T00:00:00.000Z';
    createEntity(a, 'position_responsibility', { positionId: t.engine, departmentId: env.meId, effectiveFrom: t0 });
    createEntity(a, 'position_responsibility', { positionId: t.alt, departmentId: env.eeId, effectiveFrom: t0 });
    expect(responsibilityAt(env.ctx.db, t.engine, iso())?.departmentId).toBe(env.meId);
    expect(responsibilityAt(env.ctx.db, t.alt, iso())?.departmentId).toBe(env.eeId);
    expect(codeOf(() => createEntity(a, 'position_responsibility', { positionId: t.engine, departmentId: env.eeId, effectiveFrom: '2025-06-01T00:00:00.000Z' }))).toBe('VALIDATION_FAILED');
    expect(() => env.ctx.db.prepare("INSERT INTO ast_position_responsibility (id, version, owner_installation_id, created_at, created_by, created_installation_id, updated_at, updated_by, position_id, department_id, effective_from) VALUES ('x',1,'o','t','u','i','t','u',?,?,?)").run(t.engine, env.eeId, '2025-06-01T00:00:00.000Z')).toThrow(/overlap/);
    expect(codeOf(() => createEntity(a, 'position_responsibility', { positionId: t.engine, departmentId: '0190c0de-0000-7000-8000-000000000005', effectiveFrom: '2024-01-01T00:00:00.000Z', effectiveTo: '2024-02-01T00:00:00.000Z' }))).toBe('DEPENDENCY_MISSING');
    expect(codeOf(() => createEntity(a, 'position_responsibility', { positionId: t.engine, departmentId: env.eeId, effectiveFrom: '2024-02-01T00:00:00.000Z', effectiveTo: '2024-01-01T00:00:00.000Z' }))).toBe('VALIDATION_FAILED');
  });

  it('hands responsibility over atomically and keeps the history', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = env.hubActor();
    createEntity(a, 'position_responsibility', { positionId: t.alt, departmentId: env.meId, effectiveFrom: '2025-01-01T00:00:00.000Z' });
    const out = reassignResponsibility(a, { positionId: t.alt, departmentId: env.eeId, effectiveFrom: '2026-03-01T00:00:00.000Z', reason: 'Transferred to Electrical Engineering' });
    expect(out.closed?.effectiveTo).toBe('2026-03-01T00:00:00.000Z');
    expect(responsibilityAt(env.ctx.db, t.alt, '2025-06-01T00:00:00.000Z')?.departmentId).toBe(env.meId);
    expect(responsibilityAt(env.ctx.db, t.alt, '2026-03-01T00:00:00.000Z')?.departmentId).toBe(env.eeId);
    const code = (input: object) => codeOf(() => reassignResponsibility(a, input));
    expect(code({ positionId: t.alt, departmentId: env.eeId, effectiveFrom: '2026-06-01T00:00:00.000Z' })).toBe('VALIDATION_FAILED'); // already responsible
    expect(code({ positionId: t.alt, departmentId: env.meId, effectiveFrom: '2025-09-01T00:00:00.000Z' })).toBe('WORKFLOW_BLOCKED'); // a later period exists
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_position_responsibility WHERE deleted_at IS NULL')[0]!.n).toBe(2);
  });
});

describe('ownership, versions and permissions', () => {
  it('classifications are hub reference data; ships write only their own ship, and only they change what they own', () => {
    const env = makeAstEnv();
    const ship = env.shipActor(env.shipId);
    expect(codeOf(() => createEntity(ship, 'classification', { code: 'PUMP', name: 'Pump', kind: 'equipment' }))).toBe('NOT_OWNER');
    createEntity(env.hubActor(), 'classification', { code: 'PUMP', name: 'Pump', kind: 'equipment' });

    expect(codeOf(() => createEntity(ship, 'position', { shipId: env.ship2Id, positionTag: '1', name: 'Other ship' }))).toBe('NOT_OWNER');
    const mine = createEntity(ship, 'position', { shipId: env.shipId, positionTag: '1', name: 'Propulsion' });
    expect(mine.ownerInstallationId).toBe(ship.wctx.installation.installationId);
    expect(codeOf(() => updateEntity(env.hubActor(), 'position', id(mine), { expectedVersion: 1, name: 'Hub edit' }))).toBe('NOT_OWNER');
    expect(updateEntity(ship, 'position', id(mine), { expectedVersion: 1, name: 'Propulsion plant' }).version).toBe(2);
    // Responsibility is recorded by the installation that owns the position.
    expect(codeOf(() => createEntity(env.hubActor(), 'position_responsibility', { positionId: id(mine), departmentId: env.meId, effectiveFrom: iso(-DAY) }))).toBe('NOT_OWNER');
    createEntity(ship, 'position_responsibility', { positionId: id(mine), departmentId: env.meId, effectiveFrom: iso(-DAY) });
  });

  it('a stale update fails with VERSION_CONFLICT carrying the current version', () => {
    const env = makeAstEnv();
    const a = newAsset(env);
    updateEntity(env.hubActor(), 'asset', id(a), { expectedVersion: 1, notes: 'first' });
    try {
      updateEntity(env.hubActor(), 'asset', id(a), { expectedVersion: 1, notes: 'second' });
      expect.unreachable();
    } catch (e) {
      expect((e as { code: string }).code).toBe('VERSION_CONFLICT');
      expect((e as { details: { currentVersion: number } }).details.currentVersion).toBe(2);
    }
  });

  it('denied permissions create nothing, change nothing, and are audited', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    const denied = env.hubActor(denyOnly('ast.asset.create', 'ast.asset_movement.create', 'ast.asset_movement.void', 'ast.position.create'));
    expect(codeOf(() => createAsset(denied, { name: 'No', homeShipId: env.shipId }))).toBe('FORBIDDEN');
    expect(codeOf(() => moveAsset(denied, env.ctx.events, id(a), { kind: 'remove' }))).toBe('FORBIDDEN');
    expect(codeOf(() => createEntity(denied, 'position', { shipId: env.shipId, positionTag: '9', name: 'No' }))).toBe('FORBIDDEN');
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_asset')[0]!.n).toBe(1);
    expect(currentInstallation(env.ctx.db, id(a))?.positionId).toBe(t.engine);
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE outcome = 'denied' AND action LIKE 'denied:ast.%'")[0]!.n).toBe(3);
  });

  it('every write leaves an audit row and a change-log entry; derived rows are never logged', () => {
    const env = makeAstEnv();
    const t = tree(env);
    const a = newAsset(env, { positionId: t.engine });
    moveAsset(env.hubActor(), env.ctx.events, id(a), { kind: 'remove' });
    const logged = sql(env, "SELECT DISTINCT entity_type t FROM sys_change_log WHERE entity_type LIKE 'ast.%' ORDER BY t").map((r) => r.t);
    expect(logged).toEqual(['ast.asset', 'ast.asset_movement', 'ast.position']);
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE action IN ('asset.register','asset.install','asset.remove')")[0]!.n).toBe(3);
  });
});

describe('setup', () => {
  it('ensureTagSequence is repeatable and hub-only', () => {
    const env = makeAstEnv();
    ensureTagSequence(env.hubActor().wctx);
    expect(sql(env, "SELECT COUNT(*) n FROM sys_number_sequence WHERE code = 'equipment_tag'")[0]!.n).toBe(1);
    expect(sql(env, "SELECT prefix, width FROM sys_number_sequence WHERE code = 'equipment_tag'")[0]).toEqual({ prefix: 'SLN-EQ', width: 8 });
    expect(codeOf(() => env.grant(env.shipActor(env.shipId).wctx.installation.installationId, 0))).toBe('VALIDATION_FAILED');
  });
});
