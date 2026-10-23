import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mountStatic } from '../../src/static.js';
import { makeOpsEnv } from './ops-helpers.js';

describe('M14 HTTP API', () => {
  it('reports status, makes and verifies a backup, runs an integrity check', async () => {
    const e = makeOpsEnv();
    const call = async (method: 'GET' | 'POST', url: string) => { const r = await e.app.inject({ method, url, headers: { 'x-dev-user': 'admin' } }); return { status: r.statusCode, json: r.body ? r.json() : null }; };
    expect((await call('GET', '/api/v1/ops/status')).json.warnings.map((w: { code: string }) => w.code)).toContain('no_backup');
    const made = await call('POST', '/api/v1/ops/backups');
    expect(made.status).toBe(201);
    const list = (await call('GET', '/api/v1/ops/backups')).json;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ reason: 'manual', createdBy: 'admin' });
    expect((await call('POST', `/api/v1/ops/backups/${list.items[0].id}/verify`)).json.ok).toBe(true);
    expect((await call('POST', '/api/v1/ops/backups/not-a-uuid/verify')).status).toBe(400);
    expect((await call('POST', `/api/v1/ops/backups/${crypto.randomUUID()}/verify`)).status).toBe(404);
    const chk = (await call('POST', '/api/v1/ops/integrity')).json;
    expect(chk.ok).toBe(true);
    expect((await call('GET', '/api/v1/ops/integrity')).json.items).toHaveLength(1);
    // The audit trail records the backup.
    expect(e.db.prepare("SELECT COUNT(*) AS n FROM sys_audit_event WHERE action = 'ops.backup.create'").get()).toEqual({ n: 1 });
  });
});

describe('static web serving', () => {
  it('serves files, falls back to the app page for client routes, never serves outside the folder, and leaves /api alone', async () => {
    const e = makeOpsEnv();
    const web = join(e.dir, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<html>APP</html>');
    writeFileSync(join(web, 'assets', 'a.js'), 'console.log(1)');
    writeFileSync(join(e.dir, 'secret.txt'), 'SECRET');
    expect(mountStatic(e.app, web)).toBe(true);
    const get = (url: string) => e.app.inject({ method: 'GET', url });
    expect((await get('/')).body).toContain('APP');
    expect((await get('/ops/status')).body).toContain('APP');
    const js = await get('/assets/a.js');
    expect(js.headers['content-type']).toContain('javascript');
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await get('/../secret.txt')).body).not.toContain('SECRET');
    expect((await get('/%2e%2e/secret.txt')).body).not.toContain('SECRET');
    expect((await get('/api/v1/nope')).statusCode).toBe(404);
    expect((await get('/api/v1/system/health')).statusCode).toBe(200);
    expect(mountStatic(e.app, join(e.dir, 'missing'))).toBe(false);
  });
});
