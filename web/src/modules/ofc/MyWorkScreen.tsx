/** "My work" (A1a): a plain screen for staff with basic computer skills. Their own tasks, big buttons, a note and photos. */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { ErrorNotice } from '../../platform/ui';
import { DueCell, fileToBase64, OFC, useGet, useMe, useOffice, type Page } from './binding';

export function MyWorkScreen() {
  const office = useOffice();
  const me = useMe(office.commandId);
  const list = useGet<Page>(office.commandId ? `${OFC}/tasks` : null, { commandId: office.commandId, mine: 'true', view: 'active', limit: '200' });
  return (
    <section className="mywork">
      <h1>{t('ofc.title.mywork')}</h1>
      {office.commandId && me === null && !list.loading ? <p className="notice">{t('ofc.mywork.not_registered')}</p> : null}
      <ErrorNotice error={list.error} />
      {(list.data?.items ?? []).map((r) => <MyTask key={r.id} task={r} onChanged={list.reload} />)}
      {!list.loading && (list.data?.items.length ?? 0) === 0 && me ? <p className="empty big">{t('ofc.mywork.none')}</p> : null}
    </section>
  );
}

function MyTask({ task, onChanged }: { task: Rec; onChanged(): void }) {
  const [note, setNote] = useState('');
  const [delay, setDelay] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const needDelay = Boolean(task.overdue) && !task.delayReason;
  const go = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      await api('POST', `${OFC}/tasks/${task.id}/${path}`, { expectedVersion: task.version, ...body, ...(needDelay && delay ? { delayReason: delay } : {}) });
      setNote(''); onChanged();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  };
  async function photo(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      for (const f of Array.from(files)) await api('POST', `${OFC}/attachments`, { fileName: f.name, mimeType: f.type || 'image/jpeg', contentBase64: await fileToBase64(f), record: { type: 'ofc.task', id: task.id } });
      onChanged();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <article className={`card${task.overdue ? ' late' : ''}`}>
      <header><strong>{String(task.refNo)}</strong> <span className="muted">{t(`ofc.tstatus.${String(task.status)}`)}</span></header>
      <h2>{String(task.title)}</h2>
      <p>{t('ofc.field.targetDate')}: <DueCell date={task.targetDate} overdue={task.overdue} /></p>
      {task.description ? <p>{String(task.description)}</p> : null}
      <textarea aria-label={t('ofc.mywork.note')} placeholder={t('ofc.mywork.note')} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      {needDelay ? <input aria-label={t('ofc.mywork.delay')} placeholder={t('ofc.mywork.delay')} value={delay} onChange={(e) => setDelay(e.target.value)} maxLength={1000} /> : null}
      <ErrorNotice error={error} />
      <div className="big-buttons">
        {task.status !== 'in_progress' ? <button disabled={busy || (needDelay && !delay)} onClick={() => void go('status', { status: 'in_progress', ...(note ? { note } : {}) })}>▶ {t('ofc.mywork.started')}</button> : null}
        <button disabled={busy || !note || (needDelay && !delay)} onClick={() => void go('status', { status: 'awaiting_info', note })}>? {t('ofc.mywork.need_info')}</button>
        <button className="primary" disabled={busy || !note || (needDelay && !delay)} onClick={() => void go('complete', { note })}>✓ {t('ofc.mywork.done')}</button>
        <label className="button">📷 {t('ofc.mywork.photo')}<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { void photo(e.target.files); e.target.value = ''; }} /></label>
      </div>
      <small className="muted">{t('ofc.mywork.hint')}</small>
    </article>
  );
}
