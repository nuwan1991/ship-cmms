/**
 * Ship sections / command departments (M01), the user's home section (M02), and who asked for, supervises and works on
 * a work order (M05).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIP_SECTIONS } from '../../src/modules/m01-organization/index.js';
import { createEntity, ensureDefaultSections, tombstoneEntity, updateEntity } from '../../src/modules/m01-organization/service.js';
import { createResource, updateResource } from '../../src/modules/m02-identity/service.js';
import { createWorkOrder } from '../../src/modules/m05-work/index.js';
import { acceptRepair, addCrewMember, closeWorkOrder, removeCrewMember, tombstoneWorkOrder, updateWorkOrder, changeProgress } from '../../src/modules/m05-work/service.js';
import { codeOf } from './ast-helpers.js';
import { makeIdnEnv } from './idn-helpers.js';
import { denyOnly, makeOrgEnv, seedBasics } from './org-helpers.js';
import { makeWrkEnv } from './wrk-helpers.js';

const rows = (db: { prepare(s: string): { all(...p: unknown[]): unknown[] } }, q: string, ...p: unknown[]) => db.prepare(q).all(...p) as Array<Record<string, unknown>>;

describe('ship sections and command departments', () => {
  it('a new ship starts with Electrical, Engineering and General, owned by that ship', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const got = rows(env.ctx.db, "SELECT code, name, owner_kind, owner_id FROM org_department WHERE owner_id = ? AND deleted_at IS NULL ORDER BY sort_order", s.shipId);
    expect(got).toEqual(DEFAULT_SHIP_SECTIONS.map((d) => ({ code: d.code, name: d.name, owner_kind: 'ship', owner_id: s.shipId })));
  });

  it('codes are unique per owner, so every ship has its own ENG, and large ships can add more', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    const ship2 = createEntity(a, 'ship', { code: 'SH2', name: 'Ship Two' });
    expect(rows(env.ctx.db, "SELECT 1 FROM org_department WHERE code = 'ENG' AND deleted_at IS NULL")).toHaveLength(2);
    const wpn = createEntity(a, 'department', { code: 'WPN', name: 'Weapons', ownerKind: 'ship', ownerId: s.shipId });
    expect(wpn).toMatchObject({ ownerKind: 'ship', ownerId: s.shipId, code: 'WPN' });
    expect(codeOf(() => createEntity(a, 'department', { code: 'ENG', name: 'Engineering 2', ownerKind: 'ship', ownerId: s.shipId }))).toBe('DUPLICATE');
    // A command HQ department may use the same code as a ship section.
    expect(createEntity(a, 'department', { code: 'ENG', name: 'Technical HQ', ownerKind: 'command', ownerId: s.commandIds[0] })).toMatchObject({ ownerKind: 'command' });
    void ship2;
  });

  it('owner kind and id go together and must exist', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    expect(codeOf(() => createEntity(a, 'department', { code: 'X', name: 'X', ownerKind: 'ship' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createEntity(a, 'department', { code: 'X', name: 'X', ownerId: s.shipId }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createEntity(a, 'department', { code: 'X', name: 'X', ownerKind: 'ship', ownerId: s.commandIds[0] }))).toBe('DEPENDENCY_MISSING');
    // Legacy departments without an owner still work (treated as command departments not yet attached).
    expect(createEntity(a, 'department', { code: 'OLD', name: 'Old dept' })).toMatchObject({ ownerKind: null, ownerId: null });
  });

  it('a ship section is managed under that ship\'s authority', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const seen: Array<{ permission: string; scope: unknown }> = [];
    const spy = { name: 'spy', check: (_p: unknown, permission: string, scope: unknown) => { seen.push({ permission, scope }); return { allowed: true }; } };
    createEntity(env.hubActor(spy as never), 'department', { code: 'HULL', name: 'Hull', ownerKind: 'ship', ownerId: s.shipId });
    expect(seen).toContainEqual({ permission: 'org.department.create', scope: { kind: 'ship', id: s.shipId } });
    expect(codeOf(() => createEntity(env.hubActor(denyOnly('org.department.create')), 'department', { code: 'HULL2', name: 'Hull', ownerKind: 'ship', ownerId: s.shipId }))).toBe('FORBIDDEN');
  });

  it('moving a section to another ship needs the right on the new ship too', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const ship2 = createEntity(env.hubActor(), 'ship', { code: 'SH2', name: 'Ship Two' }).id as string;
    const sec = createEntity(env.hubActor(), 'department', { code: 'HULL', name: 'Hull', ownerKind: 'ship', ownerId: s.shipId });
    const onlyShip1 = { name: 'ship1', check: (_p: unknown, _perm: string, scope?: { id?: string }) => (scope?.id === ship2 ? { allowed: false, reason: 'not ship 2' } : { allowed: true }) };
    expect(codeOf(() => updateEntity(env.hubActor(onlyShip1 as never), 'department', sec.id as string, { expectedVersion: 1, ownerId: ship2 }))).toBe('FORBIDDEN');
  });

  it('back-fills default sections for ships created before sections existed, and is safe to repeat', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    const a = env.hubActor();
    const eng = rows(env.ctx.db, "SELECT id, version FROM org_department WHERE owner_id = ? AND code = 'ENG'", s.shipId)[0]!;
    tombstoneEntity(a, 'department', eng.id as string, { expectedVersion: eng.version, reason: 'test' });
    expect(ensureDefaultSections(a)).toEqual({ ships: 1, created: 1 });
    expect(ensureDefaultSections(a)).toEqual({ ships: 1, created: 0 });
    expect(ensureDefaultSections(a, s.shipId)).toEqual({ ships: 1, created: 0 });
  });

  it('a ship cannot be removed while it still has sections', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    expect(codeOf(() => tombstoneEntity(env.hubActor(), 'ship', s.shipId, { expectedVersion: 1, reason: 'test' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('department lists filter by owner and carry the owner\'s code and name', async () => {
    const env = makeOrgEnv({ devAuth: true });
    const s = seedBasics(env);
    const r = await env.app.inject(`/api/v1/org/departments?ownerKind=ship&ownerId=${s.shipId}`);
    expect(r.statusCode).toBe(200);
    const items = r.json().items as Array<Record<string, unknown>>;
    expect(items.map((i) => i.code).sort()).toEqual(['ELEC', 'ENG', 'GEN']);
    expect(items[0]).toMatchObject({ ownerKind: 'ship', ownerId: s.shipId, ownerCode: 'SH1', ownerName: 'Ship One' });
  });

  it('only the hub changes departments and sections', () => {
    const env = makeOrgEnv();
    const s = seedBasics(env);
    expect(codeOf(() => createEntity(env.shipActor(s.shipId), 'department', { code: 'HULL', name: 'Hull', ownerKind: 'ship', ownerId: s.shipId }))).toBe('NOT_OWNER');
  });
});

describe('a user\'s home section pre-fills forms', () => {
  it('/me gives the user\'s section and the ship it belongs to; the directory lists active people', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const fleet = createEntity(a as never, 'fleet', { code: 'F1', name: 'Fleet' });
    const ship = createEntity(a as never, 'ship', { code: 'SH1', name: 'Ship One', fleetId: fleet.id });
    const elec = rows(env.ctx.db, "SELECT id FROM org_department WHERE owner_id = ? AND code = 'ELEC'", ship.id)[0]!.id as string;
    const { userId } = await env.addUser({ username: 'sparky', displayName: 'Sparky', permissions: [] });
    const u = rows(env.ctx.db, 'SELECT version FROM idn_user WHERE id = ?', userId)[0]!;
    updateResource(a, env.ctx, 'user', userId, { expectedVersion: u.version, sectionId: elec, rank: 'PO' });
    const token = await env.login('sparky');
    const me = await env.call(token, 'GET', '/api/v1/identity/me');
    expect(me.json.home).toEqual({ sectionId: elec, sectionOwnerKind: 'ship', shipId: ship.id, commandId: null });

    createResource(a, 'user', { displayName: 'Gone', status: 'inactive' });
    const dir = await env.call(token, 'GET', '/api/v1/identity/users/directory');
    expect(dir.status).toBe(200);
    const names = (dir.json.items as Array<Record<string, unknown>>).map((i) => i.displayName);
    expect(names).toContain('Sparky');
    expect(names).not.toContain('Gone');
    expect(dir.json.items.find((i: Record<string, unknown>) => i.displayName === 'Sparky')).toEqual({ id: userId, displayName: 'Sparky', rank: 'PO', serviceNumber: null, sectionId: elec });
    expect((await env.call(null, 'GET', '/api/v1/identity/users/directory')).status).toBe(401);
  });

  it('without a section, a single ship-scoped role gives the ship', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const fleet = createEntity(a as never, 'fleet', { code: 'F1', name: 'Fleet' });
    const ship = createEntity(a as never, 'ship', { code: 'SH1', name: 'Ship One', fleetId: fleet.id });
    await env.addUser({ username: 'deckhand', permissions: ['wrk.work_order.create'], scopeKind: 'ship', scopeId: ship.id as string });
    const me = await env.call(await env.login('deckhand'), 'GET', '/api/v1/identity/me');
    expect(me.json.home).toEqual({ sectionId: null, sectionOwnerKind: null, shipId: ship.id, commandId: null });
  });

  it('a section that does not exist is refused', async () => {
    const env = await makeIdnEnv();
    expect(codeOf(() => createResource(env.actor(env.adminId), 'user', { displayName: 'X', sectionId: '0190a0b0-0000-7000-8000-000000000000' }))).toBe('DEPENDENCY_MISSING');
  });
});

describe('work order: requested on / by, supervisor and crew', () => {
  const U1 = '0190a0b0-0000-7000-8000-000000000001';
  const U2 = '0190a0b0-0000-7000-8000-000000000002';
  const U3 = '0190a0b0-0000-7000-8000-000000000003';

  it('defaults requested on to now and requested by to the signed-in user', () => {
    const env = makeWrkEnv();
    const me = { ...env.asHub(), wctx: { ...env.asHub().wctx, actor: { userId: U1 } } };
    const before = new Date().toISOString();
    const w = createWorkOrder(me, { title: 'Fix light', shipId: env.shipId });
    expect(w.requestedByUserId).toBe(U1);
    expect(String(w.requestedAt) >= before).toBe(true);
    expect(w.supervisorUserId).toBeNull();
    expect(w.crew).toEqual([]);
  });

  it('takes the requested date, requester, supervisor and several crew members on create', () => {
    const env = makeWrkEnv();
    const w = createWorkOrder(env.asHub(), {
      title: 'Rewire panel', shipId: env.shipId, requestedAt: '2026-11-01T08:00:00.000Z', requestedDue: '2026-11-10',
      requestedByUserId: U1, supervisorUserId: U2, crewUserIds: [U2, U3, U3],
    });
    expect(w).toMatchObject({ requestedAt: '2026-11-01T08:00:00.000Z', requestedDue: '2026-11-10', requestedByUserId: U1, supervisorUserId: U2 });
    expect((w.crew as Array<Record<string, unknown>>).map((c) => c.userId).sort()).toEqual([U2, U3]);
  });

  it('a ship section can be the executing party', () => {
    const env = makeWrkEnv();
    const elec = rows(env.ctx.db, "SELECT id FROM org_department WHERE owner_id = ? AND code = 'ELEC'", env.shipId)[0]!.id as string;
    const w = createWorkOrder(env.asHub(), { title: 'Fix light', shipId: env.shipId, executingParty: { kind: 'department', id: elec } });
    expect(w.executingParty).toEqual({ kind: 'department', id: elec });
  });

  it('crew can be added and removed (history kept); not twice, not after closing', () => {
    const env = makeWrkEnv();
    const a = env.asHub();
    const w = createWorkOrder(a, { title: 'Fix light', shipId: env.shipId, crewUserIds: [U1] });
    const id = w.id as string;
    const c2 = addCrewMember(a, id, { userId: U2, note: 'electrician' });
    expect(c2).toMatchObject({ workOrderId: id, userId: U2, note: 'electrician' });
    expect(codeOf(() => addCrewMember(a, id, { userId: U2 }))).toBe('DUPLICATE');
    removeCrewMember(a, id, c2.id as string, { expectedVersion: 1, reason: 'Moved to another job' });
    expect(rows(env.ctx.db, 'SELECT user_id FROM wrk_work_order_crew WHERE work_order_id = ? AND deleted_at IS NULL', id)).toEqual([{ user_id: U1 }]);
    expect(rows(env.ctx.db, 'SELECT 1 FROM wrk_work_order_crew WHERE work_order_id = ?', id)).toHaveLength(2);
    expect(addCrewMember(a, id, { userId: U2 })).toMatchObject({ userId: U2 }); // can come back
    changeProgress(a, id, { to: 'in_progress' });
    changeProgress(a, id, { to: 'work_complete' });
    acceptRepair(a, id, { decision: 'accepted', returnToService: 'cleared' });
    closeWorkOrder(a, id, {});
    expect(codeOf(() => addCrewMember(a, id, { userId: U3 }))).toBe('WORKFLOW_BLOCKED');
  });

  it('changing the crew needs work_order.update', () => {
    const env = makeWrkEnv();
    const w = createWorkOrder(env.asHub(), { title: 'Fix light', shipId: env.shipId });
    const denied = { ...env.asHub(), authz: denyOnly('wrk.work_order.update') };
    expect(codeOf(() => addCrewMember(denied, w.id as string, { userId: U1 }))).toBe('FORBIDDEN');
  });

  it('requested on, requested by and supervisor can be changed later', () => {
    const env = makeWrkEnv();
    const a = env.asHub();
    const w = createWorkOrder(a, { title: 'Fix light', shipId: env.shipId });
    const u = updateWorkOrder(a, w.id as string, { expectedVersion: 1, supervisorUserId: U2, requestedByUserId: U1, requestedAt: '2026-10-30T06:00:00.000Z' });
    expect(u).toMatchObject({ supervisorUserId: U2, requestedByUserId: U1, requestedAt: '2026-10-30T06:00:00.000Z' });
    expect(updateWorkOrder(a, w.id as string, { expectedVersion: 2, supervisorUserId: null }).supervisorUserId).toBeNull();
  });

  it('removing an unused work order also removes its crew rows', () => {
    const env = makeWrkEnv();
    const a = env.asHub();
    const w = createWorkOrder(a, { title: 'Fix light', shipId: env.shipId, crewUserIds: [U1, U2] });
    tombstoneWorkOrder(a, w.id as string, { expectedVersion: 1, reason: 'Raised twice' });
    expect(rows(env.ctx.db, 'SELECT 1 FROM wrk_work_order_crew WHERE work_order_id = ? AND deleted_at IS NULL', w.id)).toHaveLength(0);
  });

  it('the crew is part of the work order read and has its own list', async () => {
    const env = makeWrkEnv({ devAuth: true });
    const w = createWorkOrder(env.asHub(), { title: 'Fix light', shipId: env.shipId, crewUserIds: [U1] });
    const r = await env.app.inject(`/api/v1/work/work-orders/${String(w.id)}`);
    expect(r.statusCode).toBe(200);
    expect((r.json().crew as Array<Record<string, unknown>>).map((c) => c.userId)).toEqual([U1]);
    const l = await env.app.inject(`/api/v1/work/work-orders/${String(w.id)}/crew`);
    expect(l.json().items).toHaveLength(1);
  });
});
