import { describe, expect, it } from 'vitest';
import { getWorkOrder } from '../../src/modules/m05-work/index.js';
import { currentDocking, DCK_PERMISSIONS, dockingDueForShip } from '../../src/modules/m16-docking/index.js';
import {
  addMonths, addWorkItem, cancelDocking, completeDocking, createDock, createDocking, dockIn, raiseWorkOrder, recordSurvey, tombstoneDock, tombstoneDocking,
  tombstoneWorkItem, undock, updateDock, updateDocking, updateWorkItem,
} from '../../src/modules/m16-docking/service.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, sql } from './ast-helpers.js';
import { day, daysAgo, makeDckEnv } from './dck-helpers.js';
import { denyOnly } from './org-helpers.js';

const v = (env: ReturnType<typeof makeDckEnv>, id: string): number => sql(env, 'SELECT version FROM dck_docking WHERE id = ?', id)[0]!.version as number;

describe('registration', () => {
  it('registers cleanly with well-formed, unique permission codes', () => {
    const env = makeDckEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('dck.dock').recordClass).toBe('hub_reference');
    expect(env.ctx.entities.get('dck.docking').recordClass).toBe('owner_mutable');
    expect(env.ctx.entities.get('dck.survey_record').recordClass).toBe('event');
    for (const p of DCK_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(new Set(DCK_PERMISSIONS).size).toBe(DCK_PERMISSIONS.length);
  });
});

