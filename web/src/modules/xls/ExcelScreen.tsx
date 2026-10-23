import { useEffect, useMemo, useState } from 'react';
import { api, apiDownload, qs, saveBlob, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { MAX_UPLOAD_BYTES, toBase64 } from './encode';

const XLS = '/api/v1/excel';
interface Col { key: string; label: string; required?: boolean; hint?: string; example?: string }
interface Template { code: string; title: string; columns: Col[] }
interface Job extends Rec { fileName: string; templateCode: string; status: string; totalRows: number; okRows: number; errorRows: number; createRows: number; updateRows: number; skipRows: number; ignoredColumns: string | null; message: string | null; createdAt: string }

export function ExcelScreen() {
  const { tz } = useSystem();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [code, setCode] = useState('');
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const recent = useList<Job>(`${XLS}/imports`);
  const rows = useList(job ? `${XLS}/imports/${job.id}/rows` : null, { status: errorsOnly ? 'error' : undefined });

  useEffect(() => {
    let live = true;
    api<{ items: Template[] }>('GET', `${XLS}/templates`).then((r) => { if (live) { setTemplates(r.items); setCode((c) => c || r.items[0]?.code || ''); } }, (e: Error) => live && setError(e));
    return () => { live = false; };
  }, []);
  const tpl = useMemo(() => templates.find((x) => x.code === code), [templates, code]);

  async function download(path: string) {
    try { const f = await apiDownload(path); saveBlob(f.blob, f.fileName); setError(null); } catch (e) { setError(e as Error); }
  }
  async function onFile(file: File | undefined) {
    if (!file || !code) return;
    setError(null); setNotice(''); setJob(null);
    if (file.size > MAX_UPLOAD_BYTES) { setError(new Error(t('xls.err.too_big'))); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setJob(await api<Job>('POST', `${XLS}/imports`, { templateCode: code, fileName: file.name, contentBase64: toBase64(bytes) }));
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  async function save(skipErrors: boolean) {
    if (!job) return;
    setBusy(true);
    try {
      const done = await api<Job>('POST', `${XLS}/imports/${job.id}/commit`, { skipErrors });
      setNotice(t('xls.saved', { file: done.fileName, create: String(done.createRows), update: String(done.updateRows), skip: String(done.skipRows) }));
      setJob(null); setError(null); recent.reload();
    } catch (e) { setError(e as Error); setJob(await api<Job>('GET', `${XLS}/imports/${job.id}`).catch(() => job)); recent.reload(); } finally { setBusy(false); }
  }

  const valid = job ? job.okRows : 0;
  return (
    <section>
      <div className="page-head"><h1>{t('xls.title')}</h1></div>
      <p className="hint">{t('xls.intro')}</p>
      <ErrorNotice error={error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}

      <h2>{t('xls.step.template')}</h2>
      <div className="tools">
        <label>{t('xls.field.template')}{' '}
          <select value={code} onChange={(e) => { setCode(e.target.value); setJob(null); }}>
            {templates.map((x) => <option key={x.code} value={x.code}>{x.title}</option>)}
          </select>
        </label>
        {can('xls.template.view') ? <>
          <button onClick={() => void download(`${XLS}/templates/${code}/file${qs({ format: 'xlsx' })}`)}>{t('xls.dl.template_xlsx')}</button>
          <button onClick={() => void download(`${XLS}/templates/${code}/file${qs({ format: 'csv' })}`)}>{t('xls.dl.template_csv')}</button>
        </> : null}
        {can('xls.export.run') ? <>
          <button onClick={() => void download(`${XLS}/templates/${code}/file${qs({ kind: 'data', format: 'xlsx' })}`)}>{t('xls.dl.data_xlsx')}</button>
          <button onClick={() => void download(`${XLS}/templates/${code}/file${qs({ kind: 'data', format: 'csv' })}`)}>{t('xls.dl.data_csv')}</button>
        </> : null}
      </div>
      {tpl ? (
        <details>
          <summary>{t('xls.columns')}</summary>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t('xls.col.name')}</th><th scope="col">{t('xls.col.required')}</th><th scope="col">{t('xls.col.notes')}</th></tr></thead>
            <tbody>{tpl.columns.map((c) => <tr key={c.key}><td>{c.label}</td><td>{c.required ? t('xls.col.yes') : t('xls.col.no')}</td><td>{c.hint ?? ''}{c.example ? ` (${c.example})` : ''}</td></tr>)}</tbody>
          </table></div>
        </details>
      ) : null}

      {can('xls.import.preview') ? <>
        <h2>{t('xls.step.upload')}</h2>
        <div className="tools">
          <label>{t('xls.field.file')}{' '}
            <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy || !code}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onFile(f); }} />
          </label>
          {busy ? <span role="status">{t('xls.uploading')}</span> : null}
        </div>
      </> : null}

      {job ? (
        <div>
          <h2>{t('xls.preview.title', { file: job.fileName })}</h2>
          <p className="hint">{t('xls.preview.note')}</p>
          {job.message ? <div className="banner warn" role="status">{job.message}</div> : null}
          {job.ignoredColumns ? <div className="banner info" role="status">{t('xls.ignored', { names: job.ignoredColumns })}</div> : null}
          <div className="axes">
            {([['total', job.totalRows], ['create', job.createRows], ['update', job.updateRows], ['skip', job.skipRows], ['errors', job.errorRows]] as const).map(([k, n]) => (
              <div className="axis" key={k}><span className="axis-name">{t(`xls.stat.${k}`)}</span> <span className={`chip ${k === 'errors' ? (n ? 'warn' : 'muted') : 'ok'}`}>{n}</span></div>
            ))}
          </div>
          <div className="tools">
            <select aria-label={t('xls.row.result')} value={errorsOnly ? 'errors' : 'all'} onChange={(e) => setErrorsOnly(e.target.value === 'errors')}>
              <option value="all">{t('xls.filter.all')}</option><option value="errors">{t('xls.filter.errors')}</option>
            </select>
            {job.errorRows === 0 && valid > 0 ? <button className="primary" disabled={busy} onClick={() => void save(false)}>{t('xls.act.save', { count: String(valid) })}</button> : null}
            {job.errorRows > 0 && valid > 0 ? <button className="primary" disabled={busy} onClick={() => void save(true)}>{t('xls.act.save_valid', { count: String(valid), errors: String(job.errorRows) })}</button> : null}
            {valid === 0 ? <button disabled>{t('xls.act.save_none')}</button> : null}
            {job.errorRows > 0 ? <button onClick={() => void download(`${XLS}/imports/${job.id}/report`)}>{t('xls.act.report')}</button> : null}
            <button className="link-danger" onClick={() => setJob(null)}>{t('xls.act.discard')}</button>
          </div>
          <ErrorNotice error={rows.error} />
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t('xls.row.row')}</th><th scope="col">{t('xls.row.result')}</th><th scope="col">{t('xls.row.values')}</th><th scope="col">{t('xls.row.problems')}</th></tr></thead>
            <tbody>
              {rows.items.map((r) => (
                <tr key={String(r.rowNo)}>
                  <td>{String(r.rowNo)}</td>
                  <td><span className={`chip ${r.status === 'error' ? 'warn' : r.action === 'skip' ? 'muted' : 'ok'}`}>{t(`xls.result.${r.status === 'error' ? 'error' : String(r.action)}`)}</span></td>
                  <td>{((r.summary as Array<{ key: string; value: string }> | undefined) ?? []).map((s) => s.value).join(' · ')}{r.reference ? ` → ${String(r.reference)}` : ''}</td>
                  <td>{((r.errors as string[] | undefined) ?? []).join(' ')}</td>
                </tr>
              ))}
              {!rows.loading && rows.items.length === 0 ? <tr><td colSpan={4} className="empty">{t('xls.rows.empty')}</td></tr> : null}
            </tbody>
          </table></div>
          {rows.hasMore ? <button onClick={rows.loadMore}>{t('common.more')}</button> : null}
        </div>
      ) : null}

      {can('xls.import.view') ? <>
        <h2>{t('xls.step.recent')}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t('xls.recent.file')}</th><th scope="col">{t('xls.recent.template')}</th><th scope="col">{t('xls.recent.when')}</th><th scope="col">{t('xls.recent.result')}</th></tr></thead>
          <tbody>
            {recent.items.map((j) => (
              <tr key={j.id}>
                <td>{j.fileName}</td><td>{templates.find((x) => x.code === j.templateCode)?.title ?? j.templateCode}</td><td>{toLocalDisplay(j.createdAt, tz)}</td>
                <td><span className={`chip ${j.status === 'committed' ? 'ok' : j.status === 'failed' ? 'warn' : 'muted'}`}>{t(`xls.job.status.${j.status}`)}</span> {j.message ?? ''}</td>
              </tr>
            ))}
            {!recent.loading && recent.items.length === 0 ? <tr><td colSpan={4} className="empty">{t('xls.recent.empty')}</td></tr> : null}
          </tbody>
        </table></div>
      </> : null}
    </section>
  );
}
