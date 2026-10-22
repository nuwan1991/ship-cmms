import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { DEFAULT_TZ } from './time';

export interface SystemInfo {
  status: string;
  installation: { installationId: string; kind: 'hub' | 'command' | 'ship' | 'workshop'; code: string; name: string } | null;
  displayTimeZone: string;
  authorizer: string;
}

const Ctx = createContext<{ info: SystemInfo | null; tz: string; error: string | null }>({ info: null, tz: DEFAULT_TZ, error: null });
export const useSystem = () => useContext(Ctx);

export function SystemProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<SystemInfo>('GET', '/api/v1/system/health').then(setInfo, (e: Error) => setError(e.message));
  }, []);
  return <Ctx.Provider value={{ info, tz: info?.displayTimeZone ?? DEFAULT_TZ, error }}>{children}</Ctx.Provider>;
}
