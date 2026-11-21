/** Equipment, repair and temporary issue register (FR-E1..E5). */
import { useState } from 'react';
import { api, ApiError, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { DueCell, OFC, OfficePicker, show, useGet, useOffice, usePersons, type Page } from './binding';
import { RecordPanel } from './RecordPanel';
import { NewWorkOrderModal, WorkOrderDetail } from './WorkOrdersScreen';

export const CONDITIONS = ['serviceable', 'unserviceable', 'repairable', 'ber', 'unknown'];
export const STATES = ['in_store', 'in_workshop', 'at_external', 'awaiting_collection', 'returned', 'on_issue'];
const VIEWS = ['with_us', 'in_repair', 'at_external', 'pending_collection', 'on_issue', 'overdue_return', 'all'];
/** Movements offered for each state (mirrors the server's flow). */
const NEXT: Record<string, string[]> = {
  in_store: ['received_for_repair', 'sent_out', 'ready_for_collection', 'collected', 'issued'], in_workshop: ['sent_out', 'repair_completed', 'ready_for_collection', 'collected'],
  at_external: ['returned_from_external'], awaiting_collection: ['collected'], returned: ['received_for_repair', 'issued'], on_issue: ['returned_from_issue'],
};

export function EquipmentScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const C = office.commandId;
  const people = usePersons(C);
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [view, setView] = useState('with_us');
  const [q, setQ] = useState('');
  const list = useGet<Page>(C ? `${OFC}/equipment` : null, { commandId: C, view, q: q || undefined, limit: '1000' });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dup, setDup] = useState<{ body: Record<string, unknown>; message: string } | null>(null);
  const unitOpts = (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) }));
  const fields: FieldDef[] = [
    { key: 'name', labelKey: 'ofc.field.equipName', type: 'text', required: true, maxLength: 200 },
    { key: 'equipNo', labelKey: 'ofc.field.equipNo', type: 'text', maxLength: 80 },
    { key: 'makeModel', labelKey: 'ofc.field.makeModel', type: 'text', maxLength: 200 },
    { key: 'serialNo', labelKey: 'ofc.field.serialNo', type: 'text', maxLength: 120 },
    { key: 'owningUnit', labelKey: 'ofc.field.owningUnit', type: 'text', maxLength: 200, hintKey: 'ofc.hint.owningUnit' },
    { key: 'ownerUnitId', labelKey: 'ofc.field.ownerUnit', type: 'select', options: unitOpts, hintKey: 'ofc.hint.ownerUnit' },
    { key: 'condition', labelKey: 'ofc.field.condition', type: 'select', options: CONDITIONS.map((c) => ({ value: c, label: t(`ofc.cond.${c}`) })) },
    { key: 'responsiblePersonId', labelKey: 'ofc.field.responsible', type: 'select', options: people.options },
    { key: 'locationText', labelKey: 'ofc.field.location', type: 'text', maxLength: 200 },
    { key: 'assetTag', labelKey: 'ofc.field.assetTag', type: 'text', maxLength: 40, hintKey: 'ofc.hint.assetTag' },
    { key: 'receivedForRepair', labelKey: 'ofc.field.receivedForRepair', type: 'checkbox' },
    { key: 'documentRef', labelKey: 'ofc.field.documentRef', type: 'text', maxLength: 120, showWhen: (v) => Boolean(v.receivedForRepair) },
    { key: 'defect', labelKey: 'ofc.field.defect', type: 'textarea', maxLength: 2000, showWhen: (v) => Boolean(v.receivedForRepair) },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
  ];
  async function create(body: Record<string, unknown>) {
    try { await api('POST', `${OFC}/equipment`, { ...body, commandId: C }); list.reload(); } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') { setDup({ body, message: e.message }); return; }
      throw e;
    }
  }
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.equipment')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.equipment.create') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.equipment')}</button> : null}
        </div>
      </div>
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.equipment')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value)}>{VIEWS.map((v) => <option key={v} value={v}>{t(`ofc.eview.${v}`)}</option>)}</select>
        <span className="muted">{t('ofc.count', { n: list.data?.total ?? 0 })}</span>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.equipName')}</th><th scope="col">{t('ofc.field.equipNo')}</th><th scope="col">{t('ofc.field.serialNo')}</th>
            <th scope="col">{t('ofc.field.owningUnit')}</th><th scope="col">{t('ofc.field.location')}</th><th scope="col">{t('ofc.field.condition')}</th><th scope="col">{t('ofc.field.state')}</th><th scope="col">{t('ofc.field.expectedReturn')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(r.id)}>{String(r.refNo)}</button></td><td>{String(r.name)}{r.makeModel ? <small className="muted"> {String(r.makeModel)}</small> : null}</td>
                <td>{show(r.equipNo)}</td><td>{show(r.serialNo)}</td><td>{show(r.owningUnit)}</td><td>{show(r.locationText)}</td>
                <td><StatusChip value={String(r.condition)} labelPrefix="ofc.cond" /></td><td><StatusChip value={String(r.state)} labelPrefix="ofc.estate" /></td>
                <td><DueCell date={r.expectedReturn} overdue={r.overdueReturn} /></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={9} className="empty">{t('ofc.equipment.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <EquipmentDetail id={open} units={units.data?.items ?? []} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? <FormModal title={t('ofc.new.equipment')} fields={fields} record={null} tz={tz} defaults={{ condition: 'unknown' }} submitKey="common.create" onClose={() => setCreating(false)} onSubmit={create} /> : null}
      {dup ? (
        <Modal title={t('ofc.dup.title')} onClose={() => setDup(null)}>
          <p>{dup.message}</p>
          <footer><button onClick={() => setDup(null)}>{t('common.cancel')}</button>
            <button className="primary" onClick={() => { void api('POST', `${OFC}/equipment`, { ...dup.body, commandId: C, allowDuplicate: true }).then(() => { setDup(null); list.reload(); }); }}>{t('ofc.dup.register')}</button></footer>
        </Modal>
      ) : null}
    </section>
  );
}

