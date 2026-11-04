import { useEffect, useState } from 'react';
import { api, qs, type Freshness } from '../../platform/api';
import { categoryStyle, swatchStyle } from '../../platform/colors';
import { t } from '../../platform/i18n';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice } from '../../platform/ui';
import { useList } from '../../platform/useList';

const RPT = '/api/v1/reports';

interface Segment { status: string; from: string; to: string; offsetPct: number; widthPct: number; days: number; reason: string | null }
interface DepBar { id: string; name: string; area: string | null; from: string; to: string; offsetPct: number; widthPct: number; days: number; atSea: boolean }
interface ShipRow {
  shipId: string; shipName: string; pennantNo: string | null; commandName: string | null; status: string | null; since: string | null; daysInStatus: number | null;
  reason: string | null; authority: string | null; opdefRef: string | null; opdefCategory: string | null;
  deployment: { id: string; name: string; area: string | null; sailedAt: string } | null; defects: Record<string, number>;
  segments: Segment[]; deployments: DepBar[]; operationalPct: number; semiOperationalPct: number; nonOperationalPct: number; notRecordedPct: number; seaDays: number;
}
interface Category { categoryId: string | null; code: string; name: string; color: string | null; open: number; whileDeployed: number }
interface Fleet {
  window: { from: string; to: string; days: number };
  counts: { ships: number; operational: number; semiOperational: number; nonOperational: number; notRecorded: number; atSea: number; seaDays: number; availabilityPct: number; openDefects: number; openDefectsWhileDeployed: number };
  fleetSplit: { operationalPct: number; semiOperationalPct: number; nonOperationalPct: number; notRecordedPct: number };
  ships: ShipRow[]; categories: Category[];
  recentChanges: Array<{ id: string; at: string; shipName: string; pennantNo: string | null; status: string; reason: string | null; authority: string | null }>;
  freshness: Freshness; generatedAt: string;
}

const PERIODS = [30, 90, 180, 365];
const Pill = ({ status }: { status: string | null }) => <span className={`pill st-${status ?? 'none'}`}>{t(`rpt.opstatus.${status ?? 'none'}`)}</span>;
const dateOnly = (iso: string, tz: string) => toLocalDisplay(iso, tz).slice(0, 10);

/**
 * Fleet operational status (D68): how many ships are operational, semi-operational and non-operational, which are at sea, each ship's
 * status with its reason and open defects per category, and a timeline of status (green / amber / red) and sea deployments (light blue).
 */
