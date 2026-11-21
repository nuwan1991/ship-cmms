/** Tasks and actions (FR-T1..T6): list with views and filters, detail with the allowed actions, subtasks and history. */
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

export const TASK_STATUSES = ['not_started', 'assigned', 'in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold', 'completed', 'closed', 'cancelled'] as const;
export const VIEWS = ['active', 'overdue', 'due_soon', 'attention', 'awaiting_verification', 'done', 'all'] as const;
const MOVES: Record<string, string[]> = {
  not_started: ['in_progress'], assigned: ['in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold'],
  in_progress: ['awaiting_info', 'awaiting_approval', 'on_hold'], awaiting_info: ['in_progress', 'awaiting_approval', 'on_hold'],
  awaiting_approval: ['in_progress', 'awaiting_info', 'on_hold'], on_hold: ['in_progress', 'awaiting_info', 'awaiting_approval'],
};

/** New task form; `source` / `parentId` create it from a letter, handover item or main task (the server carries the details over). */
export function NewTaskModal({ commandId, source, parentId, defaults, onClose, onCreated }: {
  commandId: string; source?: { type: string; id: string }; parentId?: string; defaults?: Record<string, string>; onClose(): void; onCreated?(id: string): void;
}) {
  const { tz } = useSystem();
  const people = usePersons(commandId);
  const units = useGet<Page>(commandId ? `${OFC}/units` : null, { commandId });
  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'ofc.field.title', type: 'text', required: !source, maxLength: 200, ...(source ? { hintKey: 'ofc.hint.task_from_source' } : {}) },
    { key: 'assigneePersonId', labelKey: 'ofc.field.assignee', type: 'select', options: people.options },
    { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
    { key: 'targetDate', labelKey: 'ofc.field.targetDate', type: 'date' },
    { key: 'description', labelKey: 'ofc.field.description', type: 'textarea', maxLength: 4000 },
  ];
  return (
    <FormModal title={t(parentId ? 'ofc.new.subtask' : source ? 'ofc.new.task_from' : 'ofc.new.task')} fields={fields} record={null} tz={tz} defaults={defaults ?? {}} submitKey="common.create" onClose={onClose}
      onSubmit={async (body) => {
        const r = await api<Rec>('POST', `${OFC}/tasks`, { ...body, ...(parentId ? { parentId } : source ? { source } : { commandId }) });
        onCreated?.(r.id);
      }} />
  );
}

