import { describe, expect, it } from 'vitest';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import { XLS_PERMISSIONS } from '../../src/modules/m11-excel/index.js';
import { parseCsv, serializeCsv } from '../../src/modules/m11-excel/csv.js';
import { commitImport, errorReport, exportFile, jobRows, listTemplates, previewImport } from '../../src/modules/m11-excel/service.js';
import { readXlsx, writeXlsx } from '../../src/modules/m11-excel/xlsx.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { csvBase64, makeXlsEnv, xlsxBase64, type XlsEnv } from './xls-helpers.js';

const PART_HEAD = ['Part number', 'Name', 'Unit', 'Category'];
const preview = (env: XlsEnv, templateCode: string, contentBase64: string, fileName = 'file.xlsx', a = env.hubActor()) => previewImport(a, env.ctx.importExport, { templateCode, fileName, contentBase64 });
const commit = (env: XlsEnv, id: string, skipErrors = false, a = env.hubActor()) => commitImport(a, env.ctx.importExport, id, { skipErrors });
const parts = (env: XlsEnv) => sql(env, 'SELECT part_no, name, unit, category FROM stk_part WHERE deleted_at IS NULL ORDER BY part_no');

describe('xlsx reader/writer', () => {
  it('round-trips text, numbers, booleans, blanks, unicode and special characters', () => {
    const rows = [['Name', 'Qty', 'OK'], ['Bearing <6312> & "seal"', 12.5, true], ['00123', 0, false], ['ශ්‍රී ලංකා නාවික', null, 'line1\nline2'], ['  padded  ', -4, '=SUM(A1)']];
    const back = readXlsx(writeXlsx([{ name: 'Data', rows }, { name: 'Other', rows: [['x']] }]));
    expect(back.map((s) => s.name)).toEqual(['Data', 'Other']);
    expect(back[0]!.rows).toEqual([['Name', 'Qty', 'OK'], ['Bearing <6312> & "seal"', 12.5, true], ['00123', 0, false], ['ශ්‍රී ලංකා නාවික', null, 'line1\nline2'], ['  padded  ', -4, '=SUM(A1)']]);
  });
  it('rejects files that are not workbooks', () => {
    expect(codeOf(() => readXlsx(new Uint8Array([1, 2, 3, 4, 5])))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])))).toBe('VALIDATION_FAILED');
  });
  it('reads shared strings, inline strings, formulas with cached values, and sparse rows written by other tools', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const x = (s: string) => strToU8(`<?xml version="1.0"?>${s}`);
    const wb = zipSync({
      'xl/workbook.xml': x('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': x('<Relationships><Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': x('<sst><si><t>Name</t></si><si><r><t>Rich </t></r><r><t>text</t></r><rPh><t>ignored</t></rPh></si></sst>'),
      'xl/worksheets/sheet1.xml': x('<worksheet><cols><col min="1" max="1"/></cols><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>inline</t></is></c></row><row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><f>1+2</f><v>3</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>'),
    });
    expect(readXlsx(wb)[0]!.rows).toEqual([['Name', null, 'inline'], [], ['Rich text', 3, null, true]]);
  });
});

