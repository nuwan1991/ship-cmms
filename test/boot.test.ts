import { afterEach, describe, expect, it } from 'vitest';
import { boot } from '../src/boot.js';
import type { Config } from '../src/platform/app-context.js';

const base: Config = { dataDir: '', dbFile: ':memory:', host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: false };

describe('startup', () => {
  afterEach(() => {
    delete process.env.CMMS_DEV_AUTH;
  });

  it('production boot registers the identity authorizer and answers anonymous requests with 401', async () => {
    const { app, ctx } = boot(base);
    expect(ctx.authz.current().name).toBe('idn-authorizer');
    const res = await app.inject('/api/v1/org/ships');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('starts in explicit dev mode and serves health', async () => {
    process.env.CMMS_DEV_AUTH = '1';
    const { app } = boot({ ...base, devAuth: true });
    const res = await app.inject('/api/v1/system/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'uninitialized', authorizer: 'dev-allow-all', schemaVersions: { platform: 1 } });
  });

  it('refuses dev auth when the environment flag is absent', () => {
    expect(() => boot({ ...base, devAuth: true })).toThrow(/CMMS_DEV_AUTH/);
  });
});
