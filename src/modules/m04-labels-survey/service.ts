/**
 * Command services for M04: authorization -> validation/business rules -> platform write path (records.ts).
 * A label carries the asset tag; it never replaces it. Label numbers come from this installation's own range (offline-safe).
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { uuidv7 } from '../../platform/ids.js';
import { nextNumber } from '../../platform/ranges.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { createAsset, getAsset, resolveTag, type AstActor } from '../m03-assets/index.js';
import { getLocation, resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm, type QrNoun } from './permissions.js';
import { qrSvg } from './qr.js';
import { exists, getLive, resolveLabel, toApi, TABLES, type Row } from './queries.js';
import * as S from './schemas.js';

export const LABEL_SEQUENCE = 'label_no';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const reload = (db: Db, noun: QrNoun, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ?`).get(id) as Row;
const scopeOf = (shipOrSite: unknown): ScopeRef => (typeof shipOrSite === 'string' ? { kind: 'ship', id: shipOrSite } : { kind: 'fleet' });
const checkVersion = (cur: Row, expected: number): void => {
  if (cur.version !== expected) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion: expected });
};
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}

/** A ship or workshop installation enters data only for the site it serves; the hub and commands may enter any. */
function assertSiteHeldHere(a: Actor, siteId: string): void {
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== siteId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different site; enter data where it is held', { servedSiteId: r.org_unit_id, requestedSiteId: siteId });
  }
}

// ------------------------------------------------------------------ labels

/** Reserve `count` label numbers from this installation's range. All-or-nothing: RANGE_EXHAUSTED rolls the batch back. */
export function issueLabels(a: Actor, input: unknown): Row[] {
  const b = S.parse(S.LabelIssue, input);
  const db = a.wctx.db;
  authorize(a, perm('label', 'create'), scopeOf(b.shipId));
  if (b.shipId && !resolveParty(db, { kind: 'ship', id: b.shipId })) throw missing('Ship', b.shipId);
  if (b.shipId) assertSiteHeldHere(a, b.shipId);
  return db.transaction(() => {
    const out: Row[] = [];
    for (let i = 0; i < b.count; i++) {
      const { tag } = nextNumber(db, a.wctx.installation, LABEL_SEQUENCE);
      out.push(toApi(createRecord(a.wctx, 'qr.label', { label_no: tag, state: 'reserved', home_scope_id: b.shipId ?? null, note: b.note ?? null })));
    }
    return out;
  })();
}

