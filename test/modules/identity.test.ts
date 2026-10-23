import { describe, expect, it } from 'vitest';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { AppError } from '../../src/platform/errors.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { evaluateGate, ratifyApproval, recordApproval } from '../../src/modules/m02-identity/approvals.js';
import { changeOwnPassword, login, resetLocalPassword, setCredential } from '../../src/modules/m02-identity/auth.js';
import { SETTING, checkAuthority, clockState, effectivePermissions, setSetting } from '../../src/modules/m02-identity/authority.js';
import { IDN_ENTITIES } from '../../src/modules/m02-identity/entities.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '../../src/modules/m02-identity/passwords.js';
import { IDN_PERMISSIONS, PermissionCatalogue } from '../../src/modules/m02-identity/permissions.js';
import { createResource, tombstoneResource, updateResource } from '../../src/modules/m02-identity/service.js';
import { ADMIN_PW, DAY, HOUR, USER_PW, iso, makeIdnEnv, type IdnEnv } from './idn-helpers.js';

const code = async (fn: () => unknown): Promise<string | undefined> => {
  try {
    await fn();
  } catch (e) {
    return e instanceof AppError ? e.code : `non-AppError: ${(e as Error).message}`;
  }
  return undefined;
};
const P = (env: IdnEnv, userId: string) => ({ userId, installationId: env.ctx.identity!.installationId, displayName: userId });
const check = (env: IdnEnv, userId: string, permission: string, scope?: Parameters<typeof checkAuthority>[3]) => checkAuthority(env.ctx.db, P(env, userId), permission, scope);
const subject = (id = '0190c0de-0000-7000-8000-000000000001') => ({ type: 'wrk.job_card', id });
const GATE = 'wrk.job_card.approve';
const sql = (env: IdnEnv, q: string, ...p: unknown[]) => env.ctx.db.prepare(q).all(...p) as Array<Record<string, any>>;

describe('registration and passwords', () => {
  it('registers cleanly, with well-formed permission codes and a redacted credential hash', async () => {
    const env = await makeIdnEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    for (const p of IDN_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(IDN_ENTITIES.find((e) => e.type === 'idn.credential')?.redact).toEqual(['password_hash']);
    expect(env.ctx.authz.current().name).toBe('idn-authorizer');
  });

  it('hashes with a per-password salt, verifies, and enforces the policy', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong horse battery', a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(() => assertPasswordPolicy('short')).toThrow(AppError);
    expect(() => assertPasswordPolicy('contains-bosun-inside', 'bosun')).toThrow(AppError);
  });

  it('merges permission codes announced on the bus (D25)', async () => {
    const env = await makeIdnEnv();
    const cat = new PermissionCatalogue();
    cat.add(['wrk.job_card.approve', 'not a code']);
    expect(cat.list()).toContain('wrk.job_card.approve');
    expect(cat.list()).not.toContain('not a code');
    expect(env.ctx.events).toBeDefined();
  });
});

