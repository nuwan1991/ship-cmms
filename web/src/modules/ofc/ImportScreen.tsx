/** Bring existing registers in (spec §6): paste from Excel, check every row, then register. Original references and dates are kept. */
import { useState } from 'react';
import { api } from '../../platform/api';
import { t } from '../../platform/i18n';
import { ErrorNotice } from '../../platform/ui';
import { OFC, OfficePicker, useOffice } from './binding';
import { IMPORTS, parseWithMap } from './paste';

type Kind = keyof typeof IMPORTS;
interface Preview { committed: boolean; summary: { rows: number; errors: number; warnings: number }; rows: Array<{ row: number; errors: string[]; warnings: string[] }>; created?: Array<string | null> }

export function ImportScreen() {
  const office = useOffice();
  const [kind, setKind] = useState<Kind>('persons');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = IMPORTS[kind];
  const parsed = text.trim() ? parseWithMap(text, spec.map, spec.types) : null;
  async function send(commit: boolean) {
    if (!parsed) return;
    setBusy(true); setError(null);
    try { setPreview(await api<Preview>('POST', `${OFC}/import/${kind}`, { commandId: office.commandId, rows: parsed.rows, commit })); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <section>
      <div className="page-head"><h1>{t('ofc.title.import')}</h1><div className="tools"><OfficePicker office={office} /></div></div>
      <div className="tools">
        <select aria-label={t('ofc.import.what')} value={kind} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); }}>
          {(Object.keys(IMPORTS) as Kind[]).map((k) => <option key={k} value={k}>{t(`ofc.import.${k}`)}</option>)}
        </select>
      </div>
      <p className="hint">{t(`ofc.import.help_${kind}`)}</p>
      <p className="hint">{t('ofc.import.order')}</p>
      <textarea aria-label={t('ofc.paste.area')} className="paste" value={text} placeholder={spec.example} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
      {parsed ? <p>{t('ofc.paste.columns')}: {parsed.headings.map((h) => <span key={h.heading} className={`chip ${h.field ? 'ok' : 'muted'}`}>{h.heading}{h.field ? ` → ${h.field}` : ` (${t('ofc.paste.ignored')})`}</span>)} · {t('ofc.count', { n: parsed.rows.length })}</p> : null}
      <ErrorNotice error={error} />
      {preview ? (
        <>
          <p className={preview.committed ? 'notice' : ''}>{preview.committed ? t('ofc.paste.done', { n: preview.created?.length ?? 0 }) : t('ofc.import.summary', preview.summary)}</p>
          <ul className="plain">{preview.rows.filter((r) => r.errors.length || r.warnings.length).map((r, i) => (
            <li key={i}><strong>{r.row ? t('ofc.paste.row', { n: r.row + 1 }) : ''}</strong> {r.errors.map((e) => <span key={e} className="chip warn">{e}</span>)} {r.warnings.map((w) => <span key={w} className="chip muted">{w}</span>)}</li>
          ))}</ul>
        </>
      ) : null}
      <div className="actions">
        {!preview?.committed ? <button disabled={busy || !parsed?.rows.length || !office.commandId} onClick={() => void send(false)}>{t('ofc.paste.check')}</button> : <button onClick={() => { setText(''); setPreview(null); }}>{t('ofc.import.another')}</button>}
        {preview && !preview.committed && preview.summary.errors === 0 ? <button className="primary" disabled={busy} onClick={() => void send(true)}>{t('ofc.paste.commit', { n: preview.summary.rows })}</button> : null}
      </div>
    </section>
  );
}
