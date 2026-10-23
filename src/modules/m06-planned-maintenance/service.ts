/**
 * Command services for M06: authorization -> validation/business rules -> platform write path (records.ts).
 * Plans produce preventive work orders ONLY through M05's createWorkOrder. A plan remembers the due point it last produced work for
 * (last_generated_key), so running generation twice never duplicates, and it does not start a new cycle while the previous order is open (D45).
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { getAsset, getPosition } from '../m03-assets/index.js';
import { createWorkOrder, getWorkOrder, workOrderClosedAt } from '../m05-work/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm, type PmNoun } from './permissions.js';
import { currentMeterValue, exists, getLive, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const scopeOf = (shipId: unknown): ScopeRef => (typeof shipId === 'string' ? { kind: 'ship', id: shipId } : { kind: 'fleet' });
const snake = (input: Record<string, unknown>): Row => Object.fromEntries(Object.entries(input).map(([k, v]) => [toSnake(k), v]));
const round2 = (n: number): number => Math.round(n * 100) / 100;
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}
/** A ship or workshop installation enters data only for the site it serves; the hub and commands may enter any. */
function assertSiteHeldHere(a: Actor, siteId: unknown): void {
  if (typeof siteId !== 'string') return;
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== siteId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different site; enter this where the equipment is held', { servedSiteId: r.org_unit_id, requestedSiteId: siteId });
  }
}
function checkMoment(at: string | undefined): void {
  if (at && Date.parse(at) > Date.now() + 5 * 60_000) throw new AppError('VALIDATION_FAILED', 'The time cannot be in the future', { fields: ['occurredAt'] });
}
const requireAsset = (db: Db, id: unknown) => {
  const x = typeof id === 'string' ? getAsset(db, id) : null;
  if (!x) throw missing('Asset', id);
  return x;
};

// ------------------------------------------------------------------ task templates (hub reference data)

