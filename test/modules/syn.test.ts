import { describe, expect, it } from 'vitest';
import { payloadHash } from '../../src/platform/canonical.js';
import { exportBundle, handlePull, importBundle, retryQuarantined, resolveConflict, setSubscription, syncOnce, decommissionPeer, freshness } from '../../src/modules/m10-sync/engine.js';
import { applyChange } from '../../src/modules/m10-sync/apply.js';
import { signEnvelope } from '../../src/modules/m10-sync/envelope.js';
import { createRecord } from '../../src/platform/records.js';
import { addLocation, addShip, directTransport, makeFleet, renameLocation } from './syn-helpers.js';
import { codeOf } from './ast-helpers.js';
import { createFirstAdmin } from '../../src/modules/m02-identity/bootstrap.js';

describe('M10 provisioning and sync', () => {
  it('enrols a ship and brings fleet reference data and its scoped records', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    addLocation(f.hub, f.shipAId, 'BRIDGE');
    addLocation(f.hub, f.shipBId, 'OTHER-SHIP-ROOM');
    const r = await syncOnce(ship.ctx, directTransport(f.hub));
    expect(r.rejected).toBe(0);
    expect(ship.rows('SELECT code FROM org_ship ORDER BY code').map((x) => x.code)).toEqual(['SHA', 'SHB']); // fleet reference: all ships
    expect(ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['BRIDGE']);          // scoped data: own ship only
    expect(ship.rows("SELECT status FROM sys_installation WHERE code = 'SHIP-A'")).toHaveLength(1);
    expect(f.hub.rows("SELECT status FROM syn_peer WHERE code = 'SHIP-A'")[0]!.status).toBe('active');
  });

  it('is idempotent: a second run moves nothing', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    await syncOnce(ship.ctx, directTransport(f.hub));
    const again = await syncOnce(ship.ctx, directTransport(f.hub));
    expect(again.pulled).toBe(0);
    expect(again.pushed).toBe(0);
  });

  it('pushes ship records to the hub and delivers them to other subscribed installations, but not to unsubscribed ones', async () => {
    const f = makeFleet();
    const a = addShip(f.hub, 'SHIP-A', f.shipAId);
    const b = addShip(f.hub, 'SHIP-B', f.shipBId);
    const c = addShip(f.hub, 'SHIP-C', f.shipAId); // also follows ship A
    for (const s of [a, b, c]) await syncOnce(s.ship.ctx, directTransport(f.hub));
    addLocation(a.ship, f.shipAId, 'ENGINE-ROOM');
    const push = await syncOnce(a.ship.ctx, directTransport(f.hub));
    expect(push.accepted).toBeGreaterThan(0);
    expect(f.hub.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['ENGINE-ROOM']);
    await syncOnce(b.ship.ctx, directTransport(f.hub));
    await syncOnce(c.ship.ctx, directTransport(f.hub));
    expect(b.ship.rows('SELECT 1 FROM org_location')).toHaveLength(0);
    expect(c.ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['ENGINE-ROOM']);
    // The owner stays the origin ship everywhere.
    expect(c.ship.rows('SELECT owner_installation_id AS o FROM org_location')[0]!.o).toBe(a.ship.ctx.identity!.installationId);
  });

  it('sends later versions, and a non-owner cannot change a record it received', async () => {
    const f = makeFleet();
    const a = addShip(f.hub, 'SHIP-A', f.shipAId);
    const c = addShip(f.hub, 'SHIP-C', f.shipAId);
    const loc = addLocation(a.ship, f.shipAId, 'STORE');
    for (const s of [a, c]) await syncOnce(s.ship.ctx, directTransport(f.hub));
    renameLocation(a.ship, loc.id as string, 'Main store');
    await syncOnce(a.ship.ctx, directTransport(f.hub));
    await syncOnce(c.ship.ctx, directTransport(f.hub));
    expect(c.ship.rows('SELECT name, version FROM org_location')[0]).toMatchObject({ name: 'Main store', version: 2 });
    expect(codeOf(() => renameLocation(c.ship, loc.id as string, 'Hijack'))).toBe('NOT_OWNER');
  });

  it('refuses a replica writing hub reference data, even by sending it', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(codeOf(() => createRecord(ship.wctx(), 'org.ship', { fleet_id: f.fleetId, code: 'X', name: 'X' }))).toBe('NOT_OWNER');
  });

  it('treats an equal-version difference on owner data as a fork, quarantines it, and lets the owner decide', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    const loc = addLocation(ship, f.shipAId, 'STORE');
    await syncOnce(ship.ctx, directTransport(f.hub));
    // Tamper at the hub: same version, different content (a forked history).
    f.hub.ctx.db.prepare("UPDATE org_location SET name = 'Hub edit' WHERE id = ?").run(loc.id);
    // The ship writes version 2; the hub, at version 1 with a different hash, accepts it (higher version wins).
    renameLocation(ship, loc.id as string, 'Ship edit');
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(f.hub.rows('SELECT name FROM org_location')[0]!.name).toBe('Ship edit');
    // Now an equal-version fork: replay version 2 content that differs.
    const row = f.hub.rows('SELECT * FROM org_location')[0]!;
    const forked = { ...row, name: 'Different v2' };
    const change = { changeId: crypto.randomUUID(), originInstallationId: ship.ctx.identity!.installationId, entityType: 'org.location', entityId: row.id, op: 'upsert', version: row.version, ownerInstallationId: ship.ctx.identity!.installationId, homeScopeId: f.shipAId, occurredAt: new Date().toISOString(), schemaVersion: 1, payload: forked, payloadHash: payloadHash(forked) };
    const peerId = ship.ctx.identity!.installationId;
    const o = applyChange(f.hub.ctx, change, { installationId: peerId, isHub: false });
    expect(o).toMatchObject({ status: 'quarantined', code: 'FORK' });
    expect(f.hub.rows('SELECT name FROM org_location')[0]!.name).toBe('Ship edit'); // untouched
    const conflict = f.hub.rows("SELECT * FROM syn_conflict WHERE code = 'FORK'")[0]!;
    const resolved = resolveConflict(f.hub.ctx, conflict.id, { action: 'accept_incoming', note: 'Ship is the owner' }, 'admin');
    expect(resolved.status).toBe('resolved');
    expect(f.hub.rows('SELECT name FROM org_location')[0]!.name).toBe('Different v2');
  });

  it('quarantines tampered or newer-schema changes and rejects bad signatures and hashes', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    const loc = addLocation(ship, f.shipAId, 'STORE');
    const row = ship.rows('SELECT * FROM org_location')[0]!;
    const base = { originInstallationId: ship.ctx.identity!.installationId, entityType: 'org.location', entityId: row.id, op: 'upsert' as const, version: 1, ownerInstallationId: ship.ctx.identity!.installationId, homeScopeId: f.shipAId, occurredAt: new Date().toISOString() };
    const src = { installationId: ship.ctx.identity!.installationId, isHub: false };
    const bad = applyChange(f.hub.ctx, { ...base, changeId: crypto.randomUUID(), schemaVersion: 1, payload: row, payloadHash: 'a'.repeat(64) }, src);
    expect(bad).toMatchObject({ status: 'rejected', code: 'INTEGRITY' });
    const newer = applyChange(f.hub.ctx, { ...base, changeId: crypto.randomUUID(), schemaVersion: 99, payload: row, payloadHash: payloadHash(row) }, src);
    expect(newer).toMatchObject({ status: 'quarantined', code: 'SCHEMA_NEWER' });
    const notOwner = applyChange(f.hub.ctx, { ...base, originInstallationId: crypto.randomUUID(), ownerInstallationId: crypto.randomUUID(), changeId: crypto.randomUUID(), schemaVersion: 1, payload: row, payloadHash: payloadHash(row) }, src);
    expect(notOwner).toMatchObject({ status: 'rejected', code: 'NOT_OWNER' });
    const hubRef = applyChange(f.hub.ctx, { ...base, entityType: 'org.ship', changeId: crypto.randomUUID(), schemaVersion: 1, payload: row, payloadHash: payloadHash(row) }, src);
    expect(hubRef).toMatchObject({ status: 'rejected', code: 'NOT_OWNER' });
    // A forged envelope (signed by another key) is refused by the hub.
    const other = addShip(f.hub, 'SHIP-B', null).ship;
    const forged = signEnvelope(other.ctx.db, ship.ctx.identity!.installationId, 'pull', { cursor: 0 });
    expect(codeOf(() => handlePull(f.hub.ctx, forged))).toBe('FORBIDDEN');
    void loc;
    // Retrying after upgrade: once the hub knows the schema, nothing is left to retry in this test environment.
    expect(retryQuarantined(f.hub.ctx).retried).toBeGreaterThan(0);
  });

  it('rejects a reply that is not signed by the hub', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    const impostor = makeFleet().hub; // a different hub with a different key
    const t = async (path: 'hello' | 'push' | 'pull', env: Parameters<ReturnType<typeof directTransport>>[1]) => {
      const res = await directTransport(f.hub)(path, env);
      return { ...res, signature: signEnvelope(impostor.ctx.db, res.from, res.path, res.body).signature };
    };
    await expect(syncOnce(ship.ctx, t)).rejects.toThrow(/signature/);
  });

  it('backfills when a subscription grows, and stops delivering new records when it shrinks', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    addLocation(f.hub, f.shipBId, 'B-ROOM');
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(ship.rows('SELECT 1 FROM org_location')).toHaveLength(0);
    setSubscription(f.hub.ctx, ship.ctx.identity!.installationId, [{ kind: 'ship', id: f.shipAId }, { kind: 'ship', id: f.shipBId }], true);
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['B-ROOM']);
    setSubscription(f.hub.ctx, ship.ctx.identity!.installationId, [{ kind: 'ship', id: f.shipAId }], true);
    addLocation(f.hub, f.shipBId, 'B-ROOM-2');
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['B-ROOM']); // old data stays, no new updates
  });

  it('re-sends what a restored hub has lost', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    addLocation(ship, f.shipAId, 'STORE');
    await syncOnce(ship.ctx, directTransport(f.hub));
    // Simulate a hub restored from an older backup: it forgets what it accepted from this ship.
    f.hub.ctx.db.exec("DROP TRIGGER org_location_no_delete; DELETE FROM org_location; DELETE FROM sys_change_log WHERE entity_type = 'org.location'; UPDATE syn_peer SET accepted_origin_seq = 0 WHERE role = 'replica'");
    expect(f.hub.rows('SELECT 1 FROM org_location')).toHaveLength(0);
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(f.hub.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['STORE']);
  });

  it('refuses a decommissioned installation', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    await syncOnce(ship.ctx, directTransport(f.hub));
    decommissionPeer(f.hub.ctx, f.hub.wctx(), ship.ctx.identity!.installationId);
    await expect(syncOnce(ship.ctx, directTransport(f.hub))).rejects.toThrow(/decommissioned/);
    expect(f.hub.rows("SELECT status FROM sys_installation WHERE code = 'SHIP-A'")[0]!.status).toBe('decommissioned');
  });

  it('works through signed bundle files in both directions, in any order, and is replay-safe', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    addLocation(f.hub, f.shipAId, 'BRIDGE');
    const down = exportBundle(f.hub.ctx, { peerId: ship.ctx.identity!.installationId });
    const r1 = importBundle(ship.ctx, JSON.parse(JSON.stringify(down)));
    expect(r1.accepted).toBeGreaterThan(0);
    expect(ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['BRIDGE']);
    addLocation(ship, f.shipAId, 'ENGINE');
    const up = exportBundle(ship.ctx, {});
    const r2 = importBundle(f.hub.ctx, JSON.parse(JSON.stringify(up)));
    expect(r2.accepted).toBeGreaterThan(0);
    expect(f.hub.rows('SELECT code FROM org_location ORDER BY code').map((x) => x.code)).toEqual(['BRIDGE', 'ENGINE']);
    const replay = importBundle(f.hub.ctx, JSON.parse(JSON.stringify(up)));
    expect(replay.accepted).toBe(0);
    expect(replay.duplicates).toBe(up.changes.length);
    // Tampering is caught.
    const tampered = JSON.parse(JSON.stringify(up));
    tampered.changes[0].payload.name = 'x';
    expect(codeOf(() => importBundle(f.hub.ctx, tampered))).toBe('FORBIDDEN');
    // A bundle for someone else is refused.
    expect(codeOf(() => importBundle(f.hub.ctx, down))).toBe('WORKFLOW_BLOCKED');
    // The emergency export holds everything the ship ever wrote.
    expect(exportBundle(ship.ctx, { all: true }).changes.length).toBeGreaterThanOrEqual(up.changes.length);
  });

  it('reports freshness and clock skew', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    expect(freshness(ship.ctx)).toMatchObject({ asOf: null, stale: true });
    addLocation(ship, f.shipAId, 'STORE');
    expect(freshness(ship.ctx).pendingOutbound).toBeGreaterThan(0);
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(freshness(ship.ctx)).toMatchObject({ stale: false, pendingOutbound: 0 });
    expect(freshness(f.hub.ctx).stale).toBe(false);
  });

  it('publishes an applied event so modules can rebuild derived data', async () => {
    const f = makeFleet();
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    const seen: string[] = [];
    ship.ctx.events.subscribe('sys.sync.applied', (e) => seen.push(...(e.payload as { entityTypes: string[] }).entityTypes));
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(seen).toContain('org.ship');
  });

  it('delivers a user\'s credential only to the installations the user is provisioned to, even when the credential was written first', async () => {
    const f = makeFleet();
    const admin = await createFirstAdmin(f.hub.ctx, { username: 'admin', password: 'Harbour-Master-123', displayName: 'Admin' });
    const a = addShip(f.hub, 'SHIP-A', f.shipAId);
    const b = addShip(f.hub, 'SHIP-B', f.shipBId);
    await syncOnce(a.ship.ctx, directTransport(f.hub));
    await syncOnce(b.ship.ctx, directTransport(f.hub));
    // Users and roles are visible everywhere, credentials nowhere yet.
    expect(a.ship.rows('SELECT 1 FROM idn_user')).toHaveLength(1);
    expect(a.ship.rows('SELECT 1 FROM idn_credential')).toHaveLength(0);
    // The link is added after the credential was written.
    createRecord(f.hub.wctx(), 'idn.user_installation', { user_id: admin.userId, installation_id: a.ship.ctx.identity!.installationId });
    await syncOnce(a.ship.ctx, directTransport(f.hub));
    await syncOnce(b.ship.ctx, directTransport(f.hub));
    expect(a.ship.rows('SELECT username FROM idn_credential').map((r) => r.username)).toEqual(['admin']);
    expect(a.ship.rows('SELECT 1 FROM idn_user_installation')).toHaveLength(1);
    expect(b.ship.rows('SELECT 1 FROM idn_credential')).toHaveLength(0);
    expect(b.ship.rows('SELECT 1 FROM idn_user_installation')).toHaveLength(0);
  });
});
