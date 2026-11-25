import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../platform/api';
import { FormModal } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { DCK, DOCKING_STATUSES, show, tone, useDocks, useShips } from './binding';
import { dockingFields } from './fields';

/** The docking schedule: planned, current and past dockings of every ship. */
export function DockingsScreen() {
  const { tz } = useSystem();
  const ships = useShips();
  const docks = useDocks();
  const [status, setStatus] = useState('open');
  const [shipId, setShipId] = useState('');
  const [q, setQ] = useState('');
  const list = useList(`${DCK}/dockings`, {
    open: status === 'open' ? 'true' : undefined, status: status && status !== 'open' ? status : undefined, shipId: shipId || undefined, q: q.trim() || undefined,
  });
  const conflicts = useList(`${DCK}/conflicts`);
  const [creating, setCreating] = useState(false);

  return (
    <section>
      <div className="page-head">
        <h1>{t('dck.title.dockings')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('dck.field.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">{t('dck.filter.open')}</option><option value="">{t('dck.filter.any_status')}</option>
            {DOCKING_STATUSES.map((s) => <option key={s} value={s}>{t(`dck.status.${s}`)}</option>)}
          </select>
          <select aria-label={t('dck.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('dck.filter.any_ship')}</option>{ships.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {can('dck.docking.create') ? <button className="primary" onClick={() => setCreating(true)}>{t('dck.new.docking')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      {conflicts.items.length > 0 ? (
        <div className="banner warn" role="status">
          {t('dck.conflicts', { count: String(conflicts.items.length) })}{' '}
          {conflicts.items.map((c) => `${ships.label(c.shipId)} / ${ships.label(c.otherShipId)} (${String(c.overlapFrom)} – ${String(c.overlapTo)})`).join('; ')}
        </div>
      ) : null}
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.ship')}</th><th scope="col">{t('dck.field.reference')}</th><th scope="col">{t('dck.field.dock')}</th><th scope="col">{t('dck.field.type')}</th>
          <th scope="col">{t('dck.field.planned')}</th><th scope="col">{t('dck.field.actual')}</th><th scope="col">{t('dck.field.status')}</th><th scope="col">{t('dck.field.workList')}</th>
        </tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={String(r.dockingId)}>
              <td><Link to={`/docking/dockings/${String(r.dockingId)}`}>{show(r.shipCode)} – {show(r.shipName)}</Link></td>
              <td>{show(r.reference)}</td><td>{r.dockCode ? `${String(r.dockCode)} – ${String(r.dockName)}` : '—'}</td><td>{t(`dck.type.${String(r.dockingType)}`)}</td>
              <td>{String(r.plannedDockIn)} → {String(r.plannedUndock)}</td>
              <td>{r.dockedAt ? `${String(r.dockedAt).slice(0, 10)} → ${r.undockedAt ? String(r.undockedAt).slice(0, 10) : '…'} (${t('dck.days', { n: String(r.daysInDock) })})` : '—'}</td>
              <td>
                <span className={`chip ${tone(r.status)}`}>{t(`dck.status.${String(r.status)}`)}</span>
                {r.lateDockIn ? <> <span className="chip warn">{t('dck.late.dock_in')}</span></> : null}
                {r.lateUndock ? <> <span className="chip warn">{t('dck.late.undock')}</span></> : null}
              </td>
              <td>{t('dck.items_summary', { open: String(r.itemsOpen), total: String(r.itemsTotal) })}</td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={8} className="empty">{t('dck.dockings.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {creating ? (
        <FormModal title={t('dck.new.docking')} fields={dockingFields(ships.options, docks, true)} record={null} tz={tz} defaults={{ dockingType: 'routine' }} submitKey="common.create"
          onClose={() => setCreating(false)}
          onSubmit={async (body) => { await api('POST', `${DCK}/dockings`, body); list.reload(); conflicts.reload(); }} />
      ) : null}
    </section>
  );
}
