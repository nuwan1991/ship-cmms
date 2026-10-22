import { useCallback, useEffect, useRef, useState } from 'react';
import { api, qs, type ApiError, type Freshness, type ListResponse, type Rec } from './api';

export interface ListState<T> {
  items: T[];
  freshness: Freshness[];
  hasMore: boolean;
  loading: boolean;
  error: ApiError | null;
  reload(): void;
  loadMore(): void;
}

/** Loads a cursor-paginated collection; `params` changes trigger a reload. Pass `path = null` to stay idle. */
export function useList<T = Rec>(path: string | null, params: Record<string, string | undefined> = {}): ListState<T> {
  const [items, setItems] = useState<T[]>([]);
  const [freshness, setFreshness] = useState<Freshness[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const key = JSON.stringify(params);

  const fetchPage = useCallback(
    (cursor: string | null, append: boolean) => {
      if (!path) return;
      const my = ++seq.current;
      setLoading(true);
      api<ListResponse<T>>('GET', `${path}${qs({ limit: '200', ...(JSON.parse(key) as Record<string, string>), cursor: cursor ?? undefined })}`).then(
        (r) => {
          if (my !== seq.current) return; // a newer request superseded this one
          setItems((prev) => (append ? [...prev, ...r.items] : r.items));
          setFreshness(r.freshness);
          setNext(r.nextCursor);
          setError(null);
          setLoading(false);
        },
        (e: ApiError) => {
          if (my !== seq.current) return;
          setError(e);
          setLoading(false);
        },
      );
    },
    [path, key],
  );

  useEffect(() => {
    if (!path) {
      setItems([]);
      return;
    }
    fetchPage(null, false);
  }, [path, key, tick, fetchPage]);

  return { items, freshness, hasMore: next !== null, loading, error, reload: () => setTick((x) => x + 1), loadMore: () => next && fetchPage(next, true) };
}
