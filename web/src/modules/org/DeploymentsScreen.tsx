import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay, utcIsoToLocalInput } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { ORG } from './ResourceScreen';

const days = (from: unknown, to: unknown): string => {
  const end = to ? Date.parse(String(to)) : Date.now();
  return (Math.max(0, end - Date.parse(String(from))) / 86_400_000).toFixed(1);
};

/**
 * Sea deployments (D66): when a ship sailed, where to, and when it returned. A deployment with no return date is "at sea now".
 * It is kept up to date where it was entered (Command / NHQ at the hub, or the ship); elsewhere it is read-only.
 */
export function DeploymentsScreen() {
  const { info, tz } = useSystem();
  const ships = useList(`${ORG}/ships`, { limit: '500' });
  const [shipId, setShipId] = useState('');
  const [active, setActive] = useState('');
  const list = useList(`${ORG}/deployments`, { shipId: shipId || undefined, active: active || undefined });
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const [returning, setReturning] = useState<Rec | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const here = info?.installation?.installationId;
  const mine = (r: Rec) => !here || r.ownerInstallationId === here;

  const fields: FieldDef[] = [
    { key: 'shipId', labelKey: 'org.field.shipId', type: 'select', required: true, createOnly: true, options: ships.items.map((s) => ({ value: s.id, label: `${String(s.pennantNo ?? s.code)} – ${String(s.name)}` })) },
    { key: 'name', labelKey: 'org.field.deploymentName', type: 'text', required: true, maxLength: 120, hintKey: 'org.hint.deployment_name' },
    { key: 'area', labelKey: 'org.field.area', type: 'text', maxLength: 120 },
    { key: 'sailedAt', labelKey: 'org.field.sailedAt', type: 'datetime', required: true },
    { key: 'returnedAt', labelKey: 'org.field.returnedAt', type: 'datetime', hintKey: 'org.hint.returned_at' },
    { key: 'remarks', labelKey: 'org.field.remarks', type: 'textarea', maxLength: 1000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('org.title.deployments')}</h1>
        <div className="tools">
          <select aria-label={t('org.field.shipId')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('org.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
          </select>
          <select aria-label={t('org.filter.at_sea')} value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="">{t('org.filter.all_deployments')}</option>
            <option value="true">{t('org.filter.at_sea_now')}</option>
          </select>
          {can('org.deployment.create') ? <button className="primary" onClick={() => setEditing('new')}>{t('org.new.deployment')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('org.field.shipId')}</th><th scope="col">{t('org.field.deploymentName')}</th><th scope="col">{t('org.field.area')}</th>
            <th scope="col">{t('org.field.sailedAt')}</th><th scope="col">{t('org.field.returnedAt')}</th><th scope="col" className="num">{t('org.field.daysAtSea')}</th>
            <th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => {
              const atSea = !r.returnedAt || String(r.returnedAt) > new Date().toISOString();
              return (
                <tr key={r.id}>
                  <td><strong>{String(r.shipName)}</strong>{r.pennantNo ? <div className="muted">{String(r.pennantNo)}</div> : null}</td>
                  <td>{String(r.name)}{r.remarks ? <div className="muted">{String(r.remarks)}</div> : null}</td>
                  <td>{String(r.area ?? '')}</td>
                  <td>{toLocalDisplay(String(r.sailedAt), tz)}</td>
                  <td>{r.returnedAt ? toLocalDisplay(String(r.returnedAt), tz) : null}{atSea ? <> <span className="pill sea">{t('org.at_sea')}</span></> : null}</td>
                  <td className="num">{days(r.sailedAt, r.returnedAt)}</td>
                  <td className="actions">
                    {mine(r) && atSea && !r.returnedAt && can('org.deployment.update') ? <button onClick={() => setReturning(r)}>{t('org.deployment.returned')}</button> : null}
                    {mine(r) && can('org.deployment.update') ? <button onClick={() => setEditing(r)}>{t('common.edit')}</button> : null}
                    {mine(r) && can('org.deployment.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
                    {!mine(r) ? <small className="muted">{t('org.deployment.elsewhere')}</small> : null}
                  </td>
                </tr>
              );
            })}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('org.deployments.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {editing ? (
        <FormModal
          title={editing === 'new' ? t('org.new.deployment') : t('org.edit.record', { name: String(editing.name) })}
          fields={fields}
          record={editing === 'new' ? null : editing}
          tz={tz}
          defaults={{ sailedAt: utcIsoToLocalInput(new Date().toISOString(), tz), ...(shipId ? { shipId } : {}) }}
          submitKey={editing === 'new' ? 'common.create' : 'common.save'}
          onClose={() => setEditing(null)}
          onFetchLatest={editing === 'new' ? undefined : () => api<Rec>('GET', `${ORG}/deployments/${editing.id}`)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', `${ORG}/deployments`, body);
            else await api('PATCH', `${ORG}/deployments/${editing.id}`, body);
            list.reload();
          }}
        />
      ) : null}
      {returning ? (
        <FormModal
          title={t('org.deployment.returned_title', { name: String(returning.name) })}
          fields={[{ key: 'returnedAt', labelKey: 'org.field.returnedAt', type: 'datetime', required: true }]}
          record={returning}
          tz={tz}
          defaults={{ returnedAt: utcIsoToLocalInput(new Date().toISOString(), tz) }}
          submitKey="org.deployment.returned"
          onClose={() => setReturning(null)}
          onSubmit={async (body) => { await api('PATCH', `${ORG}/deployments/${returning.id}`, body); setError(null); list.reload(); }}
        />
      ) : null}
      {removing ? (
        <ReasonModal
          title={t('org.remove.record', { name: String(removing.name) })}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${ORG}/deployments/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); list.reload(); }}
        />
      ) : null}
    </section>
  );
}