/** Stick a reserved label onto an asset (by id or by its printed equipment tag). One live label per asset: void the old one first. */
export function assignLabel(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.LabelAssign, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'label', id);
  if (!cur) throw notFound('Label', id);
  authorize(a, perm('label', 'assign'), scopeOf(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  if (cur.state !== 'reserved') throw blocked(`Label is ${String(cur.state)}; only a reserved label can be assigned`, { state: cur.state });
  const asset = b.assetId ? getAsset(db, b.assetId) : resolveTag(db, b.assetTag as string);
  if (!asset) throw missing('Asset', b.assetId ?? b.assetTag);
  return guard(() =>
    db.transaction(() => {
      const held = db.prepare("SELECT label_no FROM qr_label WHERE asset_id = ? AND state = 'assigned' AND deleted_at IS NULL").get(asset.id) as { label_no: string } | undefined;
      if (held) throw new AppError('DUPLICATE', `Asset ${asset.assetTag} already carries label ${held.label_no}; void it first`, { assetId: asset.id, labelNo: held.label_no });
      updateRecord(a.wctx, 'qr.label', id, b.expectedVersion, { state: 'assigned', asset_id: asset.id, assigned_at: nowUtc() });
      return toApi(reload(db, 'label', id));
    })(),
  );
}

/** A damaged, lost or wrong label is voided with a reason; its number is never reused. Issue and assign a new one. */
export function voidLabel(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.LabelVoid, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'label', id);
  if (!cur) throw notFound('Label', id);
  authorize(a, perm('label', 'void'), scopeOf(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  if (cur.state === 'void') throw blocked('Label is already void');
  const w = withReason(a, b.reason);
  updateRecord(w.wctx, 'qr.label', id, b.expectedVersion, { state: 'void', void_reason: b.reason });
  return toApi(reload(db, 'label', id));
}

export interface PrintCell { labelId: string; labelNo: string; state: string; assetTag: string | null; assetName: string | null; svg: string; reprint: boolean }
export interface PrintResult { jobId: string; columns: number; rows: number; perSheet: number; sheets: Array<{ page: number; cells: PrintCell[] }> }

/** Record a print job (one event per label; a second print of a label is a `reprint`) and return the A4 sheet layout with QR images. */
export function printLabels(a: Actor, input: unknown): PrintResult {
  const b = S.parse(S.LabelPrint, input);
  const db = a.wctx.db;
  authorize(a, perm('label', 'print'), { kind: 'fleet' });
  const jobId = uuidv7();
  const cells: PrintCell[] = db.transaction(() => {
    const out: PrintCell[] = [];
    for (const labelId of b.labelIds) {
      const l = getLive(db, 'label', labelId);
      if (!l) throw notFound('Label', labelId);
      if (l.state === 'void') throw blocked(`Label ${String(l.label_no)} is void and cannot be printed`, { labelId });
      const reprint = exists(db, 'SELECT 1 FROM qr_label_print WHERE label_id = ?', labelId);
      appendEvent(a.wctx, 'qr.label_print', { home_scope_id: l.home_scope_id ?? null, label_id: labelId, print_job_id: jobId, reason: reprint ? 'reprint' : 'first', note: b.note ?? null });
      const asset = l.asset_id ? getAsset(db, l.asset_id as string) : null;
      out.push({ labelId, labelNo: l.label_no as string, state: l.state as string, assetTag: asset?.assetTag ?? null, assetName: asset?.name ?? null, svg: qrSvg(l.label_no as string), reprint });
    }
    writeAudit(a.wctx, { action: 'label.print', entityType: 'qr.label_print', entityId: jobId, outcome: 'success' });
    return out;
  })();
  const perSheet = b.columns * b.rows;
  const sheets: PrintResult['sheets'] = [];
  for (let i = 0; i < cells.length; i += perSheet) sheets.push({ page: sheets.length + 1, cells: cells.slice(i, i + perSheet) });
  return { jobId, columns: b.columns, rows: b.rows, perSheet, sheets };
}

// ------------------------------------------------------------------ survey templates (hub reference data)

const serializeItems = (items: unknown): string => JSON.stringify(items ?? []);

export function createTemplate(a: Actor, input: unknown): Row {
  const b = S.parse(S.TemplateCreate, input);
  authorize(a, perm('survey_template', 'create'), { kind: 'fleet' });
  assertHub(a);
  if (exists(a.wctx.db, 'SELECT 1 FROM qr_survey_template WHERE code = ? AND deleted_at IS NULL', b.code)) throw new AppError('DUPLICATE', 'A survey template with this code already exists', { fields: ['code'] });
  const { items, ...rest } = b;
  return guard(() => toApi(createRecord(a.wctx, 'qr.survey_template', { ...snake(rest), items_json: serializeItems(items) })));
}

export function updateTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, items, ...rest } = S.parse(S.TemplateUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'survey_template', id);
  if (!cur) throw notFound('Survey template', id);
  authorize(a, perm('survey_template', 'update'), { kind: 'fleet' });
  assertHub(a);
  checkVersion(cur, expectedVersion);
  updateRecord(a.wctx, 'qr.survey_template', id, expectedVersion, { ...snake(rest), ...(items ? { items_json: serializeItems(items) } : {}) });
  return toApi(reload(db, 'survey_template', id));
}

export function tombstoneTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'survey_template', id);
  if (!cur) throw notFound('Survey template', id);
  authorize(a, perm('survey_template', 'remove'), { kind: 'fleet' });
  assertHub(a);
  checkVersion(cur, expectedVersion);
  if (exists(db, "SELECT 1 FROM qr_survey WHERE template_id = ? AND deleted_at IS NULL", id)) throw blocked('Template is used by surveys; make it inactive instead');
  tombstoneRecord(a.wctx, 'qr.survey_template', id, expectedVersion, reason);
  return toApi(reload(db, 'survey_template', id));
}

function assertHub(a: Actor): void {
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'qr.survey_template is hub-owned reference data; it can only be changed at the hub', { entityType: 'qr.survey_template' });
}
function snake(input: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [toSnake(k), v]));
}

// ------------------------------------------------------------------ surveys

