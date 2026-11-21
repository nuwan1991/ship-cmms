/** Office dashboard (spec §1.2): numbers that open the matching list, workload per person, upcoming deadlines, recently completed. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../platform/i18n';
import { ErrorNotice } from '../../platform/ui';
import { OFC, OfficePicker, priorityOptions, show, useGet, useOffice, usePersons, type Page } from './binding';
import type { Rec } from '../../platform/api';

interface Tile { key: string; n: number; warn?: boolean; link: { screen: string; view?: string; from?: string; to?: string } }
interface Dash { asOf: string; period: { from: string; to: string }; scope: string; tiles: Tile[]; people: Rec[]; upcoming: Rec[]; recent: Rec[] }

const GROUPS: Array<{ key: string; tiles: string[] }> = [
  { key: 'tasks', tiles: ['active_tasks', 'overdue_tasks', 'attention', 'due_soon', 'awaiting_decision', 'completed_period'] },
  { key: 'correspondence', tiles: ['pending_corr', 'overdue_corr'] },
  { key: 'work', tiles: ['outstanding_wo', 'overdue_wo', 'equip_repair', 'equip_collection', 'equip_overdue', 'supply_open', 'supply_overdue'] },
  { key: 'handover', tiles: ['handover_open', 'handover_overdue'] },
];

export function DashboardScreen() {
  const office = useOffice();
  const C = office.commandId;
  const people = usePersons(C);
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [unitId, setUnitId] = useState('');
  const [personId, setPersonId] = useState('');
  const [priority, setPriority] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const d = useGet<Dash>(C ? `${OFC}/dashboard` : null, { commandId: C, unitId: unitId || undefined, personId: personId || undefined, priority: priority || undefined, from: from || undefined, to: to || undefined });
  const tile = (k: string) => d.data?.tiles.find((x) => x.key === k);
  const href = (l: Tile['link']) => {
    const p = new URLSearchParams();
    if (l.view) p.set('view', l.view);
    if (l.from) p.set('from', l.from);
    if (l.to) p.set('to', l.to);
    if (l.screen === 'tasks' && personId) p.set('assignee', personId);
    const s = p.toString();
    return `/ofc/${l.screen}${s ? `?${s}` : ''}`;
  };
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.dashboard')}</h1>
        <div className="tools"><OfficePicker office={office} /><Link className="button" to="/ofc/reports">{t('ofc.nav.reports')}</Link></div>
      </div>
      <div className="tools">
        <select aria-label={t('ofc.field.unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">{t('ofc.filter.any_unit')}</option>{(units.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{String(u.path)}</option>)}</select>
        <select aria-label={t('ofc.field.assignee')} value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">{t('ofc.filter.anyone')}</option>{people.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select aria-label={t('ofc.field.priority')} value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">{t('ofc.filter.any_priority')}</option>{priorityOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <label className="inline">{t('ofc.dash.completed_from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">{t('ofc.filter.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {d.data ? <span className="muted">{t(d.data.scope === 'office' ? 'ofc.dash.scope_office' : 'ofc.dash.scope_units', { date: d.data.asOf })}</span> : null}
      </div>
      <ErrorNotice error={office.error ?? d.error} />
      {GROUPS.map((g) => (
        <div key={g.key}>
          <h2 className="group-title">{t(`ofc.dash.group.${g.key}`)}</h2>
          <ul className="tiles">
            {g.tiles.map((k) => { const x = tile(k); return x ? (
              <li key={k}><Link to={href(x.link)} className={`tile${x.warn && x.n > 0 ? ' warn' : ''}`}><span className="n">{x.n}</span><span className="l">{t(`ofc.tile.${k}`)}</span></Link></li>
            ) : null; })}
          </ul>
        </div>
      ))}
      <div className="dash-cols">
        <div>
          <h2 className="group-title">{t('ofc.dash.per_person')}</h2>
          <table>
            <thead><tr><th scope="col">{t('ofc.field.name')}</th><th scope="col">{t('ofc.field.activeTasks')}</th><th scope="col">{t('ofc.field.overdueTasks')}</th><th scope="col">{t('ofc.tview.due_soon')}</th></tr></thead>
            <tbody>
              {(d.data?.people ?? []).map((p) => (
                <tr key={String(p.id)}><td><Link to={`/ofc/tasks?assignee=${String(p.id)}`}>{p.rank ? `${String(p.rank)} ` : ''}{String(p.name)}</Link></td><td>{String(p.active)}</td>
                  <td>{Number(p.overdue) ? <span className="chip warn">{String(p.overdue)}</span> : '0'}</td><td>{String(p.dueSoon)}</td></tr>
              ))}
              {d.data && d.data.people.length === 0 ? <tr><td colSpan={4} className="empty">{t('ofc.tasks.empty')}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div>
          <h2 className="group-title">{t('ofc.dash.upcoming')}</h2>
          <ul className="plain">{(d.data?.upcoming ?? []).map((u) => <li key={String(u.id)}><strong>{String(u.targetDate)}</strong> {String(u.refNo)} {String(u.title)} · {people.name(u.assigneePersonId)}</li>)}
            {d.data && d.data.upcoming.length === 0 ? <li className="muted">{t('common.none')}</li> : null}</ul>
          <h2 className="group-title">{t('ofc.dash.recent')}</h2>
          <ul className="plain">{(d.data?.recent ?? []).map((u) => <li key={String(u.id)}>{show(u.doneAt)} {String(u.refNo)} {String(u.title)} · {people.name(u.assigneePersonId)} ({t(`ofc.tstatus.${String(u.status)}`)})</li>)}
            {d.data && d.data.recent.length === 0 ? <li className="muted">{t('common.none')}</li> : null}</ul>
        </div>
      </div>
    </section>
  );
}
