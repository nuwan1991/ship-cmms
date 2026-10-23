/**
 * M11 services: template/export files, and import jobs. An import is two steps (CONTRACTS: nothing is saved by an upload):
 *  1. preview  - the whole file is applied inside ONE transaction that is rolled back, so every row is judged by the owning module's real
 *                command service (permissions, workflow, duplicates), and later rows see earlier rows;
 *  2. commit   - the stored rows are applied again in one transaction. By default any error aborts everything; with skipErrors the rows
 *                that fail are left out and the rest are saved. Jobs are local; only the export log is shared.
 */
import { createHash } from 'node:crypto';
import type { Principal, ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { uuidv7 } from '../../platform/ids.js';
import type { ImportExportPort, ImportExportRegistry, ImportRowResult } from '../../platform/ports.js';
import { appendEvent } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { authorize, type Actor } from './actor.js';
import { perm } from './permissions.js';
import * as S from './schemas.js';
import { buildFile, mapRows, rawTable, sniffKind, type BuiltFile, type FileKind, type ParsedRow } from './tabular.js';

export type Row = Record<string, unknown>;
const fleet: ScopeRef = { kind: 'fleet' };
const SUMMARY_FIELDS = 8;

function portFor(ports: ImportExportRegistry, code: string): ImportExportPort {
  const p = ports.get(code);
  if (!p) throw new AppError('NOT_FOUND', `There is no import/export template called ${code}`);
  return p;
}

export function listTemplates(a: Actor, ports: ImportExportRegistry): Row[] {
  authorize(a, perm('template', 'view'), fleet);
  return ports.all().map((p) => ({ code: p.templateCode, title: p.title, module: p.module, entityType: p.entityType, importPermission: p.importPermission, exportPermission: p.exportPermission, columns: p.columns }));
}

export interface NamedFile extends BuiltFile { fileName: string; rowCount: number }

/** A blank template, or the current data in the same layout (so it can be edited and imported back). */
export function exportFile(a: Actor, ports: ImportExportRegistry, code: string, input: unknown): NamedFile {
  const q = S.parse(S.FileQuery, input);
  const port = portFor(ports, code);
  const stamp = nowUtc().slice(0, 10);
  if (q.kind === 'blank') {
    authorize(a, perm('template', 'view'), fleet);
    return { ...buildFile(q.format, port.title, port.columns, []), fileName: `${code}-template.${q.format}`, rowCount: 0 };
  }
  authorize(a, perm('export', 'run'), q.shipId ? { kind: 'ship', id: q.shipId } : fleet);
  const scope: ScopeRef = q.shipId ? { kind: 'ship', id: q.shipId } : fleet;
  const rows = port.exportRows(scope, a.principal);
  const file = buildFile(q.format, port.title, port.columns, rows);
  appendEvent(a.wctx, 'xls.export_log', { home_scope_id: q.shipId ?? null, template_code: code, format: q.format, row_count: rows.length, scope_kind: scope.kind, scope_id: q.shipId ?? null });
  return { ...file, fileName: `${code}-${stamp}.${q.format}`, rowCount: rows.length };
}

// ------------------------------------------------------------------ running rows

interface RowOut extends ImportRowResult { rowNo: number }
class Rollback extends Error {}

function runRow(port: ImportExportPort, principal: Principal, row: ParsedRow, commit: boolean): RowOut {
  for (const c of port.columns) {
    if (c.required && (row.data[c.key] === null || row.data[c.key] === undefined)) return { rowNo: row.rowNo, ok: false, errors: [`${c.label} is required`] };
  }
  try {
    const r = port.importRow(row.data, principal, { commit });
    return { ...r, rowNo: row.rowNo, ok: r.ok, ...(r.ok ? {} : { errors: r.errors?.length ? r.errors : ['The row was rejected'] }) };
  } catch (e) {
    if (e instanceof AppError) return { rowNo: row.rowNo, ok: false, errors: [e.message] };
    console.error(`[xls] unexpected error in ${port.templateCode} row ${row.rowNo}:`, e);
    return { rowNo: row.rowNo, ok: false, errors: ['Unexpected error while processing this row (details are in the server log)'] };
  }
}

/** Apply rows in one transaction. Preview always rolls back; commit rolls back when an error is present and skipErrors is off. */
function execute(db: Db, port: ImportExportPort, principal: Principal, rows: ParsedRow[], mode: 'preview' | 'commit', skipErrors: boolean, onSuccess?: (results: RowOut[]) => void): { results: RowOut[]; committed: boolean } {
  let results: RowOut[] = [];
  try {
    db.transaction(() => {
      results = rows.map((r) => runRow(port, principal, r, mode === 'commit'));
      if (mode === 'preview' || (!skipErrors && results.some((r) => !r.ok))) throw new Rollback();
      onSuccess?.(results);
    })();
    return { results, committed: true };
  } catch (e) {
    if (e instanceof Rollback) return { results, committed: false };
    throw e;
  }
}

const tally = (results: readonly RowOut[]) => ({
  total: results.length, ok: results.filter((r) => r.ok).length, errors: results.filter((r) => !r.ok).length,
  creates: results.filter((r) => r.ok && r.action === 'create').length, updates: results.filter((r) => r.ok && r.action === 'update').length, skips: results.filter((r) => r.ok && r.action === 'skip').length,
});
const saveRows = (db: Db, jobId: string, rows: readonly ParsedRow[], results: readonly RowOut[]): void => {
  db.prepare('DELETE FROM xls_import_row WHERE job_id = ?').run(jobId);
  const ins = db.prepare('INSERT INTO xls_import_row (job_id, row_no, data_json, status, action, errors_json, duplicate_of, reference) VALUES (?,?,?,?,?,?,?,?)');
  rows.forEach((row, i) => {
    const r = results[i]!;
    ins.run(jobId, row.rowNo, JSON.stringify(row.data), r.ok ? 'ok' : 'error', r.action ?? null, r.errors?.length ? JSON.stringify(r.errors) : null, r.duplicateOf ?? null, r.reference ?? null);
  });
};

// ------------------------------------------------------------------ jobs

export function previewImport(a: Actor, ports: ImportExportRegistry, input: unknown): Row {
  const b = S.parse(S.PreviewInput, input);
  authorize(a, perm('import', 'preview'), fleet);
  const port = portFor(ports, b.templateCode);
  const bytes = Uint8Array.from(Buffer.from(b.contentBase64, 'base64'));
  if (bytes.length === 0) throw new AppError('VALIDATION_FAILED', 'The file is empty');
  if (bytes.length > S.MAX_FILE_BYTES) throw new AppError('VALIDATION_FAILED', `The file is larger than ${S.MAX_FILE_BYTES / 1024 / 1024} MB`);
  const kind: FileKind = sniffKind(bytes);
  if (kind === 'csv' && /\.xlsx?$/i.test(b.fileName)) throw new AppError('VALIDATION_FAILED', 'This file is named .xlsx but is not a valid workbook. Open it in Excel and save it again as .xlsx.');
  if (/\.xls$/i.test(b.fileName)) throw new AppError('VALIDATION_FAILED', 'Old .xls files are not supported. Save the file as .xlsx or CSV.');
  const table = mapRows(rawTable(bytes, kind), port.columns);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const db = a.wctx.db;
  const previous = db.prepare("SELECT committed_at FROM xls_import_job WHERE template_code = ? AND file_sha256 = ? AND status = 'committed' ORDER BY committed_at DESC LIMIT 1").get(b.templateCode, sha) as { committed_at: string } | undefined;

  const { results } = execute(db, port, a.principal, table.rows, 'preview', true);
  const t = tally(results);
  const id = uuidv7();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO xls_import_job (id, template_code, file_name, file_kind, file_sha256, status, total_rows, ok_rows, error_rows, create_rows, update_rows, skip_rows, ignored_columns, message, created_at, created_by, created_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(id, b.templateCode, b.fileName, kind, sha, 'previewed', t.total, t.ok, t.errors, t.creates, t.updates, t.skips, table.ignoredColumns.length ? table.ignoredColumns.join(', ') : null,
      previous ? `This exact file was already imported on ${previous.committed_at}.` : null, nowUtc(), a.principal.userId, a.principal.displayName ?? null);
    saveRows(db, id, table.rows, results);
  })();
  return getJob(a, id);
}

