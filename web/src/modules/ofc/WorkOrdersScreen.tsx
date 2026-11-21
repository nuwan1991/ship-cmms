/** Office work orders (FR-W1..W4): the ten statuses, approval with reference, assignment, progress, verification and closure. */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { DueCell, OFC, OfficePicker, priorityOptions, show, useGet, useOffice, usePersons, type Page } from './binding';
import { RecordPanel } from './RecordPanel';

export const WO_STATUSES = ['requested', 'under_review', 'approved', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external', 'completed', 'verified', 'closed', 'cancelled'];
const VIEWS = ['outstanding', 'overdue', 'awaiting_approval', 'waiting', 'to_verify', 'done', 'all'];
const MOVES: Record<string, string[]> = {
  requested: ['under_review'], under_review: ['requested'], assigned: ['in_progress', 'awaiting_spares', 'awaiting_external'], in_progress: ['awaiting_spares', 'awaiting_external'],
  awaiting_spares: ['in_progress', 'awaiting_external'], awaiting_external: ['in_progress', 'awaiting_spares'],
};

export function NewWorkOrderModal({ commandId, sourceLetterId, sourceTaskId, defaults, onClose, onCreated }: {
  commandId: string; sourceLetterId?: string; sourceTaskId?: string; defaults?: Record<string, string>; onClose(): void; onCreated?(id: string): void;
}) {
  const { tz } = useSystem();
  const units = useGet<Page>(commandId ? `${OFC}/units` : null, { commandId });
  const equipment = useGet<Page>(commandId ? `${OFC}/equipment` : null, { commandId, view: 'with_us', limit: '1000' });
  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'ofc.field.title', type: 'text', required: !sourceLetterId && !sourceTaskId, maxLength: 200 },
    { key: 'requestingUnit', labelKey: 'ofc.field.requestingUnit', type: 'text', maxLength: 200 },
    { key: 'requestedBy', labelKey: 'ofc.field.requestedBy', type: 'text', maxLength: 200 },
    { key: 'requestDate', labelKey: 'ofc.field.requestDate', type: 'date' },
    { key: 'equipmentId', labelKey: 'ofc.field.equipment', type: 'select', options: (equipment.data?.items ?? []).map((e) => ({ value: String(e.id), label: `${String(e.refNo)} – ${String(e.name)}${e.serialNo ? ` (${String(e.serialNo)})` : ''}` })) },
    { key: 'reportedDefect', labelKey: 'ofc.field.defect', type: 'textarea', maxLength: 4000 },
    { key: 'unitId', labelKey: 'ofc.field.workshop', type: 'select', options: (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
    { key: 'targetDate', labelKey: 'ofc.field.targetDate', type: 'date' },
    { key: 'materialsRequired', labelKey: 'ofc.field.materials', type: 'textarea', maxLength: 4000 },
  ];
  return (
    <FormModal title={t('ofc.new.workorder')} fields={fields} record={null} tz={tz} defaults={{ priority: 'normal', ...(defaults ?? {}) }} submitKey="common.create" onClose={onClose}
      onSubmit={async (b) => { const r = await api<Rec>('POST', `${OFC}/work-orders`, { ...b, ...(sourceLetterId ? { sourceLetterId } : sourceTaskId ? { sourceTaskId } : { commandId }) }); onCreated?.(r.id); }} />
  );
}

export function WorkOrdersScreen() {
  const office = useOffice();
  const C = office.commandId;
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [view, setView] = useState('outstanding');
  const [unitId, setUnitId] = useState('');
  const [q, setQ] = useState('');
  const list = useGet<Page>(C ? `${OFC}/work-orders` : null, { commandId: C, view, unitId: unitId || undefined, q: q || undefined, limit: '1000' });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.workorders')}</h1>
        <div className="tools"><OfficePicker office={office} />{can('ofc.work_order.create') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.workorder')}</button> : null}</div>
      </div>
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.workorders')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value)}>{VIEWS.map((v) => <option key={v} value={v}>{t(`ofc.wview.${v}`)}</option>)}</select>
        <select aria-label={t('ofc.field.workshop')} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t('ofc.filter.any_unit')}</option>{(units.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{String(u.path)}</option>)}
        </select>
        <span className="muted">{t('ofc.count', { n: list.data?.total ?? 0 })}</span>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.title')}</th><th scope="col">{t('ofc.field.requestingUnit')}</th><th scope="col">{t('ofc.field.workshop')}</th>
            <th scope="col">{t('ofc.field.priority')}</th><th scope="col">{t('ofc.field.requestDate')}</th><th scope="col">{t('ofc.field.targetDate')}</th><th scope="col">{t('ofc.field.status')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(r.id)}>{String(r.refNo)}</button></td><td>{String(r.title)}</td><td>{show(r.requestingUnit)}</td>
                <td>{show((units.data?.items ?? []).find((u) => u.id === r.unitId)?.code)}</td><td><StatusChip value={String(r.priority)} labelPrefix="ofc.priority" /></td>
                <td>{String(r.requestDate)}</td><td><DueCell date={r.targetDate} overdue={r.overdue} /></td><td><StatusChip value={String(r.status)} labelPrefix="ofc.wstatus" /></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">{t('ofc.workorders.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <WorkOrderDetail id={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? <NewWorkOrderModal commandId={C} onClose={() => setCreating(false)} onCreated={() => list.reload()} /> : null}
    </section>
  );
}

