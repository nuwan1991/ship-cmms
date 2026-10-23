/**
 * Minimal .xlsx reader and writer (OOXML in a zip), using fflate for the zip layer only.
 * Writer: plain text/number cells, a bold frozen header row, column widths. Reader: values only (shared strings, inline strings,
 * numbers, booleans; formulas yield their cached value). Reading is defensive: entries and totals are size-capped.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { AppError } from '../../platform/errors.js';

export type CellValue = string | number | boolean | null;
export interface SheetOut { name: string; rows: ReadonlyArray<ReadonlyArray<CellValue | undefined>>; widths?: readonly number[] }
export interface SheetIn { name: string; rows: CellValue[][] }

export const MAX_ENTRY_BYTES = 30 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_COLS = 200;

const esc = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function colLetters(index: number): string {
  let n = index + 1, s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const sheetName = (n: string, i: number): string => n.replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;

export function writeXlsx(sheets: readonly SheetOut[]): Uint8Array {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet');
  const files: Record<string, Uint8Array> = {};
  const put = (path: string, xml: string) => { files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`); };
  put('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  put('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  put('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(sheetName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  put('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  put('xl/styles.xml', '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
  sheets.forEach((s, si) => {
    const rows = s.rows.map((r, ri) => {
      const cells = r.map((v, ci) => {
        if (v === null || v === undefined || v === '') return '';
        const ref = `${colLetters(ci)}${ri + 1}`;
        const style = ri === 0 ? ' s="1"' : '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="b"${style}><v>${v ? 1 : 0}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    put(`xl/worksheets/sheet${si + 1}.xml`, `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`);
  });
  return zipSync(files, { level: 6 });
}

// ------------------------------------------------------------------ reader

function* elements(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const open = `<${tag}`;
  let i = 0;
  for (;;) {
    const s = xml.indexOf(open, i);
    if (s < 0) return;
    const c = xml.charCodeAt(s + open.length);
    if (!(c === 32 || c === 62 || c === 47 || c === 9 || c === 10 || c === 13)) { i = s + open.length; continue; }
    const gt = xml.indexOf('>', s);
    if (gt < 0) return;
    const self = xml.charCodeAt(gt - 1) === 47;
    const attrs = xml.slice(s + open.length, self ? gt - 1 : gt);
    if (self) { yield { attrs, inner: '' }; i = gt + 1; continue; }
    const close = xml.indexOf(`</${tag}>`, gt);
    if (close < 0) return;
    yield { attrs, inner: xml.slice(gt + 1, close) };
    i = close + tag.length + 3;
  }
}
const attr = (attrs: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];

function unesc(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}
const textOf = (inner: string): string => {
  const noPhonetic = inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const t of elements(noPhonetic, 't')) out += unesc(t.inner);
  return out;
};

export function readXlsx(data: Uint8Array): SheetIn[] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!(f.name === 'xl/workbook.xml' || f.name === 'xl/_rels/workbook.xml.rels' || f.name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(f.name))) return false;
        if (f.originalSize > MAX_ENTRY_BYTES) throw new AppError('VALIDATION_FAILED', 'The workbook contains a sheet that is too large to import');
        total += f.originalSize;
        if (total > MAX_TOTAL_BYTES) throw new AppError('VALIDATION_FAILED', 'The workbook is too large to import');
        return true;
      },
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('VALIDATION_FAILED', 'This is not a valid .xlsx workbook (it may be corrupt or password protected)');
  }
  const wb = files['xl/workbook.xml'];
  if (!wb) throw new AppError('VALIDATION_FAILED', 'This is not a valid .xlsx workbook');
  const rels = new Map<string, string>();
  for (const r of elements(strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array()), 'Relationship')) {
    const id = attr(r.attrs, 'Id'), target = attr(r.attrs, 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`);
  }
  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) for (const si of elements(strFromU8(ss), 'si')) shared.push(textOf(si.inner));

  const sheets: SheetIn[] = [];
  for (const s of elements(strFromU8(wb), 'sheet')) {
    const name = unesc(attr(s.attrs, 'name') ?? '');
    const rid = attr(s.attrs, 'r:id');
    const file = rid ? files[rels.get(rid) ?? ''] : undefined;
    if (!file) continue;
    const rows: CellValue[][] = [];
    let seq = 0;
    for (const row of elements(strFromU8(file), 'row')) {
      const rn = Number(attr(row.attrs, 'r')) || seq + 1;
      seq = rn;
      if (rn > MAX_ROWS) throw new AppError('VALIDATION_FAILED', `The sheet has more than ${MAX_ROWS} rows`);
      const out: CellValue[] = [];
      for (const c of elements(row.inner, 'c')) {
        const ref = attr(c.attrs, 'r') ?? '';
        const col = colIndex(/^[A-Z]+/.exec(ref)?.[0] ?? '');
        if (col < 0 || col >= MAX_COLS) { if (col >= MAX_COLS) throw new AppError('VALIDATION_FAILED', `The sheet has more than ${MAX_COLS} columns`); continue; }
        const t = attr(c.attrs, 't');
        const v = [...elements(c.inner, 'v')][0]?.inner;
        let val: CellValue = null;
        if (t === 'inlineStr') val = textOf([...elements(c.inner, 'is')][0]?.inner ?? '');
        else if (v === undefined) val = null;
        else if (t === 's') val = shared[Number(v)] ?? null;
        else if (t === 'str') val = unesc(v);
        else if (t === 'b') val = v.trim() === '1';
        else if (t === 'e') val = unesc(v);
        else { const n = Number(v); val = Number.isFinite(n) ? n : unesc(v); }
        while (out.length < col) out.push(null);
        out[col] = val;
      }
      while (rows.length < rn - 1) rows.push([]);
      rows[rn - 1] = out;
    }
    sheets.push({ name, rows });
  }
  if (sheets.length === 0) throw new AppError('VALIDATION_FAILED', 'The workbook has no readable sheets');
  return sheets;
}