describe('docks', () => {
  it('keeps codes unique, versions updates, and blocks removing a dock that dockings use', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const dk = createDock(a, { code: 'gd-1', name: 'Graving dock 1', kind: 'graving_dock', maxLengthM: 120 });
    expect(dk).toMatchObject({ code: 'GD-1', capacityShips: 1, status: 'active', maxLengthM: 120 });
    expect(codeOf(() => createDock(a, { code: 'GD-1', name: 'Again', kind: 'slipway' }))).toBe('DUPLICATE');
    expect(createDock(a, { code: 'FD', name: 'Floating', kind: 'floating_dock', maxBeamM: '18.5' }).maxBeamM).toBe(18.5);
    expect(codeOf(() => createDock(a, { code: 'FD2', name: 'Bad', kind: 'floating_dock', maxBeamM: 'wide' }))).toBe('VALIDATION_FAILED');
    expect(updateDock(a, dk.id as string, { expectedVersion: 1, capacityShips: 2 })).toMatchObject({ capacityShips: 2, version: 2 });
    expect(codeOf(() => updateDock(a, dk.id as string, { expectedVersion: 1, name: 'Stale' }))).toBe('VERSION_CONFLICT');
    env.docking({ dockId: dk.id });
    expect(codeOf(() => tombstoneDock(a, dk.id as string, { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    const spare = env.dock();
    expect(tombstoneDock(a, spare, { expectedVersion: 1, reason: 'Entered twice' }).deletedAt).toBeTruthy();
  });

  it('refuses a dock change without permission', () => {
    const env = makeDckEnv();
    expect(codeOf(() => createDock(env.hubActor(denyOnly('dck.dock.create')), { code: 'X', name: 'X', kind: 'slipway' }))).toBe('FORBIDDEN');
    expect(sql(env, "SELECT COUNT(*) AS n FROM sys_audit_event WHERE action = 'denied:dck.dock.create'")[0]!.n).toBe(1);
  });
});

describe('docking lifecycle', () => {
  it('runs planned → in dock → undocked → completed and sets when the ship is next due', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const dk = env.dock();
    expect(dockingDueForShip(env.ctx.db, env.shipId)).toMatchObject({ dueState: 'never', nextDueOn: null });
    const d = createDocking(a, { shipId: env.shipId, dockId: dk, reference: 'DO/2026/01', dockingType: 'routine', plannedDockIn: day(-3), plannedUndock: day(10) });
    expect(d).toMatchObject({ status: 'planned', shipCode: 'SH1', dockCode: 'DK-1', lateDockIn: true, itemsTotal: 0 });
    expect(dockingDueForShip(env.ctx.db, env.shipId)?.nextPlannedDockIn).toBe(day(-3));
    const id = d.dockingId as string;

    expect(dockIn(a, id, { expectedVersion: 1, dockedAt: daysAgo(2) })).toMatchObject({ status: 'in_dock', lateDockIn: false, daysInDock: 2 });
    expect(currentDocking(env.ctx.db, env.shipId)).toMatchObject({ dockingId: id, status: 'in_dock', dockId: dk });
    expect(dockingDueForShip(env.ctx.db, env.shipId)?.dueState).toBe('in_dock');
    expect(codeOf(() => undock(a, id, { expectedVersion: 2, undockedAt: daysAgo(3) }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => completeDocking(a, id, { expectedVersion: 2, intervalMonths: 24 }))).toBe('WORKFLOW_BLOCKED');
    const out = undock(a, id, { expectedVersion: 2, undockedAt: daysAgo(1) });
    expect(out).toMatchObject({ status: 'undocked', daysInDock: 1 });
    expect(codeOf(() => completeDocking(a, id, { expectedVersion: 3, nextDueOn: day(-5) }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => completeDocking(a, id, { expectedVersion: 3 }))).toBe('VALIDATION_FAILED');
    const done = completeDocking(a, id, { expectedVersion: 3, intervalMonths: 24 });
    const undockedOn = daysAgo(1).slice(0, 10);
    expect(done).toMatchObject({ status: 'completed', nextDueOn: addMonths(undockedOn, 24) });
    expect(currentDocking(env.ctx.db, env.shipId)).toBeNull();
    expect(dockingDueForShip(env.ctx.db, env.shipId)).toMatchObject({ dueState: 'ok', nextDueOn: addMonths(undockedOn, 24), currentDockingId: null });
    expect(codeOf(() => updateDocking(a, id, { expectedVersion: 4, purpose: 'late edit' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('marks a ship overdue or due soon from its last completed docking', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const dk = env.dock();
    const run = (shipId: string, nextDueOn: string) => {
      const id = createDocking(a, { shipId, dockId: dk, plannedDockIn: day(-30), plannedUndock: day(-20) }).dockingId as string;
      dockIn(a, id, { expectedVersion: 1, dockedAt: daysAgo(30) });
      undock(a, id, { expectedVersion: 2, undockedAt: daysAgo(20) });
      completeDocking(a, id, { expectedVersion: 3, nextDueOn });
    };
    run(env.shipId, day(30));
    expect(dockingDueForShip(env.ctx.db, env.shipId)?.dueState).toBe('due_soon');
    run(env.ship2Id, day(-10));
    expect(dockingDueForShip(env.ctx.db, env.ship2Id)?.dueState).toBe('overdue');
  });

  it('allows one ship per single dock, refuses a ship in two docks, and never two overlapping plans for one ship', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const dk = env.dock();
    const big = env.dock('FD-1', { kind: 'floating_dock', capacityShips: 2 });
    const one = env.docking({ dockId: dk });
    expect(codeOf(() => env.docking({ plannedDockIn: day(5), plannedUndock: day(30) }))).toBe('WORKFLOW_BLOCKED');
    const two = env.docking({ shipId: env.ship2Id, dockId: dk });
    const conflicts = sql(env, 'SELECT * FROM dck_v_dock_conflict WHERE docking_id = ?', one);
    expect(conflicts.map((c) => c.other_docking_id)).toEqual([two]);
    dockIn(a, one, { expectedVersion: 1 });
    expect(codeOf(() => dockIn(a, two, { expectedVersion: 1 }))).toBe('WORKFLOW_BLOCKED');
    expect(dockIn(a, two, { expectedVersion: 1, dockId: big }).status).toBe('in_dock');
    // A cancelled plan stops counting; removal is only for planned or cancelled dockings without a work list.
    const later = env.docking({ shipId: env.ship2Id, plannedDockIn: day(100), plannedUndock: day(110) });
    expect(codeOf(() => cancelDocking(a, one, { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(cancelDocking(a, later, { expectedVersion: 1, reason: 'Ship deployed' })).toMatchObject({ status: 'cancelled', cancelReason: 'Ship deployed' });
    expect(tombstoneDocking(a, later, { expectedVersion: 2, reason: 'Not needed' }).deletedAt).toBeTruthy();
    expect(codeOf(() => tombstoneDocking(a, one, { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('refuses dock-in without a dock, in the future, or into an inactive dock', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const id = env.docking();
    expect(codeOf(() => dockIn(a, id, { expectedVersion: 1 }))).toBe('VALIDATION_FAILED');
    const dk = env.dock();
    expect(codeOf(() => dockIn(a, id, { expectedVersion: 1, dockId: dk, dockedAt: new Date(Date.now() + 3_600_000).toISOString() }))).toBe('VALIDATION_FAILED');
    updateDock(a, dk, { expectedVersion: 1, status: 'inactive' });
    expect(codeOf(() => dockIn(a, id, { expectedVersion: 1, dockId: dk }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => createDocking(a, { shipId: env.shipId, plannedDockIn: day(10), plannedUndock: day(5) }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createDocking(a, { shipId: env.fleetId, plannedDockIn: day(10), plannedUndock: day(15) }))).toBe('DEPENDENCY_MISSING');
  });

  it('checks permissions at the ship and detects stale versions', () => {
    const env = makeDckEnv();
    const id = env.docking({ dockId: env.dock() });
    expect(codeOf(() => dockIn(env.hubActor(denyOnly('dck.docking.dock_in')), id, { expectedVersion: 1 }))).toBe('FORBIDDEN');
    updateDocking(env.hubActor(), id, { expectedVersion: 1, purpose: 'Routine hull cleaning' });
    expect(codeOf(() => dockIn(env.hubActor(), id, { expectedVersion: 1 }))).toBe('VERSION_CONFLICT');
    expect(codeOf(() => createDocking(env.hubActor(denyOnly('dck.docking.create')), { shipId: env.ship2Id, plannedDockIn: day(1), plannedUndock: day(2) }))).toBe('FORBIDDEN');
  });

  it('lets only the planning installation change a docking', () => {
    const env = makeDckEnv();
    const id = env.docking();
    expect(codeOf(() => updateDocking(env.shipActor(env.shipId), id, { expectedVersion: 1, purpose: 'from the ship' }))).toBe('NOT_OWNER');
  });
});

describe('work list and survey', () => {
  it('numbers items, raises one work order per item, and blocks completion while work is open', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const id = env.docking({ dockId: env.dock(), reference: 'DO-7' });
    const shaft = env.asset('Propeller shaft');
    const i1 = addWorkItem(a, id, { category: 'propulsion', title: 'Withdraw and inspect shaft', assetId: shaft });
    const i2 = addWorkItem(a, id, { category: 'painting', title: 'Underwater hull paint' });
    expect([i1.itemNo, i2.itemNo]).toEqual([1, 2]);
    expect(codeOf(() => addWorkItem(a, id, { category: 'hull', title: 'x', assetId: env.asset('Other', env.ship2Id) }))).toBe('VALIDATION_FAILED');

    const raised = raiseWorkOrder(a, i1.id as string, {});
    expect(raised).toMatchObject({ status: 'in_progress', workOrderId: expect.any(String), workOrderNo: expect.any(String) });
    const wo = getWorkOrder(env.ctx.db, raised.workOrderId as string);
    expect(wo).toMatchObject({ assetId: shaft, shipId: env.shipId });
    expect(codeOf(() => raiseWorkOrder(a, i1.id as string, {}))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneWorkItem(a, i1.id as string, { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');

    dockIn(a, id, { expectedVersion: 1, dockedAt: daysAgo(3) });
    expect(codeOf(() => recordSurvey(a, id, { area: 'propeller', condition: 'fair', finding: 'x', surveyedAt: daysAgo(5) }))).toBe('VALIDATION_FAILED');
    const s = recordSurvey(a, id, { area: 'propeller', condition: 'poor', finding: 'Cavitation on blade tips', measurement: '3 mm pitting', actionRequired: true });
    expect(s).toMatchObject({ area: 'propeller', actionRequired: true });
    undock(a, id, { expectedVersion: 2 });

    expect(codeOf(() => completeDocking(a, id, { expectedVersion: 3, intervalMonths: 18 }))).toBe('WORKFLOW_BLOCKED');
    const d1 = updateWorkItem(a, i1.id as string, { expectedVersion: 2, status: 'done' });
    expect(d1.completedAt).toBeTruthy();
    expect(updateWorkItem(a, i1.id as string, { expectedVersion: 3, status: 'in_progress' }).completedAt).toBeNull();
    updateWorkItem(a, i1.id as string, { expectedVersion: 4, status: 'done' });
    updateWorkItem(a, i2.id as string, { expectedVersion: 1, status: 'deferred', note: 'Next docking' });
    const view = sql(env, 'SELECT * FROM dck_v_docking WHERE docking_id = ?', id)[0]!;
    expect(view).toMatchObject({ items_total: 2, items_open: 0, items_done: 1, survey_count: 1 });
    expect(completeDocking(a, id, { expectedVersion: 3, intervalMonths: 18 }).status).toBe('completed');
    expect(codeOf(() => addWorkItem(a, id, { category: 'hull', title: 'Too late' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('only records a survey while the ship is in dock, and survey records are append-only', () => {
    const env = makeDckEnv();
    const a = env.hubActor();
    const id = env.docking({ dockId: env.dock() });
    expect(codeOf(() => recordSurvey(a, id, { area: 'anodes', condition: 'good', finding: 'ok' }))).toBe('WORKFLOW_BLOCKED');
    dockIn(a, id, { expectedVersion: 1 });
    const s = recordSurvey(a, id, { area: 'anodes', condition: 'good', finding: 'ok' });
    expect(() => env.ctx.db.prepare("UPDATE dck_survey_record SET finding = 'x' WHERE id = ?").run(s.id)).toThrow(/append-only/);
  });

  it('adds months clamped to the end of the month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-25', 24)).toBe('2028-11-25');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
});
