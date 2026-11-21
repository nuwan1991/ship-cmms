/** M15 web helpers: API base, the chosen office (dockyard command), simple loaders, small shared widgets. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs, type ApiError, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { useList } from '../../platform/useList';

export const OFC = '/api/v1/office';
const ORG = '/api/v1/org';
const KEY = 'ofc.commandId';

const readKey = (): string => { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } };
const writeKey = (v: string): void => { try { localStorage.setItem(KEY, v); } catch { /* private mode: not remembered */ } };

/** The office this screen works for. Remembered per browser; the first active command is used when nothing is chosen. */
export function useOffice() {
  const commands = useList(`${ORG}/commands`);
  const [chosen, setChosen] = useState(readKey);
  const active = commands.items.filter((c) => c.status !== 'inactive');
  const commandId = active.some((c) => c.id === chosen) ? chosen : String(active[0]?.id ?? '');
  const choose = (id: string) => { writeKey(id); setChosen(id); };
  return { commandId, commands: active, choose, error: commands.error, loading: commands.loading };
}

export function OfficePicker({ office }: { office: ReturnType<typeof useOffice> }) {
  if (office.commands.length <= 1) return null;
  return (
    <select aria-label={t('ofc.field.office')} value={office.commandId} onChange={(e) => office.choose(e.target.value)}>
      {office.commands.map((c) => <option key={c.id} value={c.id}>{String(c.name)}</option>)}
    </select>
  );
}

/** GET loader for M15 endpoints (which return `{ items, total }` or a single object). `path = null` stays idle. */
export function useGet<T = Rec>(path: string | null, params: Record<string, string | undefined> = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!path) { setData(null); return; }
    const my = ++seq.current;
    setLoading(true);
    api<T>('GET', `${path}${qs(JSON.parse(key) as Record<string, string>)}`).then(
      (r) => { if (my === seq.current) { setData(r); setError(null); setLoading(false); } },
      (e: ApiError) => { if (my === seq.current) { setError(e); setLoading(false); } },
    );
  }, [path, key, tick]);
  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}

export interface Page { items: Rec[]; total: number }

/** Read a browser File as base64 (no data: prefix) for the attachment upload API. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

export const PRIORITIES = ['immediate', 'high', 'normal', 'low'] as const;
export const priorityOptions = () => PRIORITIES.map((p) => ({ value: p, label: t(`ofc.priority.${p}`) }));
export const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Today as YYYY-MM-DD in the browser's zone (filters only; the server decides what is overdue). */
export const todayIso = (): string => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

export function DueCell({ date, overdue }: { date: unknown; overdue: unknown }) {
  if (!date) return <>—</>;
  return overdue ? <span className="chip warn">{String(date)} · {t('ofc.overdue')}</span> : <>{String(date)}</>;
}
