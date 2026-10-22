import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import {
  getLocation, getShipCommandAt, listShipsByCommand, resolveParty, ORG_PERMISSIONS,
} from '../../src/modules/m01-organization/index.js';
import { createEntity, reassignShip, tombstoneEntity, updateEntity } from '../../src/modules/m01-organization/service.js';
import { seedDemoOrganization } from '../../src/modules/m01-organization/seed.js';
import { denyOnly, makeOrgEnv, seedBasics } from './org-helpers.js';

const T = (s: string) => `${s}T00:00:00.000Z`;
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : `non-AppError: ${(e as Error).message}`;
  }
  return 'NO_ERROR';
};
const rows = (env: ReturnType<typeof makeOrgEnv>, sql: string, ...p: unknown[]) => env.ctx.db.prepare(sql).all(...p) as Array<Record<string, unknown>>;

describe('M01 registration', () => {
  it('registers all entities with a clean registry and synced-table check', () => {
    const env = makeOrgEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.all().filter((d) => d.module === 'M01')).toHaveLength(8);
    expect(env.ctx.entities.get('org.location').recordClass).toBe('owner_mutable');
    expect(env.ctx.entities.get('org.ship').recordClass).toBe('hub_reference');
  });

  it('publishes well-formed permission codes', () => {
    expect(ORG_PERMISSIONS).toContain('org.ship_command_assignment.create');
    expect(ORG_PERMISSIONS.every((p) => /^org\.[a-z_]+\.(view|create|update|remove)$/.test(p))).toBe(true);
  });
});

describe('reference data rules', () => {
  it('has one fleet, unique upper-cased codes, and no fixed number of commands', () => {
    const env = makeOrgEnv();
    const a = env.hubActor();
    createEntity(a, 'fleet', { code: 'f1', name: 'Fleet' });
    expect(code(() => createEntity(a, 'fleet', { code: 'F2', name: 'Second' }))).toBe('DUPLICATE');
    const c = createEntity(a, 'command', { code: 'cmd-a', name: 'A' });
    expect(c.code).toBe('CMD-A');
    expect(code(() => createEntity(a, 'command', { code: 'CMD-A', name: 'Dup' }))).toBe('DUPLICATE');
    for (let i = 0; i < 8; i++) createEntity(a, 'command', { code: `X${i}`, name: `X${i}` }); // 9 commands: count is data
    expect(rows(env, 'SELECT COUNT(*) n FROM org_command')[0]!.n).toBe(9);
  });

  it('rejects malformed input with VALIDATION_FAILED', () => {
    const a = makeOrgEnv().hubActor();
    expect(code(() => createEntity(a, 'command', { code: '', name: 'x' }))).toBe('VALIDATION_FAILED');
    expect(code(() => createEntity(a, 'command', { code: 'OK', name: 'x', surprise: 1 }))).toBe('VALIDATION_FAILED');
    expect(code(() => createEntity(a, 'ship_command_assignment', { shipId: 'nope', commandId: 'nope', effectiveFrom: '2026-01-01' }))).toBe('VALIDATION_FAILED');
  });

  it('ship needs a fleet; tombstoned codes can be reused', () => {
    const env = makeOrgEnv();
    const a = env.hubActor();
    expect(code(() => createEntity(a, 'ship', { code: 'S', name: 'S' }))).toBe('DEPENDENCY_MISSING');
    createEntity(a, 'fleet', { code: 'F', name: 'F' });
    const d = createEntity(a, 'department', { code: 'ME', name: 'Marine Engineering' });
    tombstoneEntity(a, 'department', d.id as string, { expectedVersion: 1, reason: 'entered in error' });
    expect(createEntity(a, 'department', { code: 'ME', name: 'Marine Engineering' }).version).toBe(1);
  });

  it('workshop kinds enforce which parent applies', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    const [c1] = s.commandIds;
    expect(createEntity(a, 'workshop', { code: 'W1', name: 'Cmd', kind: 'command', commandId: c1 }).hasReplica).toBe(false);
    expect(createEntity(a, 'workshop', { code: 'W2', name: 'Spec', kind: 'specialist', hasReplica: true }).hasReplica).toBe(true);
    expect(createEntity(a, 'workshop', { code: 'W3', name: 'On', kind: 'onboard', shipId: s.shipId }).kind).toBe('onboard');
    expect(code(() => createEntity(a, 'workshop', { code: 'W4', name: 'x', kind: 'command' }))).toBe('VALIDATION_FAILED');
    expect(code(() => createEntity(a, 'workshop', { code: 'W5', name: 'x', kind: 'specialist', commandId: c1 }))).toBe('VALIDATION_FAILED');
    expect(code(() => createEntity(a, 'workshop', { code: 'W6', name: 'x', kind: 'onboard', shipId: s.shipId, commandId: c1 }))).toBe('VALIDATION_FAILED');
    expect(code(() => createEntity(a, 'workshop', { code: 'W7', name: 'x', kind: 'onboard', shipId: '018f0000-0000-7000-8000-000000000000' }))).toBe('DEPENDENCY_MISSING');
  });
});

