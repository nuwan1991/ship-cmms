/** Small helpers shared by the modules' ImportExportPort implementations (M11 consumes the ports, never these). */
import { AppError } from './errors.js';
import type { ImportRowResult } from './ports.js';

/** A trimmed string from a spreadsheet cell, or undefined when empty. Numbers (Excel strips quotes from numeric-looking text) become text. */
export function cell(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  if (v === null || v === undefined) return undefined;
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  const t = s.trim();
  return t === '' ? undefined : t;
}

/** A number from a cell, undefined when empty, NaN when not numeric. */
export function numCell(row: Record<string, unknown>, key: string): number | undefined {
  const s = cell(row, key);
  return s === undefined ? undefined : Number(s);
}

/** Turn anything thrown by a command service into a one-line, user-facing row error. */
export function rowError(e: unknown): ImportRowResult {
  if (e instanceof AppError) return { ok: false, errors: [e.message] };
  throw e;
}
export const rowFail = (...errors: string[]): ImportRowResult => ({ ok: false, errors });
