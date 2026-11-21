/** Personnel and responsibility register (FR-P1..P5): people, duty, responsibilities, workload, reassignment on transfer. */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { usePeople } from '../wrk/people';
import { DueCell, OFC, OfficePicker, show, useGet, useOffice, usePersons, type Page } from './binding';
import { RecordPanel } from './RecordPanel';
import { TaskDetail } from './TasksScreen';

const DUTY = ['available', 'on_leave', 'temporary_duty', 'course', 'sick', 'transferred'];

export function PersonnelScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const C = office.commandId;
  const users = usePeople();
  const [inactive, setInactive] = useState(false);
  const [unitId, setUnitId] = useState('');
  const list = useGet<Page>(C ? `${OFC}/persons` : null, { commandId: C, includeInactive: inactive ? 'true' : undefined, unitId: unitId || undefined });
  const persons = usePersons(C);
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const unitName = (id: unknown) => show((units.data?.items ?? []).find((u) => u.id === id)?.path);
  const fields = personFields(units.data?.items ?? [], persons.options, users.options);
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.personnel')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.person.create') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.person')}</button> : null}
        </div>
      </div>
      <div className="tools">
        <select aria-label={t('ofc.field.unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t('ofc.filter.any_unit')}</option>{(units.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{String(u.path)}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> {t('ofc.filter.inactive_people')}</label>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.serviceNo')}</th><th scope="col">{t('ofc.field.rank')}</th><th scope="col">{t('ofc.field.name')}</th><th scope="col">{t('ofc.field.appointment')}</th>
            <th scope="col">{t('ofc.field.unit')}</th><th scope="col">{t('ofc.field.dutyStatus')}</th><th scope="col">{t('ofc.field.activeTasks')}</th><th scope="col">{t('ofc.field.overdueTasks')}</th><th scope="col">{t('ofc.field.signsIn')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((p) => (
              <tr key={p.id}>
                <td>{show(p.serviceNo)}</td><td>{show(p.rank)}</td><td><button className="link" onClick={() => setOpen(p.id)}>{String(p.name)}</button></td><td>{show(p.appointment)}</td>
                <td>{unitName(p.unitId)}</td><td><StatusChip value={String(p.dutyToday)} labelPrefix="ofc.duty" /></td>
                <td>{String(p.activeTasks)}</td><td>{Number(p.overdueTasks) ? <span className="chip warn">{String(p.overdueTasks)}</span> : '0'}</td>
                <td>{p.userId ? '✓' : '—'}</td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={9} className="empty">{t('ofc.persons.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <PersonDetail id={open} units={units.data?.items ?? []} onClose={() => setOpen(null)} onChanged={() => { list.reload(); persons.reload(); }} /> : null}
      {creating ? (
        <FormModal title={t('ofc.new.person')} fields={fields} record={null} tz={tz} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (b) => { await api('POST', `${OFC}/persons`, { ...b, commandId: C }); list.reload(); persons.reload(); }} />
      ) : null}
    </section>
  );
}

function personFields(units: Rec[], persons: Array<{ value: string; label: string }>, users: Array<{ value: string; label: string }>, editing = false): FieldDef[] {
  return [
    { key: 'serviceNo', labelKey: 'ofc.field.serviceNo', type: 'text', maxLength: 40 },
    { key: 'rank', labelKey: 'ofc.field.rank', type: 'text', maxLength: 60 },
    { key: 'name', labelKey: 'ofc.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'appointment', labelKey: 'ofc.field.appointment', type: 'text', maxLength: 160 },
    { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: units.map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'supervisorPersonId', labelKey: 'ofc.field.supervisor', type: 'select', options: persons },
    { key: 'contact', labelKey: 'ofc.field.contact', type: 'text', maxLength: 200 },
    { key: 'userId', labelKey: 'ofc.field.userAccount', type: 'select', options: users, hintKey: 'ofc.hint.userAccount' },
    ...(editing ? [
      { key: 'dutyStatus', labelKey: 'ofc.field.dutyStatus', type: 'select' as const, options: ['available', 'transferred'].map((d) => ({ value: d, label: t(`ofc.duty.${d}`) })), hintKey: 'ofc.hint.duty' },
      { key: 'status', labelKey: 'ofc.field.status', type: 'select' as const, options: ['active', 'inactive'].map((s) => ({ value: s, label: t(`ofc.ustatus.${s}`) })) },
      { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text' as const, maxLength: 500, hintKey: 'ofc.hint.correction' },
    ] : []),
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 2000 },
  ];
}

interface Detail { person: Rec; responsibilities: Rec[]; duty: Rec[]; tasks: Rec[]; formerly: Rec[]; handoverItems: Rec[]; correspondence: Rec[] }
type Act = 'edit' | 'resp' | 'duty' | 'reassign' | { end: Rec } | null;

function PersonDetail({ id, units, onClose, onChanged }: { id: string; units: Rec[]; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const users = usePeople();
  const d = useGet<Detail>(`${OFC}/persons/${id}`);
  const p = d.data?.person;
  const persons = usePersons(String(p?.commandId ?? ''));
  const [act, setAct] = useState<Act>(null);
  const [task, setTask] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const refresh = () => { d.reload(); onChanged(); };
  const others = persons.options.filter((o) => o.value !== id);
  return (
    <Modal title={p ? `${p.rank ? `${String(p.rank)} ` : ''}${String(p.name)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={d.error} />
      {p && d.data ? (
        <>
          <dl className="facts">
            <dt>{t('ofc.field.serviceNo')}</dt><dd>{show(p.serviceNo)}</dd><dt>{t('ofc.field.appointment')}</dt><dd>{show(p.appointment)}</dd>
            <dt>{t('ofc.field.unit')}</dt><dd>{show(units.find((u) => u.id === p.unitId)?.path)}</dd><dt>{t('ofc.field.supervisor')}</dt><dd>{persons.name(p.supervisorPersonId)}</dd>
            <dt>{t('ofc.field.contact')}</dt><dd>{show(p.contact)}</dd><dt>{t('ofc.field.dutyStatus')}</dt><dd><StatusChip value={String(p.dutyToday)} labelPrefix="ofc.duty" /></dd>
            <dt>{t('ofc.field.userAccount')}</dt><dd>{p.userId ? users.name(p.userId) : t('ofc.no_login')}</dd>
          </dl>
          {msg ? <p className="notice">{msg}</p> : null}
          <div className="actions wrap">
            {can('ofc.person.update') ? <button onClick={() => setAct('edit')}>{t('common.edit')}</button> : null}
            {can('ofc.person.update') ? <button onClick={() => setAct('resp')}>{t('ofc.act.add_resp')}</button> : null}
            {can('ofc.person.update') ? <button onClick={() => setAct('duty')}>{t('ofc.act.add_duty')}</button> : null}
            {can('ofc.person.reassign') ? <button onClick={() => setAct('reassign')}>{t('ofc.act.reassign_all')}</button> : null}
          </div>
          <h3>{t('ofc.person.workload')}</h3>
          <table>
            <thead><tr><th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.title')}</th><th scope="col">{t('ofc.field.targetDate')}</th><th scope="col">{t('ofc.field.status')}</th></tr></thead>
            <tbody>
              {d.data.tasks.map((x) => <tr key={x.id}><td><button className="link" onClick={() => setTask(x.id)}>{String(x.refNo)}</button></td><td>{String(x.title)}</td><td><DueCell date={x.targetDate} overdue={x.overdue} /></td><td><StatusChip value={String(x.status)} labelPrefix="ofc.tstatus" /></td></tr>)}
              {d.data.tasks.length === 0 ? <tr><td colSpan={4} className="empty">{t('ofc.tasks.empty')}</td></tr> : null}
            </tbody>
          </table>
          {d.data.handoverItems.length || d.data.correspondence.length ? (
            <p>{t('ofc.person.also', { items: d.data.handoverItems.length, letters: d.data.correspondence.length })}</p>
          ) : null}
          {d.data.formerly.length ? <p className="muted">{t('ofc.person.formerly')}: {d.data.formerly.map((x) => `${String(x.refNo)} ${String(x.title)}`).join('; ')}</p> : null}
          <h3>{t('ofc.person.responsibilities')}</h3>
          <ul className="plain">
            {d.data.responsibilities.map((x) => (
              <li key={x.id}>{String(x.title)} <small className="muted">{String(x.validFrom)} – {show(x.validTo)}</small>
                {!x.validTo && can('ofc.person.update') ? <> <button className="link" onClick={() => setAct({ end: x })}>{t('ofc.act.end')}</button></> : null}</li>
            ))}
            {d.data.responsibilities.length === 0 ? <li className="muted">{t('common.none')}</li> : null}
          </ul>
          <h3>{t('ofc.person.duty')}</h3>
          <ul className="plain">
            {d.data.duty.map((x) => <li key={x.id}>{t(`ofc.duty.${String(x.dutyStatus)}`)} {String(x.dateFrom)} – {show(x.dateTo)}{x.place ? ` · ${String(x.place)}` : ''}{x.actingPersonId ? ` · ${t('ofc.field.acting')}: ${persons.name(x.actingPersonId)}` : ''}</li>)}
            {d.data.duty.length === 0 ? <li className="muted">{t('common.none')}</li> : null}
          </ul>
          <RecordPanel type="ofc.person" id={id} />
        </>
      ) : null}
      {p && act === 'edit' ? (
        <FormModal title={t('ofc.edit.record', { name: String(p.name) })} fields={personFields(units, persons.options.filter((o) => o.value !== id), users.options, true)} record={p} tz={tz} onClose={() => setAct(null)}
          onSubmit={async (b) => { await api('PATCH', `${OFC}/persons/${id}`, b); refresh(); }} />
      ) : null}
      {p && act === 'resp' ? (
        <FormModal title={t('ofc.act.add_resp')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={async (b) => { await api('POST', `${OFC}/persons/${id}/responsibilities`, b); refresh(); }}
          fields={[{ key: 'title', labelKey: 'ofc.field.responsibility', type: 'text', required: true, maxLength: 200 }, { key: 'validFrom', labelKey: 'ofc.field.from', type: 'date' }, { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 1000 }]} />
      ) : null}
      {p && act === 'duty' ? (
        <FormModal title={t('ofc.act.add_duty')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={async (b) => { await api('POST', `${OFC}/persons/${id}/duty`, b); refresh(); }}
          fields={[
            { key: 'dutyStatus', labelKey: 'ofc.field.dutyStatus', type: 'select', required: true, options: ['on_leave', 'temporary_duty', 'course', 'sick'].map((x) => ({ value: x, label: t(`ofc.duty.${x}`) })) },
            { key: 'dateFrom', labelKey: 'ofc.field.from', type: 'date', required: true }, { key: 'dateTo', labelKey: 'ofc.field.to', type: 'date' },
            { key: 'place', labelKey: 'ofc.field.place', type: 'text', maxLength: 200 }, { key: 'actingPersonId', labelKey: 'ofc.field.acting', type: 'select', options: others },
            { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 1000 },
          ]} />
      ) : null}
      {p && act === 'reassign' ? (
        <FormModal title={t('ofc.act.reassign_all')} record={null} tz={tz} onClose={() => setAct(null)} submitKey="ofc.act.reassign_all"
          extra={<p className="hint">{t('ofc.hint.reassign_all')}</p>}
          onSubmit={async (b) => { const r = await api<{ tasks: number; handoverItems: number; correspondence: number }>('POST', `${OFC}/persons/${id}/reassign`, b); setMsg(t('ofc.reassigned', r)); refresh(); }}
          fields={[
            { key: 'toPersonId', labelKey: 'ofc.field.toPerson', type: 'select', required: true, options: others }, { key: 'reason', labelKey: 'ofc.field.reason', type: 'text', required: true, maxLength: 500 },
            { key: 'includeHandoverItems', labelKey: 'ofc.field.inclHandover', type: 'checkbox' }, { key: 'includeCorrespondence', labelKey: 'ofc.field.inclLetters', type: 'checkbox' },
          ]} defaults={{ includeHandoverItems: true, includeCorrespondence: true }} />
      ) : null}
      {act && typeof act === 'object' ? (
        <ReasonModal title={t('ofc.act.end_title', { name: String(act.end.title) })} confirmKey="ofc.act.end" onClose={() => setAct(null)}
          onConfirm={async (reason) => { await api('POST', `${OFC}/responsibilities/${act.end.id}/end`, { expectedVersion: act.end.version, reason }); refresh(); }} />
      ) : null}
      {task ? <TaskDetail id={task} onOpen={setTask} onClose={() => setTask(null)} onChanged={refresh} /> : null}
    </Modal>
  );
}

export { DUTY };