export function createTemplate(a: Actor, input: unknown): Row {
  const { checklist, ...b } = S.parse(S.TemplateCreate, input);
  authorize(a, perm('task_template', 'create'), { kind: 'fleet' });
  if (b.classificationId && !exists(a.wctx.db, 'SELECT 1 FROM ast_classification WHERE id = ? AND deleted_at IS NULL', b.classificationId)) throw missing('Classification', b.classificationId);
  return guard(() => toApi(createRecord(a.wctx, 'pm.task_template', { ...snake(b), checklist_json: checklist, status: b.status ?? 'active', priority: b.priority ?? 'normal' })));
}
export function updateTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, checklist, ...rest } = S.parse(S.TemplateUpdate, input);
  authorize(a, perm('task_template', 'update'), { kind: 'fleet' });
  if (!getLive(a.wctx.db, 'task_template', id)) throw notFound('Task template', id);
  return toApi(updateRecord(a.wctx, 'pm.task_template', id, expectedVersion, { ...snake(rest), ...(checklist ? { checklist_json: checklist } : {}) }));
}
export function tombstoneTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('task_template', 'remove'), { kind: 'fleet' });
  if (!getLive(a.wctx.db, 'task_template', id)) throw notFound('Task template', id);
  if (exists(a.wctx.db, 'SELECT 1 FROM pm_plan WHERE template_id = ? AND deleted_at IS NULL', id)) throw blocked('Plans still use this task template; mark it inactive instead', { templateId: id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'pm.task_template', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ meters and readings

export function createMeter(a: Actor, input: unknown): Row {
  const b = S.parse(S.MeterCreate, input);
  const asset = requireAsset(a.wctx.db, b.assetId);
  authorize(a, perm('meter', 'create'), scopeOf(asset.homeShipId));
  assertSiteHeldHere(a, asset.homeShipId);
  return guard(() => toApi(createRecord(a.wctx, 'pm.meter', { home_scope_id: asset.homeShipId, asset_id: b.assetId, name: b.name, kind: b.kind, unit: b.unit ?? (b.kind === 'running_hours' ? 'h' : 'count'), status: 'active' })));
}
export function updateMeter(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.MeterUpdate, input);
  const cur = getLive(a.wctx.db, 'meter', id);
  if (!cur) throw notFound('Meter', id);
  authorize(a, perm('meter', 'update'), scopeOf(cur.home_scope_id));
  return toApi(updateRecord(a.wctx, 'pm.meter', id, expectedVersion, snake(rest)));
}
export function tombstoneMeter(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const cur = getLive(a.wctx.db, 'meter', id);
  if (!cur) throw notFound('Meter', id);
  authorize(a, perm('meter', 'remove'), scopeOf(cur.home_scope_id));
  if (exists(a.wctx.db, 'SELECT 1 FROM pm_plan WHERE meter_id = ? AND deleted_at IS NULL', id)) throw blocked('A running-hours plan uses this meter; remove or change the plan first', { meterId: id });
  if (exists(a.wctx.db, 'SELECT 1 FROM pm_meter_reading WHERE meter_id = ?', id)) throw blocked('This meter has readings; mark it inactive instead of removing it', { meterId: id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'pm.meter', id, expectedVersion, reason));
}

interface LastReading { reading: number; cumulative: number; occurred_at: string }
const lastReading = (db: Db, meterId: string): LastReading | undefined =>
  db.prepare('SELECT reading, cumulative, occurred_at FROM pm_meter_reading WHERE meter_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1').get(meterId) as LastReading | undefined;

function meterFor(a: Actor, meterId: string): Row {
  const m = getLive(a.wctx.db, 'meter', meterId);
  if (!m) throw missing('Meter', meterId);
  if (m.status !== 'active') throw blocked('This meter is inactive', { meterId });
  return m;
}

/** A dial reading. It may not go backwards or back in time; a replaced dial uses replaceMeter instead. */
export function recordReading(a: Actor, input: unknown): Row {
  const b = S.parse(S.Reading, input);
  const m = meterFor(a, b.meterId);
  authorize(a, perm('meter_reading', 'create'), scopeOf(m.home_scope_id));
  assertSiteHeldHere(a, m.home_scope_id);
  checkMoment(b.occurredAt);
  return a.wctx.db.transaction(() => {
    const last = lastReading(a.wctx.db, b.meterId);
    const at = b.occurredAt ?? nowUtc();
    if (last && at < last.occurred_at) throw blocked(`There is already a reading from ${last.occurred_at}; enter readings in time order`, { lastReadingAt: last.occurred_at });
    if (last && b.reading < last.reading) throw blocked(`The meter showed ${last.reading} before; ${b.reading} is lower. If the meter was replaced, record a replacement instead`, { lastReading: last.reading });
    const cumulative = round2((last?.cumulative ?? 0) + (last ? b.reading - last.reading : b.reading));
    return toApi(appendEvent(a.wctx, 'pm.meter_reading', { home_scope_id: m.home_scope_id ?? null, meter_id: b.meterId, kind: 'reading', reading: b.reading, cumulative, note: b.note ?? null, occurred_at: at }));
  })();
}

/** The dial was replaced: the cumulative total carries on from where it was, and the new dial starts at startReading. */
export function replaceMeter(a: Actor, input: unknown): Row {
  const b = S.parse(S.Replacement, input);
  const m = meterFor(a, b.meterId);
  authorize(a, perm('meter_reading', 'create'), scopeOf(m.home_scope_id));
  assertSiteHeldHere(a, m.home_scope_id);
  checkMoment(b.occurredAt);
  return a.wctx.db.transaction(() => {
    const last = lastReading(a.wctx.db, b.meterId);
    const at = b.occurredAt ?? nowUtc();
    if (last && at < last.occurred_at) throw blocked(`There is already a reading from ${last.occurred_at}; enter readings in time order`, { lastReadingAt: last.occurred_at });
    return toApi(appendEvent(a.wctx, 'pm.meter_reading', { home_scope_id: m.home_scope_id ?? null, meter_id: b.meterId, kind: 'replacement', reading: b.startReading, cumulative: last?.cumulative ?? 0, note: b.note ?? 'Meter replaced', occurred_at: at }));
  })();
}

// ------------------------------------------------------------------ plans

function targetOf(db: Db, b: { assetId?: string | undefined; positionId?: string | undefined }): { shipId: string | null; assetId: string | null; positionId: string | null } {
  if (b.assetId) return { shipId: requireAsset(db, b.assetId).homeShipId, assetId: b.assetId, positionId: null };
  const p = b.positionId ? getPosition(db, b.positionId) : null;
  if (!p) throw missing('Position', b.positionId);
  return { shipId: p.shipId, assetId: null, positionId: p.id };
}

export function createPlan(a: Actor, input: unknown): Row {
  const b = S.parse(S.PlanCreate, input);
  const db = a.wctx.db;
  const target = targetOf(db, b);
  authorize(a, perm('plan', 'create'), scopeOf(target.shipId));
  assertSiteHeldHere(a, target.shipId);
  if (b.templateId && !getLive(db, 'task_template', b.templateId)) throw missing('Task template', b.templateId);
  let baseline: number | null = null;
  if (b.meterId) {
    const m = getLive(db, 'meter', b.meterId);
    if (!m) throw missing('Meter', b.meterId);
    if (target.assetId && m.asset_id !== target.assetId) throw new AppError('VALIDATION_FAILED', 'The meter belongs to a different asset', { fields: ['meterId'] });
    baseline = currentMeterValue(db, b.meterId)?.cumulative ?? 0;
  }
  checkMoment(b.startAt);
  return guard(() => toApi(createRecord(a.wctx, 'pm.plan', {
    home_scope_id: target.shipId, code: b.code, title: b.title, template_id: b.templateId ?? null, asset_id: target.assetId, position_id: target.positionId,
    trigger_kind: b.triggerKind, interval_days: b.intervalDays ?? null, interval_hours: b.intervalHours ?? null, meter_id: b.meterId ?? null,
    lead_days: b.leadDays ?? 7, lead_hours: b.leadHours ?? 50, priority: b.priority ?? 'normal', start_at: b.startAt ?? nowUtc(), last_done_hours: baseline, status: 'active',
  })));
}
export function updatePlan(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.PlanUpdate, input);
  const cur = getLive(a.wctx.db, 'plan', id);
  if (!cur) throw notFound('Plan', id);
  authorize(a, perm('plan', 'update'), scopeOf(cur.home_scope_id));
  if (rest.intervalDays !== undefined && cur.trigger_kind !== 'calendar') throw new AppError('VALIDATION_FAILED', 'Only calendar plans have intervalDays', { fields: ['intervalDays'] });
  if (rest.intervalHours !== undefined && cur.trigger_kind !== 'running_hours') throw new AppError('VALIDATION_FAILED', 'Only running-hours plans have intervalHours', { fields: ['intervalHours'] });
  if (rest.templateId && !getLive(a.wctx.db, 'task_template', rest.templateId)) throw missing('Task template', rest.templateId);
  return toApi(updateRecord(a.wctx, 'pm.plan', id, expectedVersion, snake(rest)));
}
export function tombstonePlan(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const cur = getLive(a.wctx.db, 'plan', id);
  if (!cur) throw notFound('Plan', id);
  authorize(a, perm('plan', 'remove'), scopeOf(cur.home_scope_id));
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'pm.plan', id, expectedVersion, reason));
}

