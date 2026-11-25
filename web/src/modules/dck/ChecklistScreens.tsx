import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { DCK, show, tone, useShips } from './binding';
import { reqItemFields } from './fields';

/**
 * Checklist lines of a class template or of one ship: number, category, requirement, who, how many days before docking, mandatory.
 * `base` is the create URL; edits and removals go to `itemBase/:id`.
 */
function ItemTable({ items, createUrl, itemBase, extraCreate, permission, reload }: {
  items: Rec[]; createUrl: string; itemBase: string; extraCreate?: Record<string, unknown>; permission: { create: string; update: string; remove: string }; reload(): void;
}) {
  const { tz } = useSystem();
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  return (
    <>
      <div className="tools">{can(permission.create) ? <button className="primary" onClick={() => setEditing('new')}>{t('dck.new.req_item')}</button> : null}</div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.no')}</th><th scope="col">{t('dck.field.category')}</th><th scope="col">{t('dck.field.requirement')}</th><th scope="col">{t('dck.field.responsible')}</th>
          <th scope="col">{t('dck.field.leadDaysShort')}</th><th scope="col">{t('dck.field.mandatory')}</th><th scope="col">{t('dck.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
        </tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={String(r.id)}>
              <td>{String(r.seq)}</td><td>{t(`dck.rcat.${String(r.category)}`)}</td>
              <td>{String(r.title)}{r.description ? <div className="muted">{String(r.description)}</div> : null}</td>
              <td>{show(r.responsible)}</td><td>{String(r.leadDays)}</td><td>{r.mandatory ? t('dck.yes') : t('dck.no')}</td>
              <td><span className={`chip ${tone(r.status)}`}>{t(`status.${String(r.status)}`)}</span></td>
              <td className="actions">
                {can(permission.update) ? <button onClick={() => setEditing(r)}>{t('common.edit')}</button> : null}
                {can(permission.remove) ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {items.length === 0 ? <tr><td colSpan={8} className="empty">{t('dck.req_items.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {editing ? (
        <FormModal title={editing === 'new' ? t('dck.new.req_item') : t('dck.edit.req_item', { no: String(editing.seq) })} fields={reqItemFields(editing !== 'new', editing !== 'new')}
          record={editing === 'new' ? null : editing} tz={tz} defaults={{ mandatory: true, leadDays: '7' }} submitKey={editing === 'new' ? 'common.create' : 'common.save'}
          onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', createUrl, { ...body, ...extraCreate });
            else await api('PATCH', `${itemBase}/${editing.id}`, body);
            reload();
          }} />
      ) : null}
      {removing ? (
        <ReasonModal title={t('dck.remove.req_item', { no: String(removing.seq) })} onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${itemBase}/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); reload(); }} />
      ) : null}
    </>
  );
}

const templateFields: FieldDef[] = [
  { key: 'code', labelKey: 'dck.field.code', type: 'text', required: true, maxLength: 40, createOnly: true },
  { key: 'name', labelKey: 'dck.field.name', type: 'text', required: true, maxLength: 160 },
  { key: 'shipClass', labelKey: 'dck.field.shipClass', type: 'text', maxLength: 60, hintKey: 'dck.hint.ship_class' },
  { key: 'description', labelKey: 'dck.field.description', type: 'textarea', maxLength: 1000 },
  { key: 'status', labelKey: 'dck.field.status', type: 'select', options: [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] },
];

