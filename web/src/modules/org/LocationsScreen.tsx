import { useMemo, useState } from 'react';
import { api, type ApiError, type Rec } from '../../platform/api';
import { ExcelButtons } from '../../platform/excel';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { ORG } from './ResourceScreen';
import { buildTree, descendantIds } from './tree';

const KINDS = ['deck', 'compartment', 'space', 'room', 'tank', 'area', 'yard', 'other'];

/** Location tree for one ship or workshop. Locations are entered by the installation that serves the site; elsewhere they are read-only. */
export function LocationsScreen() {
  const { tz, info } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const workshops = useList(`${ORG}/workshops`);
  const [site, setSite] = useState<{ kind: 'ship' | 'workshop'; id: string } | null>(null);
  const list = useList(site ? `${ORG}/locations` : null, { siteId: site?.id });
  const [editing, setEditing] = useState<{ rec: Rec | null; parentId?: string } | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const [error] = useState<ApiError | null>(null);

  const rows = useMemo(() => buildTree(list.items), [list.items]);
  const label = (r: Rec) => `${String(r.code)} – ${String(r.name)}`;
  const kind = info?.installation?.kind;
  // Hub, command and the site's own installation may enter locations; the server decides (NOT_OWNER) for the rest.
  const mayWrite = can('org.location.create') && kind !== undefined;

  const fields = (rec: Rec | null): FieldDef[] => {
    const blocked = rec ? descendantIds(list.items, rec.id) : new Set<string>();
    return [
      { key: 'code', labelKey: 'org.field.code', type: 'text', required: true, maxLength: 32, hintKey: 'org.hint.code' },
      { key: 'name', labelKey: 'org.field.name', type: 'text', required: true, maxLength: 120 },
      { key: 'kind', labelKey: 'org.field.kind', type: 'select', options: () => KINDS.map((k) => ({ value: k, label: t(`org.location.kind.${k}`) })) },
      { key: 'parentId', labelKey: 'org.field.parentId', type: 'select', options: () => buildTree(list.items).filter((r) => !blocked.has(r.rec.id)).map((r) => ({ value: r.rec.id, label: `${'— '.repeat(r.depth)}${label(r.rec)}` })) },
      { key: 'sortOrder', labelKey: 'org.field.sortOrder', type: 'number' },
      { key: 'status', labelKey: 'org.field.status', type: 'select', options: () => [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] },
    ];
  };

  return (
    <section>
      <div className="page-head">
        <h1>{t('org.title.locations')}</h1>
        <div className="tools">
          <label className="inline">
            {t('org.field.site')}
            <select
              value={site ? `${site.kind}:${site.id}` : ''}
              onChange={(e) => {
                const [k, id] = e.target.value.split(':');
                setSite(k && id ? { kind: k as 'ship' | 'workshop', id } : null);
              }}
            >
              <option value="">{t('common.choose')}</option>
              <optgroup label={t('org.loc.sites_ships')}>
                {ships.items.map((s) => <option key={s.id} value={`ship:${s.id}`}>{label(s)}</option>)}
              </optgroup>
              <optgroup label={t('org.loc.sites_workshops')}>
                {workshops.items.map((w) => <option key={w.id} value={`workshop:${w.id}`}>{label(w)}</option>)}
              </optgroup>
            </select>
          </label>
          <ExcelButtons template="locations" shipId={site?.kind === 'ship' ? site.id : undefined} />
          {site && mayWrite ? <button className="primary" onClick={() => setEditing({ rec: null })}>{t('org.new.location')}</button> : null}
        </div>
      </div>
      {site ? <FreshnessBanner freshness={list.freshness} /> : <p className="help">{t('org.loc.choose_site')}</p>}
      <ErrorNotice error={list.error ?? error} />
      {site ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('org.field.name')}</th>
                <th scope="col">{t('org.field.code')}</th>
                <th scope="col">{t('org.field.kind')}</th>
                <th scope="col">{t('org.field.status')}</th>
                <th scope="col" className="actions-col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ rec, depth }) => (
                <tr key={rec.id}>
                  <td><span className="indent" style={{ paddingLeft: `${depth * 1.25}rem` }}>{String(rec.name)}</span></td>
                  <td>{String(rec.code)}</td>
                  <td>{t(`org.location.kind.${String(rec.kind)}`)}</td>
                  <td><StatusChip value={String(rec.status)} labelPrefix="status" /></td>
                  <td className="actions">
                    {mayWrite ? <button onClick={() => setEditing({ rec: null, parentId: rec.id })}>{t('org.loc.add_child')}</button> : null}
                    {can('org.location.update') ? <button onClick={() => setEditing({ rec })}>{t('common.edit')}</button> : null}
                    {can('org.location.remove') ? <button className="link-danger" onClick={() => setRemoving(rec)}>{t('common.remove')}</button> : null}
                  </td>
                </tr>
              ))}
              {!list.loading && rows.length === 0 ? <tr><td colSpan={5} className="empty">{t('org.loc.empty')}</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {site && kind && kind !== 'hub' ? <p className="help">{t('org.loc.not_here')}</p> : null}

      {editing && site ? (
        <FormModal
          title={editing.rec ? t('org.edit.record', { name: label(editing.rec) }) : t('org.new.location')}
          fields={fields(editing.rec)}
          record={editing.rec}
          tz={tz}
          defaults={{ status: 'active', kind: 'compartment', parentId: editing.parentId ?? '' }}
          submitKey={editing.rec ? 'common.save' : 'common.create'}
          onClose={() => setEditing(null)}
          onFetchLatest={editing.rec ? () => api<Rec>('GET', `${ORG}/locations/${editing.rec?.id}`) : undefined}
          onSubmit={async (body) => {
            if (editing.rec) await api('PATCH', `${ORG}/locations/${editing.rec.id}`, body);
            else await api('POST', `${ORG}/locations`, { ...body, siteKind: site.kind, siteId: site.id });
            list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ReasonModal
          title={t('org.remove.record', { name: label(removing) })}
          onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api('POST', `${ORG}/locations/${removing.id}/tombstone`, { expectedVersion: removing.version, reason });
            list.reload();
          }}
        />
      ) : null}
    </section>
  );
}
