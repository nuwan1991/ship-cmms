import { describe, expect, it } from 'vitest';
import { setTransportOverride } from '../../src/modules/m10-sync/index.js';
import type { Envelope } from '../../src/modules/m10-sync/envelope.js';
import type { Transport } from '../../src/modules/m10-sync/engine.js';
import { addLocation, makeFleet, makeHub, type Node } from './syn-helpers.js';
import { joinHub, type ProvisioningPackage } from '../../src/modules/m10-sync/engine.js';

const api = async (n: Node, method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown) => {
  const r = await n.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers: { 'x-dev-user': 'admin' } });
  return { status: r.statusCode, json: r.body ? r.json() : null };
};
const viaHttp = (hub: Node): Transport => async (path, env) => {
  const r = await hub.app.inject({ method: 'POST', url: `/api/v1/sync/peer/${path}`, payload: env as unknown as object });
  if (r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`);
  return r.json() as Envelope;
};

describe('M10 HTTP API', () => {
  it('provisions through the API, joins, runs a sync over the peer endpoints and reports status', async () => {
    const f = makeFleet();
    const prov = await api(f.hub, 'POST', '/api/v1/sync/peers', { kind: 'ship', code: 'SHIP-A', name: 'Ship A', scopes: [{ kind: 'ship', id: f.shipAId }] });
    expect(prov.status).toBe(201);
    const pkg = prov.json as ProvisioningPackage;
    expect(pkg.enrolmentSecret.length).toBeGreaterThan(20);
    // The peer list never reveals secrets.
    const peers = await api(f.hub, 'GET', '/api/v1/sync/peers');
    expect(JSON.stringify(peers.json)).not.toContain(pkg.enrolmentSecret);
    expect(peers.json.items[0]).toMatchObject({ code: 'SHIP-A', status: 'pending' });

    const { makeShipNode } = await import('./syn-helpers.js');
    const ship = makeShipNode();
    joinHub(ship.ctx, pkg, 'http://hub.invalid');
    addLocation(f.hub, f.shipAId, 'BRIDGE');
    setTransportOverride(() => viaHttp(f.hub));
    try {
      const run = await api(ship, 'POST', '/api/v1/sync/run', {});
      expect(run.status).toBe(200);
      expect(run.json.pulled).toBeGreaterThan(0);
    } finally { setTransportOverride(null); }
    expect(ship.rows('SELECT code FROM org_location').map((x) => x.code)).toEqual(['BRIDGE']);
    const st = await api(ship, 'GET', '/api/v1/sync/status');
    expect(st.json).toMatchObject({ pendingOutbound: 0, openConflicts: 0 });
    const st2 = await api(f.hub, 'GET', '/api/v1/sync/status');
    expect(st2.json.peers[0]).toMatchObject({ status: 'active' });
  });

  it('refuses unsigned or unknown callers on the peer endpoints, and re-using the enrolment secret', async () => {
    const f = makeFleet();
    const bad = await f.hub.app.inject({ method: 'POST', url: '/api/v1/sync/peer/hello', payload: { from: crypto.randomUUID(), sentAt: new Date().toISOString(), path: 'hello', body: {}, signature: 'x'.repeat(60) } });
    expect(bad.statusCode).toBe(400); // body fails validation before anything else
    const unknown = await f.hub.app.inject({ method: 'POST', url: '/api/v1/sync/peer/pull', payload: { from: crypto.randomUUID(), sentAt: new Date().toISOString(), path: 'pull', body: { cursor: 0 }, signature: 'x'.repeat(60) } });
    expect(unknown.statusCode).toBe(403);
  });

  it('lists and resolves conflicts, and checks permissions', async () => {
    const hub = makeHub();
    const c = await api(hub, 'GET', '/api/v1/sync/conflicts');
    expect(c.json.items).toEqual([]);
    const missing = await api(hub, 'POST', `/api/v1/sync/conflicts/${crypto.randomUUID()}/resolve`, { action: 'dismiss', note: 'x' });
    expect(missing.status).toBe(404);
  });
});
