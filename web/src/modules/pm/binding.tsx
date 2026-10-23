import { useMemo } from 'react';
import type { Rec } from '../../platform/api';
import { useList } from '../../platform/useList';

export const PM = '/api/v1/pm';
export const AST = '/api/v1/assets';

export const normalizeTag = (s: string): string => s.trim().toUpperCase();
export const fmtNum = (n: unknown): string => String(Math.round(Number(n) * 100) / 100);

/** Assets by id for showing "tag – name", plus select options. Loaded once per screen from the asset register (read-only). */
export function useAssets() {
  const list = useList(`${AST}/assets`, { limit: '500' });
  return useMemo(() => {
    const label = (id: unknown): string => { const a = list.items.find((x) => x.id === id); return a ? `${String(a.assetTag)} – ${String(a.name)}` : String(id ?? ''); };
    const options = list.items.map((a: Rec) => ({ value: String(a.id), label: `${String(a.assetTag)} – ${String(a.name)}` }));
    return { items: list.items, label, options };
  }, [list.items]);
}
