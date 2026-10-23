/** Turn an uploaded file into rows keyed by a template's column keys, and a template/export into a file. */
import { strFromU8, strToU8 } from 'fflate';
import { AppError } from '../../platform/errors.js';
import type { ImportColumn } from '../../platform/ports.js';
import { parseCsv, serializeCsv } from './csv.js';
import { colLetters, MAX_ROWS, readXlsx, writeXlsx, type CellValue } from './xlsx.js';

export type FileKind = 'xlsx' | 'csv';
export interface ParsedRow { rowNo: number; data: Record<string, CellValue> }
export interface ParsedTable { rows: ParsedRow[]; ignoredColumns: string[] }

const MAX_CELL_CHARS = 2000;
const norm = (s: unknown): string => String(s ?? '').replace(/\*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function sniffKind(bytes: Uint8Array): FileKind {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04 ? 'xlsx' : 'csv';
}

export function rawTable(bytes: Uint8Array, kind: FileKind): CellValue[][] {
  if (kind === 'csv') {
    const text = strFromU8(bytes);
    if (text.includes('\u0000')) throw new AppError('VALIDATION_FAILED', 'This file is not text. Save it as .xlsx or CSV and try again.');
    return parseCsv(text);
  }
  const sheets = readXlsx(bytes);
  return (sheets.find((s) => norm(s.name) === 'data') ?? sheets[0]!).rows;
}

/** First non-empty row is the header (labels or keys, any case). Rows that are entirely empty are skipped; row numbers are the spreadsheet's own. */
export function mapRows(raw: CellValue[][], columns: readonly ImportColumn[]): ParsedTable {
  const headerAt = raw.findIndex((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''));
  if (headerAt < 0) throw new AppError('VALIDATION_FAILED', 'The file is empty');
  const byName = new Map<string, ImportColumn>();
  for (const c of columns) { byName.set(norm(c.key), c); byName.set(norm(c.label), c); }
  const header = raw[headerAt]!;
  const index = new Map<string, number>();
  const ignored: string[] = [];
  header.forEach((h, i) => {
    if (h === null || h === undefined || String(h).trim() === '') return;
    const col = byName.get(norm(h));
    if (!col) { ignored.push(String(h).trim()); return; }
    if (index.has(col.key)) throw new AppError('VALIDATION_FAILED', `The column "${col.label}" appears twice (column ${colLetters(index.get(col.key)!)} and ${colLetters(i)})`);
    index.set(col.key, i);
  });
  const missing = columns.filter((c) => c.required && !index.has(c.key));
  if (missing.length) throw new AppError('VALIDATION_FAILED', `Required column${missing.length > 1 ? 's' : ''} missing from the header row: ${missing.map((c) => c.label).join(', ')}. Download the template to see the expected layout.`);
  if (index.size === 0) throw new AppError('VALIDATION_FAILED', 'None of the column headings match this template. Download the template to see the expected layout.');

  const rows: ParsedRow[] = [];
  for (let r = headerAt + 1; r < raw.length; r++) {
    const src = raw[r] ?? [];
    const data: Record<string, CellValue> = {};
    let any = false;
    for (const [key, i] of index) {
      const v = src[i] ?? null;
      if (typeof v === 'string' && v.length > MAX_CELL_CHARS) throw new AppError('VALIDATION_FAILED', `Row ${r + 1}: a cell is longer than ${MAX_CELL_CHARS} characters`);
      const trimmed = typeof v === 'string' ? v.trim() : v;
      data[key] = trimmed === '' ? null : trimmed;
      if (data[key] !== null) any = true;
    }
    if (any) rows.push({ rowNo: r + 1, data });
  }
  if (rows.length === 0) throw new AppError('VALIDATION_FAILED', 'The file has a header row but no data rows');
  if (rows.length > MAX_ROWS) throw new AppError('VALIDATION_FAILED', `At most ${MAX_ROWS} rows can be imported at a time`);
  return { rows, ignoredColumns: ignored };
}

export interface BuiltFile { bytes: Uint8Array; contentType: string; extension: string }
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Data sheet (header = labels) plus, for xlsx, an Instructions sheet describing each column. */
export function buildFile(kind: FileKind, title: string, columns: readonly ImportColumn[], rows: ReadonlyArray<Record<string, unknown>>): BuiltFile {
  const head = columns.map((c) => c.label);
  const body = rows.map((r) => columns.map((c) => (r[c.key] ?? null) as CellValue));
  if (kind === 'csv') return { bytes: strToU8(serializeCsv([head, ...body])), contentType: 'text/csv; charset=utf-8', extension: 'csv' };
  const instructions: CellValue[][] = [
    ['Column', 'Required', 'What to enter', 'Example'],
    ...columns.map((c) => [c.label, c.required ? 'Yes' : 'No', c.hint ?? '', c.example ?? '']),
    [],
    [`${title}: fill in the "Data" sheet, one row per record, and import it from the CMMS. Do not rename or reorder the header row. Nothing is saved until you review the preview and confirm.`],
  ];
  return {
    bytes: writeXlsx([
      { name: 'Data', rows: [head, ...body], widths: columns.map((c) => Math.max(14, Math.min(40, c.label.length + 6))) },
      { name: 'Instructions', rows: instructions, widths: [28, 10, 70, 26] },
    ]),
    contentType: XLSX_TYPE, extension: 'xlsx',
  };
}
