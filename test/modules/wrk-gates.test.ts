import { describe, expect, it } from 'vitest';
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import { createResource } from '../../src/modules/m02-identity/service.js';
import { GATE_APPROVE, register } from '../../src/modules/m05-work/index.js';
import { ensureWorkSequences, grantWorkRanges } from '../../src/modules/m05-work/seed.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { makeIdnEnv } from './idn-helpers.js';

const BASE = '/api/v1/work';

/** The real M02 approval service and authorizer behind M05's gates (no stand-ins). */
describe('M05 with the real M02 approval service', () => {
  it('enforces the gate policy, the gate permission and records an immutable approval', async () => {
    const env = await makeIdnEnv();
    register(env.ctx, env.app);
    const w = { db: env.ctx.db, registry: env.ctx.entities, installation: env.hub, actor: { userId: 'system' }, correlationId: uuidv7() };
    ensureWorkSequences(w);
    grantWorkRanges(w, env.hub.installationId, 20);

    const admin = env.actor(env.adminId);
    createOrg(admin as never, 'fleet', { code: 'F1', name: 'Fleet' });
    const ship = createOrg(admin as never, 'ship', { code: 'SH1', name: 'Ship One', pennantNo: 'P1' });
    createResource(admin, 'gate_policy', { gateCode: GATE_APPROVE, mode: 'mandatory_prior' });

    const base = ['wrk.work_order.view', 'wrk.work_order.create', 'wrk.work_order.progress', 'wrk.work_order.request_review'];
    await env.addUser({ username: 'planner', permissions: base });
    await env.addUser({ username: 'captain', permissions: ['wrk.work_order.view', GATE_APPROVE] });
    const planner = await env.login('planner');
    const captain = await env.login('captain');

    const created = await env.call(planner, 'POST', `${BASE}/work-orders`, { title: 'Overhaul pump', shipId: ship.id });
    expect(created.status).toBe(201);
    const W = created.json.id;
    expect((await env.call(planner, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress' })).status).toBe(422);
    expect((await env.call(planner, 'POST', `${BASE}/work-orders/${W}/request-review`, {})).status).toBe(200);
    expect((await env.call(planner, 'POST', `${BASE}/work-orders/${W}/decide`, { decision: 'approved' })).status).toBe(403); // planner lacks the gate permission
    expect((await env.call(planner, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress' })).status).toBe(422); // still not approved

    const decided = await env.call(captain, 'POST', `${BASE}/work-orders/${W}/decide`, { decision: 'approved', comment: 'Go ahead' });
    expect(decided.status).toBe(200);
    expect(decided.json.axes.approval).toBe('approved');
    const started = await env.call(planner, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress' });
    expect(started.status).toBe(200);
    expect(started.json.axes.progress).toBe('in_progress');

    const rows = env.ctx.db.prepare('SELECT gate_code, decision, subject_id FROM idn_v_approval_status WHERE subject_id = ?').all(W) as Array<Record<string, unknown>>;
    expect(rows).toEqual([{ gate_code: GATE_APPROVE, decision: 'approved', subject_id: W }]);
    const detail = await env.call(captain, 'GET', `${BASE}/work-orders/${W}`);
    expect(detail.json.gates[GATE_APPROVE]).toMatchObject({ mode: 'mandatory_prior', satisfied: true });
    const ev = env.ctx.db.prepare("SELECT approval_id, provisional FROM wrk_status_event WHERE subject_id = ? AND axis = 'approval' AND value = 'approved'").get(W) as { approval_id: string; provisional: number };
    expect(ev.approval_id).toBeTruthy();
    expect(ev.provisional).toBe(0);
  });
});