describe('reference data rules (hub only)', () => {
  it('rejects writes from a non-hub installation with NOT_OWNER', async () => {
    const env = await makeIdnEnv();
    env.becomeShip();
    expect(await code(() => createResource(env.actor(env.adminId), 'role', { code: 'X1', name: 'X' }))).toBe('NOT_OWNER');
  });

  it('enforces uniqueness, validation and referential rules', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    createResource(a, 'role', { code: 'dup', name: 'One' });
    expect(await code(() => createResource(a, 'role', { code: 'DUP', name: 'Two' }))).toBe('DUPLICATE');
    createResource(a, 'user', { displayName: 'A', serviceNumber: 'SN1' });
    expect(await code(() => createResource(a, 'user', { displayName: 'B', serviceNumber: 'SN1' }))).toBe('DUPLICATE');
    expect(await code(() => createResource(a, 'user', { displayName: '' }))).toBe('VALIDATION_FAILED');

    const role = createResource(a, 'role', { code: 'R9', name: 'R9' });
    expect(await code(() => createResource(a, 'role_permission', { roleId: role.id, permission: 'Bad Code' }))).toBe('VALIDATION_FAILED');
    createResource(a, 'role_permission', { roleId: role.id, permission: 'org.*' });
    expect(await code(() => createResource(a, 'role_permission', { roleId: role.id, permission: 'org.*' }))).toBe('DUPLICATE');

    const user = createResource(a, 'user', { displayName: 'C' });
    const base = { userId: user.id, roleId: role.id };
    expect(await code(() => createResource(a, 'role_assignment', { ...base, scopeKind: 'fleet', scopeId: '0190c0de-0000-7000-8000-0000000000aa' }))).toBe('VALIDATION_FAILED');
    expect(await code(() => createResource(a, 'role_assignment', { ...base, scopeKind: 'ship' }))).toBe('VALIDATION_FAILED');
    expect(await code(() => createResource(a, 'role_assignment', { ...base, scopeKind: 'ship', scopeId: '0190c0de-0000-7000-8000-0000000000aa' }))).toBe('DEPENDENCY_MISSING');
    expect(await code(() => createResource(a, 'role_assignment', { ...base, scopeKind: 'fleet', validFrom: iso(DAY), validUntil: iso(HOUR) }))).toBe('VALIDATION_FAILED');
    expect(await code(() => createResource(a, 'role_assignment', { userId: '0190c0de-0000-7000-8000-0000000000bb', roleId: role.id, scopeKind: 'fleet' }))).toBe('DEPENDENCY_MISSING');

    createResource(a, 'offline_grant', { roleId: role.id, leaseDays: 60 });
    expect(await code(() => createResource(a, 'offline_grant', { roleId: role.id, leaseDays: 10 }))).toBe('DUPLICATE');
    expect(await code(() => createResource(a, 'offline_grant', { leaseDays: 0 }))).toBe('VALIDATION_FAILED');
    createResource(a, 'gate_policy', { gateCode: GATE, mode: 'mandatory_prior' });
    expect(await code(() => createResource(a, 'gate_policy', { gateCode: GATE, mode: 'none' }))).toBe('DUPLICATE');
  });

  it('stale updates fail with the current version; guarded removals are blocked', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const { userId, roleId } = await env.addUser({ username: 'sailor', permissions: ['org.ship.view'] });
    const u = createResource(a, 'user', { displayName: 'Temp' });
    const v2 = updateResource(a, env.ctx, 'user', u.id as string, { expectedVersion: 1, displayName: 'Temp 2' });
    expect(v2.version).toBe(2);
    try {
      updateResource(a, env.ctx, 'user', u.id as string, { expectedVersion: 1, displayName: 'Late' });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VERSION_CONFLICT');
      expect((e as AppError).details).toMatchObject({ currentVersion: 2 });
    }
    expect(await code(() => tombstoneResource(a, 'user', userId, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(await code(() => tombstoneResource(a, 'role', roleId, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(tombstoneResource(a, 'user', u.id as string, { expectedVersion: 2, reason: 'created in error' }).deletedAt).toBeTruthy();
  });

  it('denied permissions create nothing and are audited', async () => {
    const env = await makeIdnEnv();
    const { userId } = await env.addUser({ username: 'viewer', permissions: ['idn.user.view'] });
    const before = sql(env, 'SELECT COUNT(*) n FROM idn_user')[0]!.n;
    expect(await code(() => createResource(env.actor(userId), 'user', { displayName: 'Nope' }))).toBe('FORBIDDEN');
    expect(sql(env, 'SELECT COUNT(*) n FROM idn_user')[0]!.n).toBe(before);
    expect(sql(env, "SELECT outcome FROM sys_audit_event WHERE action = 'denied:idn.user.create' AND actor_user_id = ?", userId)[0]?.outcome).toBe('denied');
  });
});

describe('authorizer', () => {
  it('matches exact codes and prefix wildcards; viewing is allowed from any scope', async () => {
    const env = await makeIdnEnv();
    const { userId } = await env.addUser({ username: 'wild', permissions: ['org.*'], scopeKind: 'fleet' });
    expect(check(env, userId, 'org.ship.update', { kind: 'fleet' }).allowed).toBe(true);
    expect(check(env, userId, 'idn.user.view').allowed).toBe(false);
    expect(check(env, env.adminId, 'anything.at.all').allowed).toBe(true);
    expect(check(env, 'unknown-user', 'org.ship.view').allowed).toBe(false);
  });

  it('limits ship-scoped grants to their ship and command-scoped grants to ships currently attached', async () => {
    const env = await makeIdnEnv();
    const t = await env.login('admin', ADMIN_PW);
    const mk = async (path: string, body: object) => (await env.call(t, 'POST', `/api/v1/org/${path}`, body)).json;
    await mk('fleets', { code: 'F', name: 'Fleet' });
    const c1 = await mk('commands', { code: 'C1', name: 'Command 1' });
    const c2 = await mk('commands', { code: 'C2', name: 'Command 2' });
    const s1 = await mk('ships', { code: 'S1', name: 'Ship 1' });
    const s2 = await mk('ships', { code: 'S2', name: 'Ship 2' });
    await mk('ship-command-assignments', { shipId: s1.id, commandId: c1.id, effectiveFrom: iso(-DAY) });
    await mk('ship-command-assignments', { shipId: s2.id, commandId: c2.id, effectiveFrom: iso(-DAY) });

    const onShip = await env.addUser({ username: 'shipper', permissions: ['org.ship.update'], scopeKind: 'ship', scopeId: s1.id });
    const onCmd = await env.addUser({ username: 'cmdr', permissions: ['org.ship.update'], scopeKind: 'command', scopeId: c1.id });
    const ship = (id: string) => ({ kind: 'ship' as const, id });
    expect(check(env, onShip.userId, 'org.ship.update', ship(s1.id)).allowed).toBe(true);
    expect(check(env, onShip.userId, 'org.ship.update', ship(s2.id)).allowed).toBe(false);
    expect(check(env, onShip.userId, 'org.ship.update', { kind: 'fleet' }).allowed).toBe(false);
    expect(check(env, onCmd.userId, 'org.ship.update', ship(s1.id)).allowed).toBe(true);
    expect(check(env, onCmd.userId, 'org.ship.update', ship(s2.id)).allowed).toBe(false);
    expect(check(env, onShip.userId, 'org.ship.view').allowed).toBe(false); // holds only update
    // Reassigning the ship moves it out of the command's reach; the grant itself is untouched.
    await env.call(t, 'POST', `/api/v1/org/ships/${s1.id}/reassign`, { commandId: c2.id, effectiveFrom: iso(-HOUR) });
    expect(check(env, onCmd.userId, 'org.ship.update', ship(s1.id)).allowed).toBe(false);
  });

  it('honours dates, inactive roles and inactive users, and reports the basis', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const past = await env.addUser({ username: 'old', permissions: ['org.ship.view'], validFrom: iso(-2 * DAY), validUntil: iso(-DAY) });
    const future = await env.addUser({ username: 'soon', permissions: ['org.ship.view'], validFrom: iso(DAY) });
    expect(check(env, past.userId, 'org.ship.view').allowed).toBe(false);
    expect(check(env, future.userId, 'org.ship.view').allowed).toBe(false);

    const ok = await env.addUser({ username: 'okay', permissions: ['org.ship.view'] });
    const d = check(env, ok.userId, 'org.ship.view');
    expect(d).toMatchObject({ allowed: true, basis: { roleAssignmentId: ok.assignmentId } });
    const role = sql(env, 'SELECT version FROM idn_role WHERE id = ?', ok.roleId)[0]!;
    updateResource(a, env.ctx, 'role', ok.roleId, { expectedVersion: role.version, status: 'inactive' });
    expect(check(env, ok.userId, 'org.ship.view').allowed).toBe(false);
  });

  it('lists effective permissions against the catalogue for the UI', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'lister', permissions: ['org.ship.*'.replace('ship.*', '*'), 'idn.user.view'] });
    const cat = new PermissionCatalogue();
    const eff = effectivePermissions(env.ctx.db, w.userId, cat);
    expect(eff.permissions).toContain('org.ship.view');
    expect(eff.permissions).toContain('idn.user.view');
    expect(eff.permissions).not.toContain('idn.role.create');
    expect(eff.restricted).toEqual({});
  });
});

