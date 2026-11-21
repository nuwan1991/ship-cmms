import { describe, expect, it } from 'vitest';
import { readXlsx } from '../../src/modules/m11-excel/xlsx.js';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { createCorrespondence } from '../../src/modules/m15-office/correspondence.js';
import { createEquipment, listEquipment, recordMovement } from '../../src/modules/m15-office/equipment.js';
import { bulkItems, createPacket } from '../../src/modules/m15-office/handover.js';
import { createPerson } from '../../src/modules/m15-office/persons.js';
import { dashboard, REPORTS, runReport } from '../../src/modules/m15-office/reports.js';
import { createUnit } from '../../src/modules/m15-office/service.js';
import { createDemand, listDemands } from '../../src/modules/m15-office/supply.js';
import { completeTask, createTask, listTasks } from '../../src/modules/m15-office/tasks.js';
import { createWorkOrder, listWorkOrders } from '../../src/modules/m15-office/workorders.js';
import { listCorrespondence } from '../../src/modules/m15-office/correspondence.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();

function seeded() {
  const env = makeOfcEnv({ devAuth: true });
  const a = env.hubActor();
  const C = env.commandId;
  const radar = createUnit(a, { commandId: C, level: 'department', code: 'RADAR', name: 'Radar', headUserId: 'u-po' }).id as string;
  const po = createPerson(a, { commandId: C, name: 'Perera', rank: 'PO', unitId: radar, userId: 'u-po' }).id as string;
  const tech = createPerson(a, { commandId: C, name: 'Fernando', unitId: radar }).id as string;
  createTask(a, { commandId: C, title: 'Late job', unitId: radar, assigneePersonId: tech, targetDate: addDays(today, -3), priority: 'high' });
  createTask(a, { commandId: C, title: 'Soon job', unitId: radar, assigneePersonId: tech, targetDate: addDays(today, 3) });
  createTask(a, { commandId: C, title: 'Urgent job', assigneePersonId: po, priority: 'immediate' });
  const done = createTask(a, { commandId: C, title: 'Done job', unitId: radar, assigneePersonId: po });
  completeTask(a, done.id as string, { expectedVersion: 1, note: 'finished' });
  createCorrespondence(a, { commandId: C, kind: 'incoming', subject: 'Late letter', replyRequired: true, replyDue: addDays(today, -1), actionUserId: po, officialRef: 'X/1' });
  createCorrespondence(a, { commandId: C, kind: 'incoming', subject: 'Fine letter', replyRequired: true, replyDue: addDays(today, 5) });
  const e = createEquipment(a, { commandId: C, name: 'Scope', receivedForRepair: true });
  recordMovement(a, e.id as string, { expectedVersion: 1, kind: 'repair_completed' });
  const lent = createEquipment(a, { commandId: C, name: 'Meter' });
  recordMovement(a, lent.id as string, { expectedVersion: 1, kind: 'issued', toText: 'Pump WS', expectedReturn: addDays(today, -1) });
  createWorkOrder(a, { commandId: C, title: 'WO late', unitId: radar, targetDate: addDays(today, -2) });
  createWorkOrder(a, { commandId: C, title: 'WO fresh' });
  createDemand(a, { commandId: C, item: 'Board', expectedDate: addDays(today, -1) });
  const p = createPacket(a, { commandId: C, appointment: 'SLE II North', fromName: 'A', toName: 'B' });
  bulkItems(a, p.id as string, { rows: [{ category: 'project', subject: 'P1', targetDate: addDays(today, -1) }, { category: 'project', subject: 'P2', status: 'completed' }], commit: true });
  return { env, a, C, radar, po, tech };
}

