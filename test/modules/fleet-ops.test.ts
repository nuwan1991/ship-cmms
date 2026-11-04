import { describe, expect, it } from 'vitest';
import {
  createDeployment, currentShipStatuses, recordShipStatus, shipStatusAt, tombstoneDeployment, updateDeployment, voidShipStatus, ORG_PERMISSIONS,
} from '../../src/modules/m01-organization/index.js';
import { shipStatusHistory } from '../../src/modules/m01-organization/operations.js';
import { createEntity as createAst, createAsset } from '../../src/modules/m03-assets/service.js';
import { categoriseExistingDefects, ensureDefectCategories, findCategoryByCode, STANDARD_CATEGORIES, suggestCategory } from '../../src/modules/m05-work/index.js';
import { convertDefect, createWorkOrder, reportDefect, updateDefect } from '../../src/modules/m05-work/service.js';
import { createDefectCategory } from '../../src/modules/m05-work/categories.js';
import { fleetStatus, REPORTS, runReport } from '../../src/modules/m13-reports/index.js';
import { runIntegrity } from '../../src/modules/m14-operations/index.js';
import { register as m14 } from '../../src/modules/m14-operations/index.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { makeRptEnv } from './rpt-helpers.js';

const DAY = 86_400_000;
const ago = (d: number): string => new Date(Date.now() - d * DAY).toISOString();
const ahead = (d: number): string => new Date(Date.now() + d * DAY).toISOString();
const id = (r: Record<string, unknown>) => r.id as string;