describe('offline authority lease', () => {
  async function shipWith(perms: string[], extra?: (env: IdnEnv) => void) {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'worker', permissions: perms });
    extra?.(env);
    env.becomeShip({ provision: [w.userId] });
    return { env, w };
  }
  const PERMS = ['org.ship.update', GATE, 'idn.user.view'];

  it('trusts delivered authority until the lease expires; the hub never expires', async () => {
    const { env, w } = await shipWith(PERMS);
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-10 * DAY));
    expect(check(env, w.userId, GATE)).toMatchObject({ allowed: true });
    expect(check(env, w.userId, GATE).provisional).toBeUndefined();

    const hubEnv = await makeIdnEnv();
    const hw = await hubEnv.addUser({ username: 'hubworker', permissions: [GATE] });
    setSetting(hubEnv.ctx.db, SETTING.lastHubSync, iso(-400 * DAY));
    expect(check(hubEnv, hw.userId, GATE).provisional).toBeUndefined();
  });

  it('after expiry: routine work allowed, approvals provisional, identity administration denied', async () => {
    const { env, w } = await shipWith(PERMS);
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-31 * DAY));
    expect(check(env, w.userId, 'org.ship.update', { kind: 'fleet' })).toMatchObject({ allowed: true });
    expect(check(env, w.userId, 'org.ship.update', { kind: 'fleet' }).provisional).toBeUndefined();
    expect(check(env, w.userId, GATE)).toMatchObject({ allowed: true, provisional: true });
    const denied = check(env, w.userId, 'idn.user.view');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/AUTHORITY_EXPIRED/);
    const eff = effectivePermissions(env.ctx.db, w.userId, new PermissionCatalogue());
    expect(eff.restricted).toMatchObject({ [GATE]: 'provisional', 'idn.user.view': 'deny' });
  });

  it('a gate policy overrides the default offline handling', async () => {
    const { env, w } = await shipWith(PERMS, (e) => {
      createResource(e.actor(e.adminId), 'gate_policy', { gateCode: 'org.ship.update', mode: 'none', offlinePolicy: 'deny' });
      createResource(e.actor(e.adminId), 'gate_policy', { gateCode: GATE, mode: 'mandatory_prior', offlinePolicy: 'deny' });
    });
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-31 * DAY));
    expect(check(env, w.userId, 'org.ship.update', { kind: 'fleet' }).allowed).toBe(false);
    expect(check(env, w.userId, GATE).allowed).toBe(false);
  });

  it('an offline grant lengthens or shortens the lease; a per-user cap can end it earlier', async () => {
    const { env, w } = await shipWith(PERMS, (e) => {
      const role = sql(e, 'SELECT id FROM idn_role WHERE code = ?', 'R-WORKER')[0]!;
      createResource(e.actor(e.adminId), 'offline_grant', { roleId: role.id, leaseDays: 90 });
    });
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-60 * DAY));
    const d = check(env, w.userId, GATE);
    expect(d.provisional).toBeUndefined();
    expect(d.basis?.offlineGrantId).toBeTruthy();
    env.ctx.db.prepare('UPDATE idn_user_installation SET lease_expires_at = ? WHERE user_id = ?').run(iso(-HOUR), w.userId);
    expect(check(env, w.userId, GATE).provisional).toBe(true);
  });
});