/** The maintenance was done (with or without a work order): restart the interval from `doneAt` / `doneHours`. */
export function recordCompletion(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.PlanComplete, input ?? {});
  const db = a.wctx.db;
  const cur = getLive(db, 'plan', id);
  if (!cur) throw notFound('Plan', id);
  authorize(a, perm('plan', 'complete'), scopeOf(cur.home_scope_id));
  assertSiteHeldHere(a, cur.home_scope_id);
  checkMoment(b.doneAt);
  const patch: Row = { last_done_at: b.doneAt ?? nowUtc() };
  if (cur.trigger_kind === 'running_hours') {
    const hours = b.doneHours ?? currentMeterValue(db, cur.meter_id as string)?.cumulative;
    if (hours === undefined) throw blocked('The meter has no readings yet; give the hours at which the work was done', { meterId: cur.meter_id });
    patch.last_done_hours = hours;
  }
  return toApi(updateRecord(a.wctx, 'pm.plan', id, cur.version as number, patch));
}

// ------------------------------------------------------------------ generation

export interface GenerateResult {
  generated: Array<{ planId: string; planCode: string; workOrderId: string; woNo: string }>;
  skipped: Array<{ planId: string; planCode: string; reason: string }>;
}
const dueKey = (d: Row): string => (d.trigger_kind === 'calendar' ? String(d.due_at) : String(round2(d.due_hours as number)));

/** Is this plan inside its lead time at the moment? (Same rule as the pm_v_due view, for one plan.) */
function dueNow(db: Db, planId: string): Row | undefined {
  return db.prepare(
    `SELECT d.*, CASE WHEN d.trigger_kind = 'calendar' THEN d.due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || d.lead_days || ' days') ELSE d.remaining_hours <= d.lead_hours END AS is_due
       FROM pm_v_plan_due d WHERE d.plan_id = ?`,
  ).get(planId) as Row | undefined;
}