describe('csv', () => {
  it('parses quotes, embedded newlines, BOM and semicolon separators', () => {
    expect(parseCsv('﻿A;B\r\n"x;1";"he said ""hi"""\r\n"two\nlines";3')).toEqual([['A', 'B'], ['x;1', 'he said "hi"'], ['two\nlines', '3']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(codeOf(() => parseCsv('a,"b'))).toBe('VALIDATION_FAILED');
  });
  it('neutralises spreadsheet formulas on the way out and round-trips ordinary text', () => {
    const out = serializeCsv([['=cmd()', '+1+2', '-5', '@x', 'plain, text', 'q"uote']]);
    expect(out).toBe('﻿\'=cmd(),\'+1+2,-5,\'@x,"plain, text","q""uote"\r\n');
    expect(parseCsv(out)[0]![4]).toBe('plain, text');
  });
});

describe('registration', () => {
  it('registers cleanly, offers the R1 templates, and has well-formed permission codes', () => {
    const env = makeXlsEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('xls.export_log').recordClass).toBe('event');
    for (const p of XLS_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(listTemplates(env.hubActor(), env.ctx.importExport).map((t) => t.code)).toEqual(['assets', 'classification-map', 'classifications', 'locations', 'parts']);
  });
});

describe('parts import', () => {
  it('previews without saving, then commits; headers may be labels or keys, any case', () => {
    const env = makeXlsEnv();
    const job = preview(env, 'parts', xlsxBase64(['PART NUMBER', 'name', 'Unit', 'Category'], [['brg-1', 'Bearing', 'each', 'Bearings'], ['grs-1', 'Grease', 'kg', null]]));
    expect(job).toMatchObject({ status: 'previewed', total_rows: 2, ok_rows: 2, error_rows: 0, create_rows: 2 });
    expect(parts(env)).toEqual([]);
    const done = commit(env, job.id as string);
    expect(done).toMatchObject({ status: 'committed', create_rows: 2 });
    expect(parts(env)).toEqual([{ part_no: 'BRG-1', name: 'Bearing', unit: 'each', category: 'Bearings' }, { part_no: 'GRS-1', name: 'Grease', unit: 'kg', category: null }]);
    expect(codeOf(() => commit(env, job.id as string))).toBe('WORKFLOW_BLOCKED');
  });

  it('updates changed rows, skips unchanged rows, and leaves blank cells alone', () => {
    const env = makeXlsEnv();
    commit(env, preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', 'each', 'A'], ['P2', 'Two', 'each', 'B']])).id as string);
    const job = preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One renamed', null, null], ['P2', 'Two', 'each', 'B']]));
    expect(job).toMatchObject({ update_rows: 1, skip_rows: 1, create_rows: 0 });
    commit(env, job.id as string);
    expect(parts(env)).toEqual([{ part_no: 'P1', name: 'One renamed', unit: 'each', category: 'A' }, { part_no: 'P2', name: 'Two', unit: 'each', category: 'B' }]);
  });

  it('reports row errors with spreadsheet row numbers, and later rows see earlier ones', () => {
    const env = makeXlsEnv();
    const job = preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', 'each', null], ['P2', null, null, null], ['bad part!', 'Bad', null, null], ['P1', 'One again', null, null]]));
    expect(job).toMatchObject({ ok_rows: 2, error_rows: 2, create_rows: 1, update_rows: 1 });
    const rows = jobRows(env.hubActor(), job.id as string, { limit: 50 }).items;
    expect(rows.map((r) => [r.rowNo, r.status])).toEqual([[2, 'ok'], [3, 'error'], [4, 'error'], [5, 'ok']]);
    expect(rows[1]!.errors).toEqual(['Name is required']);
    expect(String((rows[2]!.errors as string[])[0])).toMatch(/Part number|partNo/);
  });

  it('saves nothing when any row has an error, unless the user chooses to leave those rows out', () => {
    const env = makeXlsEnv();
    const job = preview(env, 'parts', xlsxBase64(PART_HEAD, [['OKAY', 'Fine', null, null], ['BAD', null, null, null]]));
    expect(codeOf(() => commit(env, job.id as string))).toBe('WORKFLOW_BLOCKED');
    expect(parts(env)).toEqual([]);
    expect(sql(env, 'SELECT status FROM xls_import_job WHERE id = ?', job.id)[0]?.status).toBe('failed');
    const done = commit(env, job.id as string, true);
    expect(done).toMatchObject({ status: 'committed', create_rows: 1, error_rows: 1 });
    expect(String(done.message)).toMatch(/left out/);
    expect(parts(env)).toHaveLength(1);
  });

  it('rejects files with the wrong layout before creating a job', () => {
    const env = makeXlsEnv();
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(['Name', 'Unit'], [['x', 'y']])))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(['Foo', 'Bar'], [['x', 'y']])))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(PART_HEAD, [])))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(['Part number', 'Part number', 'Name'], [['a', 'b', 'c']])))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', Buffer.from('MZ\u0000\u0000binary').toString('base64'), 'x.csv'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', Buffer.from('not a zip').toString('base64'), 'x.xlsx'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(PART_HEAD, [['a', 'b', null, null]]), 'old.xls'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => preview(env, 'nonsense', xlsxBase64(PART_HEAD, [['a', 'b', null, null]])))).toBe('NOT_FOUND');
    expect(sql(env, 'SELECT COUNT(*) AS n FROM xls_import_job')[0]?.n).toBe(0);
  });

  it('ignores unknown columns but reports them, and accepts CSV (including Excel\'s semicolon CSV)', () => {
    const env = makeXlsEnv();
    const job = preview(env, 'parts', csvBase64('﻿Part number;Name;Colour\r\nC1;Cable;red\r\nC2;"Wire; thin";blue'), 'parts.csv');
    expect(job).toMatchObject({ file_kind: 'csv', ok_rows: 2, ignored_columns: 'Colour' });
    commit(env, job.id as string);
    expect(parts(env).map((p) => p.name)).toEqual(['Cable', 'Wire; thin']);
  });

  it('warns when the same file was already imported', () => {
    const env = makeXlsEnv();
    const file = xlsxBase64(PART_HEAD, [['P1', 'One', null, null]]);
    commit(env, preview(env, 'parts', file).id as string);
    expect(String(preview(env, 'parts', file).message)).toMatch(/already imported/);
  });

  it('applies the owning module\'s permissions to every row', () => {
    const env = makeXlsEnv();
    // the owning module's service checks its own permission through the installation's authorizer (what a row may do is not M11's decision)
    env.ctx.authz.register(denyOnly('stk.part.create'));
    const job = preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', null, null]]));
    expect(job.error_rows).toBe(1);
    expect(jobRows(env.hubActor(), job.id as string, { limit: 5 }).items[0]!.errors).toEqual(['no stk.part.create']);
    expect(codeOf(() => preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', null, null]]), 'f.xlsx', env.hubActor(denyOnly('xls.import.preview'))))).toBe('FORBIDDEN');
    expect(codeOf(() => commit(env, job.id as string, false, env.hubActor(denyOnly('xls.import.commit'))))).toBe('FORBIDDEN');
    expect(parts(env)).toEqual([]);
  });

  it('produces an error report that carries the original values for fixing and re-uploading', () => {
    const env = makeXlsEnv();
    const job = preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', null, null], ['P2', null, null, null]]));
    const rep = errorReport(env.hubActor(), env.ctx.importExport, job.id as string);
    const rows = (Buffer.from(rep.bytes).toString('utf8').replace(/^﻿/, '').split(/\r\n/).filter(Boolean));
    expect(rows[0]).toBe('Row,Result,Problems,Part number,Name,Unit,Category,Manufacturer,Manufacturer part number,Description,Status');
    expect(rows[1]).toMatch(/^2,create,,P1,One/);
    expect(rows[2]).toMatch(/^3,error,Name is required,P2/);
  });
});

