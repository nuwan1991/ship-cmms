import { describe, expect, it } from 'vitest';
import { makeOfcEnv } from './ofc-helpers.js';

const BASE = '/api/v1/office';

describe('M15 HTTP API', () => {
  it('creates units, links, uploads and downloads an attachment, comments, and returns the record bundle', async () => {
    const env = makeOfcEnv({ devAuth: true });
    const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
      const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
      return { status: r.statusCode, json: r.headers['content-type']?.toString().includes('json') && r.body ? r.json() : null, body: r.body };
    };
    const dep = await call('POST', `${BASE}/units`, { commandId: env.commandId, level: 'department', code: 'fleet', name: 'Fleet department' });
    expect(dep.status).toBe(201);
    expect(dep.json.code).toBe('FLEET');
    const ws = await call('POST', `${BASE}/units`, { commandId: env.commandId, level: 'workshop', parentId: dep.json.id, code: 'ELEC-WS', name: 'Electrical workshop', verifyRule: 'officer_required' });
    expect(ws.status).toBe(201);
    expect((await call('GET', `${BASE}/units?commandId=${env.commandId}`)).json.items.map((u: { path: string }) => u.path)).toEqual(['FLEET', 'FLEET / ELEC-WS']);
    expect((await call('PATCH', `${BASE}/units/${ws.json.id}`, { expectedVersion: 1, name: 'Electrical WS', reason: 'rename' })).json.version).toBe(2);

    const rec = { type: 'ofc.org_unit', id: ws.json.id };
    expect((await call('POST', `${BASE}/links`, { from: rec, to: { type: 'ofc.org_unit', id: dep.json.id } })).status).toBe(201);
    const up = await call('POST', `${BASE}/attachments`, { fileName: 'photo.jpg', mimeType: 'image/jpeg', contentBase64: Buffer.from('jpegbytes').toString('base64'), record: rec });
    expect(up.status).toBe(201);
    const dl = await call('GET', `${BASE}/attachments/${up.json.id}/content`);
    expect(dl.status).toBe(200);
    expect(dl.body).toBe('jpegbytes');
    expect((await call('POST', `${BASE}/comments`, { record: rec, kind: 'progress', note: 'Workshop set up' })).status).toBe(201);

    const bundle = await call('GET', `${BASE}/record?type=ofc.org_unit&id=${ws.json.id}`);
    expect(bundle.json.links).toHaveLength(1);
    expect(bundle.json.attachments).toMatchObject([{ fileName: 'photo.jpg', sizeBytes: 9 }]);
    expect(bundle.json.timeline.map((e: { kind: string }) => e.kind)).toEqual(['link', 'attachment', 'progress']);
    expect((await call('POST', `${BASE}/units`, { commandId: env.commandId, level: 'workshop', code: 'NOPARENT', name: 'x' })).status).toBe(400);
    expect((await call('GET', `${BASE}/record?type=ofc.nothing&id=${ws.json.id}`)).status).toBe(400);
  });
});
