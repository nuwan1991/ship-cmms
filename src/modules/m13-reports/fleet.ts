/**
 * Fleet operational reports (D68): status history, availability, sea deployments, defects by category, and the fleet dashboard.
 * Reads only published views: org_v_ship_status_current / _period, org_v_deployment, wrk_v_defect_overview, wrk_v_defect_category.
 * Periods are clipped to the requested window; days are calendar time (24 h), shown with one decimal.
 */
import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { localFreshness } from './freshness.js';
import type { Filters, ReportDef, Row } from './reports.js';

const DAY = 86_400_000;
export const STATUS_LABEL: Record<string, string> = { operational: 'Operational', semi_operational: 'Semi-operational', non_operational: 'Non-operational' };
const all = (ctx: AppContext, sql: string, ...p: unknown[]): Row[] => ctx.db.prepare(sql).all(...p) as Row[];
const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const ms = (iso: unknown): number => Date.parse(String(iso));

export interface Window { from: string; to: string; fromMs: number; toMs: number; days: number }

/** The reporting window: `from`/`to` are calendar dates (whole days, UTC); the default is the last 90 days up to now. */
export function windowOf(f: Pick<Filters, 'from' | 'to'>, defaultDays = 90, now = Date.now()): Window {
  const toMs = f.to ? Date.parse(`${f.to}T00:00:00.000Z`) + DAY : now;
  const fromMs = f.from ? Date.parse(`${f.from}T00:00:00.000Z`) : toMs - defaultDays * DAY;
  if (!(toMs > fromMs)) throw new AppError('VALIDATION_FAILED', 'The end date must be on or after the start date');
  if (toMs - fromMs > 3660 * DAY) throw new AppError('VALIDATION_FAILED', 'Choose a period of at most ten years');
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), fromMs, toMs, days: (toMs - fromMs) / DAY };
}

/** Overlap of [a, b) (b null = open-ended) with [lo, hi), in ms. */
const overlap = (a: number, b: number | null, lo: number, hi: number): number => Math.max(0, Math.min(b ?? Infinity, hi) - Math.max(a, lo));

function shipsOf(ctx: AppContext, f: Filters): Row[] {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.shipId) { where.push('ship_id = ?'); p.push(f.shipId); }
  if (f.commandId) { where.push('command_id = ?'); p.push(f.commandId); }
  return all(ctx, `SELECT * FROM org_v_ship_status_current ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ship_name`, ...p);
}

function periodsIn(ctx: AppContext, shipIds: string[], w: Window): Row[] {
  if (shipIds.length === 0) return [];
  return all(ctx, `SELECT * FROM org_v_ship_status_period WHERE ship_id IN (${shipIds.map(() => '?').join(',')})
    AND effective_from < ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY ship_id, effective_from, event_id`, ...shipIds, w.to, w.from);
}

function deploymentsIn(ctx: AppContext, shipIds: string[], w: Window): Row[] {
  if (shipIds.length === 0) return [];
  return all(ctx, `SELECT * FROM org_v_deployment WHERE ship_id IN (${shipIds.map(() => '?').join(',')})
    AND sailed_at < ? AND (returned_at IS NULL OR returned_at > ?) ORDER BY ship_id, sailed_at`, ...shipIds, w.to, w.from);
}

interface ShipAvailability { op: number; semi: number; non: number; unknown: number; sea: number; deployments: number; span: number }

/** Days in each status and at sea for one ship inside the window, counted up to now (future planned changes are not availability). */
function availabilityOf(periods: Row[], deployments: Row[], w: Window, now = Date.now()): ShipAvailability {
  const hi = Math.min(w.toMs, now);
  const span = Math.max(0, hi - w.fromMs);
  const out: ShipAvailability = { op: 0, semi: 0, non: 0, unknown: 0, sea: 0, deployments: deployments.length, span: span / DAY };
  let known = 0;
  for (const p of periods) {
    const d = overlap(ms(p.effective_from), p.effective_to ? ms(p.effective_to) : null, w.fromMs, hi);
    known += d;
    if (p.status === 'operational') out.op += d;
    else if (p.status === 'semi_operational') out.semi += d;
    else out.non += d;
  }
  for (const d of deployments) out.sea += overlap(ms(d.sailed_at), d.returned_at ? ms(d.returned_at) : null, w.fromMs, hi);
  out.unknown = Math.max(0, span - known);
  for (const k of ['op', 'semi', 'non', 'unknown', 'sea'] as const) out[k] = out[k] / DAY;
  return out;
}