describe('clock safety', () => {
  it('blocks approvals while the clock is behind its high-water mark until an administrator resets it', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'approver', permissions: [GATE, 'org.ship.view'] });
    setSetting(env.ctx.db, SETTING.clock, iso(HOUR));
    expect(clockState(env.ctx.db).suspect).toBe(true);
    expect(check(env, w.userId, GATE).reason).toMatch(/CLOCK_SUSPECT/);
    expect(check(env, w.userId, 'org.ship.view').allowed).toBe(true);
    expect(await code(() => recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, w.userId), decidedAt: iso(0) }))).toBe('WORKFLOW_BLOCKED');

    const worker = await env.login('approver');
    expect((await env.call(worker, 'POST', '/api/v1/identity/clock/reset', { reason: 'fixed' })).status).toBe(403);
    const admin = await env.login('admin', ADMIN_PW);
    const reset = await env.call(admin, 'POST', '/api/v1/identity/clock/reset', { reason: 'RTC battery replaced' });
    expect(reset.status).toBe(200);
    expect(reset.json.wasSuspect).toBe(true);
    expect(clockState(env.ctx.db).suspect).toBe(false);
    expect(sql(env, "SELECT reason FROM sys_audit_event WHERE action = 'clock.reset'")[0]?.reason).toBe('RTC battery replaced');
    expect(recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, w.userId), decidedAt: iso(0) }).provisional).toBe(false);
  });
});

