import { createHash } from 'node:crypto';

/** Deterministic JSON (sorted keys) so payload hashes match across installations. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');
export const payloadHash = (payload: unknown): string => sha256Hex(canonicalJson(payload));

/** DB columns are snake_case; JSON APIs are camelCase. */
export const toCamel = (s: string): string => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
export const toSnake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