// ------------------------------------------------------------------ reports

const DATE_FILTERS = [{ key: 'from', label: 'From', kind: 'date' as const }, { key: 'to', label: 'To', kind: 'date' as const }];
const SHIP_FILTERS = [{ key: 'shipId', label: 'Ship', kind: 'ship' as const }, { key: 'commandId', label: 'Command', kind: 'command' as const }];

export const statusHistory: ReportDef = {
  code: 'ship_status_history', title: 'Operational status history', description: 'Every operational, semi-operational and non-operational period of each ship in the period (last 90 days unless dates are chosen).',
  columns: [
    { key: 'shipName', label: 'Ship' }, { key: 'pennantNo', label: 'Pennant' }, { key: 'commandName', label: 'Command' }, { key: 'statusLabel', label: 'Status' },
    { key: 'effectiveFrom', label: 'From', kind: 'datetime' }, { key: 'effectiveTo', label: 'To', kind: 'datetime' }, { key: 'daysInPeriod', label: 'Days in period', kind: 'number' },
    { key: 'reason', label: 'Reason' }, { key: 'authority', label: 'Set by' }, { key: 'opdefRef', label: 'OPDEF ref.' }, { key: 'opdefCategory', label: 'OPDEF cat.' },
  ],
  filters: [...SHIP_FILTERS, { key: 'status', label: 'Status', kind: 'select', options: Object.keys(STATUS_LABEL) }, ...DATE_FILTERS],
  run(ctx, f) {
    const w = windowOf(f);
    const ships = new Map(shipsOf(ctx, f).map((s) => [String(s.ship_id), s]));
    return periodsIn(ctx, [...ships.keys()], w)
      .filter((p) => !f.status || p.status === f.status)
      .map((p) => {
        const s = ships.get(String(p.ship_id))!;
        return {
          id: p.event_id, shipId: p.ship_id, shipName: s.ship_name, pennantNo: s.pennant_no, commandName: s.command_name, status: p.status, statusLabel: STATUS_LABEL[String(p.status)] ?? p.status,
          effectiveFrom: p.effective_from, effectiveTo: p.effective_to, daysInPeriod: round1(overlap(ms(p.effective_from), p.effective_to ? ms(p.effective_to) : null, w.fromMs, w.toMs) / DAY),
          reason: p.reason, authority: p.authority, opdefRef: p.opdef_ref, opdefCategory: p.opdef_category,
        };
      })
      .sort((a, b) => String(a.shipName).localeCompare(String(b.shipName)) || String(b.effectiveFrom).localeCompare(String(a.effectiveFrom)));
  },
};

export const availability: ReportDef = {
  code: 'availability', title: 'Operational availability summary', description: 'For each ship: days operational, semi-operational, non-operational and not recorded, the share of time operational, and days at sea (last 90 days unless dates are chosen).',
  columns: [
    { key: 'shipName', label: 'Ship' }, { key: 'pennantNo', label: 'Pennant' }, { key: 'commandName', label: 'Command' }, { key: 'currentStatus', label: 'Status now' },
    { key: 'operationalDays', label: 'Operational (days)', kind: 'number' }, { key: 'semiOperationalDays', label: 'Semi-op. (days)', kind: 'number' },
    { key: 'nonOperationalDays', label: 'Non-op. (days)', kind: 'number' }, { key: 'notRecordedDays', label: 'Not recorded (days)', kind: 'number' },
    { key: 'operationalPct', label: 'Operational %', kind: 'number' }, { key: 'semiOperationalPct', label: 'Semi-op. %', kind: 'number' }, { key: 'nonOperationalPct', label: 'Non-op. %', kind: 'number' },
    { key: 'seaDays', label: 'Days at sea', kind: 'number' }, { key: 'deployments', label: 'Deployments', kind: 'number' },
  ],
  filters: [...SHIP_FILTERS, ...DATE_FILTERS],
  run(ctx, f) {
    const w = windowOf(f);
    const ships = shipsOf(ctx, f);
    const ids = ships.map((s) => String(s.ship_id));
    const periods = periodsIn(ctx, ids, w);
    const deps = deploymentsIn(ctx, ids, w);
    return ships.map((s) => {
      const a = availabilityOf(periods.filter((p) => p.ship_id === s.ship_id), deps.filter((d) => d.ship_id === s.ship_id), w);
      return {
        id: s.ship_id, shipId: s.ship_id, shipName: s.ship_name, pennantNo: s.pennant_no, commandName: s.command_name, currentStatus: s.status ? STATUS_LABEL[String(s.status)] : 'Not recorded',
        operationalDays: round1(a.op), semiOperationalDays: round1(a.semi), nonOperationalDays: round1(a.non), notRecordedDays: round1(a.unknown),
        operationalPct: pct(a.op, a.span), semiOperationalPct: pct(a.semi, a.span), nonOperationalPct: pct(a.non, a.span), seaDays: round1(a.sea), deployments: a.deployments,
      };
    });
  },
};

