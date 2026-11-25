import { describe, expect, it } from 'vitest';
import { day, daysAgo, makeDckEnv, type DckEnv } from './dck-helpers.js';

const BASE = '/api/v1/docking';
async function call(env: DckEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M16 HTTP API', () => {
  it('plans, docks, works, surveys, undocks and completes a docking', async () => {
    const env = makeDckEnv({ devAuth: true });
    const dock = await call(env, 'POST', `${BASE}/docks`, { code: 'gd1', name: 'Graving dock 1', kind: 'graving_dock' });
    expect(dock.status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/docks?q=graving`)).json.items).toHaveLength(1);

    const d = await call(env, 'POST', `${BASE}/dockings`, { shipId: env.shipId, dockId: dock.json.id, reference: 'DO-1', plannedDockIn: day(-1), plannedUndock: day(14) });
    expect(d.status).toBe(201);
    const id = d.json.dockingId as string;
    expect((await call(env, 'POST', `${BASE}/dockings`, { shipId: env.shipId, plannedDockIn: day(2), plannedUndock: day(3) })).status).toBe(422);
    expect((await call(env, 'GET', `${BASE}/dockings?open=true`)).json.items.map((x: { dockingId: string }) => x.dockingId)).toEqual([id]);

    expect((await call(env, 'POST', `${BASE}/dockings/${id}/dock-in`, { expectedVersion: 1, dockedAt: daysAgo(1) })).json.status).toBe('in_dock');
    const item = await call(env, 'POST', `${BASE}/dockings/${id}/work-items`, { category: 'hull', title: 'Scrape and inspect hull' });
    expect(item.status).toBe(201);
    const wo = await call(env, 'POST', `${BASE}/work-items/${item.json.id}/work-order`, {});
    expect(wo.status).toBe(201);
    expect(wo.json.workOrderNo).toBeTruthy();
    expect((await call(env, 'POST', `${BASE}/dockings/${id}/surveys`, { area: 'hull_plating', condition: 'fair', finding: 'Light fouling' })).status).toBe(201);
    expect((await call(env, 'PATCH', `${BASE}/work-items/${item.json.id}`, { expectedVersion: 2, status: 'done' })).json.status).toBe('done');
    expect((await call(env, 'POST', `${BASE}/dockings/${id}/undock`, { expectedVersion: 2 })).json.status).toBe('undocked');

    const detail = await call(env, 'GET', `${BASE}/dockings/${id}`);
    expect(detail.json).toMatchObject({ id, version: 3, status: 'undocked', itemsTotal: 1, surveyCount: 1 });
    expect(detail.json.items).toHaveLength(1);
    expect(detail.json.surveys).toHaveLength(1);

    expect((await call(env, 'POST', `${BASE}/dockings/${id}/complete`, { expectedVersion: 3, intervalMonths: 24 })).json.status).toBe('completed');
    const due = await call(env, 'GET', `${BASE}/due`);
    const mine = due.json.items.find((x: { shipId: string }) => x.shipId === env.shipId);
    expect(mine).toMatchObject({ dueState: 'ok', lastDockingId: id });
    expect((await call(env, 'GET', `${BASE}/due?onlyDue=true`)).json.items.map((x: { shipId: string }) => x.shipId)).toEqual([env.ship2Id]);
    expect((await call(env, 'GET', `${BASE}/conflicts`)).json.items).toEqual([]);
    expect((await call(env, 'GET', `${BASE}/dockings/not-a-uuid`)).status).toBe(400);
  });
});
