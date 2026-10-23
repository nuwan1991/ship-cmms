import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, Modal, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { ORG, WRK } from './binding';
import { AxisChips } from './WorkOrderDetail';

function CaseDetail({ caseId, onClose, onChanged }: { caseId: string; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const [kase, setKase] = useState<Rec | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const [reopen, setReopen] = useState(false);
  const [addWo, setAddWo] = useState(false);
  const load = () => api<Rec>('GET', `${WRK}/repair-cases/${caseId}/summary`).then(setKase, setErr);
  useEffect(() => { void load(); }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (path: string, body: unknown) => api('POST', `${WRK}/repair-cases/${caseId}/${path}`, body).then(() => { setErr(null); void load(); onChanged(); }, (e: Error) => { setErr(e); throw e; });
  const ax = kase?.axes as { progress: string; approval: string; returnToService: string; closure: string } | undefined;
  const wos = (kase?.workOrders as Rec[]) ?? [];
  const defects = (kase?.defects as Rec[]) ?? [];
  return (
    <Modal title={kase ? `${String(kase.caseNo)} – ${String(kase.title)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={err} />
      {ax ? <AxisChips axes={ax} /> : null}
      {kase?.description ? <p>{String(kase.description)}</p> : null}
      {ax && can('wrk.repair_case.progress') && ax.closure !== 'closed' ? (
        <div className="tools">
          {ax.progress === 'planned' ? <button onClick={() => void run('progress', { to: 'in_progress' })}>{t('wrk.act.start')}</button> : null}
          {ax.progress === 'in_progress' ? <button onClick={() => void run('progress', { to: 'on_hold' })}>{t('wrk.act.hold')}</button> : null}
          {ax.progress === 'on_hold' ? <button onClick={() => void run('progress', { to: 'in_progress' })}>{t('wrk.act.resume')}</button> : null}
          {ax.progress === 'in_progress' ? <button onClick={() => void run('progress', { to: 'work_complete' })}>{t('wrk.act.complete')}</button> : null}
          {can('wrk.repair_case.close') ? <button onClick={() => void run('close', {})}>{t('wrk.act.close')}</button> : null}
          {can('wrk.work_order.create') ? <button className="primary" onClick={() => setAddWo(true)}>{t('wrk.new.workorder')}</button> : null}
        </div>
      ) : null}
      {ax?.closure === 'closed' && can('wrk.repair_case.reopen') ? <div className="tools"><button onClick={() => setReopen(true)}>{t('wrk.act.reopen')}</button></div> : null}
      <h3>{t('wrk.title.workorders')}</h3>
      <ul className="plain">{wos.map((w) => <li key={String(w.workOrderId)}>{String(w.woNo)} – {String(w.title)} <StatusChip value={String(w.progress)} labelPrefix="wrk.progress" /> <StatusChip value={String(w.closure)} labelPrefix="wrk.closure" /></li>)}{wos.length === 0 ? <li className="empty">{t('wrk.workorders.empty')}</li> : null}</ul>
      <h3>{t('wrk.title.defects')}</h3>
      <ul className="plain">{defects.map((d) => <li key={String(d.id)}>{String(d.defectNo)} – {String(d.title)}</li>)}{defects.length === 0 ? <li className="empty">{t('common.empty')}</li> : null}</ul>
      <footer><button onClick={onClose}>{t('common.close')}</button></footer>
      {reopen ? <ReasonModal title={t('wrk.act.reopen')} confirmKey="wrk.act.reopen" onClose={() => setReopen(false)} onConfirm={(reason) => run('reopen', { reason })} /> : null}
      {addWo ? (
        <FormModal title={t('wrk.new.workorder')} tz={tz} record={null} submitKey="common.create" onClose={() => setAddWo(false)} defaults={{ workType: 'corrective', priority: 'normal' }}
          fields={[{ key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 }, { key: 'workType', labelKey: 'wrk.field.workType', type: 'select', options: ['corrective', 'preventive', 'inspection', 'modification'].map((w) => ({ value: w, label: t(`wrk.wtype.${w}`) })) }]}
          onSubmit={async (b) => { await api('POST', `${WRK}/work-orders`, { ...b, repairCaseId: caseId }); void load(); onChanged(); }} />
      ) : null}
    </Modal>
  );
}

/** Repair cases group the defects and work orders for one problem, possibly spanning departments or providers. */
export function CasesScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const [shipId, setShipId] = useState('');
  const [q, setQ] = useState('');
  const list = useList(`${WRK}/repair-cases`, { shipId: shipId || undefined, q: q || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'shipId', labelKey: 'wrk.field.ship', type: 'select', required: true, options: ships.items.map((s) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` })) },
    { key: 'priority', labelKey: 'wrk.field.priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map((p) => ({ value: p, label: t(`wrk.priority.${p}`) })) },
    { key: 'description', labelKey: 'wrk.field.description', type: 'textarea', maxLength: 2000 },
  ];
  const shipName = (id: unknown) => String(ships.items.find((s) => s.id === id)?.name ?? id ?? '');
  return (
    <section>
      <div className="page-head">
        <h1>{t('wrk.title.cases')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('wrk.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('wrk.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('wrk.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
          </select>
          {can('wrk.repair_case.create') ? <button className="primary" onClick={() => setCreating(true)}>{t('wrk.new.case')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('wrk.field.number')}</th><th scope="col">{t('wrk.field.title')}</th><th scope="col">{t('wrk.field.ship')}</th><th scope="col">{t('wrk.field.priority')}</th></tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(String(r.id))}>{String(r.caseNo)}</button></td><td>{String(r.title)}</td><td>{shipName(r.homeScopeId)}</td>
                <td><StatusChip value={String(r.priority)} labelPrefix="wrk.priority" /></td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={4} className="empty">{t('wrk.cases.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {open ? <CaseDetail caseId={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? <FormModal title={t('wrk.new.case')} fields={fields} record={null} tz={tz} defaults={{ priority: 'normal' }} submitKey="common.create" onClose={() => setCreating(false)} onSubmit={async (b) => { await api('POST', `${WRK}/repair-cases`, b); list.reload(); }} /> : null}
    </section>
  );
}
