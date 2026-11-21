/** Handover / takeover (FR-H1..H5): packets, items, actions, paste import with preview, printable progress report. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { DueCell, OFC, OfficePicker, priorityOptions, show, useGet, useOffice, usePersons, type Page } from './binding';
import { parseHandoverPaste } from './paste';
import { RecordPanel } from './RecordPanel';
import { NewTaskModal } from './TasksScreen';

export const CATEGORIES = ['responsibility', 'project', 'pending_work', 'unresolved', 'correspondence', 'equipment', 'other'] as const;
export const ITEM_STATUS = ['open', 'in_progress', 'completed', 'not_applicable'] as const;

export function HandoversScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const people = usePersons(useOffice().commandId);
  const C = office.commandId;
  const list = useGet<Page>(C ? `${OFC}/handovers` : null, { commandId: C });
  const [creating, setCreating] = useState(false);
  const fields: FieldDef[] = [
    { key: 'appointment', labelKey: 'ofc.field.appointment', type: 'text', required: true, maxLength: 160 },
    { key: 'fromName', labelKey: 'ofc.field.fromName', type: 'text', required: true, maxLength: 160 },
    { key: 'fromUserId', labelKey: 'ofc.field.fromUser', type: 'select', options: people.options },
    { key: 'toName', labelKey: 'ofc.field.toName', type: 'text', required: true, maxLength: 160 },
    { key: 'toUserId', labelKey: 'ofc.field.toUser', type: 'select', options: people.options },
    { key: 'handoverDate', labelKey: 'ofc.field.handoverDate', type: 'date' },
    { key: 'takeoverDate', labelKey: 'ofc.field.takeoverDate', type: 'date' },
    { key: 'documentRef', labelKey: 'ofc.field.documentRef', type: 'text', maxLength: 120 },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.handovers')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.handover.create') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.handover')}</button> : null}
        </div>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.appointment')}</th><th scope="col">{t('ofc.field.fromName')}</th><th scope="col">{t('ofc.field.toName')}</th><th scope="col">{t('ofc.field.takeoverDate')}</th><th scope="col">{t('ofc.field.progress')}</th><th scope="col">{t('ofc.field.urgentOpen')}</th><th scope="col">{t('ofc.field.status')}</th></tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((p) => {
              const total = Number(p.itemCount), done = Number(p.doneCount ?? 0);
              return (
                <tr key={p.id}>
                  <td><Link to={`/ofc/handovers/${p.id}`}>{String(p.refNo)}</Link></td><td>{String(p.appointment)}</td><td>{String(p.fromName)}</td><td>{String(p.toName)}</td>
                  <td>{show(p.takeoverDate ?? p.handoverDate)}</td>
                  <td>{total ? `${done} / ${total} (${Math.round((done / total) * 100)}%)` : '—'}</td>
                  <td>{Number(p.urgentOpen) ? <span className="chip warn">{String(p.urgentOpen)}</span> : '0'}</td>
                  <td><StatusChip value={String(p.status)} labelPrefix="ofc.pstatus" /></td>
                </tr>
              );
            })}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">{t('ofc.handovers.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {creating ? (
        <FormModal title={t('ofc.new.handover')} fields={fields} record={null} tz={tz} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (body) => { await api('POST', `${OFC}/handovers`, { ...body, commandId: C }); list.reload(); }} />
      ) : null}
    </section>
  );
}

function itemFields(people: ReturnType<typeof usePersons>, units: Rec[], editing: boolean): FieldDef[] {
  return [
    { key: 'annexRef', labelKey: 'ofc.field.annexRef', type: 'text', maxLength: 80 },
    { key: 'category', labelKey: 'ofc.field.category', type: 'select', required: true, options: CATEGORIES.map((c) => ({ value: c, label: t(`ofc.cat.${c}`) })) },
    { key: 'subject', labelKey: 'ofc.field.subject', type: 'text', required: true, maxLength: 300 },
    { key: 'description', labelKey: 'ofc.field.description', type: 'textarea', maxLength: 4000 },
    { key: 'previousStatus', labelKey: 'ofc.field.previousStatus', type: 'textarea', maxLength: 1000, hintKey: 'ofc.hint.previousStatus' },
    { key: 'status', labelKey: 'ofc.field.currentStatus', type: 'select', options: ITEM_STATUS.map((s) => ({ value: s, label: t(`ofc.istatus.${s}`) })) },
    { key: 'priority', labelKey: 'ofc.field.priority', type: 'select', options: priorityOptions() },
    { key: 'urgent', labelKey: 'ofc.field.urgent', type: 'checkbox' },
    { key: 'responsibleUserId', labelKey: 'ofc.field.responsible', type: 'select', options: people.options },
    { key: 'unitId', labelKey: 'ofc.field.unit', type: 'select', options: units.map((u) => ({ value: String(u.id), label: String(u.path) })) },
    { key: 'targetDate', labelKey: 'ofc.field.targetDate', type: 'date' },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
    { key: 'originalRef', labelKey: 'ofc.field.originalRef', type: 'text', maxLength: 80 },
    ...(editing ? [{ key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text' as const, maxLength: 500, hintKey: 'ofc.hint.correction' }] : []),
  ];
}

export function HandoverDetailScreen() {
  const { id = '' } = useParams();
  const { tz } = useSystem();
  const people = usePersons(useOffice().commandId);
  const packet = useGet<Rec>(`${OFC}/handovers/${id}`);
  const p = packet.data;
  const units = useGet<Page>(p ? `${OFC}/units` : null, { commandId: String(p?.commandId ?? '') });
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [view, setView] = useState('');
  const [q, setQ] = useState('');
  const items = useGet<Page>(`${OFC}/handovers/${id}/items`, {
    status: status || undefined, category: category || undefined, q: q || undefined, limit: '1000', sort: 'annexRef', dir: 'asc',
    open: view === 'open' ? 'true' : undefined, overdue: view === 'overdue' ? 'true' : undefined, urgent: view === 'urgent' ? 'true' : undefined,
  });
  const [editing, setEditing] = useState<Rec | 'new' | 'packet' | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(false);
  const unitList = units.data?.items ?? [];
  const packetFields: FieldDef[] = [
    { key: 'appointment', labelKey: 'ofc.field.appointment', type: 'text', required: true, maxLength: 160 },
    { key: 'fromName', labelKey: 'ofc.field.fromName', type: 'text', required: true, maxLength: 160 },
    { key: 'toName', labelKey: 'ofc.field.toName', type: 'text', required: true, maxLength: 160 },
    { key: 'handoverDate', labelKey: 'ofc.field.handoverDate', type: 'date' },
    { key: 'takeoverDate', labelKey: 'ofc.field.takeoverDate', type: 'date' },
    { key: 'documentRef', labelKey: 'ofc.field.documentRef', type: 'text', maxLength: 120 },
    { key: 'status', labelKey: 'ofc.field.status', type: 'select', options: ['draft', 'signed', 'in_progress', 'completed'].map((s) => ({ value: s, label: t(`ofc.pstatus.${s}`) })) },
    { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
    { key: 'reason', labelKey: 'ofc.field.correctionReason', type: 'text', maxLength: 500, hintKey: 'ofc.hint.correction' },
  ];

  if (report) return <HandoverReport id={id} onBack={() => setReport(false)} />;
  return (
    <section>
      <div className="page-head">
        <h1>{p ? `${String(p.refNo)} – ${String(p.appointment)}` : t('common.loading')}</h1>
        <div className="tools">
          <Link to="/ofc/handovers">{t('ofc.back.handovers')}</Link>
          {p && can('ofc.handover.update') ? <button onClick={() => setEditing('packet')}>{t('common.edit')}</button> : null}
          <button onClick={() => setReport(true)}>{t('ofc.act.report')}</button>
          {can('ofc.handover.create') ? <button onClick={() => setImporting(true)}>{t('ofc.act.paste_import')}</button> : null}
          {can('ofc.handover.create') ? <button className="primary" onClick={() => setEditing('new')}>{t('ofc.new.item')}</button> : null}
        </div>
      </div>
      <ErrorNotice error={packet.error ?? items.error} />
      {p ? (
        <dl className="facts">
          <dt>{t('ofc.field.fromName')}</dt><dd>{String(p.fromName)}</dd><dt>{t('ofc.field.toName')}</dt><dd>{String(p.toName)}</dd>
          <dt>{t('ofc.field.handoverDate')}</dt><dd>{show(p.handoverDate)} / {show(p.takeoverDate)}</dd><dt>{t('ofc.field.documentRef')}</dt><dd>{show(p.documentRef)}</dd>
          <dt>{t('ofc.field.status')}</dt><dd><StatusChip value={String(p.status)} labelPrefix="ofc.pstatus" /></dd>
        </dl>
      ) : null}
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.items')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.field.currentStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('ofc.filter.any_status')}</option>{ITEM_STATUS.map((s) => <option key={s} value={s}>{t(`ofc.istatus.${s}`)}</option>)}
        </select>
        <select aria-label={t('ofc.field.category')} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('ofc.filter.any_category')}</option>{CATEGORIES.map((c) => <option key={c} value={c}>{t(`ofc.cat.${c}`)}</option>)}
        </select>
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value)}>
          <option value="">{t('ofc.filter.all')}</option><option value="open">{t('ofc.filter.open')}</option><option value="overdue">{t('ofc.filter.overdue')}</option><option value="urgent">{t('ofc.filter.urgent')}</option>
        </select>
        <span className="muted">{t('ofc.count', { n: items.data?.total ?? 0 })}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.annexRef')}</th><th scope="col">{t('ofc.field.subject')}</th><th scope="col">{t('ofc.field.previousStatus')}</th>
            <th scope="col">{t('ofc.field.currentStatus')}</th><th scope="col">{t('ofc.field.priority')}</th><th scope="col">{t('ofc.field.responsible')}</th><th scope="col">{t('ofc.field.targetDate')}</th><th scope="col">{t('ofc.field.latestAction')}</th>
          </tr></thead>
          <tbody>
            {(items.data?.items ?? []).map((i) => (
              <tr key={i.id}>
                <td><button className="link" onClick={() => setOpenItem(i.id)}>{String(i.refNo)}</button></td><td>{show(i.annexRef)}</td>
                <td>{String(i.subject)}{i.urgent ? <> <span className="chip warn">{t('ofc.field.urgent')}</span></> : null}</td>
                <td><small>{show(i.previousStatus)}</small></td>
                <td><StatusChip value={String(i.status)} labelPrefix="ofc.istatus" /></td><td>{t(`ofc.priority.${String(i.priority)}`)}</td>
                <td>{people.name(i.responsibleUserId)}</td><td><DueCell date={i.targetDate} overdue={i.overdue} /></td>
                <td><small>{show(i.latestAction)}{i.latestActionAt ? ` (${String(i.latestActionAt)})` : ''}</small></td>
              </tr>
            ))}
            {!items.loading && (items.data?.items.length ?? 0) === 0 ? <tr><td colSpan={9} className="empty">{t('ofc.items.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {openItem ? <ItemDetail id={openItem} units={unitList} onEdit={(r) => { setOpenItem(null); setEditing(r); }} onClose={() => setOpenItem(null)} onChanged={items.reload} /> : null}
      {importing ? <PasteImport packetId={id} onClose={() => setImporting(false)} onDone={items.reload} /> : null}
      {editing === 'packet' && p ? (
        <FormModal title={t('ofc.edit.record', { name: String(p.refNo) })} fields={packetFields} record={p} tz={tz} onClose={() => setEditing(null)} onFetchLatest={() => api<Rec>('GET', `${OFC}/handovers/${id}`)}
          onSubmit={async (body) => { await api('PATCH', `${OFC}/handovers/${id}`, body); packet.reload(); }} />
      ) : editing && editing !== 'packet' ? (
        <FormModal title={editing === 'new' ? t('ofc.new.item') : t('ofc.edit.record', { name: String(editing.refNo) })} fields={itemFields(people, unitList, editing !== 'new')} record={editing === 'new' ? null : editing} tz={tz}
          defaults={{ category: 'pending_work', priority: 'normal', status: 'open' }} onClose={() => setEditing(null)}
          onFetchLatest={editing === 'new' ? undefined : () => api<Rec>('GET', `${OFC}/handover-items/${editing.id}`)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', `${OFC}/handovers/${id}/items`, body);
            else await api('PATCH', `${OFC}/handover-items/${editing.id}`, body);
            items.reload();
          }} />
      ) : null}
    </section>
  );
}

function ItemDetail({ id, units, onEdit, onClose, onChanged }: { id: string; units: Rec[]; onEdit(r: Rec): void; onClose(): void; onChanged(): void }) {
  const people = usePersons(useOffice().commandId);
  const item = useGet<Rec>(`${OFC}/handover-items/${id}`);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const [newTask, setNewTask] = useState(false);
  const r = item.data;
  async function act() {
    if (!r) return;
    setError(null);
    try {
      await api('POST', `${OFC}/handover-items/${id}/actions`, { expectedVersion: r.version, note, ...(status ? { status } : {}) });
      setNote(''); setStatus(''); item.reload(); onChanged(); setTick((x) => x + 1);
    } catch (e) { setError(e as Error); }
  }
  return (
    <Modal title={r ? `${String(r.refNo)} – ${String(r.subject)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={item.error ?? error} />
      {r ? (
        <>
          <dl className="facts">
            <dt>{t('ofc.field.annexRef')}</dt><dd>{show(r.annexRef)}</dd><dt>{t('ofc.field.category')}</dt><dd>{t(`ofc.cat.${String(r.category)}`)}</dd>
            <dt>{t('ofc.field.description')}</dt><dd>{show(r.description)}</dd><dt>{t('ofc.field.previousStatus')}</dt><dd>{show(r.previousStatus)}</dd>
            <dt>{t('ofc.field.currentStatus')}</dt><dd><StatusChip value={String(r.status)} labelPrefix="ofc.istatus" /></dd>
            <dt>{t('ofc.field.priority')}</dt><dd>{t(`ofc.priority.${String(r.priority)}`)}{r.urgent ? ` · ${t('ofc.field.urgent')}` : ''}</dd>
            <dt>{t('ofc.field.responsible')}</dt><dd>{people.name(r.responsibleUserId)}</dd><dt>{t('ofc.field.unit')}</dt><dd>{show(units.find((u) => u.id === r.unitId)?.path)}</dd>
            <dt>{t('ofc.field.targetDate')}</dt><dd>{show(r.targetDate)}</dd><dt>{t('ofc.field.latestAction')}</dt><dd>{show(r.latestAction)}</dd>
            <dt>{t('ofc.field.remarks')}</dt><dd>{show(r.remarks)}</dd><dt>{t('ofc.field.originalRef')}</dt><dd>{show(r.originalRef)}</dd>
          </dl>
          {can('ofc.handover.update') ? (
            <>
              <div className="actions"><button onClick={() => onEdit(r)}>{t('common.edit')}</button>{can('ofc.task.assign') ? <button onClick={() => setNewTask(true)}>{t('ofc.act.make_task')}</button> : null}</div>
              <form className="comment" onSubmit={(e) => { e.preventDefault(); void act(); }}>
                <label htmlFor="hoi-action">{t('ofc.act.record_action')}</label>
                <textarea id="hoi-action" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} placeholder={t('ofc.hint.action')} />
                <div className="inline">
                  <select aria-label={t('ofc.field.currentStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">{t('ofc.action.keep_status')}</option>{ITEM_STATUS.map((s) => <option key={s} value={s}>{t(`ofc.istatus.${s}`)}</option>)}
                  </select>
                  <button type="submit" className="primary" disabled={!note.trim()}>{t('ofc.act.save_action')}</button>
                </div>
              </form>
            </>
          ) : null}
          <RecordPanel type="ofc.handover_item" id={id} reloadKey={tick} />
          {newTask ? <NewTaskModal commandId={String(r.commandId)} source={{ type: 'ofc.handover_item', id }} defaults={{ assigneePersonId: String(r.responsibleUserId ?? ''), unitId: String(r.unitId ?? '') }} onClose={() => setNewTask(false)} onCreated={() => setTick((x) => x + 1)} /> : null}
        </>
      ) : null}
    </Modal>
  );
}

interface Preview { committed: boolean; summary: { rows: number; errors: number; warnings: number }; rows?: Array<{ row: number; errors: string[]; warnings: string[] }>; created?: string[] }

function PasteImport({ packetId, onClose, onDone }: { packetId: string; onClose(): void; onDone(): void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseHandoverPaste(text) : null;
  async function send(commit: boolean) {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      const r = await api<Preview>('POST', `${OFC}/handovers/${packetId}/items/bulk`, { rows: parsed.rows, commit });
      setPreview(r);
      if (r.committed) onDone();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('ofc.act.paste_import')} onClose={onClose} wide>
      <p className="hint">{t('ofc.paste.help')}</p>
      <textarea aria-label={t('ofc.paste.area')} className="paste" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={t('ofc.paste.placeholder')} />
      {parsed ? (
        <p>{t('ofc.paste.columns')}: {parsed.headings.map((h) => <span key={h.heading} className={`chip ${h.field ? 'ok' : 'muted'}`}>{h.heading}{h.field ? ` → ${t(`ofc.field.${h.field}`)}` : ` (${t('ofc.paste.ignored')})`}</span>)}</p>
      ) : null}
      <ErrorNotice error={error} />
      {preview ? (
        preview.committed ? <p className="notice">{t('ofc.paste.done', { n: preview.created?.length ?? 0 })}</p> : (
          <>
            <p>{t('ofc.paste.summary', { rows: preview.summary.rows, errors: preview.summary.errors, warnings: preview.summary.warnings })}</p>
            <ul className="plain">
              {(preview.rows ?? []).filter((r) => r.errors.length || r.warnings.length).map((r) => (
                <li key={r.row}><strong>{t('ofc.paste.row', { n: r.row + 1 })}</strong> {r.errors.map((e) => <span key={e} className="chip warn">{e}</span>)} {r.warnings.map((w) => <span key={w} className="chip muted">{w}</span>)}</li>
              ))}
            </ul>
          </>
        )
      ) : null}
      <footer>
        <button onClick={onClose}>{t('common.close')}</button>
        {!preview?.committed ? <button disabled={busy || !parsed?.rows.length} onClick={() => void send(false)}>{t('ofc.paste.check')}</button> : null}
        {preview && !preview.committed && preview.summary.errors === 0 ? <button className="primary" disabled={busy} onClick={() => void send(true)}>{t('ofc.paste.commit', { n: preview.summary.rows })}</button> : null}
      </footer>
    </Modal>
  );
}

interface Report { packet: Rec; asOf: string; total: number; done: number; percentComplete: number; byStatus: Rec[]; byCategory: Rec[]; attention: Rec[] }

function HandoverReport({ id, onBack }: { id: string; onBack(): void }) {
  const people = usePersons(useOffice().commandId);
  const r = useGet<Report>(`${OFC}/handovers/${id}/report`);
  const d = r.data;
  return (
    <section className="report">
      <div className="tools no-print"><button onClick={onBack}>{t('ofc.back')}</button><button className="primary" onClick={() => window.print()}>{t('ofc.act.print')}</button></div>
      <ErrorNotice error={r.error} />
      {d ? (
        <>
          <header className="report-head">
            <div>{t('ofc.report.office')}</div>
            <h1>{t('ofc.report.handover_title')}</h1>
            <div>{String(d.packet.refNo)} · {String(d.packet.appointment)} · {String(d.packet.fromName)} → {String(d.packet.toName)} · {t('ofc.report.as_of', { date: d.asOf })}</div>
          </header>
          <p><strong>{t('ofc.report.complete', { done: d.done, total: d.total, pct: d.percentComplete })}</strong></p>
          <table>
            <thead><tr><th scope="col">{t('ofc.field.category')}</th><th scope="col">{t('ofc.report.total')}</th><th scope="col">{t('ofc.report.done')}</th><th scope="col">{t('ofc.report.open')}</th></tr></thead>
            <tbody>{d.byCategory.map((c) => <tr key={String(c.category)}><td>{t(`ofc.cat.${String(c.category)}`)}</td><td>{String(c.total)}</td><td>{String(c.done)}</td><td>{Number(c.total) - Number(c.done)}</td></tr>)}</tbody>
          </table>
          <h2>{t('ofc.report.attention')}</h2>
          <table>
            <thead><tr><th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.annexRef')}</th><th scope="col">{t('ofc.field.subject')}</th><th scope="col">{t('ofc.field.responsible')}</th><th scope="col">{t('ofc.field.targetDate')}</th><th scope="col">{t('ofc.field.latestAction')}</th><th scope="col">{t('ofc.field.remarks')}</th></tr></thead>
            <tbody>
              {d.attention.map((i) => (
                <tr key={String(i.id)}><td>{String(i.refNo)}</td><td>{show(i.annexRef)}</td><td>{String(i.subject)}{i.urgent ? ` (${t('ofc.field.urgent')})` : ''}</td><td>{people.name(i.responsibleUserId)}</td>
                  <td>{show(i.targetDate)}{i.overdue ? ` – ${t('ofc.overdue')}` : ''}</td><td>{show(i.latestAction)}</td><td>{show(i.remarks)}</td></tr>
              ))}
              {d.attention.length === 0 ? <tr><td colSpan={7} className="empty">{t('ofc.report.none')}</td></tr> : null}
            </tbody>
          </table>
          <div className="signatures"><div>{t('ofc.report.prepared')}</div><div>{t('ofc.report.checked')}</div></div>
        </>
      ) : null}
    </section>
  );
}
