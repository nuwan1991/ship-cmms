import { describe, expect, it } from 'vitest';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { createEntity as createOrgEntity } from '../../src/modules/m01-organization/service.js';
import { makeQrEnv, type QrEnv } from './qr-helpers.js';

const BASE = '/api/v1/labels';
type Res = { status: number; json: any };
async function call(env: QrEnv, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown): Promise<Res> {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.body ? r.json() : null };
}

describe('M04 HTTP API', () => {
  it('issues, assigns, resolves, lists and prints labels', async () => {
    const env = makeQrEnv({ devAuth: true });
    const asset = createAsset(env.hubActor(), { name: 'Pump', homeShipId: env.shipId }).asset;

    expect((await call(env, 'GET', `${BASE}/labels/remaining`)).json).toEqual({ sequence: 'label_no', remaining: 50 });
    const issued = await call(env, 'POST', `${BASE}/labels/issue`, { count: 3, shipId: env.shipId });
    expect(issued.status).toBe(201);
    expect(issued.json.items).toHaveLength(3);
    const first = issued.json.items[0];

    const assigned = await call(env, 'POST', `${BASE}/labels/${first.id}/assign`, { expectedVersion: 1, assetTag: asset.assetTag });
    expect(assigned.json).toMatchObject({ state: 'assigned', assetId: asset.id });
    const resolved = await call(env, 'GET', `${BASE}/labels/resolve?no=${first.labelNo.toLowerCase()}`);
    expect(resolved.json).toMatchObject({ labelNo: first.labelNo, assetTag: asset.assetTag, assetName: 'Pump' });
    expect((await call(env, 'GET', `${BASE}/labels/resolve?no=SLN-LB-9999`)).status).toBe(404);

    const list = await call(env, 'GET', `${BASE}/labels?state=reserved&limit=1`);
    expect(list.json.items).toHaveLength(1);
    expect(list.json.nextCursor).toBeTruthy();
    expect(list.json.freshness[0]).toMatchObject({ stale: false });
    expect((await call(env, 'GET', `${BASE}/labels?assetId=${asset.id}`)).json.items[0]).toMatchObject({ assetTag: asset.assetTag });
    expect((await call(env, 'GET', `${BASE}/labels?bogus=1`)).status).toBe(400);

    const printed = await call(env, 'POST', `${BASE}/labels/print`, { labelIds: issued.json.items.map((l: any) => l.id), columns: 3, rows: 8 });
    expect(printed.status).toBe(201);
    expect(printed.json.sheets[0].cells).toHaveLength(3);
    expect(printed.json.sheets[0].cells[0].svg).toContain('<svg');
    expect((await call(env, 'GET', `${BASE}/labels/${first.id}/prints`)).json.items).toHaveLength(1);

    const voided = await call(env, 'POST', `${BASE}/labels/${first.id}/void`, { expectedVersion: 2, reason: 'Torn' });
    expect(voided.json.state).toBe('void');
    expect((await call(env, 'POST', `${BASE}/labels/${first.id}/void`, { expectedVersion: 3, reason: 'again' })).status).toBe(422);
    expect((await call(env, 'POST', `${BASE}/labels/issue`, { count: 0 })).status).toBe(400);
  });

  it('runs a survey end to end: template, walk, scan, pending, convert, close', async () => {
    const env = makeQrEnv({ devAuth: true });
    const loc = createOrgEntity(env.hubActor(), 'location', { siteKind: 'ship', siteId: env.shipId, code: 'ER', name: 'Engine Room', kind: 'compartment' });
    const tpl = await call(env, 'POST', `${BASE}/survey-templates`, { code: 'basic', name: 'Basic', items: [{ key: 'ok', label: 'OK?', kind: 'yesno' }] });
    expect(tpl.status).toBe(201);
    expect((await call(env, 'GET', `${BASE}/survey-templates/${tpl.json.id}`)).json.items).toHaveLength(1);

    const survey = await call(env, 'POST', `${BASE}/surveys`, { locationId: loc.id, templateId: tpl.json.id });
    expect(survey.status).toBe(201);
    expect((await call(env, 'POST', `${BASE}/surveys`, { locationId: loc.id })).status).toBe(409);

    const item = await call(env, 'POST', `${BASE}/surveys/${survey.json.id}/items`, { kind: 'pending', description: 'Fire pump', answers: { ok: true } });
    expect(item.status).toBe(201);
    const labels = (await call(env, 'POST', `${BASE}/labels/issue`, { count: 1, shipId: env.shipId })).json.items;
    const conv = await call(env, 'POST', `${BASE}/survey-items/${item.json.id}/convert`, { expectedVersion: 1, labelId: labels[0].id });
    expect(conv.status).toBe(200);
    expect(conv.json.asset).toMatchObject({ name: 'Fire pump', assetTag: 'SLN-EQ-00000001' });

    const scan = await call(env, 'POST', `${BASE}/surveys/${survey.json.id}/items`, { kind: 'scanned', labelNo: labels[0].labelNo });
    expect(scan.json).toMatchObject({ assetTag: 'SLN-EQ-00000001' });
    const items = await call(env, 'GET', `${BASE}/surveys/${survey.json.id}/items`);
    expect(items.json.items).toHaveLength(2);

    const detail = await call(env, 'GET', `${BASE}/surveys/${survey.json.id}`);
    expect(detail.json.summary).toMatchObject({ itemCount: 2, scannedCount: 1, convertedCount: 1, pendingCount: 0 });
    expect((await call(env, 'GET', `${BASE}/surveys?shipId=${env.shipId}&status=open`)).json.items).toHaveLength(1);

    const closed = await call(env, 'POST', `${BASE}/surveys/${survey.json.id}/close`, { expectedVersion: 1 });
    expect(closed.json.status).toBe('closed');
    expect((await call(env, 'POST', `${BASE}/surveys/${survey.json.id}/items`, { kind: 'pending', description: 'Late' })).status).toBe(422);
  });

  it('requires authentication when dev auth is off', async () => {
    const env = makeQrEnv();
    expect((await call(env, 'GET', `${BASE}/labels`)).status).toBe(401);
  });
});
