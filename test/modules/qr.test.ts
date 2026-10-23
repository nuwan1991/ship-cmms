import { describe, expect, it } from 'vitest';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { createEntity as createOrgEntity } from '../../src/modules/m01-organization/service.js';
import { labelForAsset, QR_PERMISSIONS, resolveLabel } from '../../src/modules/m04-labels-survey/index.js';
import {
  addSurveyItem, assignLabel, closeSurvey, convertSurveyItem, createTemplate, issueLabels, printLabels, removeSurveyItem,
  startSurvey, tombstoneSurvey, tombstoneTemplate, updateSurveyItem, updateTemplate, voidLabel,
} from '../../src/modules/m04-labels-survey/service.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { denyOnly } from './org-helpers.js';
import { codeOf, sql } from './ast-helpers.js';
import { makeQrEnv, type QrEnv } from './qr-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;

function room(env: QrEnv, code = 'GEN', shipId = env.shipId) {
  return id(createOrgEntity(env.hubActor(), 'location', { siteKind: 'ship', siteId: shipId, code, name: `Room ${code}`, kind: 'compartment' }));
}
const asset = (env: QrEnv, over: Record<string, unknown> = {}) => createAsset(env.hubActor(), { name: 'Pump', homeShipId: env.shipId, ...over }).asset;

describe('registration', () => {
  it('registers cleanly, with well-formed permission codes', () => {
    const env = makeQrEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('qr.label_print').recordClass).toBe('event');
    expect(env.ctx.entities.get('qr.survey_template').recordClass).toBe('hub_reference');
    for (const p of QR_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
  });
});