describe('approvals', () => {
  it('keeps the actual decision time and actor identity, and snapshots the actor', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'cpo', displayName: 'CPO Silva', permissions: [GATE] });
    const decidedAt = iso(-3 * HOUR);
    const out = recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, w.userId), decidedAt, comment: 'checked on board' });
    expect(out.provisional).toBe(false);
    const row = sql(env, 'SELECT * FROM idn_approval WHERE id = ?', out.approvalId)[0]!;
    expect(row).toMatchObject({ occurred_at: decidedAt, actor_user_id: w.userId, decision: 'approved', confirmation_state: 'confirmed', comment: 'checked on board' });
    expect(row.recorded_at > decidedAt).toBe(true);
    expect(JSON.parse(row.actor_snapshot)).toMatchObject({ displayName: 'CPO Silva', roles: ['R-CPO'] });
    expect(JSON.parse(row.authority_basis)).toMatchObject({ roleAssignmentId: w.assignmentId });
    expect(sql(env, "SELECT 1 FROM sys_audit_event WHERE action = 'approve' AND entity_id = ?", subject().id)).toHaveLength(1);
  });

  it('refuses future or malformed times and callers without the gate permission', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'approver', permissions: [GATE] });
    const none = await env.addUser({ username: 'bystander', permissions: ['org.ship.view'] });
    const base = { gateCode: GATE, subject: subject(), decision: 'approved' as const };
    expect(await code(() => recordApproval(env.ctx, { ...base, principal: P(env, w.userId), decidedAt: iso(DAY) }))).toBe('VALIDATION_FAILED');
    expect(await code(() => recordApproval(env.ctx, { ...base, principal: P(env, w.userId), decidedAt: 'yesterday' }))).toBe('VALIDATION_FAILED');
    expect(await code(() => recordApproval(env.ctx, { ...base, principal: P(env, none.userId), decidedAt: iso(0) }))).toBe('FORBIDDEN');
    expect(sql(env, "SELECT outcome FROM sys_audit_event WHERE action = ? AND actor_user_id = ?", `denied:${GATE}`, none.userId)[0]?.outcome).toBe('denied');
    expect(sql(env, 'SELECT COUNT(*) n FROM idn_approval')[0]!.n).toBe(0);
  });

  it('is append-only at the database level', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'approver', permissions: [GATE] });
    const { approvalId } = recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, w.userId), decidedAt: iso(0) });
    expect(() => env.ctx.db.prepare("UPDATE idn_approval SET decision = 'rejected' WHERE id = ?").run(approvalId)).toThrow(/append-only/);
    expect(() => env.ctx.db.prepare('DELETE FROM idn_approval WHERE id = ?').run(approvalId)).toThrow(/append-only/);
  });

  it('evaluates gates by mode and follows the latest decision', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const w = await env.addUser({ username: 'approver', permissions: [GATE] });
    const s = subject();
    expect(evaluateGate(env.ctx, GATE, s)).toEqual({ mode: 'none', satisfied: true });
    createResource(a, 'gate_policy', { gateCode: GATE, mode: 'mandatory_prior' });
    expect(evaluateGate(env.ctx, GATE, s)).toMatchObject({ mode: 'mandatory_prior', satisfied: false, blockedReason: 'Not yet approved' });
    recordApproval(env.ctx, { gateCode: GATE, subject: s, decision: 'approved', principal: P(env, w.userId), decidedAt: iso(-2 * HOUR) });
    expect(evaluateGate(env.ctx, GATE, s).satisfied).toBe(true);
    recordApproval(env.ctx, { gateCode: GATE, subject: s, decision: 'rejected', principal: P(env, w.userId), decidedAt: iso(-HOUR) });
    expect(evaluateGate(env.ctx, GATE, s)).toMatchObject({ satisfied: false, blockedReason: 'Rejected' });
    expect(evaluateGate(env.ctx, GATE, subject('0190c0de-0000-7000-8000-000000000002')).satisfied).toBe(false); // other subject unaffected
  });

  it('username, password and display-name changes never touch historical approvals', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    const w = await env.addUser({ username: 'oldname', displayName: 'Lt Perera', permissions: [GATE] });
    const { approvalId } = recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, w.userId), decidedAt: iso(-HOUR) });
    const before = JSON.stringify(sql(env, 'SELECT * FROM idn_approval WHERE id = ?', approvalId));

    const cred = sql(env, 'SELECT version FROM idn_credential WHERE user_id = ?', w.userId)[0]!;
    await setCredential(a, env.ctx, w.userId, { username: 'newname', password: 'Brand-new-pass-789', expectedVersion: cred.version });
    const u = sql(env, 'SELECT version FROM idn_user WHERE id = ?', w.userId)[0]!;
    updateResource(a, env.ctx, 'user', w.userId, { expectedVersion: u.version, displayName: 'Cdr Perera' });

    expect(JSON.stringify(sql(env, 'SELECT * FROM idn_approval WHERE id = ?', approvalId))).toBe(before);
    expect(JSON.parse(sql(env, 'SELECT actor_snapshot FROM idn_approval WHERE id = ?', approvalId)[0]!.actor_snapshot).displayName).toBe('Lt Perera');
    expect(sql(env, 'SELECT needs_review FROM idn_v_approval_status WHERE approval_id = ?', approvalId)[0]!.needs_review).toBe(0);
    expect(await code(() => login(env.ctx, { username: 'oldname', password: USER_PW }))).toBe('UNAUTHENTICATED');
    expect((await login(env.ctx, { username: 'newname', password: 'Brand-new-pass-789' })).userId).toBe(w.userId);
    expect(sql(env, 'SELECT credential_version v FROM idn_credential WHERE user_id = ?', w.userId)[0]!.v).toBe(2);
  });
});

