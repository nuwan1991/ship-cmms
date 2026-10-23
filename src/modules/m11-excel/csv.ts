/** Small RFC 4180 reader/writer. Excel's "CSV UTF-8" starts with a byte-order mark and may use ; as the separator. */
import { AppError } from '../../platform/errors.js';

export const MAX_CSV_CELLS = 2_000_000;

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let cells = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; if (++cells > MAX_CSV_CELLS) throw new AppError('VALIDATION_FAILED', 'The file has too many cells'); }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (quoted) throw new AppError('VALIDATION_FAILED', 'The CSV file has an unclosed quote');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Cells starting with = + - @ would run as formulas in Excel; prefix them so data stays data (numbers are left alone). */
function safe(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}
export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const q = (v: unknown) => {
    const s = safe(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(q).join(',')).join('\r\n')}\r\n`;
}