const jobRow = (db: Db, id: string): Row => {
  const j = db.prepare('SELECT * FROM xls_import_job WHERE id = ?').get(id) as Row | undefined;
  if (!j) throw new AppError('NOT_FOUND', `Import ${id} not found`);
  return j;
};
export function getJob(a: Actor, id: string): Row {
  authorize(a, perm('import', 'view'), fleet);
  return jobRow(a.wctx.db, id);
}

export function commitImport(a: Actor, ports: ImportExportRegistry, id: string, input: unknown): Row {
  const { skipErrors } = S.parse(S.CommitInput, input ?? {});
  authorize(a, perm('import', 'commit'), fleet);
  const db = a.wctx.db;
  const job = jobRow(db, id);
  if (job.status === 'committed') throw new AppError('WORKFLOW_BLOCKED', 'This import has already been saved');
  const port = portFor(ports, job.template_code as string);
  const stored = db.prepare('SELECT row_no, data_json FROM xls_import_row WHERE job_id = ? ORDER BY row_no').all(id) as Array<{ row_no: number; data_json: string }>;
  const rows: ParsedRow[] = stored.map((r) => ({ rowNo: r.row_no, data: JSON.parse(r.data_json) as ParsedRow['data'] }));

  const finish = (results: RowOut[], status: 'committed' | 'failed', message: string | null) => {
    const t = tally(results);
    saveRows(db, id, rows, results);
    db.prepare('UPDATE xls_import_job SET status = ?, ok_rows = ?, error_rows = ?, create_rows = ?, update_rows = ?, skip_rows = ?, message = ?, committed_at = ?, committed_by = ? WHERE id = ?')
      .run(status, t.ok, t.errors, t.creates, t.updates, t.skips, message, status === 'committed' ? nowUtc() : null, status === 'committed' ? a.principal.userId : null, id);
  };
  const { results, committed } = execute(db, port, a.principal, rows, 'commit', skipErrors, (res) => {
    const skipped = res.filter((r) => !r.ok).length;
    finish(res, 'committed', skipped ? `${skipped} row${skipped === 1 ? '' : 's'} with errors were left out.` : null);
  });
  if (!committed) {
    const n = results.filter((r) => !r.ok).length;
    finish(results, 'failed', `Nothing was saved: ${n} row${n === 1 ? ' has' : 's have'} errors. Fix the file and upload it again, or save the valid rows only.`);
    throw new AppError('WORKFLOW_BLOCKED', `Nothing was saved: ${n} row${n === 1 ? ' has' : 's have'} errors`, { jobId: id, errorRows: n });
  }
  return jobRow(db, id);
}

