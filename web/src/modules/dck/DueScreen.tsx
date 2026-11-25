import { useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '../../platform/i18n';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { DCK, show, tone } from './binding';

/** Every ship's docking state: overdue, due soon, never docked, in dock now, or not yet due. */
export function DueScreen() {
  const [onlyDue, setOnlyDue] = useState(false);
  const [q, setQ] = useState('');
  const list = useList(`${DCK}/due`, { onlyDue: onlyDue ? 'true' : undefined, q: q.trim() || undefined });
  return (
    <section>
      <div className="page-head">
        <h1>{t('dck.title.due')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> {t('dck.filter.only_due')}</label>
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.ship')}</th><th scope="col">{t('dck.field.dueState')}</th><th scope="col">{t('dck.field.nextDueOn')}</th>
          <th scope="col">{t('dck.field.lastUndocked')}</th><th scope="col">{t('dck.field.nextPlanned')}</th>
        </tr></thead>
        <tbody>
          {list.items.map((r) => {
            const linked = r.currentDockingId ?? r.lastDockingId;
            return (
              <tr key={String(r.shipId)}>
                <td>{String(r.shipCode)} – {String(r.shipName)}{r.pennantNo ? ` (${String(r.pennantNo)})` : ''}</td>
                <td><span className={`chip ${tone(r.dueState)}`}>{t(`dck.due.${String(r.dueState)}`)}</span>{linked ? <> <Link to={`/docking/dockings/${String(linked)}`}>{t('dck.act.open')}</Link></> : null}</td>
                <td>{show(r.nextDueOn)}</td><td>{show(String(r.lastUndockedAt ?? '').slice(0, 10))}</td><td>{show(r.nextPlannedDockIn)}</td>
              </tr>
            );
          })}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('dck.due.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
    </section>
  );
}
