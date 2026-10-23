import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { normalizeTag } from './actions';
import { AST, ORG, WRK } from './binding';
import { PARTY_KINDS, useParties, WorkOrderDetail } from './WorkOrderDetail';

const WORK_TYPES = ['corrective', 'preventive', 'inspection', 'modification'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** Work orders: one row per order with its four status axes shown separately. */
export function WorkOrdersScreen({ initialCase }: { initialCase?: string }) {
  const { tz } = useSystem();
  const parties = useParties();
  const ships = useList(`${ORG}/ships`);
  const [shipId, setShipId] = useState('');
  const [progress, setProgress] = useState('');
  const [closure, setClosure] = useState('open');
  const [q, setQ] = useState('');
  const list = useList(`${WRK}/work-orders`, { shipId: shipId || undefined, progress: progress || undefined, closure: closure || undefined, q: q || undefined, repairCaseId: initialCase });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const shipName = (id: unknown) => String(ships.items.find((s) => s.id === id)?.name ?? id ?? '');

  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'shipId', labelKey: 'wrk.field.ship', type: 'select', hintKey: 'wrk.hint.wo_target', options: ships.items.map((s) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` })) },
    { key: 'assetTag', labelKey: 'wrk.field.assetTag', type: 'text', maxLength: 40, hintKey: 'wrk.hint.asset_tag' },
    { key: 'workType', labelKey: 'wrk.field.workType', type: 'select', options: WORK_TYPES.map((w) => ({ value: w, label: t(`wrk.wtype.${w}`) })) },
    { key: 'priority', labelKey: 'wrk.field.priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: t(`wrk.priority.${p}`) })) },
    { key: 'executingKind', labelKey: 'wrk.field.partyKind', type: 'select', options: PARTY_KINDS.map((k) => ({ value: k, label: t(`wrk.party.${k}`) })), hintKey: 'wrk.hint.executing' },
    { key: 'executingId', labelKey: 'wrk.field.party', type: 'select', showWhen: (v) => Boolean(v.executingKind), options: (v) => parties.options(String(v.executingKind ?? '')) },
    { key: 'requestedDue', labelKey: 'wrk.field.requestedDue', type: 'text', maxLength: 10, hintKey: 'wrk.hint.date' },
    { key: 'description', labelKey: 'wrk.field.description', type: 'textarea', maxLength: 2000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('wrk.title.workorders')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('wrk.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('wrk.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('wrk.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
          </select>
          <select aria-label={t('wrk.axis.progress')} value={progress} onChange={(e) => setProgress(e.target.value)}>
            <option value="">{t('wrk.filter.any_progress')}</option>
            {['planned', 'in_progress', 'on_hold', 'work_complete'].map((s) => <option key={s} value={s}>{t(`wrk.progress.${s}`)}</option>)}
          </select>
          <select aria-label={t('wrk.axis.closure')} value={closure} onChange={(e) => setClosure(e.target.value)}>
            <option value="">{t('wrk.filter.any_closure')}</option>
            {['open', 'closed', 'reopened'].map((s) => <option key={s} value={s}>{t(`wrk.closure.${s}`)}</option>)}
          </select>
          {can('wrk.work_order.create') ? <button className="primary" onClick={() => setCreating(true)}>{t('wrk.new.workorder')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('wrk.field.number')}</th><th scope="col">{t('wrk.field.title')}</th><th scope="col">{t('wrk.field.ship')}</th><th scope="col">{t('wrk.field.priority')}</th>
            <th scope="col">{t('wrk.axis.progress')}</th><th scope="col">{t('wrk.axis.approval')}</th><th scope="col">{t('wrk.axis.returnToService')}</th><th scope="col">{t('wrk.axis.closure')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={String(r.workOrderId)}>
                <td><button className="link" onClick={() => setOpen(String(r.workOrderId))}>{String(r.woNo)}</button></td>
                <td>{String(r.title)}{r.handoverPending ? ` · ${t('wrk.handover.pending')}` : ''}</td><td>{shipName(r.shipId)}</td>
                <td><StatusChip value={String(r.priority)} labelPrefix="wrk.priority" /></td>
                <td><StatusChip value={String(r.progress)} labelPrefix="wrk.progress" /></td>
                <td><StatusChip value={String(r.approval)} labelPrefix="wrk.approval" /></td>
                <td><StatusChip value={String(r.returnToService)} labelPrefix="wrk.rts" /></td>
                <td><StatusChip value={String(r.closure)} labelPrefix="wrk.closure" /></td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={8} className="empty">{t('wrk.workorders.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {open ? <WorkOrderDetail workOrderId={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? (
        <FormModal title={t('wrk.new.workorder')} fields={fields} record={null} tz={tz} defaults={{ workType: 'corrective', priority: 'normal' }} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const { assetTag, executingKind, executingId, ...rest } = body;
            const payload: Record<string, unknown> = { ...rest };
            if (assetTag) payload.assetId = (await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`)).id;
            if (executingKind && executingId) payload.executingParty = { kind: executingKind, id: executingId };
            await api('POST', `${WRK}/work-orders`, payload);
            list.reload();
          }} />
      ) : null}
    </section>
  );
}