/** Create the preventive work orders that are due (all active plans, or one). Safe to run repeatedly, online or offline. */
export function generateDue(a: Actor, input: unknown): GenerateResult {
  const { planId } = S.parse(S.Generate, input ?? {});
  const db = a.wctx.db;
  const plans = (planId ? [getLive(db, 'plan', planId)].filter(Boolean) : db.prepare("SELECT * FROM pm_plan WHERE deleted_at IS NULL AND status = 'active' ORDER BY code").all()) as Row[];
  if (planId && plans.length === 0) throw notFound('Plan', planId);
  const out: GenerateResult = { generated: [], skipped: [] };
  const skip = (p: Row, reason: string) => out.skipped.push({ planId: p.id as string, planCode: p.code as string, reason });
  for (const plan of plans) {
    try {
      authorize(a, perm('plan', 'generate'), scopeOf(plan.home_scope_id));
      assertSiteHeldHere(a, plan.home_scope_id);
      if (plan.status !== 'active') { skip(plan, 'The plan is suspended'); continue; }
      db.transaction(() => {
        let cur = plan;
        // A finished cycle restarts the interval from the day its work order was closed.
        if (cur.last_work_order_id && cur.last_rolled_wo_id !== cur.last_work_order_id) {
          const closedAt = workOrderClosedAt(db, cur.last_work_order_id as string);
          if (closedAt) {
            const hours = cur.meter_id ? currentMeterValue(db, cur.meter_id as string)?.cumulative : undefined;
            cur = updateRecord(a.wctx, 'pm.plan', cur.id as string, cur.version as number, { last_done_at: closedAt, ...(hours !== undefined ? { last_done_hours: hours } : {}), last_rolled_wo_id: cur.last_work_order_id });
          } else if (getWorkOrder(db, cur.last_work_order_id as string)) {
            skip(cur, 'The previous work order for this plan is still open'); return;
          }
        }
        const d = dueNow(db, cur.id as string);
        if (!d || d.is_due !== 1) { skip(cur, 'Not due yet'); return; }
        if (cur.trigger_kind === 'running_hours' && !currentMeterValue(db, cur.meter_id as string)) { skip(cur, 'The meter has no readings yet'); return; }
        const key = dueKey(d);
        if (cur.last_generated_key === key) { skip(cur, 'A work order was already created for this due point'); return; }

        const tpl = cur.template_id ? getLive(db, 'task_template', cur.template_id as string) : undefined;
        const checklist = tpl ? (JSON.parse(String(tpl.checklist_json)) as string[]) : [];
        const lines = [tpl?.description ? String(tpl.description) : '', ...(checklist.length ? ['Checklist:', ...checklist.map((c, i) => `${i + 1}. ${c}`)] : []), `Generated from plan ${String(cur.code)}.`].filter(Boolean);
        const dueOn = cur.trigger_kind === 'calendar' ? String(d.due_at).slice(0, 10) : null;
        const wo = createWorkOrder(a, {
          title: `${String(cur.title)} (${String(cur.code)})`, description: lines.join('\n').slice(0, 2000), workType: 'preventive', priority: cur.priority,
          ...(cur.asset_id ? { assetId: cur.asset_id } : { positionId: cur.position_id }), ...(cur.home_scope_id ? { shipId: cur.home_scope_id } : {}), ...(dueOn ? { requestedDue: dueOn } : {}),
        });
        updateRecord(a.wctx, 'pm.plan', cur.id as string, cur.version as number, { last_generated_key: key, last_work_order_id: wo.id });
        out.generated.push({ planId: cur.id as string, planCode: cur.code as string, workOrderId: wo.id as string, woNo: wo.woNo as string });
      })();
    } catch (e) {
      if (e instanceof AppError) skip(plan, e.message);
      else throw e;
    }
  }
  return out;
}

// ------------------------------------------------------------------ calibration

export function recordCalibration(a: Actor, input: unknown): Row {
  const b = S.parse(S.Calibration, input);
  const asset = requireAsset(a.wctx.db, b.assetId);
  authorize(a, perm('calibration', 'create'), scopeOf(asset.homeShipId));
  assertSiteHeldHere(a, asset.homeShipId);
  checkMoment(b.calibratedAt);
  if (b.result !== 'fail' && !b.nextDueOn) throw new AppError('VALIDATION_FAILED', 'Give the date the next calibration is due', { fields: ['nextDueOn'] });
  const doneOn = (b.calibratedAt ?? nowUtc()).slice(0, 10);
  if (b.nextDueOn && b.nextDueOn <= doneOn) throw new AppError('VALIDATION_FAILED', 'The next due date must be after the calibration date', { fields: ['nextDueOn'] });
  return toApi(appendEvent(a.wctx, 'pm.calibration_record', {
    home_scope_id: asset.homeShipId, asset_id: b.assetId, result: b.result, next_due_on: b.nextDueOn ?? null, certificate_no: b.certificateNo ?? null,
    calibrated_by: b.calibratedBy ?? null, note: b.note ?? null, ...(b.calibratedAt ? { occurred_at: b.calibratedAt } : {}),
  }));
}
export type { PmNoun };
