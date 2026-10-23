import { describe, expect, it } from 'vitest';
import { makeStkEnv, type StkEnv } from './stk-helpers.js';

const BASE = '/api/v1/stores';
async function call(env: StkEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M07 HTTP API', () => {
  it('takes a part from catalogue to receipt, reservation, issue, return and transfer', async () => {
    const env = makeStkEnv({ devAuth: true });
    const part = await call(env, 'POST', `${BASE}/parts`, { partNo: 'seal-01', name: 'Shaft seal', unit: 'each' });
    expect(part.status).toBe(201);
    expect(part.json.partNo).toBe('SEAL-01');
    const store = await call(env, 'POST', `${BASE}/locations`, { code: 'MAIN', name: 'Main store', siteId: env.shipId });
    const central = await call(env, 'POST', `${BASE}/locations`, { code: 'CENTRAL', name: 'Central' });
    expect(store.status).toBe(201);
    const P = part.json.id, L = store.json.id;

    expect((await call(env, 'POST', `${BASE}/receipts`, { partId: P, locationId: L, quantity: 5, unitCost: 1200, currency: 'LKR' })).status).toBe(201);
    expect((await call(env, 'POST', `${BASE}/stock-levels`, { partId: P, locationId: L, minLevel: 4 })).status).toBe(201);
    const wo = env.workOrder();
    expect((await call(env, 'POST', `${BASE}/reservations`, { partId: P, locationId: L, quantity: 2, workOrderId: wo })).status).toBe(201);
    const low = await call(env, 'GET', `${BASE}/stock?belowMinimum=true`);
    expect(low.json.items).toMatchObject([{ partNo: 'SEAL-01', onHand: 5, reserved: 2, available: 3, belowMinimum: 1 }]);

    expect((await call(env, 'POST', `${BASE}/issues`, { partId: P, locationId: L, quantity: 2, workOrderId: wo })).status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/work-orders/${wo}/parts`)).json.items).toMatchObject([{ partNo: 'SEAL-01', netQuantity: 2, netCost: 2400 }]);
    expect((await call(env, 'POST', `${BASE}/returns`, { partId: P, locationId: L, quantity: 1, workOrderId: wo })).status).toBe(201);
    const over = await call(env, 'POST', `${BASE}/issues`, { partId: P, locationId: L, quantity: 50, reference: 'x' });
    expect(over.status).toBe(422);
    expect((await call(env, 'GET', `${BASE}/transactions?partId=${P}`)).json.items).toHaveLength(3);

    const tr = await call(env, 'POST', `${BASE}/transfers`, { fromLocationId: L, toLocationId: central.json.id, lines: [{ partId: P, quantity: 1 }] });
    expect(tr.status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/transfers?state=in_transit`)).json.items).toHaveLength(1);
    expect((await call(env, 'POST', `${BASE}/transfers/${tr.json.id}/receive`, {})).json.state).toBe('received');
    expect((await call(env, 'GET', `${BASE}/numbers/remaining`)).json).toEqual({ sequence: 'transfer_no', remaining: 49 });
    expect((await call(env, 'GET', `${BASE}/parts/${P}`)).json.balance.onHand).toBe(4);
    expect((await call(env, 'POST', `${BASE}/receipts`, { partId: P, locationId: L, quantity: 1, bogus: 1 })).status).toBe(400);
  });
});
