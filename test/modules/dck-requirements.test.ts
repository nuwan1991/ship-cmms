import { describe, expect, it } from 'vitest';
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import {
  addRequirement, addShipReqItem, addTemplateItem, checklistOf, createReqTemplate, refreshChecklist, tombstoneReqTemplate, tombstoneRequirement, updateRequirement,
  updateTemplateItem,
} from '../../src/modules/m16-docking/requirements.js';
import { createDocking, dockIn, tombstoneDocking } from '../../src/modules/m16-docking/service.js';
import { codeOf, sql } from './ast-helpers.js';
import { day, makeDckEnv } from './dck-helpers.js';
import { denyOnly } from './org-helpers.js';

type Env = ReturnType<typeof makeDckEnv>;
const id = (r: Record<string, unknown>) => r.id as string;

/** A patrol-class ship, a support-class ship, a class template for patrol ships and a template for every ship. */
function setup(env: Env) {
  const a = env.hubActor();
  const patrol = id(createOrg(a, 'ship', { code: 'PC1', name: 'Patrol One', shipClass: 'Sayura Class' }));
  const support = id(createOrg(a, 'ship', { code: 'SP1', name: 'Support One', shipClass: 'Support class' }));
  const general = id(createReqTemplate(a, { code: 'ALL', name: 'Every ship' }));
  addTemplateItem(a, general, { category: 'safety', title: 'Gas-free certificate for tanks', leadDays: 2 });
  addTemplateItem(a, general, { category: 'services', title: 'Shore power arranged', mandatory: false, leadDays: 3 });
  const cls = id(createReqTemplate(a, { code: 'SAYURA', name: 'Sayura class docking', shipClass: 'sayura class ' }));
  addTemplateItem(a, cls, { category: 'documents', title: 'Docking plan and block arrangement issued', leadDays: 30, responsible: 'Dockmaster' });
  addTemplateItem(a, cls, { category: 'stores_fuel_ammunition', title: 'Ammunition landed', leadDays: 5 });
  return { a, patrol, support, general, cls };
}

