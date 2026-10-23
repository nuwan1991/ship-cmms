import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice } from '../../platform/ui';
import { useList } from '../../platform/useList';

const OPS = '/api/v1/ops';
const mb = (n: unknown): string => (n === null || n === undefined ? t('ops.unknown') : `${(Number(n) / 1_048_576).toFixed(1)} MB`);
const gb = (n: unknown): string => (n === null || n === undefined ? t('ops.unknown') : `${(Number(n) / 1e9).toFixed(1)} GB`);

interface OpsStatus { installation: { code: string; name: string; kind: string } | null; mode: string; node: string; database: { bytes: number; freeDiskBytes: number | null }; backups: { count: number; last: Record<string, unknown> | null; lastVerified: Record<string, unknown> | null }; integrity: { ranAt: string; ok: number; problemCount: number } | null; lastRestore: { restoredAt: string } | null; warnings: Array<{ code: string }>; ok: boolean }

export function HealthScreen() {
  const { tz } = useSystem();
  const [s, setS] = useState<OpsStatus | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => { api<OpsStatus>('GET', `${OPS}/status`).then(setS, (e: Error) => setError(e)); }, []);
  const when = (iso: unknown): string => (iso ? toLocalDisplay(String(iso), tz) : t('ops.none'));
  return (
    <section>
      <div className="page-head"><h1>{t('ops.title.status')}</h1></div>
      <ErrorNotice error={error} />
      {s ? (
        <>
          {s.ok ? <div className="banner info" role="status">{t('ops.ok')}</div> : s.warnings.map((w) => <div key={w.code} className="banner warn" role="alert">{t(`ops.warn.${w.code}`)}</div>)}
          <dl className="facts">
            <dt>{t('ops.field.installation')}</dt><dd>{s.installation ? `${s.installation.code} – ${s.installation.name}` : t('ops.unknown')}</dd>
            <dt>{t('ops.field.mode')}</dt><dd>{s.mode}</dd>
            <dt>{t('ops.field.node')}</dt><dd>{s.node}</dd>
            <dt>{t('ops.field.db')}</dt><dd>{mb(s.database.bytes)}</dd>
            <dt>{t('ops.field.free')}</dt><dd>{gb(s.database.freeDiskBytes)}</dd>
            <dt>{t('ops.field.last_backup')}</dt><dd>{when(s.backups.last?.createdAt)}</dd>
            <dt>{t('ops.field.last_verified')}</dt><dd>{when(s.backups.lastVerified?.verifiedAt)}</dd>
            <dt>{t('ops.field.last_check')}</dt><dd>{s.integrity ? `${when(s.integrity.ranAt)} – ${t(s.integrity.ok ? 'ops.check.ok' : 'ops.check.bad')}` : t('ops.none')}</dd>
            <dt>{t('ops.field.restore')}</dt><dd>{when(s.lastRestore?.restoredAt)}</dd>
          </dl>
          <p className="hint"><strong>{t('ops.restore.title')}.</strong> {t('ops.restore.body')}</p>
        </>
      ) : null}
    </section>
  );
}

export function BackupsScreen() {
  const { tz } = useSystem();
  const list = useList(`${OPS}/backups`);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  async function make() {
    setBusy(true); setNotice('');
    try { const m = await api<{ fileName: string }>('POST', `${OPS}/backups`, {}); setNotice(t('ops.backup.made', { file: m.fileName })); setError(null); list.reload(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  async function verify(b: Rec) {
    setNotice('');
    try {
      const r = await api<{ ok: boolean; problems: string[] }>('POST', `${OPS}/backups/${b.id}/verify`, {});
      setNotice(r.ok ? t('ops.backup.ok') : t('ops.backup.bad', { why: r.problems.join('; ') })); setError(null); list.reload();
    } catch (e) { setError(e as Error); }
  }
  return (
    <section>
      <div className="page-head">
        <h1>{t('ops.title.backups')}</h1>
        <div className="tools">{can('ops.backup.create') ? <button className="primary" disabled={busy} onClick={() => void make()}>{t('ops.act.backup')}</button> : null}</div>
      </div>
      <ErrorNotice error={list.error ?? error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('ops.col.file')}</th><th scope="col">{t('ops.col.when')}</th><th scope="col" className="num">{t('ops.col.size')}</th><th scope="col">{t('ops.col.reason')}</th><th scope="col">{t('ops.col.by')}</th><th scope="col">{t('ops.col.verified')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((b) => (
            <tr key={b.id}>
              <td>{String(b.fileName)}</td><td>{toLocalDisplay(String(b.createdAt), tz)}</td><td className="num">{mb(b.bytes)}</td><td>{t(`ops.reason.${String(b.reason)}`)}</td><td>{String(b.createdBy)}</td>
              <td>{b.verifyOk === null || b.verifyOk === undefined ? t('ops.verified.never') : <span className={`chip ${b.verifyOk ? 'ok' : 'warn'}`}>{t(b.verifyOk ? 'ops.verified.yes' : 'ops.verified.no')}</span>}</td>
              <td className="actions">{can('ops.backup.verify') ? <button onClick={() => void verify(b)}>{t('ops.act.verify')}</button> : null}</td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('ops.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      <p className="hint">{t('ops.restore.body')}</p>
    </section>
  );
}

interface Finding { code: string; title: string; severity: 'error' | 'warning'; count: number; sample: unknown[] }

export function IntegrityScreen() {
  const { tz } = useSystem();
  const list = useList(`${OPS}/integrity`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function run() {
    setBusy(true);
    try { await api('POST', `${OPS}/integrity`, {}); setError(null); list.reload(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  const latest = list.items[0];
  const findings = (latest?.findings as Finding[] | undefined) ?? [];
  return (
    <section>
      <div className="page-head">
        <h1>{t('ops.title.integrity')}</h1>
        <div className="tools">{can('ops.integrity.run') ? <button className="primary" disabled={busy} onClick={() => void run()}>{t('ops.act.check')}</button> : null}</div>
      </div>
      <ErrorNotice error={list.error ?? error} />
      {latest ? (
        <>
          <p>{t('ops.check.when')}: {toLocalDisplay(String(latest.ranAt), tz)} · {findings.length === 0 ? t('ops.check.clean') : t('ops.check.problems', { count: String(latest.problemCount), groups: String(findings.length) })}</p>
          {findings.map((f) => (
            <details key={f.code} open={f.severity === 'error'}>
              <summary><span className={`chip ${f.severity === 'error' ? 'warn' : 'muted'}`}>{t(`ops.sev.${f.severity}`)}</span> {f.title} ({f.count})</summary>
              {f.sample.length ? <pre>{JSON.stringify(f.sample, null, 2)}</pre> : null}
            </details>
          ))}
        </>
      ) : <p className="empty">{t('ops.empty')}</p>}
    </section>
  );
}
