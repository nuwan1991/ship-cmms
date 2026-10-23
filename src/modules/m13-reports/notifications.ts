import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { uuidv7 } from '../../platform/ids.js';
import { nowUtc } from '../../platform/time.js';
import { REPORTS, reportByCode, type Row } from './reports.js';

interface Alert { key: string; kind: string; severity: 'info' | 'warning' | 'critical'; title: string; body: string; refType: string | null; refId: string | null; shipId: string | null }

/** The conditions that raise a notification (fixed in R1). A condition that stays true keeps one open notification; when it clears, the notification resolves itself. */
function currentAlerts(ctx: AppContext): Alert[] {
  const out: Alert[] = [];
  const run = (code: string): Row[] => reportByCode(code).run(ctx, {});
  for (const r of run('backlog')) {
    if (r.overdue) out.push({ key: `wo_overdue:${r.id}`, kind: 'work_order_overdue', severity: r.priority === 'urgent' ? 'critical' : 'warning', title: `${r.woNo} is past its requested date`, body: `${r.title} (${r.shipName ?? 'no ship'}), requested ${String(r.requestedDue).slice(0, 10)}`, refType: 'wrk.work_order', refId: String(r.id), shipId: (r.shipId as string | null) ?? null });
  }
  for (const r of run('pending_reviews')) {
    if (Number(r.ageDays) >= 3) out.push({ key: `review:${r.what}:${r.id}`, kind: 'review_waiting', severity: 'warning', title: `${r.what} waiting ${r.ageDays} days`, body: `${r.reference}: ${r.title}`, refType: null, refId: String(r.id), shipId: (r.shipId as string | null) ?? null });
  }
  for (const r of run('maintenance_due')) {
    out.push({ key: `pm:${r.source}:${r.id}`, kind: r.state === 'overdue' ? 'maintenance_overdue' : 'maintenance_due', severity: r.state === 'overdue' ? 'warning' : 'info', title: `${r.title}${r.refCode ? ` (${r.refCode})` : ''} is ${r.state}`, body: `${r.assetTag ?? ''} ${r.assetName ?? ''}`.trim(), refType: r.source === 'plan' ? 'pm.plan' : 'ast.asset', refId: String(r.id), shipId: (r.shipId as string | null) ?? null });
  }
  for (const r of run('stock_below_minimum')) {
    out.push({ key: `stock:${r.partId}:${r.locationId}`, kind: 'stock_below_minimum', severity: 'warning', title: `${r.partNo} is below its minimum at ${r.locationCode}`, body: `Available ${r.available} ${r.unit ?? ''}, minimum ${r.minLevel}`, refType: 'stk.part', refId: String(r.partId), shipId: (r.siteId as string | null) ?? null });
  }
  for (const r of run('recurring_faults')) {
    out.push({ key: `recurring:${r.id}`, kind: 'recurring_fault', severity: 'info', title: `${r.assetTag ?? 'Equipment'} has failed ${r.occurrences} times in 90 days`, body: String(r.assetName ?? ''), refType: 'ast.asset', refId: String(r.id), shipId: (r.shipId as string | null) ?? null });
  }
  for (const r of run('sync_health')) {
    if (r.stale) out.push({ key: `sync_stale:${r.id}`, kind: 'sync_stale', severity: 'warning', title: `${r.code} has not synchronized${r.hoursSince === null ? ' yet' : ` for ${Math.round(Number(r.hoursSince) / 24)} days`}`, body: 'Its data may be out of date.', refType: null, refId: String(r.id), shipId: null });
    if (r.skewWarning) out.push({ key: `sync_skew:${r.id}`, kind: 'clock_skew', severity: 'warning', title: `${r.code} clock differs by ${r.skewSeconds} s`, body: 'Check the system clock on that installation.', refType: null, refId: String(r.id), shipId: null });
  }
  const conflicts = Number((ctx.db.prepare('SELECT open_conflicts AS n FROM syn_v_health').get() as Row).n ?? 0);
  if (conflicts > 0) out.push({ key: 'sync_conflicts', kind: 'sync_conflicts', severity: 'warning', title: `${conflicts} synchronization conflict${conflicts === 1 ? '' : 's'} need a decision`, body: 'Open Sync, then Conflicts.', refType: null, refId: null, shipId: null });
  void REPORTS;
  return out;
}

export function refreshNotifications(ctx: AppContext): { raised: number; resolved: number; open: number } {
  const now = nowUtc();
  return ctx.db.transaction(() => {
    const alerts = currentAlerts(ctx);
    const keys = new Set(alerts.map((a) => a.key));
    let raised = 0, resolved = 0;
    for (const a of alerts) {
      const cur = ctx.db.prepare('SELECT id, resolved_at FROM rpt_notification WHERE dedupe_key = ?').get(a.key) as { id: string; resolved_at: string | null } | undefined;
      if (!cur) {
        ctx.db.prepare('INSERT INTO rpt_notification (id, dedupe_key, kind, severity, title, body, ref_type, ref_id, ship_id, first_raised_at, last_raised_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv7(), a.key, a.kind, a.severity, a.title, a.body, a.refType, a.refId, a.shipId, now, now);
        raised++;
      } else {
        // A condition that came back after being resolved is a new occurrence: it is unacknowledged again.
        ctx.db.prepare(`UPDATE rpt_notification SET kind = ?, severity = ?, title = ?, body = ?, last_raised_at = ?,
            resolved_at = NULL, acknowledged_at = CASE WHEN resolved_at IS NULL THEN acknowledged_at ELSE NULL END, acknowledged_by = CASE WHEN resolved_at IS NULL THEN acknowledged_by ELSE NULL END,
            first_raised_at = CASE WHEN resolved_at IS NULL THEN first_raised_at ELSE ? END WHERE id = ?`).run(a.kind, a.severity, a.title, a.body, now, now, cur.id);
        if (cur.resolved_at) raised++;
      }
    }
    for (const r of ctx.db.prepare('SELECT id, dedupe_key FROM rpt_notification WHERE resolved_at IS NULL').all() as Array<{ id: string; dedupe_key: string }>) {
      if (!keys.has(r.dedupe_key)) { ctx.db.prepare('UPDATE rpt_notification SET resolved_at = ? WHERE id = ?').run(now, r.id); resolved++; }
    }
    return { raised, resolved, open: keys.size };
  })();
}

export function listNotifications(ctx: AppContext, q: { status?: 'open' | 'acknowledged' | 'resolved' | undefined; shipId?: string | undefined }): Row[] {
  const where: string[] = [], p: unknown[] = [];
  if (q.status === 'open') where.push('resolved_at IS NULL AND acknowledged_at IS NULL');
  if (q.status === 'acknowledged') where.push('resolved_at IS NULL AND acknowledged_at IS NOT NULL');
  if (q.status === 'resolved') where.push('resolved_at IS NOT NULL');
  if (q.shipId) { where.push('ship_id = ?'); p.push(q.shipId); }
  return (ctx.db.prepare(`SELECT * FROM rpt_notification ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (resolved_at IS NOT NULL), CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_raised_at DESC LIMIT 500`).all(...p) as Row[]);
}

export function acknowledge(ctx: AppContext, id: string, userId: string): Row {
  const r = ctx.db.prepare('SELECT * FROM rpt_notification WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'No such notification');
  if (!r.acknowledged_at) ctx.db.prepare('UPDATE rpt_notification SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?').run(nowUtc(), userId, id);
  return ctx.db.prepare('SELECT * FROM rpt_notification WHERE id = ?').get(id) as Row;
}