describe('pre-docking checklist', () => {
  it('is built from the class template, the every-ship template and the ship’s own items, with due dates before docking', () => {
    const env = makeDckEnv();
    const { a, patrol, support } = setup(env);
    addShipReqItem(a, { shipId: patrol, category: 'ship_preparation', title: 'Remove sonar dome guard', leadDays: 1 });
    const d = createDocking(a, { shipId: patrol, plannedDockIn: day(40), plannedUndock: day(60) });
    const list = checklistOf(env.ctx.db, d.dockingId as string);
    expect(list.map((r) => [r.seq, r.source, r.title])).toEqual([
      [1, 'template', 'Docking plan and block arrangement issued'], [2, 'template', 'Ammunition landed'],
      [3, 'template', 'Gas-free certificate for tanks'], [4, 'template', 'Shore power arranged'], [5, 'ship', 'Remove sonar dome guard'],
    ]);
    expect(list[0]).toMatchObject({ dueOn: day(10), mandatory: true, status: 'pending', responsible: 'Dockmaster', overdue: false });
    expect(d).toMatchObject({ reqTotal: 5, reqPending: 5, reqMandatoryPending: 4 });
    // A ship of another class gets only the every-ship items.
    const other = createDocking(a, { shipId: support, plannedDockIn: day(40), plannedUndock: day(60) });
    expect(checklistOf(env.ctx.db, other.dockingId as string).map((r) => r.title)).toEqual(['Gas-free certificate for tanks', 'Shore power arranged']);
  });

  it('refreshes only new or re-activated source items, and skips inactive ones', () => {
    const env = makeDckEnv();
    const { a, patrol, cls } = setup(env);
    const extra = addTemplateItem(a, cls, { category: 'work_package', title: 'Dockyard work package agreed' });
    updateTemplateItem(a, id(extra), { expectedVersion: 1, status: 'inactive' });
    const dId = createDocking(a, { shipId: patrol, plannedDockIn: day(40), plannedUndock: day(60) }).dockingId as string;
    expect(checklistOf(env.ctx.db, dId)).toHaveLength(4);
    expect(refreshChecklist(a, dId).added).toBe(0);
    updateTemplateItem(a, id(extra), { expectedVersion: 2, status: 'active' });
    addShipReqItem(a, { shipId: patrol, category: 'other', title: 'Ship-specific item' });
    const r = refreshChecklist(a, dId);
    expect(r.added).toBe(2);
    expect(r.items.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(refreshChecklist(a, dId).added).toBe(0);
  });

  it('blocks dock-in while mandatory items are pending, unless someone allowed to waive gives a reason', () => {
    const env = makeDckEnv();
    const { a, patrol } = setup(env);
    const dock = env.dock();
    const dId = createDocking(a, { shipId: patrol, dockId: dock, plannedDockIn: day(-1), plannedUndock: day(20) }).dockingId as string;
    expect(codeOf(() => dockIn(a, dId, { expectedVersion: 1 }))).toBe('WORKFLOW_BLOCKED');
    const items = checklistOf(env.ctx.db, dId);
    expect(items.filter((r) => r.overdue).length).toBe(4);
    // Docking plan done, ammunition not applicable; the gas-free certificate (mandatory) stays pending.
    updateRequirement(a, items[0]!.requirementId as string, { expectedVersion: 1, status: 'done', reference: 'DY/123' });
    expect(codeOf(() => updateRequirement(a, items[1]!.requirementId as string, { expectedVersion: 1, status: 'not_applicable' }))).toBe('VALIDATION_FAILED');
    updateRequirement(a, items[1]!.requirementId as string, { expectedVersion: 1, status: 'not_applicable', note: 'No ammunition embarked' });
    expect(codeOf(() => dockIn(a, dId, { expectedVersion: 1 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => dockIn(env.hubActor(denyOnly('dck.requirement.waive')), dId, { expectedVersion: 1, requirementsWaiver: 'Emergency' }))).toBe('FORBIDDEN');
    const docked = dockIn(a, dId, { expectedVersion: 1, requirementsWaiver: 'Certificate on arrival' });
    expect(docked).toMatchObject({ status: 'in_dock', requirementsWaiver: '1 pending: Certificate on arrival' });
  });

  it('lets a fully ticked checklist dock in without a reason; done keeps a time; only one-off items can be removed', () => {
    const env = makeDckEnv();
    const { a, patrol } = setup(env);
    const dId = createDocking(a, { shipId: patrol, dockId: env.dock(), plannedDockIn: day(5), plannedUndock: day(20) }).dockingId as string;
    const own = addRequirement(a, dId, { category: 'other', title: 'Divers survey before docking', mandatory: true });
    expect(own).toMatchObject({ source: 'adhoc', seq: 5 });
    const items = checklistOf(env.ctx.db, dId);
    expect(codeOf(() => tombstoneRequirement(a, items[0]!.requirementId as string, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    for (const r of items) {
      const u = updateRequirement(a, r.requirementId as string, { expectedVersion: 1, status: 'done' });
      expect(u.completedAt).toBeTruthy();
    }
    expect(updateRequirement(a, own.id as string, { expectedVersion: 2, status: 'pending' }).completedAt).toBeNull();
    expect(tombstoneRequirement(a, own.id as string, { expectedVersion: 3, reason: 'Not needed' }).deletedAt).toBeTruthy();
    expect(dockIn(a, dId, { expectedVersion: 1 })).toMatchObject({ status: 'in_dock', requirementsWaiver: null });
    expect(codeOf(() => refreshChecklist(a, dId))).toBe('WORKFLOW_BLOCKED');
  });

  it('removes the checklist with a removed docking, and protects templates in use', () => {
    const env = makeDckEnv();
    const { a, patrol, general } = setup(env);
    const dId = createDocking(a, { shipId: patrol, plannedDockIn: day(5), plannedUndock: day(20) }).dockingId as string;
    tombstoneDocking(a, dId, { expectedVersion: 1, reason: 'Entered by mistake' });
    expect(sql(env, 'SELECT COUNT(*) AS n FROM dck_requirement WHERE docking_id = ? AND deleted_at IS NULL', dId)[0]!.n).toBe(0);
    expect(codeOf(() => tombstoneReqTemplate(a, general, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => createReqTemplate(a, { code: 'ALL', name: 'Duplicate' }))).toBe('DUPLICATE');
    expect(codeOf(() => createReqTemplate(env.hubActor(denyOnly('dck.req_template.create')), { code: 'X', name: 'X' }))).toBe('FORBIDDEN');
  });
});
