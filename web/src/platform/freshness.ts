import type { Freshness } from './api';

export interface FreshnessSummary {
  level: 'authoritative' | 'ok' | 'stale' | 'never';
  /** Oldest successful sync among stale scopes, or null. */
  asOf: string | null;
  pendingOutbound: number;
}

/** Collapse per-scope freshness into one banner state. Never-synchronized and stale outrank everything (CONTRACTS §9-10). */
export function summarizeFreshness(list: readonly Freshness[], installationKind: string | undefined): FreshnessSummary | null {
  if (list.length === 0) return null;
  const pendingOutbound = list.reduce((n, f) => n + f.pendingOutbound, 0);
  const stale = list.filter((f) => f.stale);
  if (stale.some((f) => f.asOf === null)) return { level: 'never', asOf: null, pendingOutbound };
  if (stale.length) return { level: 'stale', asOf: stale.map((f) => f.asOf as string).sort()[0] ?? null, pendingOutbound };
  return { level: installationKind === 'hub' ? 'authoritative' : 'ok', asOf: null, pendingOutbound };
}