describe('locations import', () => {
  it('creates a hierarchy where a parent appears earlier in the same file, and rejects unknown sites and parents', () => {
    const env = makeXlsEnv();
    const head = ['Ship or workshop code', 'Parent location code', 'Location code', 'Name', 'Kind'];
    const job = preview(env, 'locations', xlsxBase64(head, [
      ['SH1', null, 'MAIN-DECK', 'Main deck', 'deck'], ['sh1', 'main-deck', 'ER-01', 'Engine room', 'compartment'],
      ['NOPE', null, 'X', 'X', null], ['SH1', 'GHOST', 'Y', 'Y', null], ['SH1', null, 'Z', 'Z', 'cellar'],
    ]));
    expect(job).toMatchObject({ ok_rows: 2, error_rows: 3, create_rows: 2 });
    commit(env, job.id as string, true);
    const rows = sql(env, 'SELECT code, name, parent_id FROM org_location WHERE deleted_at IS NULL ORDER BY code');
    expect(rows.map((r) => r.code)).toEqual(['ER-01', 'MAIN-DECK']);
    expect(rows.find((r) => r.code === 'ER-01')!.parent_id).toBe(sql(env, "SELECT id FROM org_location WHERE code = 'MAIN-DECK'")[0]!.id);
  });
});

describe('assets import', () => {
  it('registers new equipment (tags allocated), updates by tag, and refuses unknown tags, duplicates and ship changes', () => {
    const env = makeXlsEnv();
    const head = ['Equipment tag', 'Name', 'Serial number', 'Manufacturer', 'Ship code'];
    const job = preview(env, 'assets', xlsxBase64(head, [['', 'Pump A', 'S-1', 'Acme', 'SH1'], [null, 'Pump B', 'S-2', 'Acme', 'SH1'], [null, 'Pump A again', 'S-1', 'Acme', 'SH1'], ['SLN-EQ-00009999', 'Ghost', null, null, null]]));
    expect(job).toMatchObject({ ok_rows: 2, error_rows: 2, create_rows: 2 });
    const rows = jobRows(env.hubActor(), job.id as string, { limit: 10 }).items;
    expect(rows[0]).toMatchObject({ reference: 'SLN-EQ-00000001', action: 'create' });
    expect(rows[2]).toMatchObject({ status: 'error', duplicateOf: 'SLN-EQ-00000001' });
    expect(String((rows[3]!.errors as string[])[0])).toMatch(/No equipment has the tag/);
    commit(env, job.id as string, true);

    const upd = preview(env, 'assets', xlsxBase64(['Equipment tag', 'Name', 'Model', 'Ship code'], [['sln-eq-00000001', 'Pump A (renamed)', 'X9', null], ['SLN-EQ-00000002', null, null, 'SH2']]));
    expect(upd).toMatchObject({ update_rows: 1, error_rows: 1 });
    commit(env, upd.id as string, true);
    expect(sql(env, "SELECT name, model FROM ast_asset WHERE asset_tag = 'SLN-EQ-00000001'")[0]).toEqual({ name: 'Pump A (renamed)', model: 'X9' });
  });

  it('stops cleanly when the tag range is exhausted, rolling the whole commit back', () => {
    const env = makeXlsEnv();
    env.ctx.db.prepare('DELETE FROM sys_number_cursor').run();
    env.ctx.db.prepare("UPDATE sys_number_range SET range_end = range_start + 1 WHERE sequence_code = 'equipment_tag'").run();
    const job = preview(env, 'assets', xlsxBase64(['Name'], [['A'], ['B'], ['C']]));
    expect(job).toMatchObject({ ok_rows: 2, error_rows: 1 });
    expect(codeOf(() => commit(env, job.id as string))).toBe('WORKFLOW_BLOCKED');
    expect(sql(env, 'SELECT COUNT(*) AS n FROM ast_asset')[0]?.n).toBe(0);
  });
});

