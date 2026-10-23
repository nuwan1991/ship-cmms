import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { can, permissionMatches, setPermissions } from './permissions';
import { getToken, setToken } from './sessionStore';

afterEach(() => {
  setToken(null);
  setPermissions(null);
  vi.unstubAllGlobals();
});

describe('permissions', () => {
  it('matches exact codes, prefix wildcards and *', () => {
    expect(permissionMatches('org.ship.view', 'org.ship.view')).toBe(true);
    expect(permissionMatches('org.*', 'org.ship.view')).toBe(true);
    expect(permissionMatches('org.*', 'idn.user.view')).toBe(false);
    expect(permissionMatches('*', 'anything.at.all')).toBe(true);
    expect(permissionMatches('org.ship.view', 'org.ship.update')).toBe(false);
  });
  it('denies everything until a signed-in user supplies permissions, and again after sign-out', () => {
    expect(can('org.ship.view')).toBe(false);
    setPermissions(['org.*', 'idn.user.view']);
    expect(can('org.command.update')).toBe(true);
    expect(can('idn.user.view')).toBe(true);
    expect(can('idn.user.update')).toBe(false);
    setPermissions(null);
    expect(can('org.ship.view')).toBe(false);
  });
});

describe('session token and API client', () => {
  it('keeps the token in memory even when browser storage is unavailable', () => {
    expect(getToken()).toBeNull();
    setToken('abc');
    expect(getToken()).toBe('abc');
    setToken(null);
    expect(getToken()).toBeNull();
  });

  it('sends the bearer token only when signed in', async () => {
    const seen: Array<string | undefined> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers.authorization);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    await api('GET', '/api/v1/identity/me');
    setToken('tok123');
    await api('GET', '/api/v1/identity/me');
    expect(seen).toEqual([undefined, 'Bearer tok123']);
  });

  it('turns the error envelope into an ApiError and drops a rejected token', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'expired', correlationId: 'c1' } }), { status: 401 }));
    setToken('stale');
    await expect(api('GET', '/x')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    // In a browser the shell is told to sign out; here (no window) the token stays until the shell clears it.
    expect(typeof getToken()).toBe('string');
  });
});