describe('M15 dashboard and reports', () => {
  it('every dashboard tile equals the count of the list it opens (AT-12, FR-D4)', () => {
    const { a, C } = seeded();
    const d = dashboard(a, { commandId: C });
    const n = Object.fromEntries(d.tiles.map((t) => [t.key, t.n]));
    expect(n.active_tasks).toBe(listTasks(a, { commandId: C, view: 'active' }).total);
    expect(n.overdue_tasks).toBe(listTasks(a, { commandId: C, view: 'overdue' }).total);
    expect(n.due_soon).toBe(listTasks(a, { commandId: C, view: 'due_soon' }).total);
    expect(n.attention).toBe(listTasks(a, { commandId: C, view: 'attention' }).total);
    expect(n.completed_period).toBe(listTasks(a, { commandId: C, view: 'done', from: d.period.from, to: d.period.to }).total);
    expect(n.outstanding_wo).toBe(listWorkOrders(a, { commandId: C, view: 'outstanding' }).total);
    expect(n.overdue_wo).toBe(listWorkOrders(a, { commandId: C, view: 'overdue' }).total);
    expect(n.pending_corr).toBe(listCorrespondence(a, { commandId: C, pending: 'true' }).total);
    expect(n.overdue_corr).toBe(listCorrespondence(a, { commandId: C, overdue: 'true' }).total);
    expect(n.equip_collection).toBe(listEquipment(a, { commandId: C, view: 'pending_collection' }).total);
    expect(n.equip_overdue).toBe(listEquipment(a, { commandId: C, view: 'overdue_return' }).total);
    expect(n.supply_overdue).toBe(listDemands(a, { commandId: C, view: 'overdue' }).total);
    expect(n).toMatchObject({ active_tasks: 3, overdue_tasks: 1, due_soon: 1, attention: 1, completed_period: 1, outstanding_wo: 2, overdue_wo: 1, pending_corr: 2, overdue_corr: 1, equip_collection: 1, equip_overdue: 1, supply_overdue: 1, handover_open: 1, handover_overdue: 1 });
    expect(d.people.find((p) => p.name === 'Fernando')).toMatchObject({ active: 2, overdue: 1, due_soon: 1 });
    expect(d.recent.map((r) => r.title)).toEqual(['Done job']);
  });

  it('produces all ten reports with reference numbers, responsible persons and remarks, and as Excel (AT-13)', async () => {
    const { env, a, C } = seeded();
    for (const code of REPORTS) {
      const r = runReport(a, code, { commandId: C });
      expect(r.title, code).toBeTruthy();
      expect(r.sections.length, code).toBeGreaterThan(0);
    }
    const daily = runReport(a, 'daily_outstanding', { commandId: C });
    const rows = daily.sections[0]!.rows;
    expect(rows[0]).toMatchObject({ type: 'Task', subject: 'Late job', overdue: 3, responsible: 'Fernando' });
    expect(rows.map((r) => r.type)).toEqual(expect.arrayContaining(['Task', 'Letter (reply)', 'Work order']));
    expect(runReport(a, 'overdue_tasks', { commandId: C }).sections[0]!.rows.map((r) => r.ref)).toEqual(['TSK-00001']);
    expect(runReport(a, 'pending_correspondence', { commandId: C }).sections[0]!.rows[0]).toMatchObject({ official: 'X/1', action: 'PO Perera', overdue: 1 });
    expect(runReport(a, 'handover_completion', { commandId: C }).sections[0]!.rows[0]).toMatchObject({ total: 2, done: 1, pct: 50, overdue: 1 });
    expect(runReport(a, 'equipment_pending', { commandId: C }).sections[0]!.rows).toHaveLength(2);
    expect(runReport(a, 'workshop_progress', { commandId: C }).sections[0]!.rows).toEqual(expect.arrayContaining([expect.objectContaining({ unit: 'RADAR', requested: 1 })]));
    expect(runReport(a, 'personnel_allocation', { commandId: C }).sections[0]!.rows.find((r) => r.name === 'PO Perera')).toMatchObject({ active: 1, awaiting: 1, completed: 1 });
    const monthly = runReport(a, 'monthly_summary', { commandId: C }).sections[0]!.rows;
    expect(monthly.find((r) => r.measure === 'Incoming registered')!.value).toBe(2);
    expect(() => runReport(a, 'nope', { commandId: C })).toThrow();
    expect(() => runReport(a, 'weekly_progress', { commandId: C, from: '2026-12-01', to: '2026-11-01' })).toThrow();

    const res = await env.app.inject({ method: 'GET', url: `/api/v1/office/reports/daily_outstanding/xlsx?commandId=${C}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/daily_outstanding-/);
    const sheets = readXlsx(new Uint8Array(res.rawPayload));
    expect(sheets[0]!.rows[0]![0]).toBe('SLE (E&T) II – North');
    expect(sheets[0]!.rows[6]).toEqual(expect.arrayContaining(['Ref no.', 'Responsible']));
    expect(sheets[0]!.rows.length).toBe(7 + rows.length);
  });
});
