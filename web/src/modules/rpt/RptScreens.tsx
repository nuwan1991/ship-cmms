import { useEffect, useMemo, useState } from 'react';
import { api, apiDownload, qs, saveBlob, type Freshness, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';

const RPT = '/api/v1/reports';
const COUNTS = ['openWorkOrders', 'overdueWorkOrders', 'urgentWorkOrders', 'pendingReviews', 'maintenanceOverdue', 'maintenanceDueSoon', 'stockBelowMinimum', 'recurringFaults', 'openConflicts', 'staleInstallations'] as const;
const WARN = new Set(['overdueWorkOrders', 'urgentWorkOrders', 'maintenanceOverdue', 'stockBelowMinimum', 'openConflicts', 'staleInstallations']);

interface Dash { counts: Record<string, number>; byShip: Array<{ shipId: string | null; shipName: string; open: number; overdue: number; urgent: number }>; freshness: Freshness }

function AsOf({ f }: { f: Freshness | undefined }) {
  const { tz } = useSystem();
  if (!f) return null;
  if (!f.asOf) return <div className="banner warn" role="status">{t('rpt.never')}</div>;
  return <div className={`banner ${f.stale ? 'warn' : 'info'}`} role="status">{f.stale ? t('rpt.stale_data', { when: toLocalDisplay(f.asOf, tz) }) : t('rpt.asof', { when: toLocalDisplay(f.asOf, tz) })}</div>;
}

export function DashboardScreen() {
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { api<Dash>('GET', `${RPT}/dashboard`).then(setD, (e: Error) => setError(e)); }, []);
  return (
    <section>
      <div className="page-head"><h1>{t('rpt.title.dashboard')}</h1></div>
      <ErrorNotice error={error} />
      <AsOf f={d?.freshness} />
      {d ? (
        <>
          <ul className="tiles">
            {COUNTS.map((k) => (
              <li key={k} className={`tile${WARN.has(k) && (d.counts[k] ?? 0) > 0 ? ' warn' : ''}`}>
                <span className="n">{d.counts[k] ?? 0}</span><span className="l">{t(`rpt.count.${k}`)}</span>
              </li>
            ))}
          </ul>
          <h2>{t('rpt.by_ship')}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t('rpt.col.ship')}</th><th scope="col" className="num">{t('rpt.col.open')}</th><th scope="col" className="num">{t('rpt.col.overdue')}</th><th scope="col" className="num">{t('rpt.col.urgent')}</th></tr></thead>
            <tbody>
              {d.byShip.map((s) => <tr key={s.shipId ?? 'none'}><td>{s.shipName}</td><td className="num">{s.open}</td><td className="num">{s.overdue}</td><td className="num">{s.urgent}</td></tr>)}
              {d.byShip.length === 0 ? <tr><td colSpan={4} className="empty">{t('rpt.empty')}</td></tr> : null}
            </tbody>
          </table></div>
        </>
      ) : null}
    </section>
  );
}

interface Column { key: string; label: string; kind?: string }
interface FilterDef { key: string; label: string; kind: 'ship' | 'text' | 'number' | 'select'; options?: string[] }
interface ReportOut { report: { code: string; title: string; columns: Column[]; filters: FilterDef[] }; items: Array<Record<string, unknown>>; freshness: Freshness[] }