describe('export and templates', () => {
  it('exports in the import layout so an unchanged export re-imports as all skips, and logs the export', () => {
    const env = makeXlsEnv();
    commit(env, preview(env, 'parts', xlsxBase64(PART_HEAD, [['P1', 'One', 'each', 'A'], ['P2', 'Two', 'kg', null]])).id as string);
    createAsset(env.hubActor(), { name: 'Pump', homeShipId: env.shipId, serialNumber: 'Z1', manufacturer: 'M' });
    createOrg(env.hubActor(), 'location', { siteKind: 'ship', siteId: env.shipId, code: 'ER', name: 'Engine room' });
    for (const [code, n] of [['parts', 2], ['assets', 1], ['locations', 1]] as const) {
      for (const format of ['xlsx', 'csv'] as const) {
        const f = exportFile(env.hubActor(), env.ctx.importExport, code, { kind: 'data', format });
        expect(f.rowCount).toBe(n);
        const job = preview(env, code, Buffer.from(f.bytes).toString('base64'), f.fileName);
        expect(job, `${code}.${format}`).toMatchObject({ ok_rows: n, error_rows: 0, skip_rows: n });
      }
    }
    expect(sql(env, "SELECT COUNT(*) AS n FROM xls_export_log WHERE template_code = 'parts'")[0]?.n).toBe(2);
  });

  it('builds a blank template with a Data sheet and an Instructions sheet; template and export need their own permissions', () => {
    const env = makeXlsEnv();
    const f = exportFile(env.hubActor(), env.ctx.importExport, 'parts', { kind: 'blank' });
    const sheets = readXlsx(f.bytes);
    expect(sheets.map((s) => s.name)).toEqual(['Data', 'Instructions']);
    expect(sheets[0]!.rows).toEqual([['Part number', 'Name', 'Unit', 'Category', 'Manufacturer', 'Manufacturer part number', 'Description', 'Status']]);
    expect(sheets[1]!.rows[1]).toEqual(['Part number', 'Yes', 'Existing part numbers are updated; new ones are created.', 'BRG-6312']);
    expect(f.fileName).toBe('parts-template.xlsx');
    expect(codeOf(() => exportFile(env.hubActor(denyOnly('xls.export.run')), env.ctx.importExport, 'parts', { kind: 'data' }))).toBe('FORBIDDEN');
    expect(codeOf(() => exportFile(env.hubActor(denyOnly('xls.template.view')), env.ctx.importExport, 'parts', { kind: 'blank' }))).toBe('FORBIDDEN');
    env.ctx.authz.register(denyOnly('stk.part.view'));
    expect(codeOf(() => exportFile(env.hubActor(), env.ctx.importExport, 'parts', { kind: 'data' }))).toBe('FORBIDDEN');
  });
});
