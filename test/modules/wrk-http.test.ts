import { describe, expect, it } from 'vitest';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { GATE_APPROVE } from '../../src/modules/m05-work/index.js';
import { makeWrkEnv, stubApprovals, type WrkEnv } from './wrk-helpers.js';

const BASE = '/api/v1/work';
type Res = { status: number; json: any };
async function call(env: WrkEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<Res> {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M05 HTTP API', () => {
  it('takes a defect through repair case, work order, job card, labour, acceptance and closure', async () => {
    const env = makeWrkEnv({ devAuth: true });
    const asset = createAsset(env.hubActor(), { name: 'Pump', homeShipId: env.shipId }).asset;

    expect((await call(env, 'GET', `${BASE}/numbers/remaining`)).json).toEqual({ defect: 50, repairCase: 50, workOrder: 50 });
    const defect = await call(env, 'POST', `${BASE}/defects`, { title: 'Pump leaking', assetId: asset.id, severity: 'major' });
    expect(defect.status).toBe(201);
    expect(defect.json.defectNo).toBe('SLN-DF-00000001');
    const conv = await call(env, 'POST', `${BASE}/defects/${defect.json.id}/convert`, { expectedVersion: 1 });
    expect(conv.json.repairCase.priority).toBe('high');

    const wo = await call(env, 'POST', `${BASE}/work-orders`, { title: 'Replace seal', repairCaseId: conv.json.repairCase.id });
    expect(wo.status).toBe(201);
    expect(wo.json).toMatchObject({ woNo: 'SLN-WO-00000001', assetId: asset.id, axes: { progress: 'planned', closure: 'open' } });
    const W = wo.json.id;

    const card = await call(env, 'POST', `${BASE}/job-cards`, { workOrderId: W, title: 'Replace', checklist: ['Isolate'] });
    expect(card.status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/job-cards?workOrderId=${W}`)).json.items).toHaveLength(1);

    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'work_complete' })).status).toBe(422);
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress', note: 'go' })).json.axes.progress).toBe('in_progress');
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/labour`, { workerName: 'A. Perera', minutes: 60 })).status).toBe(201);
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/findings`, { kind: 'cause', text: 'Worn seal' })).status).toBe(201);
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/tests`, { testName: 'Leak test', result: 'pass' })).status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/work-orders/${W}/labour`)).json.items).toHaveLength(1);

    await call(env, 'PATCH', `${BASE}/job-cards/${card.json.id}`, { expectedVersion: 1, status: 'issued' });
    await call(env, 'PATCH', `${BASE}/job-cards/${card.json.id}`, { expectedVersion: 2, checklist: [{ text: 'Isolate', done: true }] });
    expect((await call(env, 'PATCH', `${BASE}/job-cards/${card.json.id}`, { expectedVersion: 3, status: 'completed' })).json.status).toBe('completed');
    await call(env, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'work_complete' });
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/close`, {})).status).toBe(422);
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/accept`, { decision: 'accepted' })).json.axes.returnToService).toBe('cleared');
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/close`, {})).json.axes.closure).toBe('closed');

    const detail = await call(env, 'GET', `${BASE}/work-orders/${W}`);
    expect(detail.json).toMatchObject({ axes: { progress: 'work_complete', approval: 'not_required', returnToService: 'cleared', closure: 'closed' }, labourMinutes: 60, handoverPending: false });
    expect(detail.json.jobCards).toHaveLength(1);
    expect(detail.json.acceptances).toHaveLength(1);
    expect((await call(env, 'GET', `${BASE}/status-events?subjectId=${W}`)).json.items).toHaveLength(4);

    const closed = await call(env, 'GET', `${BASE}/work-orders?closure=closed&shipId=${env.shipId}`);
    expect(closed.json.items).toHaveLength(1);
    expect(closed.json.items[0]).toMatchObject({ woNo: 'SLN-WO-00000001', progress: 'work_complete', returnToService: 'cleared' });
    expect(closed.json.freshness[0]).toMatchObject({ stale: false });
    expect((await call(env, 'GET', `${BASE}/work-orders?closure=open`)).json.items).toHaveLength(0);
    expect((await call(env, 'GET', `${BASE}/work-orders?bogus=1`)).status).toBe(400);

    const kase = await call(env, 'GET', `${BASE}/repair-cases/${conv.json.repairCase.id}/summary`);
    expect(kase.json.workOrders).toHaveLength(1);
    expect(kase.json.defects).toHaveLength(1);
    expect((await call(env, 'POST', `${BASE}/repair-cases/${conv.json.repairCase.id}/close`, {})).json.axes.closure).toBe('closed');
    expect((await call(env, 'GET', `${BASE}/work-orders/0198f000-0000-7000-8000-000000000000`)).status).toBe(404);
    expect((await call(env, 'POST', `${BASE}/work-orders`, { title: '' })).status).toBe(400);
  });

  it('applies the approval gate through the registered approval service', async () => {
    const env = makeWrkEnv({ devAuth: true });
    env.ctx.approvals.register(stubApprovals({ [GATE_APPROVE]: 'mandatory_prior' }));
    const wo = await call(env, 'POST', `${BASE}/work-orders`, { title: 'Overhaul', shipId: env.shipId });
    const W = wo.json.id;
    const blocked = await call(env, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress' });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error.code).toBe('WORKFLOW_BLOCKED');
    expect((await call(env, 'GET', `${BASE}/work-orders/${W}`)).json.gates[GATE_APPROVE]).toMatchObject({ mode: 'mandatory_prior', satisfied: false });
    await call(env, 'POST', `${BASE}/work-orders/${W}/request-review`, {});
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/decide`, { decision: 'approved' })).json.axes.approval).toBe('approved');
    expect((await call(env, 'POST', `${BASE}/work-orders/${W}/progress`, { to: 'in_progress' })).status).toBe(200);
  });

  it('offers a hand-over and reports the effective executing party', async () => {
    const env = makeWrkEnv({ devAuth: true });
    const ws = (await import('../../src/modules/m01-organization/service.js')).createEntity(env.hubActor(), 'workshop', { code: 'WS1', name: 'Electrical workshop', kind: 'specialist' });
    const wo = await call(env, 'POST', `${BASE}/work-orders`, { title: 'Rewind', shipId: env.shipId });
    const offer = await call(env, 'POST', `${BASE}/work-orders/${wo.json.id}/handover/offer`, { toParty: { kind: 'workshop', id: ws.id } });
    expect(offer.status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/work-orders/${wo.json.id}`)).json.handoverPending).toBe(true);
    await call(env, 'POST', `${BASE}/work-orders/${wo.json.id}/handover/respond`, { offerId: offer.json.id, action: 'accept' });
    const d = (await call(env, 'GET', `${BASE}/work-orders/${wo.json.id}`)).json;
    expect(d.effectiveExecutingParty).toEqual({ kind: 'workshop', id: ws.id });
    expect(d.handoverPending).toBe(false);
    expect((await call(env, 'GET', `${BASE}/work-orders?executingKind=workshop&executingId=${ws.id}`)).json.items).toHaveLength(1);
  });

  it('requires authentication when dev auth is off', async () => {
    const env = makeWrkEnv();
    expect((await call(env, 'GET', `${BASE}/work-orders`)).status).toBe(401);
  });
});