describe('provisional approvals and ratification', () => {
  it('stamps approvals made on an expired lease as pending, and a different current authority ratifies them', async () => {
    const env = await makeIdnEnv();
    const a = env.actor(env.adminId);
    createResource(a, 'gate_policy', { gateCode: GATE, mode: 'mandatory_prior' });
    const one = await env.addUser({ username: 'one', permissions: [GATE] });
    const two = await env.addUser({ username: 'two', permissions: [GATE, 'idn.approval.create'] });
    env.becomeShip({ provision: [one.userId, two.userId] });
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-40 * DAY));

    const out = recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, one.userId), decidedAt: iso(-HOUR) });
    expect(out.provisional).toBe(true);
    const status = () => sql(env, 'SELECT * FROM idn_v_approval_status WHERE approval_id = ?', out.approvalId)[0]!;
    expect(status()).toMatchObject({ confirmation_state: 'pending_confirmation', pending_confirmation: 1, needs_review: 1, authority_disputed: 0 });
    expect(evaluateGate(env.ctx, GATE, subject()).satisfied).toBe(true); // work may proceed; closure waits for confirmation

    // Nobody can ratify with an expired lease (their own approval would be provisional too).
    expect(await code(() => ratifyApproval(env.actor(two.userId), env.ctx, out.approvalId, null))).toBe('AUTHORITY_EXPIRED');
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(0)); // a sync happened
    expect(await code(() => ratifyApproval(env.actor(one.userId), env.ctx, out.approvalId, null))).toBe('FORBIDDEN'); // no idn.approval.create
    const raw = JSON.stringify(sql(env, 'SELECT * FROM idn_approval WHERE id = ?', out.approvalId));
    const ratified = ratifyApproval(env.actor(two.userId), env.ctx, out.approvalId, 'confirmed on return');
    expect(ratified).toMatchObject({ decision: 'ratified', ratifies_approval_id: out.approvalId, actor_user_id: two.userId });
    expect(status()).toMatchObject({ ratified: 1, pending_confirmation: 0, needs_review: 0 });
    expect(JSON.stringify(sql(env, 'SELECT * FROM idn_approval WHERE id = ?', out.approvalId))).toBe(raw); // original untouched
    expect(await code(() => ratifyApproval(env.actor(two.userId), env.ctx, out.approvalId, null))).toBe('WORKFLOW_BLOCKED');
  });

  it('the original approver cannot ratify their own approval', async () => {
    const env = await makeIdnEnv();
    const one = await env.addUser({ username: 'one', permissions: [GATE, 'idn.approval.create'] });
    env.becomeShip({ provision: [one.userId] });
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(-40 * DAY));
    const out = recordApproval(env.ctx, { gateCode: GATE, subject: subject(), decision: 'approved', principal: P(env, one.userId), decidedAt: iso(-HOUR) });
    setSetting(env.ctx.db, SETTING.lastHubSync, iso(0));
    expect(await code(() => ratifyApproval(env.actor(one.userId), env.ctx, out.approvalId, null))).toBe('WORKFLOW_BLOCKED');
  });
});

describe('revocations received late', () => {
  async function setup() {
    const env = await makeIdnEnv();
    createResource(env.actor(env.adminId), 'gate_policy', { gateCode: GATE, mode: 'mandatory_prior' });
    const worker = await env.addUser({ username: 'worker', permissions: [GATE] });
    const authority = await env.addUser({ username: 'authority', permissions: [GATE, 'idn.approval.create'] });
    return { env, worker, authority };
  }
  const revoke = (env: IdnEnv, body: object) => env.actor(env.adminId) && import('../../src/modules/m02-identity/service.js').then((m) => m.createRevocation(env.actor(env.adminId), env.ctx, body));

  it('flags approvals decided at or after the effective time, leaves earlier ones and all history intact', async () => {
    const { env, worker } = await setup();
    const early = subject('0190c0de-0000-7000-8000-0000000000e1');
    const late = subject('0190c0de-0000-7000-8000-0000000000e2');
    const a1 = recordApproval(env.ctx, { gateCode: GATE, subject: early, decision: 'approved', principal: P(env, worker.userId), decidedAt: iso(-5 * HOUR) });
    const a2 = recordApproval(env.ctx, { gateCode: GATE, subject: late, decision: 'approved', principal: P(env, worker.userId), decidedAt: iso(-2 * HOUR) });
    const before = JSON.stringify(sql(env, 'SELECT * FROM idn_approval ORDER BY id'));

    await revoke(env, { userId: worker.userId, effectiveAt: iso(-3 * HOUR), reason: 'Authority withdrawn after incident' });

    const st = (id: string) => sql(env, 'SELECT authority_disputed d, needs_review r FROM idn_v_approval_status WHERE approval_id = ?', id)[0]!;
    expect(st(a1.approvalId)).toEqual({ d: 0, r: 0 }); // decided before the effective time: stands
    expect(st(a2.approvalId)).toEqual({ d: 1, r: 1 });
    expect(JSON.stringify(sql(env, 'SELECT * FROM idn_approval ORDER BY id'))).toBe(before); // history never altered
    expect(check(env, worker.userId, GATE).allowed).toBe(false); // future actions refused immediately
    expect(evaluateGate(env.ctx, GATE, late)).toMatchObject({ satisfied: false });
    expect(evaluateGate(env.ctx, GATE, late).blockedReason).toMatch(/ratify/);
    expect(evaluateGate(env.ctx, GATE, early).satisfied).toBe(true);
  });

  it('is cleared by a ratification from a competent authority, or by reinstatement for later decisions', async () => {
    const { env, worker, authority } = await setup();
    const s = subject('0190c0de-0000-7000-8000-0000000000e3');
    const a = recordApproval(env.ctx, { gateCode: GATE, subject: s, decision: 'approved', principal: P(env, worker.userId), decidedAt: iso(-2 * HOUR) });
    await revoke(env, { userId: worker.userId, effectiveAt: iso(-3 * HOUR), reason: 'Withdrawn' });
    expect(sql(env, 'SELECT needs_review r FROM idn_v_approval_status WHERE approval_id = ?', a.approvalId)[0]!.r).toBe(1);
    expect(sql(env, "SELECT 1 FROM idn_authority_revocation WHERE reason = 'Withdrawn'")).toHaveLength(1);

    ratifyApproval(env.actor(authority.userId), env.ctx, a.approvalId, 'reviewed; work was sound');
    expect(sql(env, 'SELECT needs_review r FROM idn_v_approval_status WHERE approval_id = ?', a.approvalId)[0]!.r).toBe(0);
    expect(evaluateGate(env.ctx, GATE, s).satisfied).toBe(true);

    // Reinstated from an hour ago: that earlier decision stays flagged, a new one is clean.
    await revoke(env, { userId: worker.userId, kind: 'reinstate', effectiveAt: iso(-HOUR), reason: 'Cleared by board' });
    const s2 = subject('0190c0de-0000-7000-8000-0000000000e4');
    const b = recordApproval(env.ctx, { gateCode: GATE, subject: s2, decision: 'approved', principal: P(env, worker.userId), decidedAt: iso(-10 * 60_000) });
    expect(sql(env, 'SELECT authority_disputed d FROM idn_v_approval_status WHERE approval_id = ?', b.approvalId)[0]!.d).toBe(0);
  });

  it('revokes one assignment without touching the user\'s other grants', async () => {
    const { env, worker } = await setup();
    const extra = createResource(env.actor(env.adminId), 'role_assignment', { userId: worker.userId, roleId: worker.roleId, scopeKind: 'fleet' });
    await revoke(env, { userId: worker.userId, roleAssignmentId: worker.assignmentId, reason: 'Posting ended' });
    const d = check(env, worker.userId, GATE);
    expect(d.allowed).toBe(true);
    expect(d.basis?.roleAssignmentId).toBe(extra.id);
    await revoke(env, { userId: worker.userId, roleAssignmentId: extra.id as string, reason: 'Posting ended' });
    expect(check(env, worker.userId, GATE).allowed).toBe(false);
    expect(await code(() => revoke(env, { userId: worker.userId, roleAssignmentId: '0190c0de-0000-7000-8000-0000000000cc', reason: 'x' }))).toBe('DEPENDENCY_MISSING');
  });

  it('deactivating a user withdraws authority and sessions; reactivating restores authority', async () => {
    const { env, worker } = await setup();
    const a = env.actor(env.adminId);
    const token = await env.login('worker');
    expect((await env.call(token, 'GET', '/api/v1/identity/me')).status).toBe(200);
    const u = sql(env, 'SELECT version FROM idn_user WHERE id = ?', worker.userId)[0]!;
    updateResource(a, env.ctx, 'user', worker.userId, { expectedVersion: u.version, status: 'inactive' });
    expect(check(env, worker.userId, GATE).allowed).toBe(false);
    expect((await env.call(token, 'GET', '/api/v1/identity/me')).status).toBe(401);
    expect(sql(env, 'SELECT kind, reason FROM idn_authority_revocation WHERE user_id = ?', worker.userId)).toEqual([{ kind: 'revoke', reason: 'User deactivated' }]);
    updateResource(a, env.ctx, 'user', worker.userId, { expectedVersion: u.version + 1, status: 'active' });
    expect(check(env, worker.userId, GATE).allowed).toBe(true);
  });
});

