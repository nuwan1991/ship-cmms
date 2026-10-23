import { describe, expect, it } from 'vitest';
import { createWorkOrder } from '../../src/modules/m05-work/service.js';
import { makeRptEnv } from './rpt-helpers.js';

describe('M13 HTTP API', () => {
  it('serves the dashboard, a report with freshness, its CSV, and notifications', async () => {
    const env = makeRptEnv({ devAuth: true });
    createWorkOrder(env.asHub(), { title: 'Overhaul pump', shipId: env.shipId, priority: 'urgent', requestedDue: '2020-01-01' });
    const get = (url: string, method: 'GET' | 'POST' = 'GET') => env.app.inject({ method, url, headers: { 'x-dev-user': 'u1' } });
    const dash = (await get('/api/v1/reports/dashboard')).json();
    expect(dash.counts).toMatchObject({ openWorkOrders: 1, overdueWorkOrders: 1 });
    expect(dash.freshness).toMatchObject({ stale: false });
    const list = (await get('/api/v1/reports/reports')).json();
    expect(list.items.map((r: { code: string }) => r.code)).toContain('backlog');
    const rep = (await get(`/api/v1/reports/reports/backlog?shipId=${env.shipId}`)).json();
    expect(rep.items).toHaveLength(1);
    expect(rep.freshness[0]).toMatchObject({ stale: false });
    expect(rep.report.columns.length).toBeGreaterThan(5);
    const csv = await get('/api/v1/reports/reports/backlog/file');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Overhaul pump');
    expect(csv.body).toContain('data as of');
    expect((await get('/api/v1/reports/reports/nope')).statusCode).toBe(404);
    expect((await get('/api/v1/reports/reports/backlog?shipId=bad')).statusCode).toBe(400);
    expect((await get('/api/v1/reports/notifications/refresh', 'POST')).json().raised).toBe(1);
    const n = (await get('/api/v1/reports/notifications?status=open')).json();
    expect(n.items).toHaveLength(1);
    const ack = (await get(`/api/v1/reports/notifications/${n.items[0].id}/acknowledge`, 'POST')).json();
    expect(ack.acknowledgedBy).toBe('u1');
  });
});