/** Hub: the standard pre-docking checklist of each ship class, and one for every ship. */
export function TemplatesScreen() {
  const { tz, info } = useSystem();
  const list = useList(`${DCK}/req-templates`);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<(Rec & { items: Rec[] }) | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const readOnly = info?.installation != null && info.installation.kind !== 'hub';
  const load = useCallback(() => {
    if (!selected) { setDetail(null); return; }
    api<Rec & { items: Rec[] }>('GET', `${DCK}/req-templates/${selected}`).then((r) => { setDetail(r); setError(null); }, (e: ApiError) => setError(e));
  }, [selected]);
  useEffect(load, [load]);

  return (
    <section>
      <div className="page-head">
        <h1>{t('dck.title.templates')}</h1>
        <div className="tools">{!readOnly && can('dck.req_template.create') ? <button className="primary" onClick={() => setEditing('new')}>{t('dck.new.template')}</button> : null}</div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      {readOnly ? <div className="banner info">{t('org.hub_only')}</div> : null}
      <p className="muted">{t('dck.templates.intro')}</p>
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('dck.field.code')}</th><th scope="col">{t('dck.field.name')}</th><th scope="col">{t('dck.field.shipClass')}</th><th scope="col">{t('dck.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={String(r.id)} className={r.id === selected ? 'selected' : undefined}>
              <td>{String(r.code)}</td><td>{String(r.name)}</td><td>{r.shipClass ? String(r.shipClass) : <em>{t('dck.every_ship')}</em>}</td>
              <td><span className={`chip ${tone(r.status)}`}>{t(`status.${String(r.status)}`)}</span></td>
              <td className="actions">
                <button onClick={() => setSelected(String(r.id))}>{t('dck.act.items')}</button>
                {!readOnly && can('dck.req_template.update') ? <button onClick={() => setEditing(r)}>{t('common.edit')}</button> : null}
                {!readOnly && can('dck.req_template.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('dck.templates.empty')}</td></tr> : null}
        </tbody>
      </table></div>

      {detail ? (
        <>
          <h2>{t('dck.title.template_items', { name: `${String(detail.code)} – ${String(detail.name)}` })}</h2>
          <ItemTable items={detail.items} createUrl={`${DCK}/req-templates/${String(detail.id)}/items`} itemBase={`${DCK}/req-template-items`} reload={load}
            permission={readOnly ? { create: '-', update: '-', remove: '-' } : { create: 'dck.req_template.update', update: 'dck.req_template.update', remove: 'dck.req_template.update' }} />
        </>
      ) : null}

      {editing ? (
        <FormModal title={editing === 'new' ? t('dck.new.template') : t('dck.edit.template', { name: String(editing.name) })} fields={templateFields} record={editing === 'new' ? null : editing}
          tz={tz} defaults={{ status: 'active' }} submitKey={editing === 'new' ? 'common.create' : 'common.save'} onClose={() => setEditing(null)}
          onSubmit={async (body) => {
            if (editing === 'new') { const r = await api<Rec>('POST', `${DCK}/req-templates`, body); setSelected(r.id); } else await api('PATCH', `${DCK}/req-templates/${editing.id}`, body);
            list.reload(); load();
          }} />
      ) : null}
      {removing ? (
        <ReasonModal title={t('dck.remove.template', { name: String(removing.name) })} onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${DCK}/req-templates/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); if (removing.id === selected) setSelected(null); list.reload(); }} />
      ) : null}
    </section>
  );
}

/** Standing pre-docking requirements of one ship, added to every docking of that ship on top of its class template. */
export function ShipItemsScreen() {
  const ships = useShips();
  const [shipId, setShipId] = useState('');
  const list = useList(shipId ? `${DCK}/ship-req-items` : null, { shipId: shipId || undefined });
  return (
    <section>
      <div className="page-head">
        <h1>{t('dck.title.ship_items')}</h1>
        <div className="tools">
          <select aria-label={t('dck.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('dck.filter.choose_ship')}</option>{ships.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <p className="muted">{t('dck.ship_items.intro')}</p>
      <ErrorNotice error={list.error} />
      {shipId ? (
        <ItemTable items={list.items} createUrl={`${DCK}/ship-req-items`} itemBase={`${DCK}/ship-req-items`} extraCreate={{ shipId }} reload={list.reload}
          permission={{ create: 'dck.ship_req.create', update: 'dck.ship_req.update', remove: 'dck.ship_req.remove' }} />
      ) : null}
    </section>
  );
}