describe('ship ↔ command assignments', () => {
  it('rejects overlapping assignments, and the database trigger backs the rule', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    const [c1, c2] = s.commandIds as [string, string];
    createEntity(a, 'ship_command_assignment', { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-01-01'), effectiveTo: T('2026-06-01') });
    expect(code(() => createEntity(a, 'ship_command_assignment', { shipId: s.shipId, commandId: c2, effectiveFrom: T('2026-05-01') }))).toBe('VALIDATION_FAILED');
    // adjacent (touching) intervals are fine: [from, to)
    createEntity(a, 'ship_command_assignment', { shipId: s.shipId, commandId: c2, effectiveFrom: T('2026-06-01') });
    // bypass the service: the trigger must still refuse
    expect(() =>
      env.ctx.db
        .prepare(`INSERT INTO org_ship_command_assignment (id, version, owner_installation_id, created_at, created_by, created_installation_id, updated_at, updated_by, ship_id, command_id, effective_from)
                  VALUES ('x1', 1, 'o', 'n', 'u', 'o', 'n', 'u', ?, ?, ?)`)
        .run(s.shipId, c1, T('2026-02-01')),
    ).toThrow(/overlap/);
  });

  it('answers effective-dated lookups with half-open intervals', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    const [c1, c2] = s.commandIds as [string, string];
    createEntity(a, 'ship_command_assignment', { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-01-01'), effectiveTo: T('2026-06-01') });
    createEntity(a, 'ship_command_assignment', { shipId: s.shipId, commandId: c2, effectiveFrom: T('2026-06-01') });
    const db = env.ctx.db;
    expect(getShipCommandAt(db, s.shipId, T('2025-12-31'))).toBeNull();
    expect(getShipCommandAt(db, s.shipId, T('2026-01-01'))?.commandId).toBe(c1);
    expect(getShipCommandAt(db, s.shipId, '2026-05-31T23:59:59.999Z')?.commandId).toBe(c1);
    expect(getShipCommandAt(db, s.shipId, T('2026-06-01'))?.commandId).toBe(c2);
    expect(getShipCommandAt(db, s.shipId, T('2027-01-01'))?.effectiveTo).toBeNull();
    expect(() => getShipCommandAt(db, s.shipId, '2026-01-01')).toThrow(AppError);
    expect(listShipsByCommand(db, c1, T('2026-03-01')).map((x) => x.code)).toEqual(['SH1']);
    expect(listShipsByCommand(db, c1, T('2026-07-01'))).toEqual([]);
  });

  it('reassign closes the old assignment and opens the new atomically, changing no record owners', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    const [c1, c2] = s.commandIds as [string, string];
    createEntity(hub, 'ship_command_assignment', { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-01-01') });
    // a location entered by the ship's own installation
    const ship = env.shipActor(s.shipId);
    const loc = createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'ER', name: 'Engine Room' });
    const shipRowBefore = rows(env, 'SELECT version, owner_installation_id FROM org_ship WHERE id = ?', s.shipId)[0];

    const r = reassignShip(hub, { shipId: s.shipId, commandId: c2, effectiveFrom: T('2026-04-01'), reason: 'Refit support' });
    expect(r.closed).toMatchObject({ effectiveTo: T('2026-04-01'), version: 2 });
    expect(r.created).toMatchObject({ commandId: c2, effectiveFrom: T('2026-04-01'), effectiveTo: null });
    expect(getShipCommandAt(env.ctx.db, s.shipId, T('2026-03-31'))?.commandId).toBe(c1);
    expect(getShipCommandAt(env.ctx.db, s.shipId, T('2026-04-01'))?.commandId).toBe(c2);

    // ownership and identity untouched
    expect(rows(env, 'SELECT version, owner_installation_id FROM org_ship WHERE id = ?', s.shipId)[0]).toEqual(shipRowBefore);
    expect(rows(env, 'SELECT owner_installation_id, version, home_scope_id FROM org_location WHERE id = ?', loc.id as string)[0]).toEqual({
      owner_installation_id: ship.wctx.installation.installationId, version: 1, home_scope_id: s.shipId,
    });
    // audit reason recorded
    expect(rows(env, "SELECT reason FROM sys_audit_event WHERE entity_type = 'org.ship_command_assignment' AND action = 'create' AND reason IS NOT NULL")).toHaveLength(1);
  });

  it('reassign refuses same command, later assignments, and inactive commands, leaving data unchanged', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    const [c1, c2] = s.commandIds as [string, string];
    createEntity(hub, 'ship_command_assignment', { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-01-01') });
    expect(code(() => reassignShip(hub, { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-02-01') }))).toBe('VALIDATION_FAILED');
    expect(code(() => reassignShip(hub, { shipId: s.shipId, commandId: c2, effectiveFrom: T('2025-12-01') }))).toBe('WORKFLOW_BLOCKED');
    const cmd = rows(env, 'SELECT id, version FROM org_command WHERE id = ?', c2)[0]!;
    updateEntity(hub, 'command', c2, { expectedVersion: cmd.version, status: 'inactive' });
    expect(code(() => reassignShip(hub, { shipId: s.shipId, commandId: c2, effectiveFrom: T('2026-02-01') }))).toBe('WORKFLOW_BLOCKED');
    expect(rows(env, 'SELECT effective_to FROM org_ship_command_assignment')).toEqual([{ effective_to: null }]);
  });

  it('blocks deactivating or removing a command that still has ships', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    const c1 = s.commandIds[0]!;
    createEntity(hub, 'ship_command_assignment', { shipId: s.shipId, commandId: c1, effectiveFrom: T('2026-01-01') });
    expect(code(() => updateEntity(hub, 'command', c1, { expectedVersion: 1, status: 'inactive' }))).toBe('WORKFLOW_BLOCKED');
    expect(code(() => tombstoneEntity(hub, 'command', c1, { expectedVersion: 1, reason: 'oops' }))).toBe('WORKFLOW_BLOCKED');
    expect(code(() => tombstoneEntity(hub, 'ship', s.shipId, { expectedVersion: 1, reason: 'oops' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('the current-command view follows the clock', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    createEntity(hub, 'ship_command_assignment', { shipId: s.shipId, commandId: s.commandIds[0], effectiveFrom: T('2020-01-01') });
    const v = rows(env, 'SELECT * FROM org_v_ship_current_command');
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ ship_code: 'SH1', command_code: 'C1' });
    createEntity(hub, 'ship', { code: 'SH2', name: 'Unattached' });
    expect(rows(env, 'SELECT command_id FROM org_v_ship_current_command WHERE ship_code = ?', 'SH2')[0]).toEqual({ command_id: null });
  });
});

describe('ownership, versions and permissions', () => {
  it('only the hub writes reference data; other installations get NOT_OWNER', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const ship = env.shipActor(s.shipId);
    expect(code(() => createEntity(ship, 'command', { code: 'N', name: 'N' }))).toBe('NOT_OWNER');
    expect(code(() => updateEntity(ship, 'ship', s.shipId, { expectedVersion: 1, name: 'Renamed' }))).toBe('NOT_OWNER');
    expect(code(() => tombstoneEntity(ship, 'ship', s.shipId, { expectedVersion: 1, reason: 'x' }))).toBe('NOT_OWNER');
    expect(code(() => reassignShip(ship, { shipId: s.shipId, commandId: s.commandIds[0], effectiveFrom: T('2026-01-01') }))).toBe('NOT_OWNER');
  });

  it('stale updates fail with VERSION_CONFLICT carrying the current version', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    updateEntity(hub, 'ship', s.shipId, { expectedVersion: 1, name: 'Ship Uno' });
    try {
      updateEntity(hub, 'ship', s.shipId, { expectedVersion: 1, name: 'Ship Dos' });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VERSION_CONFLICT');
      expect((e as AppError).details).toMatchObject({ currentVersion: 2, expectedVersion: 1 });
    }
    expect(code(() => tombstoneEntity(hub, 'ship', s.shipId, { expectedVersion: 1, reason: 'x' }))).toBe('VERSION_CONFLICT');
    expect(code(() => updateEntity(hub, 'ship', s.shipId, { name: 'no version' }))).toBe('VALIDATION_FAILED');
  });

  it('denied permissions create nothing, change nothing, and are audited', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const nope = env.hubActor(denyOnly('org.ship.create', 'org.ship.update', 'org.ship.remove', 'org.ship_command_assignment.update'));
    const before = rows(env, 'SELECT COUNT(*) n FROM org_ship')[0]!.n;
    expect(code(() => createEntity(nope, 'ship', { code: 'NEW', name: 'New' }))).toBe('FORBIDDEN');
    expect(code(() => updateEntity(nope, 'ship', s.shipId, { expectedVersion: 1, name: 'X' }))).toBe('FORBIDDEN');
    expect(code(() => tombstoneEntity(nope, 'ship', s.shipId, { expectedVersion: 1, reason: 'x' }))).toBe('FORBIDDEN');
    expect(code(() => reassignShip(nope, { shipId: s.shipId, commandId: s.commandIds[0], effectiveFrom: T('2026-01-01') }))).toBe('FORBIDDEN');
    expect(rows(env, 'SELECT COUNT(*) n FROM org_ship')[0]!.n).toBe(before);
    expect(rows(env, 'SELECT version FROM org_ship WHERE id = ?', s.shipId)[0]).toEqual({ version: 1 });
    expect(rows(env, "SELECT COUNT(*) n FROM org_ship_command_assignment")[0]!.n).toBe(0);
    const denied = rows(env, "SELECT action, entity_type, actor_user_id FROM sys_audit_event WHERE outcome = 'denied'");
    expect(denied.length).toBe(4);
    expect(denied[0]).toMatchObject({ action: 'denied:org.ship.create', entity_type: 'org.ship', actor_user_id: 'tester' });
  });

  it('every successful write leaves an audit row and a change-log entry', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    updateEntity(hub, 'ship', s.shipId, { expectedVersion: 1, shipClass: 'Demo class' });
    const audit = rows(env, "SELECT action, entity_version, changes FROM sys_audit_event WHERE entity_id = ? ORDER BY occurred_at, id", s.shipId);
    expect(audit.map((r) => r.action)).toEqual(['create', 'update']);
    expect(JSON.parse(audit[1]!.changes as string)).toEqual({ ship_class: [null, 'Demo class'] });
    const log = rows(env, "SELECT op, version FROM sys_change_log WHERE entity_id = ? AND entity_type = 'org.ship' ORDER BY seq", s.shipId);
    expect(log).toEqual([{ op: 'upsert', version: 1 }, { op: 'upsert', version: 2 }]);
  });
});

describe('locations', () => {
  const setup = () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const other = createEntity(env.hubActor(), 'ship', { code: 'SH2', name: 'Ship Two' }).id as string;
    return { env, s, other, ship: env.shipActor(s.shipId), hub: env.hubActor() };
  };

  it('builds a tree per ship with readable paths and unique codes per parent', () => {
    const { env, s, ship } = setup();
    const deck = createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'LOWER', name: 'Lower Deck', kind: 'deck' });
    const er = createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: deck.id, code: 'ER', name: 'Engine Room' });
    const ps = createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: er.id, code: 'PS', name: 'Port Side', kind: 'space' });
    expect(getLocation(env.ctx.db, ps.id as string)).toMatchObject({ pathText: 'Lower Deck / Engine Room / Port Side', siteId: s.shipId, siteKind: 'ship' });
    expect(code(() => createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: deck.id, code: 'er', name: 'Dup' }))).toBe('DUPLICATE');
    createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'ER', name: 'Same code at another level is fine' });
    expect(ship.wctx.installation.installationId).toBe(rows(env, 'SELECT owner_installation_id o FROM org_location WHERE id = ?', er.id as string)[0]!.o);
  });

  it('keeps trees inside one site and prevents cycles, deep nesting and orphaning', () => {
    const { env, s, other, ship, hub } = setup();
    const a = createEntity(hub, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'A', name: 'A' });
    const b = createEntity(hub, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: a.id, code: 'B', name: 'B' });
    const foreign = createEntity(hub, 'location', { siteKind: 'ship', siteId: other, code: 'A', name: 'Other ship' });
    expect(code(() => createEntity(hub, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: foreign.id, code: 'X', name: 'x' }))).toBe('VALIDATION_FAILED');
    expect(code(() => updateEntity(hub, 'location', a.id as string, { expectedVersion: 1, parentId: b.id }))).toBe('VALIDATION_FAILED'); // cycle
    expect(code(() => updateEntity(hub, 'location', a.id as string, { expectedVersion: 1, parentId: a.id }))).toBe('VALIDATION_FAILED'); // self
    expect(code(() => tombstoneEntity(hub, 'location', a.id as string, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED'); // has child
    let parent = b.id as string;
    let depthError = 'NO_ERROR';
    for (let i = 0; i < 12 && depthError === 'NO_ERROR'; i++) {
      depthError = code(() => (parent = createEntity(hub, 'location', { siteKind: 'ship', siteId: s.shipId, parentId: parent, code: `D${i}`, name: `D${i}` }).id as string));
    }
    expect(depthError).toBe('VALIDATION_FAILED');
    void env;
    void ship;
  });

  it('is owned by the installation that entered it; a ship enters only its own site', () => {
    const { env, s, other, ship, hub } = setup();
    expect(code(() => createEntity(ship, 'location', { siteKind: 'ship', siteId: other, code: 'X', name: 'Not my ship' }))).toBe('NOT_OWNER');
    const mine = createEntity(ship, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'MINE', name: 'Mine' });
    // the hub is not the owner, so it cannot overwrite a ship-owned location
    expect(code(() => updateEntity(hub, 'location', mine.id as string, { expectedVersion: 1, name: 'Hub edit' }))).toBe('NOT_OWNER');
    expect(updateEntity(ship, 'location', mine.id as string, { expectedVersion: 1, name: 'Renamed' }).version).toBe(2);
    expect(code(() => tombstoneEntity(hub, 'location', mine.id as string, { expectedVersion: 2, reason: 'x' }))).toBe('NOT_OWNER');
    expect(tombstoneEntity(ship, 'location', mine.id as string, { expectedVersion: 2, reason: 'duplicate entry' }).deletedAt).toBeTruthy();
    expect(getLocation(env.ctx.db, mine.id as string)).toBeNull();
  });

  it('blocks removing a ship that still has locations', () => {
    const { s, hub } = setup();
    createEntity(hub, 'location', { siteKind: 'ship', siteId: s.shipId, code: 'A', name: 'A' });
    expect(code(() => tombstoneEntity(hub, 'ship', s.shipId, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
  });
});

describe('PartyRef resolution', () => {
  it('resolves each party kind and returns null for tombstoned or unknown ids', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const hub = env.hubActor();
    const dept = createEntity(hub, 'department', { code: 'EE', name: 'Electrical Engineering' });
    const ws = createEntity(hub, 'workshop', { code: 'WS', name: 'Workshop', kind: 'specialist' });
    const ext = createEntity(hub, 'external_provider', { code: 'EXT', name: 'Provider', contactEmail: 'a@example.invalid' });
    const db = env.ctx.db;
    expect(resolveParty(db, { kind: 'department', id: dept.id as string })).toMatchObject({ code: 'EE', name: 'Electrical Engineering' });
    expect(resolveParty(db, { kind: 'workshop', id: ws.id as string })?.code).toBe('WS');
    expect(resolveParty(db, { kind: 'external_provider', id: ext.id as string })?.code).toBe('EXT');
    expect(resolveParty(db, { kind: 'ship', id: s.shipId })?.code).toBe('SH1');
    expect(resolveParty(db, { kind: 'command', id: s.commandIds[0]! })?.code).toBe('C1');
    tombstoneEntity(hub, 'department', dept.id as string, { expectedVersion: 1, reason: 'x' });
    expect(resolveParty(db, { kind: 'department', id: dept.id as string })).toBeNull();
    expect(resolveParty(db, { kind: 'command', id: s.shipId })).toBeNull(); // wrong kind
  });
});

describe('demo seed', () => {
  it('loads seven commands, ships, workshops and locations through the normal write path, hub only', () => {
    const env = makeOrgEnv();
    const result = seedDemoOrganization(env.hubActor());
    expect(result).toEqual({ commands: 7, ships: 3, locations: 18 });
    expect(rows(env, 'SELECT COUNT(*) n FROM org_workshop')[0]!.n).toBe(3);
    // the seeded reattachment is visible in effective-dated lookups
    const ship = rows(env, "SELECT id FROM org_ship WHERE code = 'DEMO-102'")[0]!.id as string;
    expect(getShipCommandAt(env.ctx.db, ship, T('2025-06-01'))?.commandId).not.toBe(getShipCommandAt(env.ctx.db, ship, T('2026-06-01'))?.commandId);
    expect(rows(env, "SELECT COUNT(*) n FROM sys_change_log WHERE entity_type LIKE 'org.%'")[0]!.n).toBeGreaterThan(30);
    expect(code(() => seedDemoOrganization(env.hubActor()))).toBe('DUPLICATE'); // not idempotent by design: refuses to double-seed
    expect(() => seedDemoOrganization(env.shipActor(null))).toThrow(/hub only/);
  });
});
