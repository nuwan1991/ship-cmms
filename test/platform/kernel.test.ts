import { describe, expect, it } from 'vitest';
import { AuthorizerRegistry, denyAllAuthorizer, devAllowAllAuthorizer, requirePermission } from '../../src/platform/authz.js';
import { canonicalJson, payloadHash, toCamel, toSnake } from '../../src/platform/canonical.js';
import { SyncChange } from '../../src/platform/contracts.js';
import { AppError, toEnvelope } from '../../src/platform/errors.js';
import { EventBus } from '../../src/platform/events.js';
import { isUuid, uuidv7 } from '../../src/platform/ids.js';
import { isLocalDate, isUtcIso, toLocalDisplay } from '../../src/platform/time.js';
import { decimalToMilli, milliToDecimal } from '../../src/platform/units.js';

describe('ids', () => {
  it('generates valid, unique, time-ordered UUIDv7', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    expect(ids.every(isUuid)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids[0]![14]).toBe('7');
  });
});

describe('time and units', () => {
  it('stores UTC and displays Asia/Colombo (UTC+05:30)', () => {
    expect(isUtcIso('2026-10-21T17:59:00.000Z')).toBe(true);
    expect(isUtcIso('2026-10-21 17:59')).toBe(false);
    expect(toLocalDisplay('2026-10-21T17:59:00.000Z')).toBe('2026-10-21 23:29');
    expect(isLocalDate('2026-02-30')).toBe(false);
    expect(isLocalDate('2026-10-21')).toBe(true);
  });
  it('keeps quantities as exact integers', () => {
    expect(decimalToMilli('12.5')).toBe(12500);
    expect(milliToDecimal(12500)).toBe('12.500');
    expect(() => decimalToMilli('1.2345')).toThrow();
  });
});

describe('errors and naming', () => {
  it('maps codes to statuses and hides internals', () => {
    const e = new AppError('VERSION_CONFLICT', 'stale', { currentVersion: 3 });
    expect(e.status).toBe(409);
    expect(toEnvelope(e, 'c1').error).toMatchObject({ code: 'VERSION_CONFLICT', correlationId: 'c1' });
    expect(toEnvelope(new Error('secret db path'), 'c2').error.message).toBe('Unexpected error');
  });
  it('converts snake/camel and hashes canonically', () => {
    expect(toCamel('owner_installation_id')).toBe('ownerInstallationId');
    expect(toSnake('ownerInstallationId')).toBe('owner_installation_id');
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(payloadHash({ a: 1, b: 2 })).toBe(payloadHash({ b: 2, a: 1 }));
  });
});

describe('contracts', () => {
  it('validates a sync change envelope', () => {
    const change = {
      changeId: uuidv7(), originInstallationId: uuidv7(), entityType: 'org.ship', entityId: uuidv7(), op: 'upsert',
      version: 1, ownerInstallationId: uuidv7(), homeScopeId: null, occurredAt: '2026-10-21T17:59:00.000Z',
      schemaVersion: 1, payload: { name: 'x' }, payloadHash: payloadHash({ name: 'x' }),
    };
    expect(SyncChange.safeParse(change).success).toBe(true);
    expect(SyncChange.safeParse({ ...change, occurredAt: 'yesterday' }).success).toBe(false);
  });
});

describe('authorization port', () => {
  const principal = { userId: 'u1', installationId: uuidv7(), displayName: 'U' };
  it('fails closed without an authorizer and rejects dev auth outside dev mode', () => {
    const r = new AuthorizerRegistry();
    expect(() => r.assertProductionReady()).toThrow(/No Authorizer/);
    delete process.env.CMMS_DEV_AUTH;
    expect(() => r.register(devAllowAllAuthorizer)).toThrow(/CMMS_DEV_AUTH/);
    expect(() => requirePermission(denyAllAuthorizer, principal, 'org.ship.update')).toThrow(AppError);
    expect(() => requirePermission(devAllowAllAuthorizer, principal, 'BadCode')).toThrow(/Malformed/);
  });
});

describe('event bus', () => {
  it('isolates handler failures from the publisher', () => {
    const bus = new EventBus();
    let seen = 0;
    bus.subscribe('mon.condition.breached', () => { throw new Error('boom'); });
    bus.subscribe('mon.condition.breached', () => { seen += 1; });
    expect(() => bus.publish({ type: 'mon.condition.breached', occurredAt: '2026-10-21T00:00:00.000Z', payload: {} })).not.toThrow();
    expect(seen).toBe(1);
    expect(bus.failures).toHaveLength(1);
  });
});
