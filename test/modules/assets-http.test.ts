import { describe, expect, it } from 'vitest';
import { seedDemoOrganization } from '../../src/modules/m01-organization/seed.js';
import { currentInstallation, register, responsibilityAt } from '../../src/modules/m03-assets/index.js';
import { seedDemoAssets } from '../../src/modules/m03-assets/seed.js';
import { makeActor } from '../../src/modules/m03-assets/actor.js';
import { makeOrgEnv } from './org-helpers.js';
import { iso, makeAstEnv, sql, type AstEnv } from './ast-helpers.js';

const BASE = '/api/v1/assets';
type Res = { status: number; json: any };
async function call(env: AstEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<Res> {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M03 HTTP API', () => {
  it('builds a position tree, registers and installs an asset, and shows it with its path', async () => {
    const env = makeAstEnv({ devAuth: true });
    const sys = await call(env, 'POST', `${BASE}/positions`, { shipId: env.shipId, positionTag: '2', name: 'Electrical power' });
    expect(sys.status).toBe(201);
    expect(sys.json).toMatchObject({ level: 'system', version: 1, homeScopeId: env.shipId });
    const eq = await call(env, 'POST', `${BASE}/positions`, { shipId: env.shipId, parentId: sys.json.id, positionTag: '2.1', name: 'Generator' });
    const asset = await call(env, 'POST', `${BASE}/assets`, { name: 'Generator engine', homeShipId: env.shipId, manufacturer: 'Acme', serialNumber: 'SN-9', positionId: eq.json.id });
    expect(asset.status).toBe(201);
    expect(asset.json).toMatchObject({ assetTag: 'SLN-EQ-00000001', serialNumber: 'SN-9', state: { positionId: eq.json.id, assetStatus: 'in_service' } });

    const detail = await call(env, 'GET', `${BASE}/assets/${asset.json.id}`);
    expect(detail.json.installation.position.pathText).toBe('Electrical power / Generator');
    expect(detail.json.custodyParty).toMatchObject({ kind: 'ship', code: 'SH1' });
    const pos = await call(env, 'GET', `${BASE}/positions/${eq.json.id}`);
    expect(pos.json).toMatchObject({ pathText: 'Electrical power / Generator', responsibility: null, asset: { assetTag: 'SLN-EQ-00000001' } });
    const byTag = await call(env, 'GET', `${BASE}/assets/resolve?tag=sln-eq-00000001`);
    expect(byTag.json.id).toBe(asset.json.id);
    expect((await call(env, 'GET', `${BASE}/tag-ranges/remaining`)).json).toEqual({ sequence: 'equipment_tag', remaining: 49 });
  });

  it('lists with filters, search and cursor pagination, and always returns freshness', async () => {
    const env = makeAstEnv({ devAuth: true });
    const p = await call(env, 'POST', `${BASE}/positions`, { shipId: env.shipId, positionTag: '1', name: 'Propulsion' });
    for (const [n, positioned] of [['Pump', true], ['Valve', false], ['Fan', false]] as const) {
      await call(env, 'POST', `${BASE}/assets`, { name: n, homeShipId: env.shipId, ...(positioned ? { positionId: p.json.id } : {}) });
    }
    const all = await call(env, 'GET', `${BASE}/assets?limit=2`);
    expect(all.json.items).toHaveLength(2);
    expect(all.json.nextCursor).toBeTruthy();
    expect(all.json.freshness[0]).toMatchObject({ stale: false });
    const rest = await call(env, 'GET', `${BASE}/assets?limit=2&cursor=${all.json.nextCursor}`);
    expect(rest.json.items).toHaveLength(1);
    expect(rest.json.nextCursor).toBeNull();
    expect((await call(env, 'GET', `${BASE}/assets?q=pump`)).json.items.map((i: any) => i.name)).toEqual(['Pump']);
    expect((await call(env, 'GET', `${BASE}/assets?positionId=${p.json.id}`)).json.items).toHaveLength(1);
    expect((await call(env, 'GET', `${BASE}/assets?shipId=${env.shipId}`)).json.items).toHaveLength(1);
    expect((await call(env, 'GET', `${BASE}/positions?shipId=${env.shipId}&parentId=root`)).json.items).toHaveLength(1);
    expect((await call(env, 'GET', `${BASE}/assets?bogus=1`)).status).toBe(400);
  });

  it('appends movements and lists history newest first, with corrections linked', async () => {
    const env = makeAstEnv({ devAuth: true });
    const p = await call(env, 'POST', `${BASE}/positions`, { shipId: env.shipId, positionTag: '1', name: 'Propulsion' });
    const a = await call(env, 'POST', `${BASE}/assets`, { name: 'Pump', homeShipId: env.shipId, positionId: p.json.id });
    const rem = await call(env, 'POST', `${BASE}/assets/${a.json.id}/movements`, { kind: 'remove', note: 'Landed' });
    expect(rem.status).toBe(201);
    expect(rem.json.current.positionId).toBeNull();
    const voided = await call(env, 'POST', `${BASE}/assets/${a.json.id}/movements`, { kind: 'void', correctsMovementId: rem.json.movement.id, note: 'Entered by mistake' });
    expect(voided.json.current.positionId).toBe(p.json.id);
    const hist = await call(env, 'GET', `${BASE}/assets/${a.json.id}/movements`);
    expect(hist.json.items.map((m: any) => m.kind)).toEqual(['void', 'remove', 'install', 'register']);
    expect(hist.json.items.find((m: any) => m.kind === 'remove').voided).toBe(true);
    expect(hist.json.items[0].voided).toBe(false);
  });

  it('answers errors with the shared envelope', async () => {
    const env = makeAstEnv({ devAuth: true });
    const a = await call(env, 'POST', `${BASE}/assets`, { name: 'Pump', homeShipId: env.shipId });
    const missing = '0190c0de-0000-7000-8000-000000000009';
    expect((await call(env, 'GET', `${BASE}/assets/${missing}`)).json.error.code).toBe('NOT_FOUND');
    expect((await call(env, 'GET', `${BASE}/assets/not-a-uuid`)).status).toBe(400);
    expect((await call(env, 'GET', `${BASE}/assets/resolve?tag=SLN-EQ-99999999`)).status).toBe(404);
    expect((await call(env, 'POST', `${BASE}/assets/${a.json.id}/movements`, { kind: 'install' })).status).toBe(400);
    expect((await call(env, 'POST', `${BASE}/assets/${a.json.id}/movements`, { kind: 'remove' })).json.error.code).toBe('WORKFLOW_BLOCKED');
    const bad = await call(env, 'PATCH', `${BASE}/assets/${a.json.id}`, { expectedVersion: 1, assetTag: 'SLN-EQ-00000099' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.correlationId).toBeTruthy();
    const ok = await call(env, 'PATCH', `${BASE}/assets/${a.json.id}`, { expectedVersion: 1, notes: 'n' });
    expect(ok.json.version).toBe(2);
    const stale = await call(env, 'PATCH', `${BASE}/assets/${a.json.id}`, { expectedVersion: 1, notes: 'm' });
    expect(stale.status).toBe(409);
    expect(stale.json.error.details.currentVersion).toBe(2);
    const tomb = await call(env, 'POST', `${BASE}/assets/${a.json.id}/tombstone`, { expectedVersion: 2, reason: 'Scrapped' });
    expect(tomb.json.deletedAt).toBeTruthy();
    expect((await call(env, 'GET', `${BASE}/assets/${a.json.id}`)).status).toBe(404);
  });

  it('a ship installation cannot change hub reference data over HTTP (NOT_OWNER)', async () => {
    const env = makeAstEnv({ devAuth: true });
    const ship = env.shipActor(env.shipId);
    env.ctx.identity = ship.wctx.installation;
    const r = await call(env, 'POST', `${BASE}/classifications`, { code: 'PUMP', name: 'Pump', kind: 'equipment' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('NOT_OWNER');
  });
});

describe('demo seed', () => {
  it('loads the generator/alternator example through the normal write path, hub only', () => {
    const env = makeOrgEnv();
    register(env.ctx, env.app);
    const actor = makeActor(env.ctx, { userId: 'system', installationId: env.hub.installationId, displayName: 'Seed' });
    seedDemoOrganization(actor);
    // The seed defines the equipment-tag sequence and grants the hub a range itself.
    expect(seedDemoAssets(actor)).toEqual({ classifications: 3, positions: 5, assets: 3 });

    const rows = sql(env, 'SELECT a.asset_tag, v.position_tag, v.asset_status, v.custody_party_kind FROM ast_asset a JOIN ast_v_asset_overview v ON v.asset_id = a.id ORDER BY a.asset_tag');
    expect(rows).toEqual([
      { asset_tag: 'SLN-EQ-00000001', position_tag: '2.1.1', asset_status: 'in_service', custody_party_kind: 'ship' },
      { asset_tag: 'SLN-EQ-00000002', position_tag: '2.1.2', asset_status: 'in_service', custody_party_kind: 'ship' },
      { asset_tag: 'SLN-EQ-00000003', position_tag: null, asset_status: 'under_repair', custody_party_kind: 'workshop' },
    ]);
    // Marine Engineering has the engine, Electrical Engineering the alternator.
    const pos = (tag: string) => sql(env, 'SELECT id FROM ast_position WHERE position_tag = ?', tag)[0]!.id as string;
    const dept = (positionTag: string) => sql(env, 'SELECT code FROM org_department WHERE id = ?', responsibilityAt(env.ctx.db, pos(positionTag), iso())?.departmentId)[0]!.code;
    expect(dept('2.1.1')).toBe('ME');
    expect(dept('2.1.2')).toBe('EE');
    const alt = sql(env, "SELECT id FROM ast_asset WHERE asset_tag = 'SLN-EQ-00000002'")[0]!.id as string;
    expect(currentInstallation(env.ctx.db, alt)?.positionTag).toBe('2.1.2');
    expect(() => seedDemoAssets(env.shipActor(null))).toThrow(/hub only/);
  });

  it('shows where an asset physically is and lists assets by location', async () => {
    const env = makeAstEnv({ devAuth: true });
    const deck = await call(env, 'POST', '/api/v1/org/locations', { siteKind: 'ship', siteId: env.shipId, code: 'D2', name: 'Deck 2', kind: 'deck' });
    const amr = await call(env, 'POST', '/api/v1/org/locations', { siteKind: 'ship', siteId: env.shipId, parentId: deck.json.id, code: 'AMR', name: 'Auxiliary machinery room', kind: 'compartment' });
    const store = await call(env, 'POST', '/api/v1/org/locations', { siteKind: 'ship', siteId: env.shipId, parentId: deck.json.id, code: 'ES', name: 'Electrical store', kind: 'room' });
    const fitted = await call(env, 'POST', `${BASE}/assets`, { name: 'Alternator', homeShipId: env.shipId, locationId: amr.json.id });
    const spare = await call(env, 'POST', `${BASE}/assets`, { name: 'Spare alternator', homeShipId: env.shipId, locationId: amr.json.id, assetStatus: 'in_store' });
    const mv = await call(env, 'POST', `${BASE}/assets/${spare.json.id}/movements`, { kind: 'status_change', assetStatus: 'in_store', locationId: store.json.id });
    expect(mv.status, JSON.stringify(mv.json)).toBe(201);

    // Same status and same location is not a movement.
    const again = await call(env, 'POST', `${BASE}/assets/${spare.json.id}/movements`, { kind: 'status_change', assetStatus: 'in_store', locationId: store.json.id });
    expect(again.status).toBe(400);
    expect((await call(env, 'GET', `${BASE}/assets/${fitted.json.id}`)).json.location).toMatchObject({ code: 'AMR', pathText: 'Deck 2 / Auxiliary machinery room' });
    const inStore = await call(env, 'GET', `${BASE}/assets?locationId=${store.json.id}`);
    expect(inStore.json.items.map((r: any) => r.name)).toEqual(['Spare alternator']);
    expect((await call(env, 'GET', `${BASE}/assets?locationId=${amr.json.id}`)).json.items.map((r: any) => r.name)).toEqual(['Alternator']);
  });
});
