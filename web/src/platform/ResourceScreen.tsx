import { useEffect, useState, type ReactNode } from 'react';
import { api, type ApiError, type Rec } from './api';
import { FormModal, type FieldDef, type Values } from './form';
import { t } from './i18n';
import { can } from './permissions';
import { ReasonModal } from './reason';
import { useSystem } from './system';
import { ErrorNotice, FreshnessBanner } from './ui';
import { useList } from './useList';

export interface Option { value: string; label: string }

export interface RefDef {
  /** defaults to the screen's apiBase */
  apiBase?: string;
  collection: string;
  label(r: Rec): string;
  filter?(r: Rec): boolean;
}
export interface ColumnDef {
  key: string;
  labelKey: string;
  render?(row: Rec, tz: string, refs: Record<string, Option[]>): ReactNode;
}
export interface ResourceConfig {
  /** API base of the owning module, e.g. /api/v1/org */
  apiBase: string;
  /** permission prefix of the owning module, e.g. `org` -> org.ship.create */
  permPrefix: string;
  /** label keys with {name}; default to the shared record labels */
  editKey?: string;
  removeKey?: string;
  /** permission noun, e.g. `ship` -> org.ship.create */
  noun: string;
  collection: string;
  titleKey: string;
  newKey: string;
  columns: ColumnDef[];
  fields(refs: Record<string, Option[]>): FieldDef[];
  refs?: Record<string, RefDef>;
  hubOnly: boolean;
  searchable?: boolean;
  /** Values for a new record. */
  defaults?: Values;
  rowName(r: Rec): string;
}

/** Options for select fields, loaded once per screen from other collections (fleet-wide reference data). */
export function useRefOptions(refs: Record<string, RefDef> | undefined, apiBase: string): Record<string, Option[]> {
  const [out, setOut] = useState<Record<string, Option[]>>({});
  useEffect(() => {
    let live = true;
    for (const [k, def] of Object.entries(refs ?? {})) {
      api<{ items: Rec[] }>('GET', `${def.apiBase ?? apiBase}/${def.collection}?limit=500`).then(
        (r) => live && setOut((p) => ({ ...p, [k]: r.items.filter(def.filter ?? (() => true)).map((i) => ({ value: i.id, label: def.label(i) })) })),
        () => undefined,
      );
    }
    return () => { live = false; };
  }, [refs, apiBase]);
  return out;
}

export function ResourceScreen({ config, rowActions, headerExtra }: { config: ResourceConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode; headerExtra?: ReactNode }) {
  const { info, tz } = useSystem();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);
  const list = useList(`${config.apiBase}/${config.collection}`, { q: debounced || undefined });
  const refs = useRefOptions(config.refs, config.apiBase);
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  const readOnly = config.hubOnly && info?.installation != null && info.installation.kind !== 'hub';
  const canCreate = !readOnly && can(`${config.permPrefix}.${config.noun}.create`);
  const canUpdate = !readOnly && can(`${config.permPrefix}.${config.noun}.update`);
  const canRemove = !readOnly && can(`${config.permPrefix}.${config.noun}.remove`);
  const fields = config.fields(refs);

  return (
    <section>
      <div className="page-head">
        <h1>{t(config.titleKey)}</h1>
        <div className="tools">
          {config.searchable !== false ? <input type="search" aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /> : null}
          {headerExtra}
          {canCreate ? <button className="primary" onClick={() => setEditing('new')}>{t(config.newKey)}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      {readOnly ? <div className="banner info">{t('org.hub_only')}</div> : null}
      <ErrorNotice error={list.error ?? actionError} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {config.columns.map((c) => <th key={c.key} scope="col">{t(c.labelKey)}</th>)}
              <th scope="col" className="actions-col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={row.id}>
                {config.columns.map((c) => <td key={c.key}>{c.render ? c.render(row, tz, refs) : String(row[c.key] ?? '')}</td>)}
                <td className="actions">
                  {rowActions?.(row, list.reload)}
                  {canUpdate ? <button onClick={() => setEditing(row)}>{t('common.edit')}</button> : null}
                  {canRemove ? <button className="link-danger" onClick={() => setRemoving(row)}>{t('common.remove')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={config.columns.length + 1} className="empty">{t('common.empty')}</td></tr> : null}
            {list.loading ? <tr><td colSpan={config.columns.length + 1} className="empty">{t('common.loading')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {editing ? (
        <FormModal
          title={editing === 'new' ? t(config.newKey) : t(config.editKey ?? 'org.edit.record', { name: config.rowName(editing) })}
          fields={fields}
          record={editing === 'new' ? null : editing}
          tz={tz}
          defaults={config.defaults ?? {}}
          submitKey={editing === 'new' ? 'common.create' : 'common.save'}
          onClose={() => setEditing(null)}
          onFetchLatest={editing === 'new' ? undefined : () => api<Rec>('GET', `${config.apiBase}/${config.collection}/${editing.id}`)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', `${config.apiBase}/${config.collection}`, body);
            else await api('PATCH', `${config.apiBase}/${config.collection}/${editing.id}`, body);
            list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ReasonModal
          title={t(config.removeKey ?? 'org.remove.record', { name: config.rowName(removing) })}
          onClose={() => { setRemoving(null); setActionError(null); }}
          onConfirm={async (reason) => {
            await api('POST', `${config.apiBase}/${config.collection}/${removing.id}/tombstone`, { expectedVersion: removing.version, reason });
            list.reload();
          }}
        />
      ) : null}
    </section>
  );
}
