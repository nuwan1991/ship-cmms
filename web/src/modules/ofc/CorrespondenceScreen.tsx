/** Correspondence register (FR-K1..K6): incoming, outgoing, minute sheets; replies, matters, pending and overdue replies. */
import { useState } from 'react';
import { api, ApiError, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { DueCell, OFC, OfficePicker, priorityOptions, show, todayIso, useGet, useOffice, usePersons, type Page } from './binding';
import { RecordPanel } from './RecordPanel';
import { NewTaskModal } from './TasksScreen';

export const KINDS = ['incoming', 'outgoing', 'minute', 'signal', 'other'] as const;
export const STATUS: Record<string, string[]> = {
  incoming: ['received', 'under_action', 'replied', 'filed'], outgoing: ['draft', 'signed', 'dispatched', 'acknowledged'],
  minute: ['open', 'filed'], signal: ['received', 'under_action', 'replied', 'filed'], other: ['open', 'filed'],
};

function corrFields(kind: string, matters: Rec[], units: Rec[], people: ReturnType<typeof usePersons>): FieldDef[] {
  const out = kind === 'outgoing';
  return [
    { key: 'kind', labelKey: 'ofc.field.kind', type: 'select', required: true, createOnly: true, options: KINDS.map((k) => ({ value: k, label: t(`ofc.kind.${k}`) })) },
    { key: 'subject', labelKey: 'ofc.field.subject', type: 'text', required: true, maxLength: 300 },
    { key: 'officialRef', labelKey: 'ofc.field.officialRef', type: 'text', maxLength: 80, hintKey: 'ofc.hint.officialRef' },
    { key: 'letterDate', labelKey: 'ofc.field.letterDate', type: 'date' },
    { key: 'receivedDate', labelKey: 'ofc.field.receivedDate', type: 'date', showWhen: (v) => String(v.kind || kind) !== 'outgoing' },
    { key: 'sentDate', labelKey: 'ofc.field.sentDate', type: 'date', showWhen: (v) => String(v.kind || kind) === 'outgoing' },
    { key: 'originator', labelKey: 'ofc.field.originator', type: 'text', maxLength: 200 },
    { key: 'recipients', labelKey: 'ofc.field.recipients', type: 'text', maxLength: 500 },
    { key: 'fileRef', labelKey: 'ofc.field.fileRef', type: 'text', maxLength: 80 },
    { key: 'matterId', labelKey: 'ofc.field.matter', type: 'select', options: matters.map((m) => ({ value: String(m.id), label: `${String(m.refNo)} – ${String(m.title)}` })), hintKey: 'ofc.hint.matter' },
    { key: 'classification', labelKey: 'ofc.field.classification', type: 'select', options: ['unclassified', 'restricted'].map((c) => ({ value: c, label: t(`ofc.class.${c}`) })) },
    { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
    { key: 'replyRequired', labelKey: 'ofc.field.replyRequired', type: 'checkbox', showWhen: (v) => !out && String(v.kind || kind) !== 'outgoing' },
    { key: 'replyDue', labelKey: 'ofc.field.replyDue', type: 'date', showWhen: (v) => Boolean(v.replyRequired) },
    { key: 'actionUserId', labelKey: 'ofc.field.actionOfficer', type: 'select', options: people.options },
    { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: units.map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'dispatchMode', labelKey: 'ofc.field.dispatchMode', type: 'text', maxLength: 60, showWhen: (v) => String(v.kind || kind) === 'outgoing' },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
  ];
}

export function CorrespondenceScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const people = usePersons(useOffice().commandId);
  const C = office.commandId;
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'all' | 'pending' | 'overdue'>('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useGet<Page>(C ? `${OFC}/correspondence` : null, {
    commandId: C, kind: kind || undefined, status: status || undefined, q: q || undefined, from: from || undefined, to: to || undefined,
    pending: view === 'pending' ? 'true' : undefined, overdue: view === 'overdue' ? 'true' : undefined, limit: '500',
  });
  const matters = useGet<Page>(C ? `${OFC}/matters` : null, { commandId: C });
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<Record<string, string | boolean> | null>(null);
  const [dup, setDup] = useState<{ body: Record<string, unknown>; message: string } | null>(null);

  async function create(body: Record<string, unknown>) {
    try {
      await api('POST', `${OFC}/correspondence`, { ...body, commandId: C });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') { setDup({ body, message: e.message }); return; }
      throw e;
    }
    list.reload();
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.correspondence')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.correspondence.create') && C ? (
            <>
              <button className="primary" onClick={() => setCreating({ kind: 'incoming', receivedDate: todayIso(), priority: 'normal', classification: 'unclassified' })}>{t('ofc.new.incoming')}</button>
              <button onClick={() => setCreating({ kind: 'outgoing', priority: 'normal', classification: 'unclassified' })}>{t('ofc.new.outgoing')}</button>
              <button onClick={() => setCreating({ kind: 'minute', priority: 'normal', classification: 'unclassified', letterDate: todayIso() })}>{t('ofc.new.minute')}</button>
            </>
          ) : null}
        </div>
      </div>
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.correspondence')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.field.kind')} value={kind} onChange={(e) => { setKind(e.target.value); setStatus(''); }}>
          <option value="">{t('ofc.filter.any_kind')}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t(`ofc.kind.${k}`)}</option>)}
        </select>
        <select aria-label={t('ofc.field.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('ofc.filter.any_status')}</option>
          {[...new Set([...(kind ? STATUS[kind]! : Object.values(STATUS).flat()), 'cancelled'])].map((s) => <option key={s} value={s}>{t(`ofc.cstatus.${s}`)}</option>)}
        </select>
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value as 'all')}>
          <option value="all">{t('ofc.filter.all')}</option><option value="pending">{t('ofc.filter.pending')}</option><option value="overdue">{t('ofc.filter.overdue_reply')}</option>
        </select>
        <label className="inline">{t('ofc.filter.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">{t('ofc.filter.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="muted">{t('ofc.count', { n: list.data?.total ?? 0 })}</span>
      </div>
      <ErrorNotice error={office.error ?? list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.kind')}</th><th scope="col">{t('ofc.field.officialRef')}</th><th scope="col">{t('ofc.field.date')}</th>
            <th scope="col">{t('ofc.field.fromTo')}</th><th scope="col">{t('ofc.field.subject')}</th><th scope="col">{t('ofc.field.actionOfficer')}</th><th scope="col">{t('ofc.field.replyDue')}</th><th scope="col">{t('ofc.field.status')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(r.id)}>{String(r.refNo)}</button></td>
                <td>{t(`ofc.kind.${String(r.kind)}`)}</td><td>{show(r.officialRef)}</td><td>{show(r.letterDate ?? r.receivedDate ?? r.sentDate)}</td>
                <td>{show(r.kind === 'outgoing' ? r.recipients : r.originator)}</td>
                <td>{String(r.subject)}{r.classification === 'restricted' ? <> <span className="chip warn">{t('ofc.class.restricted')}</span></> : null}{r.priority === 'immediate' || r.priority === 'high' ? <> <StatusChip value={String(r.priority)} labelPrefix="ofc.priority" /></> : null}</td>
                <td>{people.name(r.actionUserId)}</td>
                <td>{r.pending ? <DueCell date={r.replyDue} overdue={r.overdue} /> : r.replyRequired ? t('ofc.reply.done') : '—'}</td>
                <td><StatusChip value={String(r.status)} labelPrefix="ofc.cstatus" /></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={9} className="empty">{t('ofc.correspondence.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open ? <CorrespondenceDetail id={open} matters={matters.data?.items ?? []} units={units.data?.items ?? []} onOpen={setOpen} onClose={() => setOpen(null)} onChanged={list.reload}
        onReply={(r) => { setOpen(null); setCreating({ kind: 'outgoing', replyToId: r.id, subject: `Re: ${String(r.subject)}`, recipients: String(r.originator ?? ''), matterId: String(r.matterId ?? ''), priority: String(r.priority), classification: String(r.classification) }); }} /> : null}
      {creating ? (
        <FormModal title={t(creating.replyToId ? 'ofc.new.reply' : `ofc.new.${String(creating.kind)}`)} fields={corrFields(String(creating.kind), matters.data?.items ?? [], units.data?.items ?? [], people)} record={null} tz={tz}
          defaults={creating} submitKey="common.create" onClose={() => setCreating(null)}
          onSubmit={(body) => create(creating.replyToId ? { ...body, replyToId: creating.replyToId } : body)} />
      ) : null}
      {dup ? (
        <Modal title={t('ofc.dup.title')} onClose={() => setDup(null)}>
          <p>{dup.message}</p><p>{t('ofc.dup.body')}</p>
          <footer>
            <button onClick={() => setDup(null)}>{t('common.cancel')}</button>
            <button className="primary" onClick={() => { void api('POST', `${OFC}/correspondence`, { ...dup.body, commandId: C, allowDuplicate: true }).then(() => { setDup(null); list.reload(); }); }}>{t('ofc.dup.register')}</button>
          </footer>
        </Modal>
      ) : null}
    </section>
  );
}

export function CorrespondenceDetail({ id, matters, units, onClose, onChanged, onReply, onOpen }: { id: string; matters: Rec[]; units: Rec[]; onClose(): void; onChanged(): void; onReply(r: Rec): void; onOpen(id: string): void }) {
  const { tz } = useSystem();
  const people = usePersons(useOffice().commandId);
  const rec = useGet<Rec>(`${OFC}/correspondence/${id}`);
  const [editing, setEditing] = useState(false);
  const [reasonFor, setReasonFor] = useState<'cancel' | 'noreply' | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const r = rec.data;
  const refresh = () => { rec.reload(); onChanged(); setTick((x) => x + 1); };
  const setStatus = async (status: string, reason?: string) => {
    if (!r) return;
    setError(null);
    try { await api('POST', `${OFC}/correspondence/${id}/status`, { expectedVersion: r.version, status, ...(reason ? { reason } : {}) }); refresh(); } catch (e) { setError(e as Error); }
  };
  const live = r && r.status !== 'cancelled';
  const editable = live && can('ofc.correspondence.update') && !r.masked;

  return (
    <Modal title={r ? `${String(r.refNo)} – ${String(r.subject)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={rec.error ?? error} />
      {r ? (
        <>
          <div className="axes">
            <StatusChip value={String(r.status)} labelPrefix="ofc.cstatus" />
            <StatusChip value={String(r.priority)} labelPrefix="ofc.priority" />
            {r.classification === 'restricted' ? <span className="chip warn">{t('ofc.class.restricted')}</span> : null}
            {r.pending ? <span className={`chip ${r.overdue ? 'warn' : 'muted'}`}>{t(r.overdue ? 'ofc.reply.overdue' : 'ofc.reply.pending')}</span> : null}
          </div>
          <dl className="facts">
            <dt>{t('ofc.field.kind')}</dt><dd>{t(`ofc.kind.${String(r.kind)}`)}</dd>
            <dt>{t('ofc.field.officialRef')}</dt><dd>{show(r.officialRef)}</dd>
            <dt>{t('ofc.field.fileRef')}</dt><dd>{show(r.fileRef)}</dd>
            <dt>{t('ofc.field.letterDate')}</dt><dd>{show(r.letterDate)}</dd>
            <dt>{t(r.kind === 'outgoing' ? 'ofc.field.sentDate' : 'ofc.field.receivedDate')}</dt><dd>{show(r.kind === 'outgoing' ? r.sentDate : r.receivedDate)}</dd>
            <dt>{t('ofc.field.originator')}</dt><dd>{show(r.originator)}</dd>
            <dt>{t('ofc.field.recipients')}</dt><dd>{show(r.recipients)}</dd>
            <dt>{t('ofc.field.matter')}</dt><dd>{show(matters.find((m) => m.id === r.matterId)?.title)}</dd>
            <dt>{t('ofc.field.actionOfficer')}</dt><dd>{people.name(r.actionUserId)}</dd>
            <dt>{t('ofc.field.unit')}</dt><dd>{show(units.find((u) => u.id === r.unitId)?.path)}</dd>
            <dt>{t('ofc.field.replyDue')}</dt><dd>{r.replyRequired ? show(r.replyDue) : t('ofc.reply.not_required')}{r.noReplyReason ? ` · ${t('ofc.reply.released')}: ${String(r.noReplyReason)}` : ''}</dd>
            <dt>{t('ofc.field.remarks')}</dt><dd>{show(r.remarks)}</dd>
          </dl>
          {(r.replies as Rec[] | undefined)?.length ? (
            <p>{t('ofc.replies')}: {(r.replies as Rec[]).map((x) => <button key={x.id} className="link" onClick={() => onOpen(x.id)}>{String(x.refNo)} ({t(`ofc.cstatus.${String(x.status)}`)})</button>)}</p>
          ) : null}
          {live ? (
            <div className="actions wrap">
              {editable ? <button onClick={() => setEditing(true)}>{t('common.edit')}</button> : null}
              {can('ofc.correspondence.update') ? (STATUS[String(r.kind)] ?? []).filter((s) => s !== r.status).map((s) => <button key={s} onClick={() => void setStatus(s)}>{t(`ofc.to.${s}`)}</button>) : null}
              {can('ofc.correspondence.create') && r.kind !== 'outgoing' ? <button className="primary" onClick={() => onReply(r)}>{t('ofc.act.reply')}</button> : null}
              {can('ofc.task.assign') && !r.masked ? <button onClick={() => setNewTask(true)}>{t('ofc.act.make_task')}</button> : null}
              {r.pending && can('ofc.correspondence.update') ? <button onClick={() => setReasonFor('noreply')}>{t('ofc.act.no_reply')}</button> : null}
              {can('ofc.correspondence.cancel') ? <button className="danger" onClick={() => setReasonFor('cancel')}>{t('ofc.act.cancel')}</button> : null}
            </div>
          ) : null}
          <RecordPanel type="ofc.correspondence" id={id} reloadKey={tick} />
        </>
      ) : null}
      {editing && r ? (
        <FormModal title={t('ofc.edit.record', { name: String(r.refNo) })} fields={[...corrFields(String(r.kind), matters, units, people), { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, hintKey: 'ofc.hint.correction' }]}
          record={r} tz={tz} onClose={() => setEditing(false)} onFetchLatest={() => api<Rec>('GET', `${OFC}/correspondence/${id}`)}
          onSubmit={async (body) => { const { kind: _k, ...rest } = body; await api('PATCH', `${OFC}/correspondence/${id}`, rest); refresh(); }} />
      ) : null}
      {newTask && r ? <NewTaskModal commandId={String(r.commandId)} source={{ type: 'ofc.correspondence', id }} defaults={{ assigneePersonId: String(r.actionUserId ?? ''), unitId: String(r.unitId ?? '') }} onClose={() => setNewTask(false)} onCreated={() => refresh()} /> : null}
      {reasonFor && r ? (
        <ReasonModal title={t(reasonFor === 'cancel' ? 'ofc.act.cancel_title' : 'ofc.act.no_reply_title', { name: String(r.refNo) })} confirmKey={reasonFor === 'cancel' ? 'ofc.act.cancel' : 'ofc.act.no_reply'} onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            if (reasonFor === 'cancel') await api('POST', `${OFC}/correspondence/${id}/status`, { expectedVersion: r.version, status: 'cancelled', reason });
            else await api('POST', `${OFC}/correspondence/${id}/no-reply`, { expectedVersion: r.version, reason });
            refresh();
          }} />
      ) : null}
    </Modal>
  );
}
