import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, SIGNED_OUT_EVENT } from './api';
import { setPermissions } from './permissions';
import { setToken } from './sessionStore';

export interface Me {
  user: { id: string; displayName: string; rank?: string | null; serviceNumber?: string | null };
  permissions: string[];
  restrictedWhenOffline: Record<string, string>;
  authority: { hub: boolean; lastHubSyncAt: string | null; leaseDays: number | null; leaseExpiresAt: string | null; expired: boolean };
  clock: { highWater: string | null; suspect: boolean };
}

export type AuthState = 'loading' | 'anonymous' | 'ready' | 'unreachable';

interface AuthCtx {
  state: AuthState;
  me: Me | null;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthCtx>({ state: 'loading', me: null, signIn: async () => undefined, signOut: async () => undefined, refresh: async () => undefined });
export const useAuth = () => useContext(Ctx);

const REFRESH_MS = 5 * 60_000; // lease and clock state change slowly; re-read it so banners stay true

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const anonymous = useCallback(() => {
    setToken(null);
    setPermissions(null);
    setMe(null);
    setState('anonymous');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>('GET', '/api/v1/identity/me');
      setPermissions(m.permissions);
      setMe(m);
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setState((s) => (s === 'ready' ? s : 'unreachable'));
      else anonymous();
    }
  }, [anonymous]);

  useEffect(() => {
    void refresh();
    const onOut = () => anonymous();
    window.addEventListener(SIGNED_OUT_EVENT, onOut);
    const h = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, onOut);
      clearInterval(h);
    };
  }, [refresh, anonymous]);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string }>('POST', '/api/v1/identity/login', { username, password });
    setToken(r.token);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('POST', '/api/v1/identity/logout');
    } catch {
      /* the local session is dropped either way */
    }
    anonymous();
  }, [anonymous]);

  const value = useMemo(() => ({ state, me, signIn, signOut, refresh }), [state, me, signIn, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
