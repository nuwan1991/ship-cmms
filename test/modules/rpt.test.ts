import { describe, expect, it } from 'vitest';
import { createWorkOrder, requestReview } from '../../src/modules/m05-work/service.js';
import { setStockLevel } from '../../src/modules/m07-stores/service.js';
import { dashboard, listNotifications, refreshNotifications, REPORTS, runReport, toCsv } from '../../src/modules/m13-reports/index.js';
import { acknowledge } from '../../src/modules/m13-reports/notifications.js';
import { RPT_PERMISSIONS } from '../../src/modules/m13-reports/index.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { makeRptEnv } from './rpt-helpers.js';

const ymd = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

describe('M13 reports', () => {
  it('lists every report and runs each on an empty installation', () => {
    const env = makeRptEnv();
    expect(REPORTS.map((r) => r.code)).toEqual(['backlog', 'pending_reviews', 'maintenance_due', 'stock_below_minimum', 'recurring_faults', 'sync_health']);
    for (const r of REPORTS) {
      const out = runReport(env.ctx, r.code, {});
      expect(out.rows, r.code).toEqual(r.code === 'sync_health' ? [] : []);
      expect(out.freshness.stale).toBe(false); // the hub is authoritative
    }
    expect((dashboard(env.ctx).counts as Record<string, number>).openWorkOrders).toBe(0);
  });

  it('backlog shows open work orders with ship, age and overdue, and filters by ship and priority', () => {
    const env = makeRptEnv();
    createWorkOrder(env.asHub(), { title: 'Overhaul pump', shipId: env.shipId, priority: 'urgent', requestedDue: ymd(-3) });
    createWorkOrder(env.asHub(), { title: 'Paint rails', shipId: env.ship2Id, priority: 'low' });
    const all = runReport(env.ctx, 'backlog', {}).rows;
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ title: 'Overhaul pump', shipName: 'Ship One', overdue: true, priority: 'urgent' }); // most urgent first
    expect(runReport(env.ctx, 'backlog', { shipId: env.ship2Id }).rows.map((r) => r.title)).toEqual(['Paint rails']);
    expect(runReport(env.ctx, 'backlog', { priority: 'urgent' }).rows).toHaveLength(1);
    expect(runReport(env.ctx, 'backlog', { olderThanDays: 5 }).rows).toHaveLength(0);
    const d = dashboard(env.ctx);
    expect(d.counts).toMatchObject({ openWorkOrders: 2, overdueWorkOrders: 1, urgentWorkOrders: 1 });
    expect((d.byShip as Array<{ shipName: string; open: number }>).map((s) => s.shipName).sort()).toEqual(['Ship One', 'Ship Two']);
  });

  it('pending reviews lists work waiting for approval', () => {
    const env = makeRptEnv();
    const wo = createWorkOrder(env.asHub(), { title: 'Replace seal', shipId: env.shipId }).id as string;
    expect(runReport(env.ctx, 'pending_reviews', {}).rows).toHaveLength(0);
    requestReview(env.asHub(), wo, {});
    const rows = runReport(env.ctx, 'pending_reviews', {}).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ what: 'Approval', title: 'Replace seal', shipName: 'Ship One' });
  });

  it('stock below minimum and maintenance due come from the other modules\' views', () => {
    const env = makeRptEnv();
    setStockLevel(env.hubActor(), { partId: env.part('P-LOW'), locationId: env.loc('STORE-1'), minLevel: 5 });
    const low = runReport(env.ctx, 'stock_below_minimum', {}).rows;
    expect(low).toHaveLength(1);
    expect(low[0]).toMatchObject({ partNo: 'P-LOW', minLevel: 5, available: 0 });
  });

  it('sync health reports each peer, staleness and clock warnings', () => {
    const env = makeRptEnv();
    const id = crypto.randomUUID();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    env.ctx.db.prepare("INSERT INTO syn_peer (installation_id, role, kind, code, name, status, last_sync_at, last_skew_ms, created_at) VALUES (?, 'replica', 'ship', 'SHIP-X', 'Ship X', 'active', ?, 600000, ?)").run(id, old, old);
    const rows = runReport(env.ctx, 'sync_health', {}).rows;
    expect(rows[0]).toMatchObject({ code: 'SHIP-X', stale: true, skewWarning: true, skewSeconds: 600 });
    expect((dashboard(env.ctx).counts as Record<string, number>).staleInstallations).toBe(1);
  });

  it('a replica that never synchronized is stale; one that did is fresh', () => {
    const env = makeRptEnv();
    env.ctx.db.exec("UPDATE sys_local_identity SET kind = 'ship'");
    env.ctx.identity = { ...env.ctx.identity!, kind: 'ship' };
    env.ctx.db.prepare("INSERT INTO syn_peer (installation_id, role, kind, code, name, status, created_at) VALUES (?, 'hub', 'hub', 'HQ2', 'Hub', 'active', ?)").run(crypto.randomUUID(), new Date().toISOString());
    expect(runReport(env.ctx, 'backlog', {}).freshness).toMatchObject({ asOf: null, stale: true });
    env.ctx.db.prepare("UPDATE syn_peer SET last_sync_at = ? WHERE role = 'hub'").run(new Date().toISOString());
    expect(runReport(env.ctx, 'backlog', {}).freshness.stale).toBe(false);
  });

  it('CSV output carries a heading with data-as-of, quotes cells and neutralises formulas', () => {
    const csv = toCsv([{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], [{ a: '=1+1', b: 'x, "y"' }, { a: true, b: null }], { title: 'T', generatedAt: '2026-10-23T00:00:00.000Z', asOf: null, stale: true });
    expect(csv).toContain('# T');
    expect(csv).toContain('never synchronized (STALE)');
    expect(csv).toContain("'=1+1,\"x, \"\"y\"\"\"");
    expect(csv).toContain('yes,');
  });
});