export function FleetScreen() {
  const { tz } = useSystem();
  const commands = useList('/api/v1/org/commands', { limit: '500' });
  const [commandId, setCommandId] = useState('');
  const [days, setDays] = useState(90);
  const [d, setD] = useState<Fleet | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    api<Fleet>('GET', `${RPT}/fleet-status${qs({ commandId: commandId || undefined, days: String(days) })}`).then((r) => { if (live) { setD(r); setError(null); } }, (e: Error) => live && setError(e));
    return () => { live = false; };
  }, [commandId, days]);

  const cats = d?.categories ?? [];
  const totalOpen = cats.reduce((n, c) => n + c.open, 0);
  const ticks = d ? [0, 1, 2, 3].map((i) => new Date(Date.parse(d.window.from) + ((Date.parse(d.window.to) - Date.parse(d.window.from)) * i) / 3).toISOString()) : [];

  return (
    <section>
      <div className="page-head">
        <h1>{t('rpt.title.fleet')}</h1>
        <div className="tools">
          <label className="inline">{t('rpt.filter.command')}
            <select value={commandId} onChange={(e) => setCommandId(e.target.value)}>
              <option value="">{t('rpt.filter.all_commands')}</option>
              {commands.items.map((c) => <option key={c.id} value={c.id}>{String(c.name)}</option>)}
            </select>
          </label>
          <label className="inline">{t('rpt.filter.period')}
            <select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p} value={p}>{t('rpt.last_days', { n: String(p) })}</option>)}
            </select>
          </label>
        </div>
      </div>
      <ErrorNotice error={error} />
      {d ? (
        <>
          {d.freshness.asOf ? <div className={`banner ${d.freshness.stale ? 'warn' : 'info'}`} role="status">{t(d.freshness.stale ? 'rpt.stale_data' : 'rpt.asof', { when: toLocalDisplay(d.freshness.asOf, tz) })}</div> : <div className="banner warn" role="status">{t('rpt.never')}</div>}

          <ul className="tiles fleet-kpis" aria-label={t('rpt.fleet.totals')}>
            {([['operational', d.counts.operational], ['semi_operational', d.counts.semiOperational], ['non_operational', d.counts.nonOperational]] as const).map(([k, n]) => (
              <li key={k} className="tile">
                <span className="l"><span className={`swatch st-${k}`} />{t(`rpt.opstatus.${k}`)}</span>
                <span className={`n st-${k}`}>{n}</span>
                <span className="l">{t('rpt.of_ships', { n: String(d.counts.ships) })}</span>
              </li>
            ))}
            <li className="tile sea">
              <span className="l"><span className="swatch sea" />{t('rpt.fleet.at_sea')}</span>
              <span className="n">{d.counts.atSea}</span>
              <span className="l">{t('rpt.fleet.sea_days', { n: String(d.counts.seaDays), days: String(d.window.days) })}</span>
            </li>
            <li className="tile">
              <span className="l">{t('rpt.fleet.availability', { days: String(d.window.days) })}</span>
              <span className="n">{d.counts.availabilityPct}%</span>
              <span className="stackbar" aria-hidden>
                <span className="seg st-operational" style={{ width: `${d.fleetSplit.operationalPct}%` }} />
                <span className="seg st-semi_operational" style={{ width: `${d.fleetSplit.semiOperationalPct}%` }} />
                <span className="seg st-non_operational" style={{ width: `${d.fleetSplit.nonOperationalPct}%` }} />
              </span>
            </li>
            {d.counts.notRecorded > 0 ? (
              <li className="tile warn"><span className="l">{t('rpt.fleet.not_recorded')}</span><span className="n">{d.counts.notRecorded}</span><span className="l">{t('rpt.fleet.not_recorded_help')}</span></li>
            ) : null}
          </ul>

          <div className="fleet-grid">
            <div className="main panel">
              <h2>{t('rpt.fleet.ships_now')}</h2>
              <div className="table-wrap"><table>
                <thead><tr>
                  <th scope="col">{t('rpt.col.ship')}</th><th scope="col">{t('rpt.col.command')}</th><th scope="col">{t('rpt.col.status')}</th><th scope="col">{t('rpt.col.since')}</th>
                  <th scope="col">{t('rpt.col.reason')}</th><th scope="col">{t('rpt.col.deployment')}</th><th scope="col">{t('rpt.col.open_defects')}</th>
                </tr></thead>
                <tbody>
                  {d.ships.map((s) => (
                    <tr key={s.shipId}>
                      <td><strong>{s.shipName}</strong>{s.pennantNo ? <div className="muted">{s.pennantNo}</div> : null}</td>
                      <td>{s.commandName ?? ''}</td>
                      <td><Pill status={s.status} /></td>
                      <td className="nowrap">{s.since ? <>{dateOnly(s.since, tz)}<div className="muted">{t('rpt.days', { n: String(s.daysInStatus ?? 0) })}</div></> : ''}</td>
                      <td>{s.reason ?? ''}{s.opdefRef ? <div className="muted">OPDEF {s.opdefRef}{s.opdefCategory ? ` · ${s.opdefCategory}` : ''}</div> : null}{s.authority ? <div className="muted">{t('rpt.set_by', { who: s.authority })}</div> : null}</td>
                      <td>{s.deployment ? <span className="pill sea" title={s.deployment.area ?? ''}>{t('rpt.fleet.at_sea_short')}: {s.deployment.name}</span> : <span className="muted">{t('rpt.fleet.alongside')}</span>}</td>
                      <td>
                        <span className="defect-chips">
                          {cats.map((c) => <span key={c.code} className="cat" style={categoryStyle(c.color)} title={c.name}>{s.defects[c.categoryId ?? 'none'] ?? 0}</span>)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {d.ships.length === 0 ? <tr><td colSpan={7} className="empty">{t('rpt.empty')}</td></tr> : null}
                </tbody>
              </table></div>
              <p className="hint">{t('rpt.fleet.chip_order', { list: cats.map((c) => c.name).join(' · ') })}</p>
            </div>

            <div className="side">
              <div className="panel">
                <h2>{t('rpt.fleet.defects_by_category')}</h2>
                <div className="stackbar" aria-hidden>
                  {cats.map((c) => <span key={c.code} style={{ ...swatchStyle(c.color), width: `${totalOpen ? (c.open / totalOpen) * 100 : 0}%` }} />)}
                </div>
                <ul className="legend">
                  {cats.map((c) => (
                    <li key={c.code}>
                      <span className="swatch" style={swatchStyle(c.color)} />
                      <span className="grow">{c.name}</span>
                      <span className="n">{c.open}</span>
                      <span className="muted">{totalOpen ? Math.round((c.open / totalOpen) * 100) : 0}%</span>
                    </li>
                  ))}
                </ul>
                <p className="hint">{t('rpt.fleet.defects_total', { n: String(d.counts.openDefects), m: String(d.counts.openDefectsWhileDeployed) })}</p>
              </div>
              <div className="panel">
                <h2>{t('rpt.fleet.recent_changes')}</h2>
                <ul className="changes">
                  {d.recentChanges.map((c) => (
                    <li key={c.id}>
                      <small>{dateOnly(c.at, tz)}</small>
                      <div><strong>{c.pennantNo ?? c.shipName}</strong> → <Pill status={c.status} />{c.reason || c.authority ? <div><small>{[c.reason, c.authority ? t('rpt.set_by', { who: c.authority }) : null].filter(Boolean).join(' · ')}</small></div> : null}</div>
                    </li>
                  ))}
                  {d.recentChanges.length === 0 ? <li className="empty">{t('rpt.empty')}</li> : null}
                </ul>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 16 }}>
            <div className="page-head">
              <h2>{t('rpt.fleet.timeline', { days: String(d.window.days) })}</h2>
              <ul className="legend" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: 0 }}>
                {(['operational', 'semi_operational', 'non_operational'] as const).map((k) => <li key={k}><span className={`swatch st-${k}`} />{t(`rpt.opstatus.${k}`)}</li>)}
                <li><span className="swatch sea" />{t('rpt.fleet.at_sea')}</li>
              </ul>
            </div>
            <div className="table-wrap" style={{ border: 0 }}>
              <div className="timeline">
                <div className="row"><span /><div className="scale">{ticks.map((x) => <span key={x}>{dateOnly(x, tz)}</span>)}</div><span className="pct">{t('rpt.fleet.pct_head')}</span></div>
                {d.ships.map((s) => (
                  <div className="row" key={s.shipId}>
                    <div><strong>{s.pennantNo ?? ''}</strong> <span className="muted">{s.shipName}</span></div>
                    <div className="bars">
                      <div className="status-bar">
                        {s.segments.map((g) => <span key={`${g.from}`} className={`seg st-${g.status}`} style={{ left: `${g.offsetPct}%`, width: `${g.widthPct}%` }} title={`${t(`rpt.opstatus.${g.status}`)} · ${dateOnly(g.from, tz)} – ${dateOnly(g.to, tz)} · ${t('rpt.days', { n: String(g.days) })}${g.reason ? ` · ${g.reason}` : ''}`} />)}
                      </div>
                      <div className="sea-bar">
                        {s.deployments.map((p) => <span key={p.id} className="dep" style={{ left: `${p.offsetPct}%`, width: `${p.widthPct}%` }} title={`${p.name} · ${dateOnly(p.from, tz)} – ${p.atSea ? t('rpt.fleet.at_sea') : dateOnly(p.to, tz)} · ${t('rpt.days', { n: String(p.days) })}`} />)}
                      </div>
                    </div>
                    <div className="pct">{s.operationalPct} · {s.semiOperationalPct} · {s.nonOperationalPct}% · {s.seaDays}d</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="hint">{t('rpt.fleet.timeline_help')}</p>
          </div>
        </>
      ) : null}
    </section>
  );
}