export const deploymentReport: ReportDef = {
  code: 'sea_deployments', title: 'Sea deployments', description: 'Deployments at sea in the period with their length, and which ships are at sea now (last 90 days unless dates are chosen).',
  columns: [
    { key: 'shipName', label: 'Ship' }, { key: 'pennantNo', label: 'Pennant' }, { key: 'commandName', label: 'Command' }, { key: 'name', label: 'Deployment' }, { key: 'area', label: 'Area' },
    { key: 'sailedAt', label: 'Sailed', kind: 'datetime' }, { key: 'returnedAt', label: 'Returned', kind: 'datetime' }, { key: 'atSeaNow', label: 'At sea now', kind: 'flag' },
    { key: 'totalDays', label: 'Days at sea (total)', kind: 'number' }, { key: 'daysInPeriod', label: 'Days in period', kind: 'number' }, { key: 'remarks', label: 'Remarks' },
  ],
  filters: [...SHIP_FILTERS, ...DATE_FILTERS],
  run(ctx, f) {
    const w = windowOf(f);
    const now = Date.now();
    const ships = shipsOf(ctx, f);
    return deploymentsIn(ctx, ships.map((s) => String(s.ship_id)), w)
      .map((d) => {
        const end = d.returned_at ? ms(d.returned_at) : now;
        return {
          id: d.deployment_id, shipId: d.ship_id, shipName: d.ship_name, pennantNo: d.pennant_no, commandName: d.command_name, name: d.name, area: d.area, sailedAt: d.sailed_at, returnedAt: d.returned_at,
          atSeaNow: ms(d.sailed_at) <= now && (!d.returned_at || ms(d.returned_at) > now), totalDays: round1(Math.max(0, end - ms(d.sailed_at)) / DAY),
          daysInPeriod: round1(overlap(ms(d.sailed_at), d.returned_at ? ms(d.returned_at) : null, w.fromMs, Math.min(w.toMs, now)) / DAY), remarks: d.remarks,
        };
      })
      .sort((a, b) => String(b.sailedAt).localeCompare(String(a.sailedAt)));
  },
};

/** Defects joined with the deployment of their ship at the moment they were reported (if any). */
const DEFECT_SQL = `
  SELECT d.*, s.ship_name, s.pennant_no, s.command_id, s.command_name,
         EXISTS (SELECT 1 FROM org_v_deployment g WHERE g.ship_id = d.ship_id AND g.sailed_at <= d.reported_at AND (g.returned_at IS NULL OR g.returned_at > d.reported_at)) AS while_deployed
  FROM wrk_v_defect_overview d LEFT JOIN org_v_ship_status_current s ON s.ship_id = d.ship_id`;

