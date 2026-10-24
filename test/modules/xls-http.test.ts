import { describe, expect, it } from 'vitest';
import { readXlsx } from '../../src/modules/m11-excel/xlsx.js';
import { csvBase64, makeXlsEnv, xlsxBase64, type XlsEnv } from './xls-helpers.js';

const BASE = '/api/v1/excel';
async function call(env: XlsEnv, method: 'GET' | 'POST', url: string, payload?: unknown) {
  const r = await env.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
  return { status: r.statusCode, json: r.headers['content-type']?.toString().startsWith('application/json') ? r.json() : null, raw: r.rawPayload, headers: r.headers };
}

describe('M11 HTTP API', () => {
  it('lists templates, serves files, previews, reports and commits', async () => {
    const env = makeXlsEnv({ devAuth: true });
    const tpl = await call(env, 'GET', `${BASE}/templates`);
    expect(tpl.json.items.map((t: any) => t.code)).toEqual(['assets', 'classification-map', 'classifications', 'locations', 'parts']);
    expect(tpl.json.items.find((t: any) => t.code === 'parts').columns[0]).toMatchObject({ key: 'partNo', required: true });

    const blank = await call(env, 'GET', `${BASE}/templates/parts/file?format=xlsx`);
    expect(blank.status).toBe(200);
    expect(blank.headers['content-type']).toContain('spreadsheetml');
    expect(blank.headers['content-disposition']).toContain('parts-template.xlsx');
    expect(readXlsx(new Uint8Array(blank.raw))[0]!.rows[0]![0]).toBe('Part number');
    expect((await call(env, 'GET', `${BASE}/templates/nope/file`)).status).toBe(404);
    expect((await call(env, 'GET', `${BASE}/templates/parts/file?kind=huh`)).status).toBe(400);

    const up = await call(env, 'POST', `${BASE}/imports`, { templateCode: 'parts', fileName: 'C:\\fakepath\\parts.xlsx', contentBase64: xlsxBase64(['Part number', 'Name'], [['P1', 'One'], ['P2', null]]) });
    expect(up.status).toBe(201);
    expect(up.json).toMatchObject({ fileName: 'parts.xlsx', status: 'previewed', totalRows: 2, okRows: 1, errorRows: 1 });
    const rows = await call(env, 'GET', `${BASE}/imports/${up.json.id}/rows?status=error`);
    expect(rows.json.items).toMatchObject([{ rowNo: 3, status: 'error', errors: ['Name is required'] }]);
    expect((await call(env, 'GET', `${BASE}/imports/${up.json.id}/rows?limit=1&cursor=2`)).json).toMatchObject({ items: [{ rowNo: 3 }], nextCursor: null });
    const rep = await call(env, 'GET', `${BASE}/imports/${up.json.id}/report`);
    expect(rep.headers['content-type']).toContain('text/csv');
    expect(String(rep.raw)).toContain('Name is required');

    const blocked = await call(env, 'POST', `${BASE}/imports/${up.json.id}/commit`, {});
    expect(blocked.status).toBe(422);
    expect(env.ctx.db.prepare('SELECT COUNT(*) AS n FROM stk_part').get()).toEqual({ n: 0 });
    const ok = await call(env, 'POST', `${BASE}/imports/${up.json.id}/commit`, { skipErrors: true });
    expect(ok.json).toMatchObject({ status: 'committed', createRows: 1 });
    expect((await call(env, 'GET', `${BASE}/imports`)).json.items).toHaveLength(1);

    const csv = await call(env, 'POST', `${BASE}/imports`, { templateCode: 'parts', fileName: 'p.csv', contentBase64: csvBase64('Part number,Name\nP3,Three') });
    expect(csv.json).toMatchObject({ fileKind: 'csv', okRows: 1 });
    const exp = await call(env, 'GET', `${BASE}/templates/parts/file?kind=data&format=csv`);
    expect(String(exp.raw)).toContain('P1,One');
    expect(exp.headers['x-row-count']).toBe('1');

    expect((await call(env, 'POST', `${BASE}/imports`, { templateCode: 'parts', fileName: 'x.xlsx', contentBase64: 'not base64!!' })).status).toBe(400);
    expect((await call(env, 'POST', `${BASE}/imports`, { templateCode: 'parts', fileName: 'x.xlsx', contentBase64: xlsxBase64(['Part number', 'Name'], []), extra: 1 })).status).toBe(400);
  });
});
