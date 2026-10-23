/**
 * The R1 reports. Each is a read-only query over published views (`<prefix>_v_*`) of other modules; nothing here reads another module's tables.
 * Dates are UTC instants or calendar dates as stored; the UI formats them for display.
 */
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { localFreshness, staleAfterMs } from './freshness.js';

export type Row = Record<string, unknown>;
export interface Column { key: string; label: string; kind?: 'text' | 'number' | 'date' | 'datetime' | 'flag' }
export interface ReportDef {
  code: string;
  title: string;
  description: string;
  columns: Column[];
  filters: Array<{ key: string; label: string; kind: 'ship' | 'text' | 'number' | 'select'; options?: string[] }>;
  run(ctx: AppContext, f: Filters): Row[];
}
export interface Filters { shipId?: string | undefined; workType?: string | undefined; priority?: string | undefined; olderThanDays?: number | undefined; basis?: string | undefined; source?: string | undefined }

export const FilterSchema = z.strictObject({
  shipId: z.uuid().optional(), workType: z.enum(['corrective', 'preventive', 'inspection', 'modification']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  olderThanDays: z.coerce.number().int().min(0).max(3650).optional(), source: z.enum(['plan', 'calibration']).optional(), format: z.enum(['csv']).optional(),
});

const PRIORITY_RANK = "CASE o.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END";
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const all = (ctx: AppContext, sql: string, ...p: unknown[]): Row[] => ctx.db.prepare(sql).all(...p) as Row[];
const flag = (v: unknown): boolean => v === 1 || v === true;

const backlog: ReportDef = {
  code: 'backlog', title: 'Maintenance backlog', description: 'Every work order not yet closed, oldest and most urgent first.',
  columns: [
    { key: 'woNo', label: 'Work order' }, { key: 'title', label: 'Title' }, { key: 'shipName', label: 'Ship' }, { key: 'assetTag', label: 'Equipment tag' }, { key: 'assetName', label: 'Equipment' },
    { key: 'workType', label: 'Type' }, { key: 'priority', label: 'Priority' }, { key: 'progress', label: 'Progress' }, { key: 'approval', label: 'Approval' }, { key: 'returnToService', label: 'Return to service' },
    { key: 'ageDays', label: 'Age (days)', kind: 'number' }, { key: 'requestedDue', label: 'Requested due', kind: 'date' }, { key: 'overdue', label: 'Overdue', kind: 'flag' }, { key: 'labourMinutes', label: 'Labour (min)', kind: 'number' },
  ],
  filters: [{ key: 'shipId', label: 'Ship', kind: 'ship' }, { key: 'workType', label: 'Type', kind: 'select', options: ['corrective', 'preventive', 'inspection', 'modification'] }, { key: 'priority', label: 'Priority', kind: 'select', options: ['urgent', 'high', 'normal', 'low'] }, { key: 'olderThanDays', label: 'Older than (days)', kind: 'number' }],
  run(ctx, f) {
    const where = ["o.closure <> 'closed'"], p: unknown[] = [];
    if (f.shipId) { where.push('o.ship_id = ?'); p.push(f.shipId); }
    if (f.workType) { where.push('o.work_type = ?'); p.push(f.workType); }
    if (f.priority) { where.push('o.priority = ?'); p.push(f.priority); }
    if (f.olderThanDays !== undefined) { where.push('julianday(\'now\') - julianday(o.created_at) >= ?'); p.push(f.olderThanDays); }
    return all(ctx, `
      SELECT o.work_order_id AS id, o.wo_no AS woNo, o.title, o.ship_id AS shipId, s.ship_name AS shipName, a.asset_tag AS assetTag, a.name AS assetName, o.work_type AS workType, o.priority,
             o.progress, o.approval, o.return_to_service AS returnToService, CAST(julianday('now') - julianday(o.created_at) AS INTEGER) AS ageDays, o.requested_due AS requestedDue,
             (o.requested_due IS NOT NULL AND substr(o.requested_due, 1, 10) < date('now')) AS overdue, o.labour_minutes AS labourMinutes
      FROM wrk_v_work_order_overview o
      LEFT JOIN org_v_ship_current_command s ON s.ship_id = o.ship_id
      LEFT JOIN ast_v_asset_overview a ON a.asset_id = o.asset_id
      WHERE ${where.join(' AND ')} ORDER BY ${PRIORITY_RANK}, o.created_at LIMIT 5000`, ...p).map((r) => ({ ...r, overdue: flag(r.overdue) }));
  },
};

const pendingReviews: ReportDef = {
  code: 'pending_reviews', title: 'Pending reviews and confirmations', description: 'Work waiting for a decision: approvals, return-to-service assessments, hand-overs and offline approvals awaiting confirmation.',
  columns: [{ key: 'what', label: 'Waiting for' }, { key: 'reference', label: 'Reference' }, { key: 'title', label: 'Title' }, { key: 'shipName', label: 'Ship' }, { key: 'since', label: 'Since', kind: 'datetime' }, { key: 'ageDays', label: 'Age (days)', kind: 'number' }],
  filters: [{ key: 'shipId', label: 'Ship', kind: 'ship' }],
  run(ctx, f) {
    const ship = f.shipId ? ' AND o.ship_id = ?' : '';
    const p = f.shipId ? [f.shipId] : [];
    const wo = (what: string, cond: string) => `SELECT '${what}' AS what, o.wo_no AS reference, o.title, o.ship_id AS shipId, s.ship_name AS shipName, o.created_at AS since, o.work_order_id AS id
      FROM wrk_v_work_order_overview o LEFT JOIN org_v_ship_current_command s ON s.ship_id = o.ship_id WHERE o.closure <> 'closed' AND ${cond}${ship}`;
    const rows: Row[] = [
      ...all(ctx, wo('Approval', "o.approval = 'pending_review'"), ...p),
      ...all(ctx, wo('Return-to-service assessment', "o.progress = 'work_complete' AND o.return_to_service = 'not_assessed'"), ...p),
      ...all(ctx, wo('Hand-over answer', 'o.handover_pending = 1'), ...p),
      ...(f.shipId ? [] : all(ctx, "SELECT 'Offline approval to confirm' AS what, gate_code AS reference, subject_type || ' ' || subject_id AS title, NULL AS shipId, NULL AS shipName, decided_at AS since, approval_id AS id FROM idn_v_approval_status WHERE needs_review = 1")),
    ];
    return rows.map((r): Row => ({ ...r, ageDays: Math.max(0, Math.floor((Date.now() - Date.parse(String(r.since))) / 86_400_000)) })).sort((a, b) => Date.parse(String(a.since)) - Date.parse(String(b.since)));
  },
};

const maintenanceDue: ReportDef = {
  code: 'maintenance_due', title: 'Planned maintenance and calibration due', description: 'Overdue and soon-due plans and calibrations, from the planned-maintenance due list.',
  columns: [{ key: 'source', label: 'Source' }, { key: 'refCode', label: 'Plan' }, { key: 'title', label: 'Title' }, { key: 'shipName', label: 'Ship' }, { key: 'assetTag', label: 'Equipment tag' }, { key: 'assetName', label: 'Equipment' }, { key: 'dueOn', label: 'Due', kind: 'date' }, { key: 'remainingHours', label: 'Hours left', kind: 'number' }, { key: 'state', label: 'State' }],
  filters: [{ key: 'shipId', label: 'Ship', kind: 'ship' }, { key: 'source', label: 'Source', kind: 'select', options: ['plan', 'calibration'] }],
  run(ctx, f) {
    const where = ['(d.overdue = 1 OR d.due_soon = 1)'], p: unknown[] = [];
    if (f.shipId) { where.push('d.ship_id = ?'); p.push(f.shipId); }
    if (f.source) { where.push('d.source = ?'); p.push(f.source); }
    return all(ctx, `
      SELECT d.ref_id AS id, d.source, d.ref_code AS refCode, d.title, d.ship_id AS shipId, s.ship_name AS shipName, a.asset_tag AS assetTag, a.name AS assetName, d.due_on AS dueOn, d.remaining_hours AS remainingHours,
             CASE WHEN d.overdue = 1 THEN 'overdue' ELSE 'due soon' END AS state, d.work_order_id AS workOrderId
      FROM pm_v_due d LEFT JOIN org_v_ship_current_command s ON s.ship_id = d.ship_id LEFT JOIN ast_v_asset_overview a ON a.asset_id = d.asset_id
      WHERE ${where.join(' AND ')} ORDER BY d.overdue DESC, d.due_on LIMIT 5000`, ...p);
  },
};

const stockLow: ReportDef = {
  code: 'stock_below_minimum', title: 'Stock below minimum', description: 'Parts whose available quantity is below the minimum level at a location.',
  columns: [{ key: 'partNo', label: 'Part' }, { key: 'partName', label: 'Name' }, { key: 'locationCode', label: 'Location' }, { key: 'onHand', label: 'On hand', kind: 'number' }, { key: 'reserved', label: 'Reserved', kind: 'number' }, { key: 'available', label: 'Available', kind: 'number' }, { key: 'minLevel', label: 'Minimum', kind: 'number' }, { key: 'unit', label: 'Unit' }],
  filters: [{ key: 'shipId', label: 'Site (ship)', kind: 'ship' }],
  run(ctx, f) {
    return all(ctx, `SELECT part_id AS partId, location_id AS locationId, part_no AS partNo, part_name AS partName, location_code AS locationCode, site_id AS siteId, on_hand AS onHand, reserved, available, min_level AS minLevel, unit
      FROM stk_v_stock WHERE below_minimum = 1 ${f.shipId ? 'AND site_id = ?' : ''} ORDER BY part_no LIMIT 5000`, ...(f.shipId ? [f.shipId] : []));
  },
};

const recurring: ReportDef = {
  code: 'recurring_faults', title: 'Recurring faults', description: 'Equipment with three or more defects or corrective jobs in the last 90 days.',
  columns: [{ key: 'assetTag', label: 'Equipment tag' }, { key: 'assetName', label: 'Equipment' }, { key: 'shipName', label: 'Ship' }, { key: 'occurrences', label: 'Occurrences', kind: 'number' }, { key: 'firstAt', label: 'First', kind: 'datetime' }, { key: 'lastAt', label: 'Last', kind: 'datetime' }],
  filters: [{ key: 'shipId', label: 'Ship', kind: 'ship' }],
  run(ctx, f) {
    return all(ctx, `SELECT r.asset_id AS id, a.asset_tag AS assetTag, a.name AS assetName, r.ship_id AS shipId, s.ship_name AS shipName, r.occurrences, r.first_at AS firstAt, r.last_at AS lastAt
      FROM wrk_v_recurring_faults r LEFT JOIN ast_v_asset_overview a ON a.asset_id = r.asset_id LEFT JOIN org_v_ship_current_command s ON s.ship_id = r.ship_id
      ${f.shipId ? 'WHERE r.ship_id = ?' : ''} ORDER BY r.occurrences DESC LIMIT 1000`, ...(f.shipId ? [f.shipId] : []));
  },
};

const syncHealth: ReportDef = {
  code: 'sync_health', title: 'Synchronization health', description: 'When each installation last exchanged data, clock differences, and changes waiting to be sent.',
  columns: [{ key: 'code', label: 'Installation' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }, { key: 'lastSyncAt', label: 'Last exchange', kind: 'datetime' }, { key: 'hoursSince', label: 'Hours ago', kind: 'number' }, { key: 'stale', label: 'Stale', kind: 'flag' }, { key: 'skewSeconds', label: 'Clock difference (s)', kind: 'number' }, { key: 'skewWarning', label: 'Clock warning', kind: 'flag' }, { key: 'pendingOutbound', label: 'Waiting to send', kind: 'number' }],
  filters: [],
  run(ctx) {
    return all(ctx, 'SELECT peer_installation_id AS id, code, name, kind, role, status, last_sync_at AS lastSyncAt, last_skew_ms AS skew, pending_outbound AS pendingOutbound FROM syn_v_peer_health ORDER BY role DESC, code')
      .filter((r) => r.status !== 'decommissioned')
      .map((r) => {
        const age = r.lastSyncAt ? Date.now() - Date.parse(String(r.lastSyncAt)) : null;
        const skew = r.skew === null || r.skew === undefined ? null : Number(r.skew);
        return { ...r, hoursSince: age === null ? null : Math.round(age / 360_000) / 10, stale: r.status === 'active' && (age === null || age > staleAfterMs(String(r.kind))), skewSeconds: skew === null ? null : Math.round(skew / 1000), skewWarning: skew !== null && Math.abs(skew) > 300_000 };
      });
  },
};

export const REPORTS: readonly ReportDef[] = [backlog, pendingReviews, maintenanceDue, stockLow, recurring, syncHealth];
export const reportByCode = (code: string): ReportDef => {
  const r = REPORTS.find((x) => x.code === code);
  if (!r) throw new AppError('NOT_FOUND', `No report ${code}`);
  return r;
};

export function runReport(ctx: AppContext, code: string, f: Filters): { report: Pick<ReportDef, 'code' | 'title' | 'description' | 'columns' | 'filters'>; rows: Row[]; generatedAt: string; freshness: ReturnType<typeof localFreshness> } {
  const def = reportByCode(code);
  const rows = def.run(ctx, f);
  return { report: { code: def.code, title: def.title, description: def.description, columns: def.columns, filters: def.filters }, rows, generatedAt: new Date().toISOString(), freshness: localFreshness(ctx) };
}

/** CSV with the same neutralisation as M11: a cell that would start a spreadsheet formula is prefixed with an apostrophe. */
export function toCsv(columns: Column[], rows: Row[], meta: { title: string; generatedAt: string; asOf: string | null; stale: boolean }): string {
  const esc = (v: unknown): string => {
    let s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = [`# ${meta.title}`, `# generated ${meta.generatedAt}; data as of ${meta.asOf ?? 'never synchronized'}${meta.stale ? ' (STALE)' : ''}`];
  return `﻿${[...head, columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n')}\r\n`;
}

export function dashboard(ctx: AppContext): Record<string, unknown> {
  const open = backlog.run(ctx, {});
  const byShip = new Map<string, { shipId: string | null; shipName: string; open: number; overdue: number; urgent: number }>();
  for (const r of open) {
    const k = String(r.shipId ?? '');
    const e = byShip.get(k) ?? { shipId: (r.shipId as string | null) ?? null, shipName: String(r.shipName ?? 'No ship'), open: 0, overdue: 0, urgent: 0 };
    e.open++; if (r.overdue) e.overdue++; if (r.priority === 'urgent' || r.priority === 'high') e.urgent++;
    byShip.set(k, e);
  }
  const due = maintenanceDue.run(ctx, {});
  const health = ctx.db.prepare('SELECT * FROM syn_v_health').get() as Row;
  const sync = syncHealth.run(ctx, {});
  return {
    counts: {
      openWorkOrders: open.length, overdueWorkOrders: open.filter((r) => r.overdue).length, urgentWorkOrders: open.filter((r) => r.priority === 'urgent').length,
      pendingReviews: pendingReviews.run(ctx, {}).length, maintenanceOverdue: due.filter((r) => r.state === 'overdue').length, maintenanceDueSoon: due.filter((r) => r.state === 'due soon').length,
      stockBelowMinimum: stockLow.run(ctx, {}).length, recurringFaults: recurring.run(ctx, {}).length,
      openConflicts: Number(health.open_conflicts ?? 0), staleInstallations: sync.filter((r) => r.stale).length,
    },
    byShip: [...byShip.values()].sort((a, b) => b.open - a.open),
    freshness: localFreshness(ctx),
    generatedAt: new Date().toISOString(),
  };
}