describe('labels', () => {
  it('issues reserved labels from the installation range, in order', () => {
    const env = makeQrEnv();
    const out = issueLabels(env.hubActor(), { count: 3 });
    expect(out.map((l) => l.labelNo)).toEqual(['SLN-LB-00000001', 'SLN-LB-00000002', 'SLN-LB-00000003']);
    expect(out.every((l) => l.state === 'reserved' && !l.assetId)).toBe(true);
  });

  it('is all-or-nothing when the range runs out (offline safety)', () => {
    const env = makeQrEnv({ hubLabels: 2 });
    expect(codeOf(() => issueLabels(env.hubActor(), { count: 3 }))).toBe('RANGE_EXHAUSTED');
    expect(sql(env, 'SELECT COUNT(*) n FROM qr_label')[0]!.n).toBe(0);
    expect(issueLabels(env.hubActor(), { count: 2 })).toHaveLength(2);
  });

  it('assigns by asset tag; the label carries the tag and never replaces it', () => {
    const env = makeQrEnv();
    const a = asset(env);
    const [l] = issueLabels(env.hubActor(), { count: 1 });
    const done = assignLabel(env.hubActor(), id(l!), { expectedVersion: 1, assetTag: a.asset_tag ?? a.assetTag });
    expect(done).toMatchObject({ state: 'assigned', assetId: a.id, version: 2 });
    expect(labelForAsset(env.ctx.db, id(a))?.labelNo).toBe('SLN-LB-00000001');
    expect(resolveLabel(env.ctx.db, 'sln-lb-00000001')).toMatchObject({ state: 'assigned', assetId: a.id });
    expect(sql(env, 'SELECT asset_tag FROM ast_asset WHERE id = ?', a.id)[0]!.asset_tag).toBe('SLN-EQ-00000001');
  });

  it('enforces one live label per asset, reserved-only assignment and optimistic versions', () => {
    const env = makeQrEnv();
    const a = asset(env);
    const [l1, l2] = issueLabels(env.hubActor(), { count: 2 });
    assignLabel(env.hubActor(), id(l1!), { expectedVersion: 1, assetId: id(a) });
    expect(codeOf(() => assignLabel(env.hubActor(), id(l2!), { expectedVersion: 1, assetId: id(a) }))).toBe('DUPLICATE');
    expect(codeOf(() => assignLabel(env.hubActor(), id(l1!), { expectedVersion: 2, assetId: id(a) }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => assignLabel(env.hubActor(), id(l2!), { expectedVersion: 9, assetId: id(a) }))).toBe('VERSION_CONFLICT');
    expect(codeOf(() => assignLabel(env.hubActor(), id(l2!), { expectedVersion: 1, assetTag: 'SLN-EQ-99999999' }))).toBe('DEPENDENCY_MISSING');
    expect(codeOf(() => assignLabel(env.hubActor(), id(l2!), { expectedVersion: 1 }))).toBe('VALIDATION_FAILED');
  });

  it('voids with a reason; the number is never reused and a replacement can be assigned', () => {
    const env = makeQrEnv();
    const a = asset(env);
    const [l1, l2] = issueLabels(env.hubActor(), { count: 2 });
    assignLabel(env.hubActor(), id(l1!), { expectedVersion: 1, assetId: id(a) });
    expect(codeOf(() => voidLabel(env.hubActor(), id(l1!), { expectedVersion: 2, reason: '  ' }))).toBe('VALIDATION_FAILED');
    expect(voidLabel(env.hubActor(), id(l1!), { expectedVersion: 2, reason: 'Water damaged' })).toMatchObject({ state: 'void', voidReason: 'Water damaged' });
    expect(labelForAsset(env.ctx.db, id(a))).toBeNull();
    expect(resolveLabel(env.ctx.db, 'SLN-LB-00000001')?.state).toBe('void');
    expect(codeOf(() => voidLabel(env.hubActor(), id(l1!), { expectedVersion: 3, reason: 'again' }))).toBe('WORKFLOW_BLOCKED');
    expect(assignLabel(env.hubActor(), id(l2!), { expectedVersion: 1, assetId: id(a) }).state).toBe('assigned');
    expect(issueLabels(env.hubActor(), { count: 1 })[0]!.labelNo).toBe('SLN-LB-00000003');
  });

  it('records print jobs: first print, then reprint; void labels cannot be printed; sheets are split to A4 grids', () => {
    const env = makeQrEnv();
    const a = asset(env);
    const labels = issueLabels(env.hubActor(), { count: 5 });
    assignLabel(env.hubActor(), id(labels[0]!), { expectedVersion: 1, assetId: id(a) });
    const first = printLabels(env.hubActor(), { labelIds: labels.map(id), columns: 2, rows: 2 });
    expect(first.perSheet).toBe(4);
    expect(first.sheets.map((s) => s.cells.length)).toEqual([4, 1]);
    expect(first.sheets[0]!.cells[0]).toMatchObject({ labelNo: 'SLN-LB-00000001', assetTag: 'SLN-EQ-00000001', reprint: false });
    expect(first.sheets[0]!.cells[0]!.svg).toMatch(/^<svg[^>]*>.*<path d="M/);
    const again = printLabels(env.hubActor(), { labelIds: [id(labels[0]!)] });
    expect(again.sheets[0]!.cells[0]!.reprint).toBe(true);
    expect(sql(env, 'SELECT reason FROM qr_label_print WHERE label_id = ? ORDER BY occurred_at, id', id(labels[0]!)).map((r) => r.reason)).toEqual(['first', 'reprint']);
    voidLabel(env.hubActor(), id(labels[1]!), { expectedVersion: 1, reason: 'Spoiled' });
    expect(codeOf(() => printLabels(env.hubActor(), { labelIds: [id(labels[1]!)] }))).toBe('WORKFLOW_BLOCKED');
    expect(sql(env, 'SELECT COUNT(*) n FROM qr_label_print')[0]!.n).toBe(6); // the blocked job wrote nothing
  });

  it('denies without permission and audits the denial', () => {
    const env = makeQrEnv();
    const denied = env.hubActor(denyOnly('qr.label.create', 'qr.label.print'));
    expect(codeOf(() => issueLabels(denied, { count: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(() => printLabels(denied, { labelIds: ['0198f000-0000-7000-8000-000000000000'] }))).toBe('FORBIDDEN');
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE outcome = 'denied' AND action = 'denied:qr.label.create'")[0]!.n).toBe(1);
  });

  it('a ship issues labels only from its own range and only for itself', () => {
    const env = makeQrEnv();
    const ship = env.shipActor(env.shipId);
    expect(codeOf(() => issueLabels(ship, { count: 1 }))).toBe('RANGE_EXHAUSTED');
    env.grantLabels(ship.wctx.installation.installationId, 10);
    expect(issueLabels(ship, { count: 2, shipId: env.shipId })).toHaveLength(2);
    expect(codeOf(() => issueLabels(ship, { count: 1, shipId: env.ship2Id }))).toBe('NOT_OWNER');
    // the hub cannot edit a label that the ship's installation owns
    const [l] = issueLabels(ship, { count: 1 });
    expect(codeOf(() => voidLabel(env.hubActor(), id(l!), { expectedVersion: 1, reason: 'x' }))).toBe('NOT_OWNER');
  });
});

describe('survey templates', () => {
  it('are hub reference data with unique codes and validated questions', () => {
    const env = makeQrEnv();
    const t = createTemplate(env.hubActor(), { code: 'basic', name: 'Basic', items: [{ key: 'ok', label: 'OK?', kind: 'yesno' }] });
    expect(t).toMatchObject({ code: 'BASIC', items: [{ key: 'ok', label: 'OK?', kind: 'yesno' }] });
    expect(codeOf(() => createTemplate(env.hubActor(), { code: 'BASIC', name: 'Dup' }))).toBe('DUPLICATE');
    expect(codeOf(() => createTemplate(env.hubActor(), { code: 'X', name: 'X', items: [{ key: 'a', label: 'A', kind: 'text' }, { key: 'a', label: 'B', kind: 'text' }] }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createTemplate(env.shipActor(env.shipId), { code: 'SHIP', name: 'Ship' }))).toBe('NOT_OWNER');
    expect(updateTemplate(env.hubActor(), id(t), { expectedVersion: 1, items: [] })).toMatchObject({ items: [], version: 2 });
    const s = startSurvey(env.hubActor(), { locationId: room(env), templateId: id(t) });
    expect(s.status).toBe('open');
    expect(codeOf(() => tombstoneTemplate(env.hubActor(), id(t), { expectedVersion: 2, reason: 'old' }))).toBe('WORKFLOW_BLOCKED');
  });
});

describe('compartment surveys', () => {
  it('walks a compartment: scanned and pending items, one open survey per compartment, then close', () => {
    const env = makeQrEnv();
    const a = asset(env);
    const [l1, l2] = issueLabels(env.hubActor(), { count: 2 });
    assignLabel(env.hubActor(), id(l1!), { expectedVersion: 1, assetId: id(a) });
    const loc = room(env);
    const s = startSurvey(env.hubActor(), { locationId: loc });
    expect(s).toMatchObject({ homeScopeId: env.shipId, status: 'open' });
    expect(codeOf(() => startSurvey(env.hubActor(), { locationId: loc }))).toBe('DUPLICATE');

    const scanned = addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', labelNo: 'sln-lb-00000001', observedStatus: 'under_repair', answers: { ok: false } });
    expect(scanned).toMatchObject({ kind: 'scanned', assetId: id(a), labelNo: 'SLN-LB-00000001', answers: { ok: false } });
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', assetId: id(a) }))).toBe('DUPLICATE');
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', labelNo: l2!.labelNo }))).toBe('WORKFLOW_BLOCKED'); // reserved, not on an asset
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', labelNo: 'SLN-LB-77777777' }))).toBe('NOT_FOUND');
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', assetTag: 'SLN-EQ-1', assetId: id(a) }))).toBe('VALIDATION_FAILED');
    voidLabel(env.hubActor(), id(l1!), { expectedVersion: 2, reason: 'Peeling' });
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', labelNo: l1!.labelNo }))).toBe('WORKFLOW_BLOCKED');

    const pending = addSurveyItem(env.hubActor(), id(s), { kind: 'pending', description: 'Bilge pump', manufacturer: 'Acme', model: 'BP', serialNumber: 'S1' });
    expect(pending).toMatchObject({ kind: 'pending', description: 'Bilge pump' });
    expect(updateSurveyItem(env.hubActor(), id(pending), { expectedVersion: 1, note: 'corroded' })).toMatchObject({ note: 'corroded', version: 2 });
    expect(codeOf(() => updateSurveyItem(env.hubActor(), id(scanned), { expectedVersion: 1, description: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(sql(env, 'SELECT item_count, scanned_count, pending_count FROM qr_v_survey_summary WHERE survey_id = ?', id(s))[0]).toEqual({ item_count: 2, scanned_count: 1, pending_count: 1 });

    const closed = closeSurvey(env.hubActor(), id(s), { expectedVersion: 1 });
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeTruthy();
    expect(codeOf(() => addSurveyItem(env.hubActor(), id(s), { kind: 'pending', description: 'Late' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => removeSurveyItem(env.hubActor(), id(pending), { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => closeSurvey(env.hubActor(), id(s), { expectedVersion: 2 }))).toBe('WORKFLOW_BLOCKED');
    expect(startSurvey(env.hubActor(), { locationId: loc }).status).toBe('open'); // a new walk-through is allowed after closing
  });

  it('converts a pending item into a registered asset through M03, optionally with a label', () => {
    const env = makeQrEnv();
    const [label] = issueLabels(env.hubActor(), { count: 1 });
    const loc = room(env);
    const s = startSurvey(env.hubActor(), { locationId: loc });
    const item = addSurveyItem(env.hubActor(), id(s), { kind: 'pending', description: 'Bilge pump', manufacturer: 'Acme', model: 'BP-1', serialNumber: 'S-77', observedStatus: 'under_repair' });
    const out = convertSurveyItem(env.hubActor(), id(item), { expectedVersion: 1, labelId: id(label!) });
    expect(out.asset).toMatchObject({ name: 'Bilge pump', assetTag: 'SLN-EQ-00000001', serialNumber: 'S-77', homeScopeId: env.shipId });
    expect(out.item).toMatchObject({ convertedAssetId: out.asset.id, labelNo: 'SLN-LB-00000001' });
    expect(labelForAsset(env.ctx.db, out.asset.id as string)?.labelNo).toBe('SLN-LB-00000001');
    const state = sql(env, 'SELECT asset_status, location_id, custody_party_kind, custody_party_id FROM ast_asset_current WHERE asset_id = ?', out.asset.id)[0];
    expect(state).toEqual({ asset_status: 'under_repair', location_id: loc, custody_party_kind: 'ship', custody_party_id: env.shipId });
    expect(codeOf(() => convertSurveyItem(env.hubActor(), id(item), { expectedVersion: 2 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => updateSurveyItem(env.hubActor(), id(item), { expectedVersion: 2, note: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneSurvey(env.hubActor(), id(s), { expectedVersion: 1, reason: 'oops' }))).toBe('WORKFLOW_BLOCKED');
    const scanned = addSurveyItem(env.hubActor(), id(s), { kind: 'scanned', assetId: out.asset.id as string });
    expect(codeOf(() => convertSurveyItem(env.hubActor(), id(scanned), { expectedVersion: 1 }))).toBe('WORKFLOW_BLOCKED');
  });

  it('rolls conversion back completely when the asset cannot be created (range exhausted)', () => {
    const env = makeQrEnv({ hubRange: 0 });
    const s = startSurvey(env.hubActor(), { locationId: room(env) });
    const item = addSurveyItem(env.hubActor(), id(s), { kind: 'pending', description: 'Mystery box' });
    expect(codeOf(() => convertSurveyItem(env.hubActor(), id(item), { expectedVersion: 1 }))).toBe('RANGE_EXHAUSTED');
    expect(sql(env, 'SELECT converted_asset_id FROM qr_survey_item WHERE id = ?', id(item))[0]!.converted_asset_id).toBeNull();
    expect(sql(env, 'SELECT COUNT(*) n FROM ast_asset')[0]!.n).toBe(0);
  });

  it('a ship surveys only its own compartments; removing an item and deleting an unconverted survey is allowed', () => {
    const env = makeQrEnv();
    const ship = env.shipActor(env.shipId);
    expect(codeOf(() => startSurvey(ship, { locationId: room(env, 'OTHER', env.ship2Id) }))).toBe('NOT_OWNER');
    const mine = startSurvey(env.hubActor(), { locationId: room(env) });
    const item = addSurveyItem(env.hubActor(), id(mine), { kind: 'pending', description: 'Thing' });
    expect(removeSurveyItem(env.hubActor(), id(item), { expectedVersion: 1, reason: 'mistake' }).deletedAt).toBeTruthy();
    expect(tombstoneSurvey(env.hubActor(), id(mine), { expectedVersion: 1, reason: 'cancelled' }).deletedAt).toBeTruthy();
    expect(startSurvey(env.hubActor(), { locationId: sql(env, "SELECT id FROM org_location WHERE code = 'GEN'")[0]!.id }).status).toBe('open');
  });
});