describe('ship operational status (D66)', () => {
  it('registers status events and deployments with clean tables and permission codes', () => {
    const env = makeRptEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('org.ship_status_event').recordClass).toBe('event');
    expect(env.ctx.entities.get('org.deployment').recordClass).toBe('owner_mutable');
    expect(env.ctx.entities.get('wrk.defect_category').recordClass).toBe('hub_reference');
    for (const p of ['org.ship_status.record', 'org.ship_status.void', 'org.deployment.create']) expect(ORG_PERMISSIONS).toContain(p);
    for (const p of ORG_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
  });

  it('records periods that run until the next change, and shows the status in force now', () => {
    const env = makeRptEnv();
    const a = env.hubActor();
    expect(shipStatusAt(env.ctx.db, env.shipId)).toBeNull();
    recordShipStatus(a, env.shipId, { status: 'operational', effectiveFrom: ago(60) });
    recordShipStatus(a, env.shipId, { status: 'non_operational', effectiveFrom: ago(30), reason: 'Refit', authority: 'NHQ', opdefRef: 'OPDEF 12/26', opdefCategory: 'C3' });
    const now = shipStatusAt(env.ctx.db, env.shipId)!;
    expect(now).toMatchObject({ status: 'non_operational', reason: 'Refit', authority: 'NHQ', opdefRef: 'OPDEF 12/26', effectiveTo: null });
    expect(shipStatusAt(env.ctx.db, env.shipId, ago(45))).toMatchObject({ status: 'operational', effectiveTo: expect.any(String) });
    const cur = currentShipStatuses(env.ctx.db).find((s) => s.shipId === env.shipId)!;
    expect(cur).toMatchObject({ status: 'non_operational', shipName: 'Ship One' });
    expect(currentShipStatuses(env.ctx.db).find((s) => s.shipId === env.ship2Id)!.status).toBeNull();
  });

  it('needs a reason when not fully operational, refuses a repeat of the same status, and limits how far ahead', () => {
    const env = makeRptEnv();
    const a = env.hubActor();
    expect(codeOf(() => recordShipStatus(a, env.shipId, { status: 'semi_operational' }))).toBe('VALIDATION_FAILED');
    recordShipStatus(a, env.shipId, { status: 'operational', effectiveFrom: ago(5) });
    expect(codeOf(() => recordShipStatus(a, env.shipId, { status: 'operational' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => recordShipStatus(a, env.shipId, { status: 'non_operational', reason: 'Docking', effectiveFrom: ahead(200) }))).toBe('VALIDATION_FAILED');
    recordShipStatus(a, env.shipId, { status: 'non_operational', reason: 'Docking', effectiveFrom: ahead(10) }); // a planned docking
    expect(shipStatusAt(env.ctx.db, env.shipId)!.status).toBe('operational');
  });

  it('a mistaken entry is withdrawn by a void event; history keeps it', () => {
    const env = makeRptEnv();
    const a = env.hubActor();
    recordShipStatus(a, env.shipId, { status: 'operational', effectiveFrom: ago(10) });
    const wrong = recordShipStatus(a, env.shipId, { status: 'non_operational', reason: 'Wrong ship', effectiveFrom: ago(2) });
    expect(codeOf(() => voidShipStatus(a, id(wrong), { reason: '' }))).toBe('VALIDATION_FAILED');
    voidShipStatus(a, id(wrong), { reason: 'Entered against the wrong ship' });
    expect(shipStatusAt(env.ctx.db, env.shipId)!.status).toBe('operational');
    const h = shipStatusHistory(env.ctx.db, env.shipId);
    expect(h.periods).toHaveLength(1);
    expect(h.voided[0]).toMatchObject({ status: 'non_operational', voidReason: 'Entered against the wrong ship' });
    expect(codeOf(() => voidShipStatus(a, id(wrong), { reason: 'again' }))).toBe('WORKFLOW_BLOCKED');
    // Nothing was updated or deleted: both events and the void are still in the append-only table.
    expect(sql(env, 'SELECT COUNT(*) n FROM org_ship_status_event')[0]!.n).toBe(3);
  });

  it('who may record is a permission; a ship installation records only for its own ship', () => {
    const env = makeRptEnv();
    expect(codeOf(() => recordShipStatus(env.hubActor(denyOnly('org.ship_status.record')), env.shipId, { status: 'operational' }))).toBe('FORBIDDEN');
    const ship = env.shipActor(env.shipId);
    recordShipStatus(ship, env.shipId, { status: 'operational' });
    expect(codeOf(() => recordShipStatus(ship, env.ship2Id, { status: 'operational' }))).toBe('NOT_OWNER');
    expect(sql(env, 'SELECT owner_installation_id o, home_scope_id h FROM org_ship_status_event')[0]).toMatchObject({ o: ship.wctx.installation.installationId, h: env.shipId });
  });
});

describe('sea deployments (D66)', () => {
  it('creates, returns, refuses overlaps and is changed only where it was entered', () => {
    const env = makeRptEnv();
    const a = env.hubActor();
    const d = createDeployment(a, { shipId: env.shipId, name: 'Patrol North', area: 'North', sailedAt: ago(20) });
    expect(currentShipStatuses(env.ctx.db).find((s) => s.shipId === env.shipId)).toMatchObject({ deploymentName: 'Patrol North' });
    expect(codeOf(() => createDeployment(a, { shipId: env.shipId, name: 'Overlap', sailedAt: ago(5) }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createDeployment(a, { shipId: env.shipId, name: 'Bad', sailedAt: ago(5), returnedAt: ago(6) }))).toBe('VALIDATION_FAILED');
    const returnedAt = ago(2);
    expect(updateDeployment(a, id(d), { expectedVersion: 1, returnedAt })).toMatchObject({ returnedAt, version: 2 });
    expect(currentShipStatuses(env.ctx.db).find((s) => s.shipId === env.shipId)!.deploymentId).toBeNull();
    createDeployment(a, { shipId: env.shipId, name: 'Exercise', sailedAt: ago(1) });
    const ship = env.shipActor(env.shipId);
    expect(codeOf(() => updateDeployment(ship, id(d), { expectedVersion: 2, remarks: 'x' }))).toBe('NOT_OWNER');
    expect(codeOf(() => tombstoneDeployment(a, id(d), { expectedVersion: 1, reason: 'stale' }))).toBe('VERSION_CONFLICT');
    tombstoneDeployment(a, id(d), { expectedVersion: 2, reason: 'Entered twice' });
  });

  it('an overlap that arrives by replication is reported by the data checks', () => {
    const env = makeRptEnv();
    m14(env.ctx, env.app);
    createDeployment(env.hubActor(), { shipId: env.shipId, name: 'A', sailedAt: ago(10), returnedAt: ago(5) });
    createDeployment(env.shipActor(env.shipId), { shipId: env.shipId, name: 'B', sailedAt: ago(30), returnedAt: ago(20) });
    // As if two installations had entered the same voyage offline: replication brings both.
    env.ctx.db.prepare("UPDATE org_deployment SET sailed_at = ?, returned_at = ? WHERE name = 'B'").run(ago(8), ago(6));
    expect(runIntegrity(env.ctx, 'test').findings.find((f) => f.code === 'deployment_overlap')).toMatchObject({ count: 1 });
  });
});

describe('defect categories (D67)', () => {
  it('loads the standard list once, at the hub only', () => {
    const env = makeRptEnv();
    const total = STANDARD_CATEGORIES.reduce((n, m) => n + 1 + m.subs.length, 0);
    expect(ensureDefectCategories(env.hubActor().wctx)).toBe(total);
    expect(ensureDefectCategories(env.hubActor().wctx)).toBe(0);
    expect(codeOf(() => ensureDefectCategories(env.shipActor(env.shipId).wctx))).toBe('NOT_OWNER');
    expect(findCategoryByCode(env.ctx.db, 'ME-HULL')!.parent_id).toBe(findCategoryByCode(env.ctx.db, 'ME')!.id);
    expect(codeOf(() => createDefectCategory(env.hubActor(), { code: 'X', name: 'Too deep', parentId: findCategoryByCode(env.ctx.db, 'ME-HULL')!.id }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createDefectCategory(env.shipActor(env.shipId), { code: 'X', name: 'At a ship' }))).toBe('NOT_OWNER');
  });

  it('a defect takes its main category from a subcategory, refuses a mismatch, and must have one once the list exists', () => {
    const env = makeRptEnv();
    const a = env.asHub();
    // Before the list exists nothing is required (an installation that has not received it yet keeps working).
    expect(reportDefect(a, { title: 'Before', shipId: env.shipId }).categoryId).toBeNull();
    ensureDefectCategories(env.hubActor().wctx);
    const cat = (c: string) => findCategoryByCode(env.ctx.db, c)!.id as string;
    const d = reportDefect(a, { title: 'Hull crack', shipId: env.shipId, subcategoryId: cat('ME-HULL') });
    expect(d).toMatchObject({ categoryId: cat('ME'), subcategoryId: cat('ME-HULL') });
    expect(codeOf(() => reportDefect(a, { title: 'Mismatch', shipId: env.shipId, categoryId: cat('ELEC'), subcategoryId: cat('ME-HULL') }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => reportDefect(a, { title: 'Sub as main', shipId: env.shipId, categoryId: cat('ME-HULL') }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => reportDefect(a, { title: 'None', shipId: env.shipId }))).toBe('VALIDATION_FAILED');
  });

  it('suggests the main category from the department responsible for the equipment', () => {
    const env = makeRptEnv();
    ensureDefectCategories(env.hubActor().wctx);
    const h = env.hubActor();
    const sys = createAst(h, 'position', { shipId: env.shipId, positionTag: '3', name: 'Electrical system' });
    const alt = createAst(h, 'position', { shipId: env.shipId, parentId: id(sys), positionTag: '3.1', name: 'Alternator' });
    createAst(h, 'position_responsibility', { positionId: id(sys), departmentId: env.eeId, effectiveFrom: ago(400) });
    const asset = createAsset(h, { name: 'Alternator 1', homeShipId: env.shipId, positionId: id(alt) }).asset;
    expect(suggestCategory(env.ctx.db, { assetId: id(asset) })).toMatchObject({ code: 'ELEC', departmentCode: 'EE' });
    const d = reportDefect(env.asHub(), { title: 'Alternator noisy', assetId: id(asset) });
    expect(d.categoryId).toBe(findCategoryByCode(env.ctx.db, 'ELEC')!.id);
  });

  it('a converted defect can still be categorised but not re-worded; old defects are categorised in bulk', () => {
    const env = makeRptEnv();
    const a = env.asHub();
    const old = reportDefect(a, { title: 'Old', shipId: env.shipId });
    ensureDefectCategories(env.hubActor().wctx);
    const cat = (c: string) => findCategoryByCode(env.ctx.db, c)!.id as string;
    convertDefect(a, id(old), { expectedVersion: 1 });
    expect(codeOf(() => updateDefect(a, id(old), { expectedVersion: 2, title: 'New words' }))).toBe('WORKFLOW_BLOCKED');
    expect(updateDefect(a, id(old), { expectedVersion: 2, subcategoryId: cat('WPN-GUN') })).toMatchObject({ categoryId: cat('WPN'), subcategoryId: cat('WPN-GUN') });
    const other = reportDefect(a, { title: 'No equipment', shipId: env.shipId, categoryId: cat('ME') });
    expect(updateDefect(a, id(other), { expectedVersion: 1, categoryId: cat('ELEC') })).toMatchObject({ categoryId: cat('ELEC'), subcategoryId: null });
    const r = categoriseExistingDefects(a, { apply: false });
    expect(r).toMatchObject({ uncategorised: 0, matched: 0 });
  });
});

describe('fleet reports and dashboard (D68)', () => {
  function fleet() {
    const env = makeRptEnv();
    const a = env.hubActor();
    ensureDefectCategories(a.wctx);
    recordShipStatus(a, env.shipId, { status: 'operational', effectiveFrom: ago(60) });
    recordShipStatus(a, env.shipId, { status: 'non_operational', effectiveFrom: ago(30), reason: 'Refit' });
    recordShipStatus(a, env.ship2Id, { status: 'operational', effectiveFrom: ago(100) });
    createDeployment(a, { shipId: env.ship2Id, name: 'Patrol', sailedAt: ago(10) });
    const cat = (c: string) => findCategoryByCode(env.ctx.db, c)!.id as string;
    reportDefect(env.asHub(), { title: 'At sea fault', shipId: env.ship2Id, subcategoryId: cat('ELEC-GEN'), reportedAt: ago(3), severity: 'major' });
    reportDefect(env.asHub(), { title: 'Hull', shipId: env.shipId, subcategoryId: cat('ME-HULL'), reportedAt: ago(20), severity: 'critical' });
    reportDefect(env.asHub(), { title: 'Gun', shipId: env.shipId, categoryId: cat('WPN'), reportedAt: ago(1) });
    return { env, cat };
  }

  it('lists the fleet reports first and runs every report on an empty installation', () => {
    const env = makeRptEnv();
    expect(REPORTS.slice(0, 4).map((r) => r.code)).toEqual(['ship_status_history', 'availability', 'sea_deployments', 'defects_by_category']);
    for (const r of REPORTS) expect(() => runReport(env.ctx, r.code, {})).not.toThrow();
  });

  it('availability counts days per status in the window, and days at sea', () => {
    const { env } = fleet();
    const rows = runReport(env.ctx, 'availability', {}).rows;
    const one = rows.find((r) => r.shipId === env.shipId)!;
    expect(one).toMatchObject({ notRecordedDays: 30, operationalDays: 30, nonOperationalDays: 30, operationalPct: 33.3, currentStatus: 'Non-operational' });
    const two = rows.find((r) => r.shipId === env.ship2Id)!;
    expect(two).toMatchObject({ operationalPct: 100, seaDays: 10, deployments: 1 });
    // A chosen period: the last 30 days only (dates are whole days, so allow for part of today).
    const from = ago(29).slice(0, 10);
    const r30 = runReport(env.ctx, 'availability', { shipId: env.shipId, from }).rows[0]!;
    expect(Number(r30.nonOperationalDays)).toBeGreaterThanOrEqual(29);
    expect(r30.operationalDays).toBe(0);
    expect(codeOf(() => runReport(env.ctx, 'availability', { from: '2026-05-02', to: '2026-05-01' }))).toBe('VALIDATION_FAILED');
  });

  it('status history and deployments list the periods in the window', () => {
    const { env } = fleet();
    const h = runReport(env.ctx, 'ship_status_history', { shipId: env.shipId }).rows;
    expect(h.map((r) => r.statusLabel)).toEqual(['Non-operational', 'Operational']);
    expect(runReport(env.ctx, 'ship_status_history', { status: 'non_operational' }).rows).toHaveLength(1);
    const d = runReport(env.ctx, 'sea_deployments', {}).rows;
    expect(d[0]).toMatchObject({ name: 'Patrol', atSeaNow: true, totalDays: 10 });
  });

  it('defects by category groups by ship and category, counts open and reported while deployed', () => {
    const { env, cat } = fleet();
    const rows = runReport(env.ctx, 'defects_by_category', {}).rows;
    expect(rows.find((r) => r.categoryName === 'Electrical')).toMatchObject({ shipName: 'Ship Two', subcategoryName: 'Power generation', reported: 1, stillOpen: 1, major: 1, whileDeployed: 1 });
    expect(rows.find((r) => r.categoryName === 'Marine Engineering')).toMatchObject({ critical: 1, whileDeployed: 0 });
    expect(runReport(env.ctx, 'defects_by_category', { categoryId: cat('WPN') }).rows).toHaveLength(1);
    expect(runReport(env.ctx, 'defects_by_category', { from: ago(2).slice(0, 10) }).rows.map((r) => r.categoryName)).toEqual(['Weapon']);
  });

  it('fleet dashboard: counts, ship rows with timeline, open defects by category and recent changes', () => {
    const { env } = fleet();
    const f = fleetStatus(env.ctx) as Record<string, any>;
    expect(f.counts).toMatchObject({ ships: 2, operational: 1, nonOperational: 1, semiOperational: 0, atSea: 1, seaDays: 10, openDefects: 3, openDefectsWhileDeployed: 1 });
    expect(f.categories.map((c: any) => [c.code, c.open, c.color])).toEqual([['ELEC', 1, '#2F9E44'], ['ME', 1, '#7A1F2B'], ['WPN', 1, '#C9CDD2']]);
    const one = f.ships.find((s: any) => s.shipId === env.shipId);
    expect(one).toMatchObject({ status: 'non_operational', reason: 'Refit', daysInStatus: 30, deployment: null });
    expect(one.segments.map((g: any) => g.status)).toEqual(['operational', 'non_operational']);
    expect(Math.round(one.segments[0].offsetPct)).toBe(33);
    const two = f.ships.find((s: any) => s.shipId === env.ship2Id);
    expect(two.deployment).toMatchObject({ name: 'Patrol' });
    expect(two.deployments[0]).toMatchObject({ atSea: true });
    expect(f.recentChanges[0]).toMatchObject({ status: 'non_operational', shipName: 'Ship One' });
  });

  it('category filters reach the backlog through the repair case', () => {
    const { env, cat } = fleet();
    const d = sql(env, "SELECT id FROM wrk_defect WHERE title = 'Hull'")[0]!.id as string;
    convertDefect(env.asHub(), d, { expectedVersion: 1 });
    const caseId = sql(env, 'SELECT repair_case_id r FROM wrk_defect WHERE id = ?', d)[0]!.r as string;
    createWorkOrder(env.asHub(), { title: 'Weld plate', repairCaseId: caseId });
    createWorkOrder(env.asHub(), { title: 'Unrelated', shipId: env.shipId });
    expect(runReport(env.ctx, 'backlog', { categoryId: cat('ME') }).rows.map((r) => r.title)).toEqual(['Weld plate']);
    expect(runReport(env.ctx, 'backlog', { categoryId: 'none' }).rows.map((r) => r.title)).toEqual(['Unrelated']);
  });
});

describe('hub and ship installations exchange status, deployments and categories (D66, D67)', () => {
  it('the ship receives the category list and NHQ entries; the ship\'s own entries reach the hub', async () => {
    const { makeFleet, addShip, directTransport } = await import('./syn-helpers.js');
    const { syncOnce } = await import('../../src/modules/m10-sync/engine.js');
    const { register: m03 } = await import('../../src/modules/m03-assets/index.js');
    const { register: m05 } = await import('../../src/modules/m05-work/index.js');
    const { makeActor } = await import('../../src/modules/m01-organization/actor.js');
    const { allowAll } = await import('./org-helpers.js');
    const f = makeFleet();
    m03(f.hub.ctx, f.hub.app);
    m05(f.hub.ctx, f.hub.app);
    const { ship } = addShip(f.hub, 'SHIP-A', f.shipAId);
    m03(ship.ctx, ship.app);
    m05(ship.ctx, ship.app);
    const actor = (n: typeof ship) => ({ ...makeActor(n.ctx, { userId: 'tester', installationId: n.ctx.identity!.installationId, displayName: 'Tester' }), authz: allowAll });

    // NHQ at the hub: loads the categories, sets the ship non-operational and enters a deployment.
    const added = ensureDefectCategories(f.hub.wctx());
    recordShipStatus(actor(f.hub), f.shipAId, { status: 'non_operational', reason: 'Refit', authority: 'NHQ', effectiveFrom: ago(10) });
    createDeployment(actor(f.hub), { shipId: f.shipAId, name: 'Passage to dockyard', sailedAt: ago(20), returnedAt: ago(12) });
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(ship.rows('SELECT COUNT(*) n FROM wrk_defect_category')[0]!.n).toBe(added);
    expect(shipStatusAt(ship.ctx.db, f.shipAId)).toMatchObject({ status: 'non_operational', authority: 'NHQ' });
    expect(ship.rows('SELECT name FROM org_deployment')[0]!.name).toBe('Passage to dockyard');
    // The hub's deployment is read-only at the ship; the ship cannot change the category list.
    const depId = ship.rows('SELECT id FROM org_deployment')[0]!.id as string;
    expect(codeOf(() => updateDeployment(actor(ship), depId, { expectedVersion: 1, remarks: 'x' }))).toBe('NOT_OWNER');
    expect(codeOf(() => ensureDefectCategories(ship.wctx()))).toBe('NOT_OWNER');

    // During roll-out the ship itself records: back to operational, and sailing on patrol.
    recordShipStatus(actor(ship), f.shipAId, { status: 'operational', authority: 'Commanding officer' });
    createDeployment(actor(ship), { shipId: f.shipAId, name: 'Patrol', sailedAt: ago(1) });
    await syncOnce(ship.ctx, directTransport(f.hub));
    expect(shipStatusAt(f.hub.ctx.db, f.shipAId)).toMatchObject({ status: 'operational', authority: 'Commanding officer' });
    expect(f.hub.rows("SELECT owner_installation_id o FROM org_deployment WHERE name = 'Patrol'")[0]!.o).toBe(ship.ctx.identity!.installationId);
  });
});
