import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppContext } from '../src/platform/app-context.js';
import { AuthorizerRegistry } from '../src/platform/authz.js';
import { createPlatformRegistry } from '../src/platform/entity-registry.js';
import { ApprovalPortRegistry, ImportExportRegistry } from '../src/platform/ports.js';
import { EventBus } from '../src/platform/events.js';
import { setLocalIdentity } from '../src/platform/identity.js';
import { makeEnv } from './helpers.js';

function ctxFor(initialized: boolean): AppContext {
  const { db } = makeEnv();
  return {
    db,
    config: { dataDir: '', dbFile: ':memory:', host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: false },
    entities: createPlatformRegistry(),
    authz: new AuthorizerRegistry(),
    approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(),
    events: new EventBus(),
    identity: initialized ? setLocalIdentity(db, { kind: 'hub', code: 'HQ', name: 'Fleet HQ' }) : null,
  };
}

describe('HTTP shell', () => {
  it('reports health with installation identity and schema versions', async () => {
    const app = buildApp(ctxFor(true));
    const res = await app.inject('/api/v1/system/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', installation: { kind: 'hub', code: 'HQ' }, displayTimeZone: 'Asia/Colombo', schemaVersions: { platform: 1 } });
  });

  it('reports an uninitialized installation instead of failing', async () => {
    const res = await buildApp(ctxFor(false)).inject('/api/v1/system/health');
    expect(res.json().status).toBe('uninitialized');
  });

  it('returns the shared error envelope and echoes the correlation id', async () => {
    const res = await buildApp(ctxFor(true)).inject({ url: '/api/v1/nope', headers: { 'x-correlation-id': 'corr-12345678' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-correlation-id']).toBe('corr-12345678');
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'No route GET /api/v1/nope', correlationId: 'corr-12345678' } });
  });

  it('lists modules and registered entities', async () => {
    const app = buildApp(ctxFor(true));
    expect((await app.inject('/api/v1/system/modules')).json().modules).toHaveLength(14);
    expect((await app.inject('/api/v1/system/entities')).json().entities.map((e: { type: string }) => e.type)).toContain('sys.audit_event');
  });
});
