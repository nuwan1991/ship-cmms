/** Links, attachments and history of any office record (FR-C4..C6): shown at the bottom of every detail screen. */
import { useEffect, useState } from 'react';
import { api, apiDownload, saveBlob, type ApiError, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice } from '../../platform/ui';
import { fileToBase64, OFC, useGet } from './binding';

interface Bundle { links: Rec[]; attachments: Rec[]; timeline: Rec[] }
const TYPE_LABEL: Record<string, string> = {
  'ofc.correspondence': 'ofc.type.correspondence', 'ofc.matter': 'ofc.type.matter', 'ofc.handover_item': 'ofc.type.handover_item', 'ofc.handover_packet': 'ofc.type.handover_packet', 'ofc.org_unit': 'ofc.type.org_unit',
};

export function RecordPanel({ type, id, reloadKey = 0 }: { type: string; id: string; reloadKey?: number }) {
  const { tz } = useSystem();
  const b = useGet<Bundle>(`${OFC}/record`, { type, id });
  const { reload } = b;
  useEffect(() => { if (reloadKey) reload(); }, [reloadKey, reload]);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<'comment' | 'progress'>('comment');
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  const [detach, setDetach] = useState<Rec | null>(null);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); b.reload(); } catch (e) { setError(e as Error); } finally { setBusy(false); } };

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      for (const f of Array.from(files)) {
        await api('POST', `${OFC}/attachments`, { fileName: f.name, mimeType: f.type || 'application/octet-stream', contentBase64: await fileToBase64(f), classification: restricted ? 'restricted' : 'unclassified', record: { type, id } });
      }
    });
  }
  async function open(att: Rec) {
    await run(async () => { const { blob, fileName } = await apiDownload(`${OFC}/attachments/${String(att.id)}/content`); saveBlob(blob, fileName); });
  }

  const data = b.data;
  return (
    <div className="record-panel">
      <ErrorNotice error={b.error ?? error} />
      <h3>{t('ofc.panel.attachments')}</h3>
      <ul className="plain">
        {(data?.attachments ?? []).map((a) => (
          <li key={String(a.linkId)}>
            <button className="link" onClick={() => void open(a)}>{String(a.fileName)}</button> <small className="muted">{Math.ceil(Number(a.sizeBytes) / 1024)} KB</small>
            {a.classification === 'restricted' ? <> <span className="chip warn">{t('ofc.class.restricted')}</span></> : null}
            {can('ofc.attachment.remove') ? <> <button className="link" onClick={() => setDetach(a)}>{t('ofc.act.detach')}</button></> : null}
          </li>
        ))}
        {data && data.attachments.length === 0 ? <li className="muted">{t('ofc.panel.no_attachments')}</li> : null}
      </ul>
      {can('ofc.attachment.create') ? (
        <div className="inline">
          <label className="button">{t('ofc.act.attach')}<input type="file" multiple hidden disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
          <label className="check"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> {t('ofc.attach.restricted')}</label>
        </div>
      ) : null}

      {data && data.links.length ? (
        <>
          <h3>{t('ofc.panel.links')}</h3>
          <ul className="plain">
            {data.links.map((l) => {
              const otherType = String(l.direction === 'out' ? l.toType : l.fromType);
              return <li key={String(l.id)}>{t(`ofc.link.${String(l.linkType)}`)}: {t(TYPE_LABEL[otherType] ?? otherType)} <small className="muted">{String(l.direction === 'out' ? l.toId : l.fromId).slice(-8)}</small></li>;
            })}
          </ul>
        </>
      ) : null}

      <h3>{t('ofc.panel.history')}</h3>
      <ol className="timeline">
        {(data?.timeline ?? []).map((e) => (
          <li key={String(e.id)}>
            <small className="muted">{toLocalDisplay(String(e.occurredAt), tz)} · {String(e.actorName ?? '')}</small>
            <div>
              <strong>{t(`ofc.ev.${String(e.kind)}`)}</strong>
              {e.field ? ` ${String(e.field)}` : ''}
              {e.fromValue != null || e.toValue != null ? `: ${String(e.fromValue ?? '—')} → ${String(e.toValue ?? '—')}` : ''}
              {e.note ? <div>{String(e.note)}</div> : null}
            </div>
          </li>
        ))}
        {data && data.timeline.length === 0 ? <li className="muted">{t('ofc.panel.no_history')}</li> : null}
      </ol>
      {can('ofc.timeline.comment') ? (
        <form className="comment" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('POST', `${OFC}/comments`, { record: { type, id }, kind, note }); setNote(''); }); }}>
          <textarea aria-label={t('ofc.panel.note')} placeholder={t('ofc.panel.note')} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          <div className="inline">
            <select aria-label={t('ofc.panel.kind')} value={kind} onChange={(e) => setKind(e.target.value as 'comment' | 'progress')}>
              <option value="comment">{t('ofc.ev.comment')}</option><option value="progress">{t('ofc.ev.progress')}</option>
            </select>
            <button type="submit" disabled={busy || !note.trim()}>{t('ofc.act.add_note')}</button>
          </div>
        </form>
      ) : null}
      {detach ? (
        <ReasonModal title={t('ofc.act.detach_title', { name: String(detach.fileName) })} onClose={() => setDetach(null)}
          onConfirm={async (reason) => { await api('POST', `${OFC}/attachment-links/${String(detach.linkId)}/remove`, { expectedVersion: Number(detach.linkVersion), reason }); b.reload(); }} />
      ) : null}
    </div>
  );
}
