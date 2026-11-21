import { describe, expect, it } from 'vitest';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { bulkDemands, createDemand, listDemands, setStage, setSupplyStages, updateDemand } from '../../src/modules/m15-office/supply.js';
import { createWorkOrder } from '../../src/modules/m15-office/workorders.js';
import { timelineOf } from '../../src/modules/m15-office/queries.js';
import { codeOf, sql } from './ast-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();

describe('M15 supply demands', () => {
  it('records stages with dates, links to a work order, and updates by Supply reference from a paste (FR-S1..S5)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    const wo = createWorkOrder(a, { commandId: C, title: 'Radar repair' });
    const d = createDemand(a, { commandId: C, supplyRef: 'LG/2026/551', item: 'Display PSU board', quantity: 1, workOrderId: wo.id, demandDate: addDays(today, -20), expectedDate: addDays(today, -1) });
    expect(d).toMatchObject({ ref_no: 'SUP-00001', stage: 'Demand raised', closed: 0 });
    expect(codeOf(() => createDemand(a, { commandId: C, supplyRef: 'LG/2026/551', item: 'x' }))).toBe('DUPLICATE');
    expect(listDemands(a, { commandId: C, view: 'overdue' }).total).toBe(1);
    expect(codeOf(() => setStage(a, d.id as string, { expectedVersion: 1, stage: 'Lost in space' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => updateDemand(a, d.id as string, { expectedVersion: 1, stage: 'Order placed' }))).toBe('VALIDATION_FAILED');
    const s1 = setStage(a, d.id as string, { expectedVersion: 1, stage: 'order placed', stageDate: addDays(today, -5), expectedDate: addDays(today, 10) });
    expect(s1).toMatchObject({ stage: 'Order placed', stage_date: addDays(today, -5) });
    expect(listDemands(a, { commandId: C }).items[0]!.daysInStage).toBe(5);
    expect(timelineOf(env.ctx.db, 'ofc.supply_demand', d.id as string).find((e) => e.field === 'stage')!.to_value).toBe('Order placed');

    const rows = [
      { supplyRef: 'LG/2026/551', item: 'Display PSU board', stage: 'Received at Supply', stageDate: today },
      { supplyRef: 'LG/2026/600', item: 'Cable gland 20mm', quantity: 12, stage: 'Under processing' },
      { item: 'Fuse 5A', stage: 'Bogus stage' },
    ];
    const preview = bulkDemands(a, { commandId: C, rows });
    expect(preview).toMatchObject({ committed: false, summary: { rows: 3, errors: 1, create: 1, update: 1 } });
    const done = bulkDemands(a, { commandId: C, rows: rows.slice(0, 2), commit: true });
    expect(done.committed).toBe(true);
    expect(sql(env, 'SELECT supply_ref, stage FROM ofc_supply_demand ORDER BY ref_no')).toEqual([
      { supply_ref: 'LG/2026/551', stage: 'Received at Supply' }, { supply_ref: 'LG/2026/600', stage: 'Under processing' },
    ]);
    // same paste again: nothing changes
    expect(bulkDemands(a, { commandId: C, rows: rows.slice(0, 2) }).summary).toMatchObject({ create: 0, update: 0, unchanged: 2 });
    const cur = sql(env, "SELECT * FROM ofc_supply_demand WHERE supply_ref = 'LG/2026/551'")[0]!;
    setStage(a, cur.id, { expectedVersion: cur.version, stage: 'Issued / collected' });
    expect(listDemands(a, { commandId: C, view: 'closed' }).total).toBe(1);

    setSupplyStages(a, C, { stages: ['Raised', 'With Supply', 'Issued'] });
    expect(codeOf(() => createDemand(a, { commandId: C, item: 'x', stage: 'Order placed' }))).toBe('VALIDATION_FAILED');
    expect(createDemand(a, { commandId: C, item: 'x' }).stage).toBe('Raised');
  });
});