type Act = 'approve' | 'assign' | 'complete' | 'verify' | 'close' | 'reopen' | 'cancel' | 'edit' | 'supply' | { status: string } | null;

export function WorkOrderDetail({ id, onClose, onChanged }: { id: string; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const d = useGet<Rec>(`${OFC}/work-orders/${id}`);
  const r = d.data;
  const C = String(r?.commandId ?? '');
  const people = usePersons(C);
  const units = useGet<Page>(r ? `${OFC}/units` : null, { commandId: C });
  const demands = useGet<Page & { stages: string[] }>(r ? `${OFC}/supply` : null, { commandId: C, workOrderId: id, view: 'all' });
  const [act, setAct] = useState<Act>(null);
  const [tick, setTick] = useState(0);
  const p = (r?.permissions ?? {}) as Record<string, boolean>;
  const refresh = () => { d.reload(); demands.reload(); onChanged(); setTick((x) => x + 1); };
  const post = async (path: string, b: Record<string, unknown>) => { await api('POST', `${OFC}/work-orders/${id}/${path}`, { expectedVersion: r!.version, ...b }); refresh(); };
  const needDelay = Boolean(r?.overdue) && !r?.delayReason;
  const delay: FieldDef[] = needDelay ? [{ key: 'delayReason', labelKey: 'ofc.field.delayReason', type: 'text', required: true, maxLength: 1000 }] : [];
  const crew = (r?.crew as string[] | undefined) ?? [];
  return (
    <Modal title={r ? `${String(r.refNo)} – ${String(r.title)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={d.error} />
      {r ? (
        <>
          <div className="axes"><StatusChip value={String(r.status)} labelPrefix="ofc.wstatus" /><StatusChip value={String(r.priority)} labelPrefix="ofc.priority" />{r.overdue ? <span className="chip warn">{t('ofc.overdue')}</span> : null}</div>
          <dl className="facts">
            <dt>{t('ofc.field.requestingUnit')}</dt><dd>{show(r.requestingUnit)}{r.requestedBy ? ` · ${String(r.requestedBy)}` : ''} ({String(r.requestDate)})</dd>
            <dt>{t('ofc.field.equipment')}</dt><dd>{r.equipment ? `${String((r.equipment as Rec).refNo)} – ${String((r.equipment as Rec).name)}${(r.equipment as Rec).serialNo ? ` (${String((r.equipment as Rec).serialNo)})` : ''}` : '—'}</dd>
            <dt>{t('ofc.field.defect')}</dt><dd>{show(r.reportedDefect)}</dd>
            <dt>{t('ofc.field.workshop')}</dt><dd>{show((units.data?.items ?? []).find((u) => u.id === r.unitId)?.path)}</dd>
            <dt>{t('ofc.field.supervisor')}</dt><dd>{people.name(r.supervisorPersonId)}</dd>
            <dt>{t('ofc.field.crew')}</dt><dd>{crew.length ? crew.map((c) => people.name(c)).join(', ') : '—'}</dd>
            <dt>{t('ofc.field.targetDate')}</dt><dd>{show(r.targetDate)}</dd>
            <dt>{t('ofc.field.approval')}</dt><dd>{r.approvedAt ? `${String(r.approvedAt)}${r.approvalRef ? ` · ${String(r.approvalRef)}` : ''}` : '—'}</dd>
            <dt>{t('ofc.field.actionsTaken')}</dt><dd>{show(r.actionsTaken)}</dd><dt>{t('ofc.field.materials')}</dt><dd>{show(r.materialsRequired)}</dd>
            {r.externalAgency ? <><dt>{t('ofc.field.externalAgency')}</dt><dd>{String(r.externalAgency)}</dd></> : null}
            <dt>{t('ofc.field.delayReason')}</dt><dd>{show(r.delayReason)}</dd>
            {r.completionDetails ? <><dt>{t('ofc.field.completionNote')}</dt><dd>{String(r.completionDetails)} ({show(r.completedAt)})</dd></> : null}
            {r.verifiedAt ? <><dt>{t('ofc.field.verified')}</dt><dd>{String(r.verifiedAt)}{r.verifyNote ? ` – ${String(r.verifyNote)}` : ''}</dd></> : null}
          </dl>
          <div className="actions wrap">
            {p.approve ? <button className="primary" onClick={() => setAct('approve')}>{t('ofc.act.approve')}</button> : null}
            {p.assign ? <button onClick={() => setAct('assign')}>{t(r.status === 'approved' ? 'ofc.act.assign' : 'ofc.act.reassign')}</button> : null}
            {(p.update || p.approve) ? (MOVES[String(r.status)] ?? []).map((s) => <button key={s} onClick={() => setAct({ status: s })}>{t(`ofc.wto.${s}`)}</button>) : null}
            {p.complete ? <button className="primary" onClick={() => setAct('complete')}>{t('ofc.act.complete')}</button> : null}
            {p.verify ? <button className="primary" onClick={() => setAct('verify')}>{t('ofc.act.verify')}</button> : null}
            {p.close ? <button className="primary" onClick={() => setAct('close')}>{t('ofc.act.close_wo')}</button> : null}
            {p.reopen ? <button onClick={() => setAct('reopen')}>{t('ofc.act.send_back')}</button> : null}
            {p.update ? <button onClick={() => setAct('edit')}>{t('common.edit')}</button> : null}
            {can('ofc.supply.create') && p.update ? <button onClick={() => setAct('supply')}>{t('ofc.act.add_demand')}</button> : null}
            {p.cancel ? <button className="danger" onClick={() => setAct('cancel')}>{t('ofc.act.cancel')}</button> : null}
          </div>
          {(demands.data?.items.length ?? 0) ? (
            <>
              <h3>{t('ofc.nav.supply')}</h3>
              <ul className="plain">{demands.data!.items.map((s) => <li key={s.id}>{String(s.refNo)} {s.supplyRef ? `(${String(s.supplyRef)})` : ''} {String(s.item)} · <strong>{String(s.stage)}</strong> {t('ofc.supply.since', { date: String(s.stageDate), n: Number(s.daysInStage) })}{s.overdue ? <> <span className="chip warn">{t('ofc.overdue')}</span></> : null}</li>)}</ul>
            </>
          ) : null}
          <RecordPanel type="ofc.work_order" id={id} reloadKey={tick} />
        </>
      ) : null}
      {r && act === 'approve' ? <FormModal title={t('ofc.act.approve')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post('approve', b)} submitKey="ofc.act.approve"
        extra={<p className="hint">{t('ofc.hint.approve')}</p>} fields={[{ key: 'approvalRef', labelKey: 'ofc.field.approvalRef', type: 'text', maxLength: 120 }, { key: 'note', labelKey: 'ofc.field.note', type: 'textarea', maxLength: 2000 }]} /> : null}
      {r && act === 'assign' ? <FormModal title={t('ofc.act.assign')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post('assign', b)}
        defaults={{ unitId: String(r.unitId ?? ''), supervisorPersonId: String(r.supervisorPersonId ?? ''), crew: crew.join(',') }}
        fields={[
          { key: 'unitId', labelKey: 'ofc.field.workshop', type: 'select', required: true, options: (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) })) },
          { key: 'supervisorPersonId', labelKey: 'ofc.field.supervisor', type: 'select', options: people.options },
          { key: 'crew', labelKey: 'ofc.field.crew', type: 'multiselect', options: people.options },
          ...(r.status !== 'approved' ? [{ key: 'reason', labelKey: 'ofc.field.reason', type: 'text' as const, required: true, maxLength: 500 }] : []),
        ]} /> : null}
      {r && act && typeof act === 'object' ? <FormModal title={t(`ofc.wto.${act.status}`)} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post('status', { status: act.status, ...b })}
        fields={[...delay, ...(act.status === 'awaiting_external' ? [{ key: 'externalAgency', labelKey: 'ofc.field.externalAgency', type: 'text' as const, required: !r.externalAgency, maxLength: 200 }] : []), { key: 'note', labelKey: 'ofc.field.note', type: 'textarea', maxLength: 2000 }]} /> : null}
      {r && act === 'complete' ? <FormModal title={t('ofc.act.complete')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post('complete', b)} submitKey="ofc.act.complete"
        fields={[{ key: 'completionDetails', labelKey: 'ofc.field.completionNote', type: 'textarea', required: true, maxLength: 8000 }, { key: 'actionsTaken', labelKey: 'ofc.field.actionsTaken', type: 'textarea', maxLength: 8000 }, ...delay]} /> : null}
      {r && (act === 'verify' || act === 'close') ? <FormModal title={t(act === 'verify' ? 'ofc.act.verify' : 'ofc.act.close_wo')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post(act, b)} submitKey={act === 'verify' ? 'ofc.act.verify' : 'ofc.act.close_wo'}
        fields={[{ key: 'note', labelKey: 'ofc.field.verifyNote', type: 'textarea', maxLength: 2000 }]} /> : null}
      {r && (act === 'reopen' || act === 'cancel') ? <ReasonModal title={t(act === 'reopen' ? 'ofc.act.send_back' : 'ofc.act.cancel_title', { name: String(r.refNo) })} confirmKey={act === 'reopen' ? 'ofc.act.send_back' : 'ofc.act.cancel'} onClose={() => setAct(null)} onConfirm={(reason) => post(act, { reason })} /> : null}
      {r && act === 'edit' ? <FormModal title={t('ofc.edit.record', { name: String(r.refNo) })} record={r} tz={tz} onClose={() => setAct(null)} onSubmit={async (b) => { await api('PATCH', `${OFC}/work-orders/${id}`, b); refresh(); }}
        fields={[
          { key: 'title', labelKey: 'ofc.field.title', type: 'text', required: true, maxLength: 200 }, { key: 'requestingUnit', labelKey: 'ofc.field.requestingUnit', type: 'text', maxLength: 200 },
          { key: 'reportedDefect', labelKey: 'ofc.field.defect', type: 'textarea', maxLength: 4000 }, { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
          { key: 'targetDate', labelKey: 'ofc.field.targetDate', type: 'date' }, { key: 'actionsTaken', labelKey: 'ofc.field.actionsTaken', type: 'textarea', maxLength: 8000 },
          { key: 'materialsRequired', labelKey: 'ofc.field.materials', type: 'textarea', maxLength: 4000 }, { key: 'delayReason', labelKey: 'ofc.field.delayReason', type: 'text', maxLength: 1000 },
          { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 }, { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, hintKey: 'ofc.hint.task_reason' },
        ]} /> : null}
      {r && act === 'supply' ? <FormModal title={t('ofc.act.add_demand')} record={null} tz={tz} onClose={() => setAct(null)}
        onSubmit={async (b) => { await api('POST', `${OFC}/supply`, { ...b, commandId: C, workOrderId: id, unitId: r.unitId ?? undefined, demandingUnit: String(r.requestingUnit ?? '') || undefined }); refresh(); }}
        fields={[
          { key: 'item', labelKey: 'ofc.field.item', type: 'text', required: true, maxLength: 300 }, { key: 'partNo', labelKey: 'ofc.field.partNo', type: 'text', maxLength: 80 },
          { key: 'quantity', labelKey: 'ofc.field.quantity', type: 'number' }, { key: 'supplyRef', labelKey: 'ofc.field.supplyRef', type: 'text', maxLength: 80, hintKey: 'ofc.hint.supplyRef' },
          { key: 'expectedDate', labelKey: 'ofc.field.expectedDate', type: 'date' },
        ]} /> : null}
    </Modal>
  );
}