export function listJobs(a: Actor): Row[] {
  authorize(a, perm('import', 'view'), fleet);
  return a.wctx.db.prepare('SELECT * FROM xls_import_job ORDER BY created_at DESC, id DESC LIMIT 100').all() as Row[];
}

const parseJson = <T>(s: unknown, d: T): T => { try { return typeof s === 'string' ? (JSON.parse(s) as T) : d; } catch { return d; } };
export function jobRows(a: Actor, id: string, q: { status?: string; after?: number; limit: number }): { items: Row[]; next: number | null } {
  authorize(a, perm('import', 'view'), fleet);
  const db = a.wctx.db;
  jobRow(db, id);
  const where = ['job_id = ?', 'row_no > ?'];
  const params: unknown[] = [id, q.after ?? 0];
  if (q.status) { where.push('status = ?'); params.push(q.status); }
  const rows = db.prepare(`SELECT * FROM xls_import_row WHERE ${where.join(' AND ')} ORDER BY row_no LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((r) => {
      const data = parseJson<Record<string, unknown>>(r.data_json, {});
      return {
        rowNo: r.row_no, status: r.status, action: r.action, errors: parseJson<string[]>(r.errors_json, []), duplicateOf: r.duplicate_of, reference: r.reference,
        summary: Object.entries(data).filter(([, v]) => v !== null).slice(0, SUMMARY_FIELDS).map(([k, v]) => ({ key: k, value: String(v) })),
      };
    }),
    next: rows.length > q.limit ? (page[page.length - 1]!.row_no as number) : null,
  };
}

/** The uploaded rows with the outcome of each, as CSV, so errors can be fixed in the original sheet and uploaded again. */
export function errorReport(a: Actor, ports: ImportExportRegistry, id: string): NamedFile {
  authorize(a, perm('import', 'view'), fleet);
  const db = a.wctx.db;
  const job = jobRow(db, id);
  const port = portFor(ports, job.template_code as string);
  const stored = db.prepare('SELECT * FROM xls_import_row WHERE job_id = ? ORDER BY row_no').all(id) as Row[];
  const cols = [{ key: 'rowNo', label: 'Row' }, { key: 'result', label: 'Result' }, { key: 'problems', label: 'Problems' }, ...port.columns];
  const rows = stored.map((r) => ({
    rowNo: r.row_no, result: r.status === 'ok' ? String(r.action ?? 'ok') : 'error', problems: parseJson<string[]>(r.errors_json, []).join(' | '), ...parseJson<Record<string, unknown>>(r.data_json, {}),
  }));
  const f = buildFile('csv', port.title, cols, rows);
  return { ...f, fileName: `${String(job.template_code)}-import-report.csv`, rowCount: rows.length };
}
