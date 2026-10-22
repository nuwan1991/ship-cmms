import { afterEach, describe, expect, it } from 'vitest';
import { denyOnly, makeOrgEnv } from './org-helpers.js';

afterEach(() => {
  delete process.env.CMMS_DEV_AUTH;
});

const P = '/api/v1/org';
const json = (res: { json(): any }) => res.json();

async function post(app: ReturnType<typeof makeOrgEnv>['app'], url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload: payload as object, headers });
}

describe('M01 HTTP API', () => {
  it('creates, reads, updates and tombstones with the shared conventions', async () => {
    const { app } = makeOrgEnv({ devAuth: true });
    const created = await post(app, `${P}/commands`, { code: 'cmd-1', name: 'Command One' }, { 'x-correlation-id': 'corr-aaaaaaaa' });
    expect(created.statusCode).toBe(201);
    expect(created.headers['x-correlation-id']).toBe('corr-aaaaaaaa');
    const cmd = json(created);
    expect(cmd).toMatchObject({ code: 'CMD-1', name: 'Command One', version: 1, status: 'active' });
    expect(cmd.updatedAt).toMatch(/Z$/);
    expect(cmd).not.toHaveProperty('updated_at');

    expect(json(await app.inject(`${P}/commands/${cmd.id}`))).toMatchObject({ id: cmd.id, version: 1 });

    const updated = await app.inject({ method: 'PATCH', url: `${P}/commands/${cmd.id}`, payload: { expectedVersion: 1, name: 'Command 1' } });
    expect(json(updated)).toMatchObject({ name: 'Command 1', version: 2 });

    const stale = await app.inject({ method: 'PATCH', url: `${P}/commands/${cmd.id}`, payload: { expectedVersion: 1, name: 'Late edit' } });
    expect(stale.statusCode).toBe(409);
    expect(json(stale).error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });

    const gone = await post(app, `${P}/commands/${cmd.id}/tombstone`, { expectedVersion: 2, reason: 'created in error' });
    expect(gone.statusCode).toBe(200);
    expect(json(gone).deletedAt).toBeTruthy();
    expect((await app.inject(`${P}/commands/${cmd.id}`)).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `${P}/commands/${cmd.id}` })).statusCode).toBe(404); // no HTTP DELETE
  });

  it('lists with cursor pagination, search, filters and freshness; rejects unknown parameters', async () => {
    const { app } = makeOrgEnv({ devAuth: true });
    for (const c of ['ALFA', 'BRAVO', 'CHARLIE']) await post(app, `${P}/commands`, { code: c, name: `Command ${c}` });
    const p1 = json(await app.inject(`${P}/commands?limit=2`));
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    expect(p1.freshness).toEqual([{ scope: { kind: 'fleet' }, asOf: null, stale: false, pendingOutbound: 0 }]);
    const p2 = json(await app.inject(`${P}/commands?limit=2&cursor=${p1.nextCursor}`));
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(json(await app.inject(`${P}/commands?q=brav`)).items.map((i: any) => i.code)).toEqual(['BRAVO']);
    expect(json(await app.inject(`${P}/commands?q=%25`)).items).toHaveLength(0); // wildcard is escaped
    const bad = await app.inject(`${P}/commands?colour=red`);
    expect(bad.statusCode).toBe(400);
    expect(json(bad).error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects unauthenticated and unauthorized requests with the error envelope', async () => {
    const anon = makeOrgEnv();
    const r1 = await anon.app.inject(`${P}/commands`);
    expect(r1.statusCode).toBe(401);
    expect(json(r1).error).toMatchObject({ code: 'UNAUTHENTICATED' });

    const env = makeOrgEnv({ devAuth: true });
    env.ctx.authz.register(denyOnly('org.command.view', 'org.command.create'));
    const r2 = await env.app.inject(`${P}/commands`);
    expect(r2.statusCode).toBe(403);
    expect(json(r2).error).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'org.command.view' } });
    expect((await post(env.app, `${P}/commands`, { code: 'X', name: 'X' })).statusCode).toBe(403);
    expect(env.ctx.db.prepare("SELECT COUNT(*) n FROM org_command").get()).toEqual({ n: 0 });
    expect(env.ctx.db.prepare("SELECT COUNT(*) n FROM sys_audit_event WHERE outcome = 'denied'").get()).toEqual({ n: 2 });
  });

  it('validates bodies and ids', async () => {
    const { app } = makeOrgEnv({ devAuth: true });
    expect((await post(app, `${P}/commands`, { code: '', name: '' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: `${P}/commands` })).statusCode).toBe(400); // no body
    expect((await app.inject(`${P}/commands/not-a-uuid`)).statusCode).toBe(400);
    expect((await app.inject(`${P}/commands/018f0000-0000-7000-8000-000000000000`)).statusCode).toBe(404);
  });

  it('serves ships with their current command, effective-dated lookup and reassignment', async () => {
    const { app } = makeOrgEnv({ devAuth: true });
    await post(app, `${P}/fleets`, { code: 'F', name: 'Fleet' });
    const c1 = json(await post(app, `${P}/commands`, { code: 'C1', name: 'One' }));
    const c2 = json(await post(app, `${P}/commands`, { code: 'C2', name: 'Two' }));
    const ship = json(await post(app, `${P}/ships`, { code: 'S1', name: 'Ship', pennantNo: 'P1' }));
    expect(json(await app.inject(`${P}/ships`)).items[0].currentCommand).toBeNull();

    const a1 = await post(app, `${P}/ship-command-assignments`, { shipId: ship.id, commandId: c1.id, effectiveFrom: '2020-01-01T00:00:00.000Z' });
    expect(a1.statusCode).toBe(201);
    const overlap = await post(app, `${P}/ship-command-assignments`, { shipId: ship.id, commandId: c2.id, effectiveFrom: '2021-01-01T00:00:00.000Z' });
    expect(overlap.statusCode).toBe(400);
    expect(json(overlap).error.details).toMatchObject({ rule: 'ASSIGNMENT_OVERLAP' });

    const re = await post(app, `${P}/ships/${ship.id}/reassign`, { commandId: c2.id, effectiveFrom: '2024-01-01T00:00:00.000Z', reason: 'Refit' });
    expect(re.statusCode).toBe(200);
    expect(json(re).closed.effectiveTo).toBe('2024-01-01T00:00:00.000Z');

    const listed = json(await app.inject(`${P}/ships`)).items[0];
    expect(listed.currentCommand).toMatchObject({ code: 'C2', name: 'Two' });
    expect(json(await app.inject(`${P}/ships?commandId=${c1.id}`)).items).toHaveLength(0);
    expect(json(await app.inject(`${P}/ships?commandId=${c2.id}`)).items).toHaveLength(1);

    const at = json(await app.inject(`${P}/ships/${ship.id}/command?at=2022-06-01T00:00:00.000Z`));
    expect(at.command).toMatchObject({ code: 'C1' });
    expect(json(await app.inject(`${P}/ships/${ship.id}/command`)).command).toMatchObject({ code: 'C2' });
    expect((await app.inject(`${P}/ships/${ship.id}/command?at=2022-06-01`)).statusCode).toBe(400);
    expect(json(await app.inject(`${P}/ship-command-assignments?shipId=${ship.id}`)).items).toHaveLength(2);
  });

  it('serves location trees by site and resolves parties', async () => {
    const { app } = makeOrgEnv({ devAuth: true });
    await post(app, `${P}/fleets`, { code: 'F', name: 'Fleet' });
    const ship = json(await post(app, `${P}/ships`, { code: 'S1', name: 'Ship' }));
    const deck = json(await post(app, `${P}/locations`, { siteKind: 'ship', siteId: ship.id, code: 'MAIN', name: 'Main Deck', kind: 'deck' }));
    const er = json(await post(app, `${P}/locations`, { siteKind: 'ship', siteId: ship.id, parentId: deck.id, code: 'ER', name: 'Engine Room' }));
    expect(deck).toMatchObject({ homeScopeId: ship.id, siteKind: 'ship', parentId: null });

    const roots = json(await app.inject(`${P}/locations?siteId=${ship.id}&parentId=root`));
    expect(roots.items.map((i: any) => i.code)).toEqual(['MAIN']);
    expect(roots.freshness[0].scope).toEqual({ kind: 'ship', id: ship.id });
    expect(json(await app.inject(`${P}/locations?siteId=${ship.id}`)).items).toHaveLength(2);
    expect(json(await app.inject(`${P}/locations/${er.id}`)).path.map((p: any) => p.name)).toEqual(['Main Deck', 'Engine Room']);

    const dept = json(await post(app, `${P}/departments`, { code: 'ME', name: 'Marine Engineering' }));
    expect(json(await app.inject(`${P}/parties/resolve?kind=department&id=${dept.id}`))).toMatchObject({ kind: 'department', code: 'ME' });
    expect((await app.inject(`${P}/parties/resolve?kind=department&id=${ship.id}`)).statusCode).toBe(404);
    expect((await app.inject(`${P}/parties/resolve?kind=nonsense&id=${ship.id}`)).statusCode).toBe(400);
  });

  it('a ship installation cannot change hub reference data over HTTP (NOT_OWNER)', async () => {
    const env = makeOrgEnv({ devAuth: true });
    const ship = { installationId: '018f0000-0000-7000-8000-0000000000aa', kind: 'ship' as const, code: 'SHIP1', name: 'Ship' };
    env.ctx.identity = ship;
    const res = await post(env.app, `${P}/commands`, { code: 'N', name: 'N' });
    expect(res.statusCode).toBe(409);
    expect(json(res).error.code).toBe('NOT_OWNER');
  });
});