export function startSurvey(a: Actor, input: unknown): Row {
  const b = S.parse(S.SurveyCreate, input);
  const db = a.wctx.db;
  const loc = getLocation(db, b.locationId);
  if (!loc) throw missing('Location', b.locationId);
  authorize(a, perm('survey', 'create'), scopeOf(loc.siteId));
  assertSiteHeldHere(a, loc.siteId);
  if (b.templateId) {
    const t = getLive(db, 'survey_template', b.templateId);
    if (!t) throw missing('Survey template', b.templateId);
    if (t.status !== 'active') throw blocked('Survey template is inactive');
  }
  if (exists(db, "SELECT 1 FROM qr_survey WHERE location_id = ? AND status = 'open' AND deleted_at IS NULL", b.locationId)) {
    throw new AppError('DUPLICATE', 'A survey of this compartment is already open; close it first', { fields: ['locationId'] });
  }
  return guard(() => toApi(createRecord(a.wctx, 'qr.survey', { home_scope_id: loc.siteId, location_id: b.locationId, template_id: b.templateId ?? null, status: 'open', started_at: b.startedAt ?? nowUtc(), note: b.note ?? null })));
}

const openSurvey = (db: Db, id: unknown): Row => {
  const s = typeof id === 'string' ? getLive(db, 'survey', id) : undefined;
  if (!s) throw notFound('Survey', id);
  return s;
};
const requireOpen = (s: Row): void => { if (s.status !== 'open') throw blocked('Survey is closed; no more items can be changed', { surveyId: s.id }); };

