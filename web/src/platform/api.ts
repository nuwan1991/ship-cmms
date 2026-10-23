/** Thin fetch client for the CMMS API: shared error envelope, correlation ids, camelCase JSON (CONTRACTS §6, §9). */
import { getToken, setToken } from './sessionStore';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  correlationId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
  get code(): string {
    return this.body.code;
  }
  /** Set when code === VERSION_CONFLICT. */
  get currentVersion(): number | undefined {
    const v = this.body.details?.currentVersion;
    return typeof v === 'number' ? v : undefined;
  }
}

export type Rec = { id: string; version: number; updatedAt: string } & Record<string, unknown>;

export interface Freshness {
  scope: { kind: string; id?: string };
  asOf: string | null;
  stale: boolean;
  pendingOutbound: number;
}

export interface ListResponse<T = Rec> {
  items: T[];
  nextCursor: string | null;
  freshness: Freshness[];
}

const newCorrelationId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Fired when the server rejects the session token, so the shell can return to the sign-in screen. */
export const SIGNED_OUT_EVENT = 'cmms:signed-out';

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        'x-correlation-id': newCorrelationId(),
        ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Local server unreachable (LAN down, server stopped). Distinct from an API error.
    throw new ApiError(0, { code: 'NETWORK', message: 'The local server cannot be reached.', correlationId: '-' });
  }
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (res.status === 401 && getToken() && typeof window !== 'undefined') {
    setToken(null);
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  if (!res.ok) {
    const e = (data as { error?: ApiErrorBody } | null)?.error;
    throw new ApiError(res.status, e ?? { code: 'INTERNAL', message: `Request failed (${res.status})`, correlationId: res.headers.get('x-correlation-id') ?? '-' });
  }
  return data as T;
}

export const qs = (params: Record<string, string | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
