import { describe, expect, it } from 'vitest';
import { changeProgress, closeWorkOrder } from '../../src/modules/m05-work/service.js';
import { getWorkOrder } from '../../src/modules/m05-work/index.js';
import { currentMeterValue, dueForAsset, PM_PERMISSIONS } from '../../src/modules/m06-planned-maintenance/index.js';
import {
  createMeter, createPlan, createTemplate, generateDue, recordCalibration, recordCompletion, recordReading, replaceMeter, tombstoneMeter, tombstonePlan,
  tombstoneTemplate, updateMeter, updatePlan,
} from '../../src/modules/m06-planned-maintenance/service.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { daysAgo, hoursAgo, makePmEnv } from './pm-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;

describe('registration', () => {
  it('registers cleanly with well-formed, unique permission codes', () => {
    const env = makePmEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('pm.meter_reading').recordClass).toBe('event');
    expect(env.ctx.entities.get('pm.plan').recordClass).toBe('owner_mutable');
    expect(env.ctx.entities.get('pm.task_template').recordClass).toBe('hub_reference');
    for (const p of PM_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(new Set(PM_PERMISSIONS).size).toBe(PM_PERMISSIONS.length);
  });
});

describe('meters and readings', () => {
  it('accumulates readings, refuses lower or out-of-order ones, and carries the total across a replaced dial', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const m = env.meter(env.pmAsset());
    expect(currentMeterValue(env.ctx.db, m)).toBeNull();
    recordReading(a, { meterId: m, reading: 1000, occurredAt: daysAgo(10) });
    recordReading(a, { meterId: m, reading: 1100.5, occurredAt: daysAgo(5) });
    expect(currentMeterValue(env.ctx.db, m)).toMatchObject({ reading: 1100.5, cumulative: 1100.5 });
    expect(codeOf(() => recordReading(a, { meterId: m, reading: 1050 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => recordReading(a, { meterId: m, reading: 1200, occurredAt: daysAgo(7) }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => recordReading(a, { meterId: m, reading: 1200, occurredAt: new Date(Date.now() + 3_600_000).toISOString() }))).toBe('VALIDATION_FAILED');
    replaceMeter(a, { meterId: m, startReading: 0, occurredAt: daysAgo(3) });
    expect(currentMeterValue(env.ctx.db, m)).toMatchObject({ reading: 0, cumulative: 1100.5 });
    recordReading(a, { meterId: m, reading: 40, occurredAt: daysAgo(1) });
    expect(currentMeterValue(env.ctx.db, m)).toMatchObject({ reading: 40, cumulative: 1140.5 });
  });

  it('keeps meter names unique per asset, blocks removal once read, and ignores inactive meters', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    const m = createMeter(a, { assetId: asset, name: 'Hours' });
    expect(codeOf(() => createMeter(a, { assetId: asset, name: 'Hours' }))).toBe('DUPLICATE');
    expect(createMeter(a, { assetId: env.pmAsset(), name: 'Hours' }).kind).toBe('running_hours');
    recordReading(a, { meterId: id(m), reading: 5 });
    expect(codeOf(() => tombstoneMeter(a, id(m), { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    updateMeter(a, id(m), { expectedVersion: 1, status: 'inactive' });
    expect(codeOf(() => recordReading(a, { meterId: id(m), reading: 6 }))).toBe('WORKFLOW_BLOCKED');
    const spare = createMeter(a, { assetId: asset, name: 'Spare' });
    expect(tombstoneMeter(a, id(spare), { expectedVersion: 1, reason: 'unused' }).deletedAt).toBeTruthy();
  });
});

describe('plans: validation', () => {
  it('needs exactly one target and the right interval fields, and a meter on the same asset', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset(), other = env.pmAsset();
    const base = { code: 'P1', title: 'Service' };
    expect(codeOf(() => createPlan(a, { ...base, triggerKind: 'calendar' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createPlan(a, { ...base, assetId: asset, triggerKind: 'calendar' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createPlan(a, { ...base, assetId: asset, positionId: asset, triggerKind: 'calendar', intervalDays: 30 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createPlan(a, { ...base, assetId: asset, triggerKind: 'running_hours', intervalHours: 100 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createPlan(a, { ...base, assetId: asset, triggerKind: 'running_hours', intervalHours: 100, meterId: env.meter(other) }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createPlan(a, { ...base, assetId: '019aaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa', triggerKind: 'calendar', intervalDays: 30 }))).toBe('DEPENDENCY_MISSING');
    const ok = createPlan(a, { ...base, assetId: asset, triggerKind: 'calendar', intervalDays: 30 });
    expect(ok).toMatchObject({ code: 'P1', homeScopeId: env.shipId, status: 'active' });
    expect(codeOf(() => createPlan(a, { ...base, assetId: asset, triggerKind: 'calendar', intervalDays: 30 }))).toBe('DUPLICATE');
    expect(codeOf(() => updatePlan(a, id(ok), { expectedVersion: 1, intervalHours: 5 }))).toBe('VALIDATION_FAILED');
    expect(updatePlan(a, id(ok), { expectedVersion: 1, intervalDays: 60 }).intervalDays).toBe(60);
  });
  it('blocks removing a task template or a meter that a plan still uses', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    const t = createTemplate(a, { code: 'T1', name: 'Check', checklist: ['a', 'b'] });
    const m = env.meter(asset);
    createPlan(a, { code: 'P1', title: 'Service', templateId: id(t), assetId: asset, triggerKind: 'running_hours', intervalHours: 100, meterId: m });
    expect(codeOf(() => tombstoneTemplate(a, id(t), { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneMeter(a, m, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
  });
});

describe('calendar plans generate preventive work orders', () => {
  it('creates one order when due, never twice, waits for it to close, then restarts the interval from its closure', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    const tpl = createTemplate(a, { code: 'T1', name: 'Quarterly', description: 'Routine check.', checklist: ['Insulation test', 'Grease bearings'] });
    const plan = createPlan(a, { code: 'PM-90', title: 'Quarterly inspection', templateId: id(tpl), assetId: asset, triggerKind: 'calendar', intervalDays: 90, leadDays: 7, startAt: daysAgo(85), priority: 'high' });

    const early = createPlan(a, { code: 'PM-EARLY', title: 'Not yet', assetId: asset, triggerKind: 'calendar', intervalDays: 365 });
    const first = generateDue(a, {});
    expect(first.generated).toHaveLength(1);
    expect(first.skipped).toEqual([{ planId: id(early), planCode: 'PM-EARLY', reason: 'Not due yet' }]);
    const wo = getWorkOrder(env.ctx.db, first.generated[0]!.workOrderId)!;
    expect(wo).toMatchObject({ workType: 'preventive', assetId: asset, shipId: env.shipId });
    expect(wo.title).toBe('Quarterly inspection (PM-90)');
    const row = sql(env, 'SELECT description, priority, requested_due FROM wrk_work_order WHERE id = ?', wo.id)[0]!;
    expect(row.description).toContain('1. Insulation test');
    expect(row).toMatchObject({ priority: 'high' });
    expect(row.requested_due).toBe(sql(env, 'SELECT substr(due_at, 1, 10) AS d FROM pm_v_plan_due WHERE plan_id = ?', id(plan))[0]!.d);

    // running it again changes nothing
    const again = generateDue(a, { planId: id(plan) });
    expect(again.generated).toEqual([]);
    expect(again.skipped[0]!.reason).toMatch(/still open|already created/);
    expect(sql(env, "SELECT COUNT(*) AS n FROM wrk_work_order WHERE work_type = 'preventive'")[0]!.n).toBe(1);

    // closing the order restarts the interval, so nothing is due any more
    changeProgress(env.asHub(), wo.id, { to: 'in_progress' });
    changeProgress(env.asHub(), wo.id, { to: 'work_complete' });
    closeWorkOrder(env.asHub(), wo.id, {});
    const after = generateDue(a, { planId: id(plan) });
    expect(after).toMatchObject({ generated: [], skipped: [{ reason: 'Not due yet' }] });
    const p = sql(env, 'SELECT last_done_at, last_rolled_wo_id FROM pm_plan WHERE id = ?', id(plan))[0]!;
    expect(p.last_rolled_wo_id).toBe(wo.id);
    expect(Date.now() - Date.parse(String(p.last_done_at))).toBeLessThan(60_000);
  });

  it('skips suspended plans, reports permission problems per plan, and stops a ship installation generating for another ship', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset(), other = env.pmAsset('Other', env.ship2Id);
    const p1 = createPlan(a, { code: 'A', title: 'A', assetId: asset, triggerKind: 'calendar', intervalDays: 10, startAt: daysAgo(30) });
    createPlan(a, { code: 'C', title: 'C', assetId: other, triggerKind: 'calendar', intervalDays: 10, startAt: daysAgo(30) });
    updatePlan(a, id(p1), { expectedVersion: 1, status: 'suspended' });
    const ship = env.shipActor(env.shipId);
    env.grantWork(ship.wctx.installation.installationId, 10);
    // the ship creates and owns its own plan; plans owned by the hub cannot be advanced from the ship
    createPlan(ship, { code: 'B', title: 'B', assetId: asset, triggerKind: 'calendar', intervalDays: 10, startAt: daysAgo(30) });
    const r = generateDue(ship, {});
    expect(r.generated.map((g) => g.planCode)).toEqual(['B']);
    expect(r.skipped.map((s) => s.planCode)).toEqual(['C']);
    expect(r.skipped[0]!.reason).toMatch(/different site/);
    expect(generateDue(env.hubActor(denyOnly('pm.plan.generate')), {}).generated).toEqual([]);
    expect(generateDue(env.hubActor(denyOnly('pm.plan.generate')), {}).skipped.every((s) => /no pm\.plan\.generate/.test(s.reason))).toBe(true);
  });

  it('reports an exhausted work-number range instead of failing the whole run', () => {
    const env = makePmEnv();
    env.ctx.db.prepare("UPDATE sys_number_range SET range_end = range_start WHERE sequence_code = 'work_order_no'").run();
    const a = env.hubActor();
    const asset = env.pmAsset();
    for (const c of ['A', 'B']) createPlan(a, { code: c, title: c, assetId: asset, triggerKind: 'calendar', intervalDays: 10, startAt: daysAgo(30) });
    const r = generateDue(a, {});
    expect(r.generated).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]!.reason).toMatch(/synchronize/);
  });
});

describe('running-hours plans', () => {
  it('counts from the hours at creation, is due inside the lead time, and restarts from the completion hours', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    const m = env.meter(asset);
    recordReading(a, { meterId: m, reading: 1000, occurredAt: hoursAgo(48) });
    const plan = createPlan(a, { code: 'H500', title: '500 h service', assetId: asset, triggerKind: 'running_hours', intervalHours: 500, meterId: m, leadHours: 50 });
    const due = () => sql(env, 'SELECT due_hours, remaining_hours FROM pm_v_plan_due WHERE plan_id = ?', id(plan))[0]!;
    expect(due()).toEqual({ due_hours: 1500, remaining_hours: 500 });
    expect(generateDue(a, {}).skipped[0]!.reason).toBe('Not due yet');
    recordReading(a, { meterId: m, reading: 1460, occurredAt: hoursAgo(1) });
    expect(due().remaining_hours).toBe(40);
    const g = generateDue(a, {});
    expect(g.generated).toHaveLength(1);
    expect(generateDue(a, {}).generated).toEqual([]);
    recordReading(a, { meterId: m, reading: 1510 });
    const done = recordCompletion(a, id(plan), { doneHours: 1505 });
    expect(done.lastDoneHours).toBe(1505);
    expect(due()).toEqual({ due_hours: 2005, remaining_hours: 495 });
  });

  it('will not generate before the meter has any reading, and completion without a reading needs hours', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    const m = env.meter(asset);
    const plan = createPlan(a, { code: 'H1', title: 'H', assetId: asset, triggerKind: 'running_hours', intervalHours: 10, meterId: m, leadHours: 10 });
    expect(generateDue(a, {}).skipped[0]!.reason).toMatch(/no readings|due yet|Not due/);
    expect(codeOf(() => recordCompletion(a, id(plan), {}))).toBe('WORKFLOW_BLOCKED');
    expect(recordCompletion(a, id(plan), { doneHours: 0 }).lastDoneHours).toBe(0);
  });
});

describe('calibration and the due list', () => {
  it('needs a next due date unless the instrument failed, and the latest record decides what is due', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    expect(codeOf(() => recordCalibration(a, { assetId: asset, result: 'pass' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => recordCalibration(a, { assetId: asset, result: 'pass', nextDueOn: '2020-01-01' }))).toBe('VALIDATION_FAILED');
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    recordCalibration(a, { assetId: asset, result: 'pass', nextDueOn: past, calibratedAt: daysAgo(375), certificateNo: 'C1' });
    expect(dueForAsset(env.ctx.db, asset)).toMatchObject([{ source: 'calibration', dueOn: past, overdue: true }]);
    recordCalibration(a, { assetId: asset, result: 'adjusted', nextDueOn: soon });
    expect(dueForAsset(env.ctx.db, asset)).toMatchObject([{ source: 'calibration', dueOn: soon, overdue: false, dueSoon: true }]);
    recordCalibration(a, { assetId: asset, result: 'fail' });
    expect(dueForAsset(env.ctx.db, asset)).toEqual([]);
  });

  it('lists plans and calibrations together with overdue and due-soon flags', () => {
    const env = makePmEnv();
    const a = env.hubActor();
    const asset = env.pmAsset();
    createPlan(a, { code: 'OVER', title: 'Overdue', assetId: asset, triggerKind: 'calendar', intervalDays: 30, startAt: daysAgo(40) });
    createPlan(a, { code: 'SOON', title: 'Soon', assetId: asset, triggerKind: 'calendar', intervalDays: 30, startAt: daysAgo(25), leadDays: 7 });
    createPlan(a, { code: 'LATER', title: 'Later', assetId: asset, triggerKind: 'calendar', intervalDays: 365 });
    const items = dueForAsset(env.ctx.db, asset);
    expect(items.map((i) => [i.title, i.overdue, i.dueSoon])).toEqual([['Overdue', true, true], ['Soon', false, true], ['Later', false, false]]);
    const suspended = sql(env, "SELECT id FROM pm_plan WHERE code = 'LATER'")[0]!.id as string;
    updatePlan(a, suspended, { expectedVersion: 1, status: 'suspended' });
    expect(dueForAsset(env.ctx.db, asset)).toHaveLength(2);
    tombstonePlan(a, id(sql(env, "SELECT * FROM pm_plan WHERE code = 'SOON'")[0] as Record<string, unknown>), { expectedVersion: 1, reason: 'retired' });
    expect(dueForAsset(env.ctx.db, asset)).toHaveLength(1);
  });

  it('keeps an append-only history', () => {
    const env = makePmEnv();
    const m = env.meter(env.pmAsset());
    const r = recordReading(env.hubActor(), { meterId: m, reading: 5 });
    expect(() => env.ctx.db.prepare('UPDATE pm_meter_reading SET reading = 9 WHERE id = ?').run(r.id)).toThrow();
    expect(() => env.ctx.db.prepare('DELETE FROM pm_meter_reading WHERE id = ?').run(r.id)).toThrow();
  });
});