describe('M13 notifications', () => {
  it('raises once per condition, keeps acknowledgement while it persists, resolves when it clears, and re-raises as new', () => {
    const env = makeRptEnv();
    const wo = createWorkOrder(env.asHub(), { title: 'Overhaul pump', shipId: env.shipId, priority: 'high', requestedDue: ymd(-2) }).id as string;
    const first = refreshNotifications(env.ctx);
    expect(first.raised).toBe(1);
    expect(refreshNotifications(env.ctx).raised).toBe(0); // idempotent
    const n = listNotifications(env.ctx, { status: 'open' });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'work_order_overdue', severity: 'warning' });
    acknowledge(env.ctx, n[0]!.id as string, 'admin');
    refreshNotifications(env.ctx);
    expect(listNotifications(env.ctx, { status: 'acknowledged' })).toHaveLength(1);
    // The date is moved out: the condition clears and the notification resolves.
    env.ctx.db.prepare('UPDATE wrk_work_order SET requested_due = ? WHERE id = ?').run(ymd(10), wo);
    expect(refreshNotifications(env.ctx).resolved).toBe(1);
    expect(listNotifications(env.ctx, { status: 'resolved' })).toHaveLength(1);
    env.ctx.db.prepare('UPDATE wrk_work_order SET requested_due = ? WHERE id = ?').run(ymd(-1), wo);
    expect(refreshNotifications(env.ctx).raised).toBe(1);
    expect(listNotifications(env.ctx, { status: 'open' })).toHaveLength(1); // unacknowledged again
  });

  it('raises sync conflict and stock notifications', () => {
    const env = makeRptEnv();
    setStockLevel(env.hubActor(), { partId: env.part('P-LOW'), locationId: env.loc('STORE-1'), minLevel: 5 });
    env.ctx.db.prepare(`INSERT INTO syn_conflict (id, change_id, code, detail, entity_type, entity_id, incoming_version, origin_installation_id, received_from_installation_id, change_json, detected_at)
      VALUES (?, ?, 'FORK', 'x', 'org.location', ?, 2, ?, ?, '{}', ?)`).run(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), new Date().toISOString());
    refreshNotifications(env.ctx);
    expect(listNotifications(env.ctx, {}).map((n) => n.kind).sort()).toEqual(['stock_below_minimum', 'sync_conflicts']);
  });

  it('only reads published views of other modules', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../../src/modules/m13-reports/', import.meta.url).pathname;
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(dir + f, 'utf8');
      for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+([a-z]{2,4}_[a-z_0-9]+)/g)) {
        const name = m[1]!;
        if (!/^[a-z]{2,4}_v_/.test(name) && !name.startsWith('rpt_')) bad.push(`${f}: ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('declares well-formed permission codes', () => {
    for (const p of RPT_PERMISSIONS) expect(PERMISSION_RE.test(p), p).toBe(true);
  });
});
