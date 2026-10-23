import { describe, expect, it } from 'vitest';
import { daysAgo, makePmEnv, type PmEnv } from './pm-helpers.js';

const BASE = '/api/v1/pm';
async function call(env: PmEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M06 HTTP API', () => {
  it('runs a plan from template to generated work order and due list', async () => {
    const env = makePmEnv({ devAuth: true });
    const asset = env.pmAsset();
    const tpl = await call(env, 'POST', `${BASE}/task-templates`, { code: 'tq', name: 'Quarterly', checklist: ['Check'] });
    expect(tpl.status).toBe(201);
    expect(tpl.json).toMatchObject({ code: 'TQ', checklist: ['Check'] });
    const meter = await call(env, 'POST', `${BASE}/meters`, { assetId: asset, name: 'Hours' });
    expect((await call(env, 'POST', `${BASE}/meters/${meter.json.id}/readings`, { reading: 100 })).json).toMatchObject({ cumulative: 100 });
    expect((await call(env, 'POST', `${BASE}/meters/${meter.json.id}/readings`, { reading: 90 })).status).toBe(422);
    expect((await call(env, 'GET', `${BASE}/meters?assetId=${asset}`)).json.items[0].current).toMatchObject({ cumulative: 100 });
    expect((await call(env, 'POST', `${BASE}/meters/${meter.json.id}/replace`, { startReading: 0 })).status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/meters/${meter.json.id}/readings`)).json.items).toHaveLength(2);

    const plan = await call(env, 'POST', `${BASE}/plans`, { code: 'p1', title: 'Quarterly inspection', templateId: tpl.json.id, assetId: asset, triggerKind: 'calendar', intervalDays: 30, startAt: daysAgo(40) });
    expect(plan.status).toBe(201);
    expect((await call(env, 'POST', `${BASE}/plans`, { code: 'p2', title: 'bad', assetId: asset, triggerKind: 'calendar' })).status).toBe(400);
    const due = await call(env, 'GET', `${BASE}/due?onlyDue=true`);
    expect(due.json.items).toMatchObject([{ source: 'plan', refCode: 'P1', overdue: true, dueSoon: true }]);

    const gen = await call(env, 'POST', `${BASE}/generate`, {});
    expect(gen.json.generated).toHaveLength(1);
    expect((await call(env, 'POST', `${BASE}/generate`, {})).json.generated).toEqual([]);
    expect((await call(env, 'GET', `${BASE}/plans/${plan.json.id}`)).json).toMatchObject({ lastWorkOrderId: gen.json.generated[0].workOrderId });
    expect((await call(env, 'GET', `${BASE}/due`)).json.items[0].workOrderId).toBe(gen.json.generated[0].workOrderId);

    expect((await call(env, 'POST', `${BASE}/calibrations`, { assetId: asset, result: 'pass', nextDueOn: '2999-01-01' })).status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/calibrations?assetId=${asset}`)).json.items).toHaveLength(1);
    expect((await call(env, 'POST', `${BASE}/plans/${plan.json.id}/complete`, {})).json.lastDoneAt).toBeTruthy();
    expect((await call(env, 'POST', `${BASE}/calibrations`, { assetId: asset, result: 'pass', bogus: 1 })).status).toBe(400);
  });
});