function EquipmentDetail({ id, units, onClose, onChanged }: { id: string; units: Rec[]; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const d = useGet<Rec>(`${OFC}/equipment/${id}`);
  const r = d.data;
  const people = usePersons(String(r?.commandId ?? ''));
  const [move, setMove] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [newWo, setNewWo] = useState(false);
  const [wo, setWo] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => { d.reload(); onChanged(); setTick((x) => x + 1); };
  const moveFields = (kind: string): FieldDef[] => [
    { key: 'date', labelKey: 'ofc.field.date', type: 'date', required: true },
    ...(['sent_out', 'issued', 'received_for_repair', 'returned_from_external', 'collected'].includes(kind) ? [{ key: 'toText', labelKey: kind === 'collected' ? 'ofc.field.collectedBy' : 'ofc.field.toWhere', type: 'text' as const, maxLength: 200, required: ['sent_out', 'issued'].includes(kind) }] : []),
    ...(['issued', 'collected', 'received_for_repair', 'returned_from_external'].includes(kind) ? [{ key: 'personId', labelKey: 'ofc.field.person', type: 'select' as const, options: people.options }] : []),
    ...(['sent_out', 'issued'].includes(kind) ? [{ key: 'expectedReturn', labelKey: 'ofc.field.expectedReturn', type: 'date' as const, required: kind === 'issued' }] : []),
    { key: 'condition', labelKey: 'ofc.field.condition', type: 'select', required: kind === 'condition', options: CONDITIONS.map((c) => ({ value: c, label: t(`ofc.cond.${c}`) })) },
    { key: 'documentRef', labelKey: 'ofc.field.documentRef', type: 'text', maxLength: 120 },
    { key: 'note', labelKey: 'ofc.field.note', type: 'textarea', maxLength: 2000 },
  ];
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  return (
    <Modal title={r ? `${String(r.refNo)} – ${String(r.name)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={d.error} />
      {r ? (
        <>
          <div className="axes"><StatusChip value={String(r.state)} labelPrefix="ofc.estate" /><StatusChip value={String(r.condition)} labelPrefix="ofc.cond" />{r.overdueReturn ? <span className="chip warn">{t('ofc.reply.overdue_return')}</span> : null}</div>
          <dl className="facts">
            <dt>{t('ofc.field.equipNo')}</dt><dd>{show(r.equipNo)}</dd><dt>{t('ofc.field.makeModel')}</dt><dd>{show(r.makeModel)}</dd><dt>{t('ofc.field.serialNo')}</dt><dd>{show(r.serialNo)}</dd>
            <dt>{t('ofc.field.owningUnit')}</dt><dd>{show(r.owningUnit)}{r.ownerUnitId ? ` · ${show(units.find((u) => u.id === r.ownerUnitId)?.path)}` : ''}</dd>
            <dt>{t('ofc.field.location')}</dt><dd>{show(r.locationText)}{r.custodianPersonId ? ` · ${people.name(r.custodianPersonId)}` : ''}</dd>
            <dt>{t('ofc.field.expectedReturn')}</dt><dd>{show(r.expectedReturn)}</dd><dt>{t('ofc.field.responsible')}</dt><dd>{people.name(r.responsiblePersonId)}</dd>
            {r.asset ? <><dt>{t('ofc.field.assetTag')}</dt><dd>{String((r.asset as Rec).tag)}</dd></> : null}
            <dt>{t('ofc.field.remarks')}</dt><dd>{show(r.remarks)}</dd>
          </dl>
          <div className="actions wrap">
            {can('ofc.equipment.record') ? (NEXT[String(r.state)] ?? []).concat('condition').map((k) => <button key={k} onClick={() => setMove(k)}>{t(`ofc.move.${k}`)}</button>) : null}
            {can('ofc.work_order.create') ? <button className="primary" onClick={() => setNewWo(true)}>{t('ofc.act.raise_wo')}</button> : null}
            {can('ofc.equipment.update') ? <button onClick={() => setEdit(true)}>{t('common.edit')}</button> : null}
          </div>
          <h3>{t('ofc.equipment.movements')}</h3>
          <table>
            <thead><tr><th scope="col">{t('ofc.field.date')}</th><th scope="col">{t('ofc.field.movement')}</th><th scope="col">{t('ofc.field.toWhere')}</th><th scope="col">{t('ofc.field.condition')}</th><th scope="col">{t('ofc.field.documentRef')}</th><th scope="col">{t('ofc.field.note')}</th></tr></thead>
            <tbody>{(r.movements as Rec[]).map((m) => (
              <tr key={m.id}><td>{String(m.movementDate)}</td><td>{t(`ofc.move.${String(m.kind)}`)}</td><td>{show(m.toText ?? m.fromText)}{m.personId ? ` · ${people.name(m.personId)}` : ''}{m.expectedReturn ? ` (${t('ofc.field.expectedReturn')} ${String(m.expectedReturn)})` : ''}</td>
                <td>{m.condition ? t(`ofc.cond.${String(m.condition)}`) : '—'}</td><td>{show(m.documentRef)}</td><td>{show(m.note)}</td></tr>
            ))}</tbody>
          </table>
          {(r.workOrders as Rec[]).length ? <p>{t('ofc.nav.workorders')}: {(r.workOrders as Rec[]).map((w) => <button key={w.id} className="link" onClick={() => setWo(w.id)}>{String(w.refNo)} ({t(`ofc.wstatus.${String(w.status)}`)})</button>)}</p> : null}
          <RecordPanel type="ofc.equipment" id={id} reloadKey={tick} />
        </>
      ) : null}
      {r && move ? (
        <FormModal title={t(`ofc.move.${move}`)} fields={moveFields(move)} record={null} tz={tz} defaults={{ date: today, condition: move === 'condition' ? '' : '' }} onClose={() => setMove(null)}
          onSubmit={async (b) => { await api('POST', `${OFC}/equipment/${id}/movements`, { ...b, kind: move, expectedVersion: r.version }); refresh(); }} />
      ) : null}
      {r && edit ? (
        <FormModal title={t('ofc.edit.record', { name: String(r.refNo) })} record={r} tz={tz} onClose={() => setEdit(false)} onSubmit={async (b) => { await api('PATCH', `${OFC}/equipment/${id}`, b); refresh(); }}
          fields={[
            { key: 'name', labelKey: 'ofc.field.equipName', type: 'text', required: true, maxLength: 200 }, { key: 'equipNo', labelKey: 'ofc.field.equipNo', type: 'text', maxLength: 80 },
            { key: 'makeModel', labelKey: 'ofc.field.makeModel', type: 'text', maxLength: 200 }, { key: 'serialNo', labelKey: 'ofc.field.serialNo', type: 'text', maxLength: 120 },
            { key: 'owningUnit', labelKey: 'ofc.field.owningUnit', type: 'text', maxLength: 200 },
            { key: 'ownerUnitId', labelKey: 'ofc.field.ownerUnit', type: 'select', options: units.map((u) => ({ value: String(u.id), label: String(u.path) })) },
            { key: 'responsiblePersonId', labelKey: 'ofc.field.responsible', type: 'select', options: people.options },
            { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
            { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, hintKey: 'ofc.hint.correction' },
          ]} />
      ) : null}
      {r && newWo ? <NewWorkOrderModal commandId={String(r.commandId)} defaults={{ title: `Repair ${String(r.name)}`, equipmentId: id, requestingUnit: String(r.owningUnit ?? ''), unitId: String(r.ownerUnitId ?? '') }} onClose={() => setNewWo(false)} onCreated={() => refresh()} /> : null}
      {wo ? <WorkOrderDetail id={wo} onClose={() => setWo(null)} onChanged={refresh} /> : null}
    </Modal>
  );
}