describe('authentication', () => {
  it('signs in, returns the profile and permissions, and signs out', async () => {
    const env = await makeIdnEnv();
    await env.addUser({ username: 'sailor', displayName: 'AB Fernando', permissions: ['org.ship.view'] });
    const token = await env.login('sailor');
    const me = await env.call(token, 'GET', '/api/v1/identity/me');
    expect(me.status).toBe(200);
    expect(me.json.user.displayName).toBe('AB Fernando');
    expect(me.json.permissions).toEqual(['org.ship.view']);
    expect(me.json.authority).toMatchObject({ hub: true, expired: false });
    expect(me.json).not.toHaveProperty('passwordHash');
    await env.call(token, 'POST', '/api/v1/identity/logout');
    expect((await env.call(token, 'GET', '/api/v1/identity/me')).status).toBe(401);
    expect((await env.call('not-a-token', 'GET', '/api/v1/identity/me')).status).toBe(401);
    expect((await env.call(null, 'GET', '/api/v1/identity/me')).status).toBe(401);
  });

  it('audits failures without revealing which part was wrong, then locks out after repeated failures', async () => {
    const env = await makeIdnEnv();
    await env.addUser({ username: 'sailor', permissions: [] });
    const r1 = await env.app.inject({ method: 'POST', url: '/api/v1/identity/login', payload: { username: 'sailor', password: 'wrong-password-1' } });
    const r2 = await env.app.inject({ method: 'POST', url: '/api/v1/identity/login', payload: { username: 'nobody', password: 'wrong-password-1' } });
    expect(r1.statusCode).toBe(401);
    expect(r1.json().error.message).toBe(r2.json().error.message);
    for (let i = 0; i < 4; i++) await env.app.inject({ method: 'POST', url: '/api/v1/identity/login', payload: { username: 'sailor', password: 'wrong-password-1' } });
    // five failures for 'sailor' (the lockout limit) plus one for the unknown name, all audited
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE action = 'login.failed'")[0]!.n).toBe(6);
    const locked = await env.app.inject({ method: 'POST', url: '/api/v1/identity/login', payload: { username: 'sailor', password: USER_PW } });
    expect(locked.statusCode).toBe(403);
    expect(sql(env, "SELECT 1 FROM sys_audit_event WHERE action = 'login.locked'")).toHaveLength(1);
  });

  it('keeps hashes out of API responses and the audit trail; a new credential ends old sessions', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'sailor', permissions: [] });
    const admin = await env.login('admin', ADMIN_PW);
    const cred = await env.call(admin, 'GET', `/api/v1/identity/users/${w.userId}/credential`);
    expect(cred.status).toBe(200);
    expect(JSON.stringify(cred.json)).not.toMatch(/scrypt|passwordHash/);
    const hash = sql(env, 'SELECT password_hash h FROM idn_credential WHERE user_id = ?', w.userId)[0]!.h as string;
    expect(JSON.stringify(sql(env, 'SELECT changes FROM sys_audit_event'))).not.toContain(hash);
    expect(JSON.stringify(sql(env, "SELECT payload FROM sys_change_log WHERE entity_type = 'idn.credential'"))).toContain(hash); // replication carries it

    const token = await env.login('sailor');
    const put = await env.call(admin, 'PUT', `/api/v1/identity/users/${w.userId}/credential`, { username: 'sailor', password: 'Another-pass-1234', expectedVersion: cred.json.version });
    expect(put.status).toBe(200);
    expect((await env.call(token, 'GET', '/api/v1/identity/me')).status).toBe(401);
    expect(await code(() => setCredential(env.actor(env.adminId), env.ctx, w.userId, { username: 'sailor', password: 'Third-pass-123456' }))).toBe('VALIDATION_FAILED'); // needs expectedVersion
  });

  it('only signs users in where they are provisioned', async () => {
    const env = await makeIdnEnv();
    const here = await env.addUser({ username: 'here', permissions: [] });
    await env.addUser({ username: 'elsewhere', permissions: [] });
    env.becomeShip({ provision: [here.userId] });
    expect((await login(env.ctx, { username: 'here', password: USER_PW })).userId).toBe(here.userId);
    expect(await code(() => login(env.ctx, { username: 'elsewhere', password: USER_PW }))).toBe('UNAUTHENTICATED');
  });

  it('a local administrator reset is installation-scoped and superseded by a newer hub credential', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'sailor', permissions: [] });
    env.becomeShip({ provision: [w.userId] });
    await resetLocalPassword(env.actor(env.adminId), env.ctx, w.userId, { password: 'Local-reset-pass-1' });
    expect(sql(env, "SELECT 1 FROM sys_audit_event WHERE action = 'credential.reset_local'")).toHaveLength(1);
    expect((await login(env.ctx, { username: 'sailor', password: 'Local-reset-pass-1' })).userId).toBe(w.userId);
    expect(await code(() => login(env.ctx, { username: 'sailor', password: USER_PW }))).toBe('UNAUTHENTICATED');
    env.ctx.db.prepare('UPDATE idn_credential SET updated_at = ? WHERE user_id = ?').run(iso(HOUR), w.userId); // a newer hub version arrives
    expect((await login(env.ctx, { username: 'sailor', password: USER_PW })).userId).toBe(w.userId);
    expect(await code(() => login(env.ctx, { username: 'sailor', password: 'Local-reset-pass-1' }))).toBe('UNAUTHENTICATED');
  });

  it('own password change writes a hub credential version at the hub and a local override elsewhere', async () => {
    const env = await makeIdnEnv();
    const w = await env.addUser({ username: 'sailor', permissions: [] });
    expect(await changeOwnPassword(env.actor(w.userId), env.ctx, { currentPassword: USER_PW, newPassword: 'Hub-changed-pass-1' })).toEqual({ scope: 'fleet' });
    expect(sql(env, 'SELECT credential_version v FROM idn_credential WHERE user_id = ?', w.userId)[0]!.v).toBe(2);
    expect(await code(() => changeOwnPassword(env.actor(w.userId), env.ctx, { currentPassword: 'wrong-current-1', newPassword: 'Whatever-pass-12' }))).toBe('FORBIDDEN');
    env.becomeShip({ provision: [w.userId] });
    expect(await changeOwnPassword(env.actor(w.userId), env.ctx, { currentPassword: 'Hub-changed-pass-1', newPassword: 'Ship-changed-pass-1' })).toEqual({ scope: 'installation' });
    expect(sql(env, 'SELECT credential_version v FROM idn_credential WHERE user_id = ?', w.userId)[0]!.v).toBe(2);
    expect((await login(env.ctx, { username: 'sailor', password: 'Ship-changed-pass-1' })).userId).toBe(w.userId);
  });
});