export const defectsByCategory: ReportDef = {
  code: 'defects_by_category', title: 'Defects by category', description: 'Defects reported in the period, grouped by ship, category and subcategory, with how many are still open and how many were reported while deployed.',
  columns: [
    { key: 'shipName', label: 'Ship' }, { key: 'categoryName', label: 'Category' }, { key: 'subcategoryName', label: 'Subcategory' },
    { key: 'reported', label: 'Reported', kind: 'number' }, { key: 'stillOpen', label: 'Still open', kind: 'number' }, { key: 'critical', label: 'Critical', kind: 'number' },
    { key: 'major', label: 'Major', kind: 'number' }, { key: 'minor', label: 'Minor', kind: 'number' }, { key: 'whileDeployed', label: 'While deployed', kind: 'number' },
  ],
  filters: [...SHIP_FILTERS, { key: 'categoryId', label: 'Category', kind: 'category' }, { key: 'subcategoryId', label: 'Subcategory', kind: 'subcategory' }, { key: 'severity', label: 'Severity', kind: 'select', options: ['critical', 'major', 'minor'] }, ...DATE_FILTERS],
  run(ctx, f) {
    const w = windowOf(f);
    const where = ['d.reported_at >= ?', 'd.reported_at < ?'];
    const p: unknown[] = [w.from, w.to];
    if (f.shipId) { where.push('d.ship_id = ?'); p.push(f.shipId); }
    if (f.commandId) { where.push('s.command_id = ?'); p.push(f.commandId); }
    if (f.categoryId === 'none') where.push('d.category_id IS NULL');
    else if (f.categoryId) { where.push('d.category_id = ?'); p.push(f.categoryId); }
    if (f.subcategoryId) { where.push('d.subcategory_id = ?'); p.push(f.subcategoryId); }
    if (f.severity) { where.push('d.severity = ?'); p.push(f.severity); }
    const rows = all(ctx, `${DEFECT_SQL} WHERE ${where.join(' AND ')}`, ...p);
    const groups = new Map<string, Row>();
    for (const r of rows) {
      const k = `${String(r.ship_id)}|${String(r.category_id)}|${String(r.subcategory_id)}`;
      const g = groups.get(k) ?? {
        id: k, shipId: r.ship_id, shipName: r.ship_name ?? 'No ship', categoryId: r.category_id, categoryCode: r.category_code, categoryName: r.category_name ?? 'Uncategorised',
        categoryColor: r.category_color, subcategoryName: r.subcategory_name ?? '', reported: 0, stillOpen: 0, critical: 0, major: 0, minor: 0, whileDeployed: 0,
      };
      g.reported = Number(g.reported) + 1;
      if (r.is_open) g.stillOpen = Number(g.stillOpen) + 1;
      g[String(r.severity)] = Number(g[String(r.severity)] ?? 0) + 1;
      if (r.while_deployed) g.whileDeployed = Number(g.whileDeployed) + 1;
      groups.set(k, g);
    }
    return [...groups.values()].sort((a, b) => String(a.shipName).localeCompare(String(b.shipName)) || String(a.categoryName).localeCompare(String(b.categoryName)) || String(a.subcategoryName).localeCompare(String(b.subcategoryName)));
  },
};

export const FLEET_REPORTS: readonly ReportDef[] = [statusHistory, availability, deploymentReport, defectsByCategory];

// ------------------------------------------------------------------ fleet dashboard

export interface FleetStatusQuery { commandId?: string | undefined; days?: number | undefined }