export function updateSurvey(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.SurveyUpdate, input);
  const db = a.wctx.db;
  const cur = openSurvey(db, id);
  authorize(a, perm('survey', 'update'), scopeOf(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  requireOpen(cur);
  updateRecord(a.wctx, 'qr.survey', id, expectedVersion, snake(rest));
  return toApi(reload(db, 'survey', id));
}

export function closeSurvey(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.SurveyClose, input);
  const db = a.wctx.db;
  const cur = openSurvey(db, id);
  authorize(a, perm('survey', 'close'), scopeOf(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  requireOpen(cur);
  updateRecord(a.wctx, 'qr.survey', id, b.expectedVersion, { status: 'closed', closed_at: nowUtc(), ...(b.note !== undefined ? { note: b.note } : {}) });
  return toApi(reload(db, 'survey', id));
}

export function tombstoneSurvey(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = openSurvey(db, id);
  authorize(a, perm('survey', 'remove'), scopeOf(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (exists(db, 'SELECT 1 FROM qr_survey_item WHERE survey_id = ? AND deleted_at IS NULL AND converted_asset_id IS NOT NULL', id)) throw blocked('Items of this survey were converted to assets; the survey must be kept');
  return db.transaction(() => {
    for (const it of db.prepare('SELECT id, version FROM qr_survey_item WHERE survey_id = ? AND deleted_at IS NULL').all(id) as Array<{ id: string; version: number }>) {
      tombstoneRecord(a.wctx, 'qr.survey_item', it.id, it.version, reason);
    }
    tombstoneRecord(a.wctx, 'qr.survey', id, expectedVersion, reason);
    return toApi(reload(db, 'survey', id));
  })();
}

// ------------------------------------------------------------------ survey items

/** Add something found during the walk: a known asset (scanned label / typed tag / picked asset) or an unregistered "pending" item. */
export function addSurveyItem(a: Actor, surveyId: string, input: unknown): Row {
  const b = S.parse(S.ItemCreate, input);
  const db = a.wctx.db;
  const survey = openSurvey(db, surveyId);
  authorize(a, perm('survey_item', 'create'), scopeOf(survey.home_scope_id));
  assertSiteHeldHere(a, survey.home_scope_id as string);
  requireOpen(survey);
  const base = { survey_id: surveyId, home_scope_id: survey.home_scope_id, observed_status: b.observedStatus ?? null, answers_json: JSON.stringify(b.answers), note: b.note ?? null };
  return guard(() =>
    db.transaction(() => {
      if (b.kind === 'pending') {
        return toApi(createRecord(a.wctx, 'qr.survey_item', { ...base, kind: 'pending', description: b.description, manufacturer: b.manufacturer ?? null, model: b.model ?? null, serial_number: b.serialNumber ?? null }));
      }
      let labelNo: string | null = null;
      let asset = null as ReturnType<typeof getAsset>;
      if (b.labelNo) {
        const l = resolveLabel(db, b.labelNo);
        if (!l) throw new AppError('NOT_FOUND', `No label ${b.labelNo.toUpperCase()} is known on this installation`);
        if (l.state === 'void') throw blocked(`Label ${l.labelNo} is void; this sticker should be removed`, { labelNo: l.labelNo });
        if (!l.assetId) throw blocked(`Label ${l.labelNo} is not assigned to an asset yet; record the item as pending, then convert it`, { labelNo: l.labelNo });
        labelNo = l.labelNo;
        asset = getAsset(db, l.assetId);
      } else if (b.assetTag) asset = resolveTag(db, b.assetTag);
      else if (b.assetId) asset = getAsset(db, b.assetId);
      if (!asset) throw missing('Asset', b.labelNo ?? b.assetTag ?? b.assetId);
      return toApi(createRecord(a.wctx, 'qr.survey_item', { ...base, kind: 'scanned', asset_id: asset.id, label_no: labelNo }));
    })(),
  );
}

export function updateSurveyItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, answers, ...rest } = S.parse(S.ItemUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'survey_item', id);
  if (!cur) throw notFound('Survey item', id);
  authorize(a, perm('survey_item', 'update'), scopeOf(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  requireOpen(openSurvey(db, cur.survey_id));
  if (cur.converted_asset_id) throw blocked('Item was converted to an asset and can no longer be changed');
  const pendingOnly = ['description', 'manufacturer', 'model', 'serialNumber'].filter((k) => (rest as Record<string, unknown>)[k] !== undefined);
  if (cur.kind === 'scanned' && pendingOnly.length) throw blocked('Only pending items have a description, manufacturer, model or serial number');
  updateRecord(a.wctx, 'qr.survey_item', id, expectedVersion, { ...snake(rest), ...(answers ? { answers_json: JSON.stringify(answers) } : {}) });
  return toApi(reload(db, 'survey_item', id));
}

export function removeSurveyItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'survey_item', id);
  if (!cur) throw notFound('Survey item', id);
  authorize(a, perm('survey_item', 'remove'), scopeOf(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  requireOpen(openSurvey(db, cur.survey_id));
  if (cur.converted_asset_id) throw blocked('Item was converted to an asset and must be kept');
  tombstoneRecord(a.wctx, 'qr.survey_item', id, expectedVersion, reason);
  return toApi(reload(db, 'survey_item', id));
}

/**
 * Turn a pending item into a registered asset (through M03, so the tag comes from the asset-tag range and the registration is a
 * movement event). The asset is held by the surveyed site; optionally installed in a position and given a reserved label.
 */
export function convertSurveyItem(a: Actor, id: string, input: unknown): { item: Row; asset: Row } {
  const b = S.parse(S.ItemConvert, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'survey_item', id);
  if (!cur) throw notFound('Survey item', id);
  authorize(a, perm('survey_item', 'convert'), scopeOf(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  if (cur.kind !== 'pending') throw blocked('Only pending items can be converted');
  if (cur.converted_asset_id) throw blocked('Item was already converted', { assetId: cur.converted_asset_id });
  const survey = openSurvey(db, cur.survey_id);
  const loc = getLocation(db, survey.location_id as string);
  if (!loc) throw missing('Location', survey.location_id);
  return guard(() =>
    db.transaction(() => {
      let label: Row | undefined;
      if (b.labelId) {
        label = getLive(db, 'label', b.labelId);
        if (!label) throw missing('Label', b.labelId);
        if (label.state !== 'reserved') throw blocked(`Label ${String(label.label_no)} is ${String(label.state)}; choose a reserved label`);
      }
      const created = createAsset(a as AstActor, {
        name: b.name ?? cur.description, manufacturer: cur.manufacturer ?? null, model: cur.model ?? null, serialNumber: cur.serial_number ?? null,
        classificationId: b.classificationId ?? null, homeShipId: loc.siteKind === 'ship' ? loc.siteId : null, locationId: loc.id,
        custody: { kind: loc.siteKind, id: loc.siteId },
        ...(cur.observed_status ? { assetStatus: cur.observed_status } : {}), ...(b.positionId ? { positionId: b.positionId } : {}),
        notes: `Registered from compartment survey ${String(survey.id)}`,
      });
      const assetId = created.asset.id as string;
      if (label) updateRecord(a.wctx, 'qr.label', label.id as string, label.version as number, { state: 'assigned', asset_id: assetId, assigned_at: nowUtc() });
      updateRecord(a.wctx, 'qr.survey_item', id, b.expectedVersion, { converted_asset_id: assetId, converted_at: nowUtc(), ...(label ? { label_no: label.label_no } : {}) });
      return { item: toApi(reload(db, 'survey_item', id)), asset: created.asset };
    })(),
  );
}