export function TasksScreen({ mineOnly = false }: { mineOnly?: boolean }) {
  const office = useOffice();
  const C = office.commandId;
  const people = usePersons(C);
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [view, setView] = useState<string>(() => new URLSearchParams(window.location.search).get('view') ?? 'active');
  const [assignee, setAssignee] = useState(() => new URLSearchParams(window.location.search).get('assignee') ?? '');
  const [unitId, setUnitId] = useState('');
  const [priority, setPriority] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useGet<Page>(C ? `${OFC}/tasks` : null, {
    commandId: C, view, assigneePersonId: assignee || undefined, unitId: unitId || undefined, priority: priority || undefined, status: status || undefined,
    q: q || undefined, mine: mineOnly ? 'true' : undefined, limit: '1000',
  });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <section>
      <div className="page-head">
        <h1>{t(mineOnly ? 'ofc.title.my_tasks' : 'ofc.title.tasks')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {!mineOnly && can('ofc.task.assign') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.task')}</button> : null}
        </div>
      </div>
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.tasks')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value)}>
          {VIEWS.map((v) => <option key={v} value={v}>{t(`ofc.tview.${v}`)}</option>)}
        </select>
        {!mineOnly ? (
          <select aria-label={t('ofc.field.assignee')} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">{t('ofc.filter.anyone')}</option>{people.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : null}
        <select aria-label={t('ofc.field.unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t('ofc.filter.any_unit')}</option>{(units.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{String(u.path)}</option>)}
        </select>
        <select aria-label={t('ofc.field.priority')} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">{t('ofc.filter.any_priority')}</option>{priorityOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label={t('ofc.field.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('ofc.filter.any_status')}</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{t(`ofc.tstatus.${s}`)}</option>)}
        </select>
        <span className="muted">{t('ofc.count', { n: list.data?.total ?? 0 })}</span>
      </div>
      <ErrorNotice error={office.error ?? list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.title')}</th><th scope="col">{t('ofc.field.assignee')}</th><th scope="col">{t('ofc.field.unit')}</th>
            <th scope="col">{t('ofc.field.priority')}</th><th scope="col">{t('ofc.field.targetDate')}</th><th scope="col">{t('ofc.field.status')}</th><th scope="col">{t('ofc.field.delayReason')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(r.id)}>{String(r.refNo)}</button></td>
                <td>{r.parentId ? '↳ ' : ''}{String(r.title)}{Number(r.subtaskCount) ? <small className="muted"> ({String(r.subtaskDone)}/{String(r.subtaskCount)})</small> : null}</td>
                <td>{people.name(r.assigneePersonId)}</td>
                <td>{show((units.data?.items ?? []).find((u) => u.id === r.unitId)?.code)}</td>
                <td><StatusChip value={String(r.priority)} labelPrefix="ofc.priority" /></td>
                <td><DueCell date={r.targetDate} overdue={r.overdue} /></td>
                <td><StatusChip value={String(r.status)} labelPrefix="ofc.tstatus" /></td>
                <td><small>{show(r.delayReason)}</small></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">{t('ofc.tasks.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <TaskDetail id={open} onOpen={setOpen} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? <NewTaskModal commandId={C} defaults={{ priority: 'normal' }} onClose={() => setCreating(false)} onCreated={() => list.reload()} /> : null}
    </section>
  );
}

type Act = 'complete' | 'close' | 'reopen' | 'cancel' | 'assign' | 'edit' | 'subtask' | { status: string } | null;

export function TaskDetail({ id, onOpen, onClose, onChanged }: { id: string; onOpen(id: string): void; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const office = useOffice();
  const rec = useGet<Rec>(`${OFC}/tasks/${id}`);
  const r = rec.data;
  const people = usePersons(String(r?.commandId ?? office.commandId));
  const units = useGet<Page>(r ? `${OFC}/units` : null, { commandId: String(r?.commandId ?? '') });
  const [act, setAct] = useState<Act>(null);
  const [tick, setTick] = useState(0);
  const p = (r?.permissions ?? {}) as Record<string, boolean>;
  const refresh = () => { rec.reload(); onChanged(); setTick((x) => x + 1); };
  const post = async (path: string, body: Record<string, unknown>) => { await api('POST', `${OFC}/tasks/${id}/${path}`, { expectedVersion: r!.version, ...body }); refresh(); };
  const overdue = Boolean(r?.overdue) && !r?.delayReason;
  const delayField: FieldDef[] = overdue ? [{ key: 'delayReason', labelKey: 'ofc.field.delayReason', type: 'text', required: true, maxLength: 1000, hintKey: 'ofc.hint.delay' }] : [];

  return (
    <Modal title={r ? `${String(r.refNo)} – ${String(r.title)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={rec.error} />
      {r ? (
        <>
          <div className="axes">
            <StatusChip value={String(r.status)} labelPrefix="ofc.tstatus" /><StatusChip value={String(r.priority)} labelPrefix="ofc.priority" />
            {r.overdue ? <span className="chip warn">{t('ofc.days_overdue', { n: Number(r.daysOverdue) })}</span> : null}
          </div>
          <dl className="facts">
            {r.parent ? <><dt>{t('ofc.field.mainTask')}</dt><dd><button className="link" onClick={() => onOpen(String((r.parent as Rec).id))}>{String((r.parent as Rec).refNo)} – {String((r.parent as Rec).title)}</button></dd></> : null}
            {r.source ? <><dt>{t('ofc.field.source')}</dt><dd>{t(`ofc.type.${String((r.source as Rec).type).split('.')[1]}`)} {String((r.source as Rec).refNo)} – {String((r.source as Rec).subject)}</dd></> : null}
            <dt>{t('ofc.field.assignee')}</dt><dd>{people.name(r.assigneePersonId)}</dd>
            <dt>{t('ofc.field.unit')}</dt><dd>{show((units.data?.items ?? []).find((u) => u.id === r.unitId)?.path)}</dd>
            <dt>{t('ofc.field.targetDate')}</dt><dd>{show(r.targetDate)}</dd>
            <dt>{t('ofc.field.progressPct')}</dt><dd>{r.progressPct == null ? '—' : `${String(r.progressPct)}%`}</dd>
            <dt>{t('ofc.field.description')}</dt><dd>{show(r.description)}</dd>
            <dt>{t('ofc.field.delayReason')}</dt><dd>{show(r.delayReason)}</dd>
            {r.completionNote ? <><dt>{t('ofc.field.completionNote')}</dt><dd>{String(r.completionNote)} ({show(r.completedAt)})</dd></> : null}
            {r.closedAt ? <><dt>{t('ofc.field.verified')}</dt><dd>{String(r.closedAt)}{r.verifyNote ? ` – ${String(r.verifyNote)}` : ''}</dd></> : null}
            <dt>{t('ofc.field.remarks')}</dt><dd>{show(r.remarks)}</dd>
          </dl>
          <div className="actions wrap">
            {p.update ? (MOVES[String(r.status)] ?? []).map((s) => <button key={s} onClick={() => setAct({ status: s })}>{t(`ofc.tto.${s}`)}</button>) : null}
            {p.complete ? <button className="primary" onClick={() => setAct('complete')}>{t('ofc.act.complete')}</button> : null}
            {p.close ? <button className="primary" onClick={() => setAct('close')}>{t('ofc.act.verify_close')}</button> : null}
            {p.assign ? <button onClick={() => setAct('assign')}>{t(r.assigneePersonId ? 'ofc.act.reassign' : 'ofc.act.assign')}</button> : null}
            {p.update ? <button onClick={() => setAct('edit')}>{t('common.edit')}</button> : null}
            {p.subtask ? <button onClick={() => setAct('subtask')}>{t('ofc.new.subtask')}</button> : null}
            {p.reopen ? <button onClick={() => setAct('reopen')}>{t('ofc.act.reopen')}</button> : null}
            {p.cancel ? <button className="danger" onClick={() => setAct('cancel')}>{t('ofc.act.cancel')}</button> : null}
          </div>
          {(r.subtasks as Rec[]).length ? (
            <>
              <h3>{t('ofc.subtasks')}</h3>
              <ul className="plain">
                {(r.subtasks as Rec[]).map((s) => (
                  <li key={s.id}><button className="link" onClick={() => onOpen(s.id)}>{String(s.refNo)}</button> {String(s.title)} · {people.name(s.assigneePersonId)} · <StatusChip value={String(s.status)} labelPrefix="ofc.tstatus" /> <DueCell date={s.targetDate} overdue={s.overdue} /></li>
                ))}
              </ul>
            </>
          ) : null}
          <RecordPanel type="ofc.task" id={id} reloadKey={tick} />
        </>
      ) : null}

      {r && act && typeof act === 'object' ? (
        <FormModal title={t(`ofc.tto.${act.status}`)} fields={[...delayField, { key: 'note', labelKey: 'ofc.field.note', type: 'textarea', maxLength: 2000 }]} record={null} tz={tz} onClose={() => setAct(null)}
          onSubmit={(b) => post('status', { status: act.status, ...b })} />
      ) : null}
      {r && act === 'complete' ? (
        <FormModal title={t('ofc.act.complete')} fields={[{ key: 'note', labelKey: 'ofc.field.completionNote', type: 'textarea', required: true, maxLength: 4000, hintKey: 'ofc.hint.completion' }, ...delayField]} record={null} tz={tz}
          submitKey="ofc.act.complete" onClose={() => setAct(null)} onSubmit={(b) => post('complete', b)} />
      ) : null}
      {r && act === 'close' ? (
        <FormModal title={t('ofc.act.verify_close')} fields={[{ key: 'note', labelKey: 'ofc.field.verifyNote', type: 'textarea', maxLength: 2000, hintKey: 'ofc.hint.verify' }]} record={null} tz={tz}
          submitKey="ofc.act.verify_close" onClose={() => setAct(null)} onSubmit={(b) => post('close', b)} />
      ) : null}
      {r && act === 'assign' ? (
        <FormModal title={t('ofc.act.assign')} record={null} tz={tz} onClose={() => setAct(null)} onSubmit={(b) => post('assign', b)}
          fields={[{ key: 'assigneePersonId', labelKey: 'ofc.field.assignee', type: 'select', required: true, options: people.options }, ...(r.assigneePersonId ? [{ key: 'reason', labelKey: 'ofc.field.reason', type: 'text' as const, required: true, maxLength: 500 }] : [])]} />
      ) : null}
      {r && act === 'edit' ? (
        <FormModal title={t('ofc.edit.record', { name: String(r.refNo) })} record={r} tz={tz} onClose={() => setAct(null)} onFetchLatest={() => api<Rec>('GET', `${OFC}/tasks/${id}`)}
          onSubmit={async (b) => { await api('PATCH', `${OFC}/tasks/${id}`, b); refresh(); }}
          fields={[
            { key: 'title', labelKey: 'ofc.field.title', type: 'text', required: true, maxLength: 200 },
            { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: (units.data?.items ?? []).map((u) => ({ value: String(u.id), label: String(u.path) })) },
            { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
            { key: 'startDate', labelKey: 'ofc.field.startDate', type: 'date' },
            { key: 'targetDate', labelKey: 'ofc.field.targetDate', type: 'date' },
            { key: 'progressPct', labelKey: 'ofc.field.progressPct', type: 'number' },
            { key: 'delayReason', labelKey: 'ofc.field.delayReason', type: 'text', maxLength: 1000, hintKey: 'ofc.hint.delay' },
            { key: 'description', labelKey: 'ofc.field.description', type: 'textarea', maxLength: 4000 },
            { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
            { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, hintKey: 'ofc.hint.task_reason' },
          ]} />
      ) : null}
      {r && act === 'subtask' ? <NewTaskModal commandId={String(r.commandId)} parentId={id} defaults={{ priority: String(r.priority), targetDate: String(r.targetDate ?? '') }} onClose={() => setAct(null)} onCreated={() => refresh()} /> : null}
      {r && (act === 'reopen' || act === 'cancel') ? (
        <ReasonModal title={t(act === 'reopen' ? 'ofc.act.reopen_title' : 'ofc.act.cancel_title', { name: String(r.refNo) })} confirmKey={act === 'reopen' ? 'ofc.act.reopen' : 'ofc.act.cancel'} onClose={() => setAct(null)}
          onConfirm={(reason) => post(act, { reason })} />
      ) : null}
    </Modal>
  );
}