/** Everything the fleet dashboard shows: counts, one row per ship with a timeline, open defects by category and recent changes. */
export function fleetStatus(ctx: AppContext, q: FleetStatusQuery = {}): Record<string, unknown> {
  const days = q.days ?? 90;
  const now = Date.now();
  const w = windowOf({}, days, now);
  const ships = shipsOf(ctx, { commandId: q.commandId });
  const ids = ships.map((s) => String(s.ship_id));
  const periods = periodsIn(ctx, ids, w);
  const deps = deploymentsIn(ctx, ids, w);
  const mains = all(ctx, "SELECT category_id, code, name, color FROM wrk_v_defect_category WHERE is_main = 1 AND status = 'active' ORDER BY sort_order, code");
  const open = ids.length
    ? all(ctx, `SELECT x.ship_id, x.category_id, COUNT(*) AS n, SUM(x.while_deployed) AS deployed FROM (${DEFECT_SQL} WHERE d.is_open = 1 AND d.ship_id IN (${ids.map(() => '?').join(',')})) x GROUP BY x.ship_id, x.category_id`, ...ids)
    : [];
  const pos = (t: number): number => Math.round(((Math.min(Math.max(t, w.fromMs), w.toMs) - w.fromMs) / (w.toMs - w.fromMs)) * 10000) / 100;

  let opDays = 0;
  let spanDays = 0;
  let seaDays = 0;
  const rows = ships.map((s) => {
    const sp = periods.filter((p) => p.ship_id === s.ship_id);
    const sd = deps.filter((d) => d.ship_id === s.ship_id);
    const a = availabilityOf(sp, sd, w, now);
    opDays += a.op;
    spanDays += a.span;
    seaDays += a.sea;
    const defects: Record<string, number> = {};
    for (const o of open.filter((x) => x.ship_id === s.ship_id)) defects[String(o.category_id ?? 'none')] = Number(o.n);
    return {
      shipId: s.ship_id, shipName: s.ship_name, pennantNo: s.pennant_no, commandId: s.command_id, commandName: s.command_name,
      status: s.status ?? null, since: s.status_since ?? null, daysInStatus: s.status_since ? Math.floor((now - ms(s.status_since)) / DAY) : null,
      reason: s.reason ?? null, authority: s.authority ?? null, opdefRef: s.opdef_ref ?? null, opdefCategory: s.opdef_category ?? null,
      deployment: s.deployment_id ? { id: s.deployment_id, name: s.deployment_name, area: s.deployment_area, sailedAt: s.sailed_at } : null,
      defects,
      segments: sp.map((p) => {
        const from = Math.max(ms(p.effective_from), w.fromMs);
        const to = Math.min(p.effective_to ? ms(p.effective_to) : w.toMs, w.toMs);
        return { status: p.status, from: new Date(from).toISOString(), to: new Date(to).toISOString(), offsetPct: pos(from), widthPct: Math.max(0, pos(to) - pos(from)), days: round1((to - from) / DAY), reason: p.reason };
      }).filter((g) => g.widthPct > 0),
      deployments: sd.map((d) => {
        const from = Math.max(ms(d.sailed_at), w.fromMs);
        const to = Math.min(d.returned_at ? ms(d.returned_at) : now, w.toMs);
        return { id: d.deployment_id, name: d.name, area: d.area, from: new Date(from).toISOString(), to: new Date(to).toISOString(), offsetPct: pos(from), widthPct: Math.max(0, pos(to) - pos(from)), days: round1((to - from) / DAY), atSea: !d.returned_at || ms(d.returned_at) > now };
      }).filter((g) => g.widthPct > 0),
      operationalPct: pct(a.op, a.span), semiOperationalPct: pct(a.semi, a.span), nonOperationalPct: pct(a.non, a.span), notRecordedPct: pct(a.unknown, a.span), seaDays: round1(a.sea),
    };
  });

  const byStatus = (st: string | null) => rows.filter((r) => r.status === st).length;
  const categories = [
    ...mains.map((m) => ({ categoryId: m.category_id, code: m.code, name: m.name, color: m.color, open: open.filter((o) => o.category_id === m.category_id).reduce((n, o) => n + Number(o.n), 0), whileDeployed: open.filter((o) => o.category_id === m.category_id).reduce((n, o) => n + Number(o.deployed ?? 0), 0) })),
  ];
  const uncategorised = open.filter((o) => o.category_id === null || !mains.some((m) => m.category_id === o.category_id));
  if (uncategorised.length) categories.push({ categoryId: null, code: 'NONE', name: 'Uncategorised', color: null, open: uncategorised.reduce((n, o) => n + Number(o.n), 0), whileDeployed: uncategorised.reduce((n, o) => n + Number(o.deployed ?? 0), 0) });

  const recent = ids.length
    ? all(ctx, `SELECT p.*, s.ship_name, s.pennant_no FROM org_v_ship_status_period p JOIN org_v_ship_status_current s ON s.ship_id = p.ship_id
        WHERE p.ship_id IN (${ids.map(() => '?').join(',')}) AND p.effective_from <= ? ORDER BY p.effective_from DESC, p.event_id DESC LIMIT 10`, ...ids, new Date(now).toISOString())
    : [];

  return {
    window: { from: w.from, to: w.to, days },
    counts: {
      ships: rows.length, operational: byStatus('operational'), semiOperational: byStatus('semi_operational'), nonOperational: byStatus('non_operational'), notRecorded: byStatus(null),
      atSea: rows.filter((r) => r.deployment).length, seaDays: round1(seaDays), availabilityPct: pct(opDays, spanDays),
      openDefects: categories.reduce((n, c) => n + c.open, 0), openDefectsWhileDeployed: categories.reduce((n, c) => n + c.whileDeployed, 0),
    },
    fleetSplit: (() => {
      const t = { op: 0, semi: 0, non: 0, unknown: 0 };
      for (const r of rows) { t.op += r.operationalPct; t.semi += r.semiOperationalPct; t.non += r.nonOperationalPct; t.unknown += r.notRecordedPct; }
      const n = rows.length || 1;
      return { operationalPct: round1(t.op / n), semiOperationalPct: round1(t.semi / n), nonOperationalPct: round1(t.non / n), notRecordedPct: round1(t.unknown / n) };
    })(),
    ships: rows,
    categories,
    recentChanges: recent.map((r) => ({ id: r.event_id, at: r.effective_from, shipId: r.ship_id, shipName: r.ship_name, pennantNo: r.pennant_no, status: r.status, reason: r.reason, authority: r.authority })),
    freshness: localFreshness(ctx),
    generatedAt: new Date(now).toISOString(),
  };
}