export function ReportsScreen() {
  const { tz } = useSystem();
  const catalogue = useList(`${RPT}/reports`);
  const ships = useList('/api/v1/org/ships', { limit: '500' });
  const [code, setCode] = useState('backlog');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [out, setOut] = useState<ReportOut | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const query = useMemo(() => qs(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '').map(([k, v]) => [k, v]))), [filters]);
  useEffect(() => {
    let live = true;
    api<ReportOut>('GET', `${RPT}/reports/${code}${query}`).then((r) => { if (live) { setOut(r); setError(null); } }, (e: Error) => live && setError(e));
    return () => { live = false; };
  }, [code, query]);
  const cell = (c: Column, v: unknown): string =>
    v === null || v === undefined ? '' : c.kind === 'flag' ? t(v ? 'rpt.yes' : 'rpt.no') : c.kind === 'datetime' ? toLocalDisplay(String(v), tz) : String(v);
  async function csv() {
    try { const f = await apiDownload(`${RPT}/reports/${code}/file${query}`); saveBlob(f.blob, f.fileName); setError(null); } catch (e) { setError(e as Error); }
  }
  return (
    <section>
      <div className="page-head">
        <h1>{t('rpt.title.reports')}</h1>
        <div className="tools">
          <select aria-label={t('rpt.title.reports')} value={code} onChange={(e) => { setCode(e.target.value); setFilters({}); setOut(null); }}>
            {catalogue.items.map((r) => <option key={String(r.code)} value={String(r.code)}>{t(`rpt.report.${String(r.code)}`)}</option>)}
          </select>
          {can('rpt.report.export') ? <button onClick={() => void csv()}>{t('rpt.act.csv')}</button> : null}
        </div>
      </div>
      {out ? (
        <div className="tools filters">
          {out.report.filters.map((f) => (
            <label key={f.key}>{t(`rpt.filter.${f.kind === 'ship' ? 'ship' : f.key}`)}
              {f.kind === 'ship' ? (
                <select value={filters[f.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}><option value="">{t('rpt.filter.any')}</option>{ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}</select>
              ) : f.kind === 'select' ? (
                <select value={filters[f.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}><option value="">{t('rpt.filter.any')}</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              ) : <input type="number" min={0} value={filters[f.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })} />}
            </label>
          ))}
        </div>
      ) : null}
      <ErrorNotice error={error} />
      <AsOf f={out?.freshness[0]} />
      {out ? (
        <>
          <p><small>{t('rpt.rows', { count: String(out.items.length) })}</small></p>
          <div className="table-wrap"><table>
            <thead><tr>{out.report.columns.map((c) => <th key={c.key} scope="col" className={c.kind === 'number' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
            <tbody>
              {out.items.map((r, i) => <tr key={String(r.id ?? i)}>{out.report.columns.map((c) => <td key={c.key} className={c.kind === 'number' ? 'num' : undefined}>{cell(c, r[c.key])}</td>)}</tr>)}
              {out.items.length === 0 ? <tr><td colSpan={out.report.columns.length} className="empty">{t('rpt.empty')}</td></tr> : null}
            </tbody>
          </table></div>
        </>
      ) : null}
    </section>
  );
}

export function NotificationsScreen() {
  const { tz } = useSystem();
  const [state, setState] = useState('open');
  const list = useList(`${RPT}/notifications`, { status: state || undefined });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  async function refresh() {
    try { const r = await api<{ raised: number; resolved: number }>('POST', `${RPT}/notifications/refresh`, {}); setNotice(t('rpt.n.refreshed', { raised: String(r.raised), resolved: String(r.resolved) })); setError(null); list.reload(); } catch (e) { setError(e as Error); }
  }
  useEffect(() => { if (can('rpt.notification.refresh')) void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  async function ack(n: Rec) { try { await api('POST', `${RPT}/notifications/${n.id}/acknowledge`, {}); list.reload(); } catch (e) { setError(e as Error); } }
  return (
    <section>
      <div className="page-head">
        <h1>{t('rpt.title.notifications')}</h1>
        <div className="tools">
          <select aria-label={t('rpt.title.notifications')} value={state} onChange={(e) => setState(e.target.value)}>
            {['open', 'acknowledged', 'resolved', ''].map((s) => <option key={s} value={s}>{s ? t(`rpt.n.status.${s}`) : '—'}</option>)}
          </select>
          {can('rpt.notification.refresh') ? <button onClick={() => void refresh()}>{t('rpt.act.refresh')}</button> : null}
        </div>
      </div>
      <ErrorNotice error={list.error ?? error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      <ul className="notifications">
        {list.items.map((n) => (
          <li key={n.id} className={`note ${String(n.severity)}`}>
            <div><span className={`chip ${n.severity === 'info' ? 'muted' : 'warn'}`}>{t(`rpt.severity.${String(n.severity)}`)}</span> <strong>{String(n.title)}</strong></div>
            {n.body ? <div>{String(n.body)}</div> : null}
            <small>{toLocalDisplay(String(n.lastRaisedAt), tz)}</small>
            {!n.acknowledgedAt && !n.resolvedAt && can('rpt.notification.acknowledge') ? <button onClick={() => void ack(n)}>{t('rpt.act.ack')}</button> : null}
          </li>
        ))}
        {!list.loading && list.items.length === 0 ? <li className="empty">{t('rpt.n.empty')}</li> : null}
      </ul>
      <FreshnessBanner freshness={list.freshness} />
    </section>
  );
}
