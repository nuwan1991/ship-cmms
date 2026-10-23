import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { fmtNum, PM, useAssets } from './binding';

interface Generated { generated: Array<{ planCode: string; woNo: string }>; skipped: Array<{ planCode: string; reason: string }> }

/** What is overdue or coming due, from plans and calibration, with one button to create the work orders that are due. */
export function DueScreen() {
  const assets = useAssets();
  const [onlyDue, setOnlyDue] = useState(true);
  const [source, setSource] = useState('');
  const list = useList(`${PM}/due`, { onlyDue: onlyDue ? 'true' : undefined, source: source || undefined });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Generated | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function generate() {
    setBusy(true);
    try { setResult(await api<Generated>('POST', `${PM}/generate`, {})); setError(null); list.reload(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  const status = (r: Rec): 'overdue' | 'soon' | 'ok' => (r.overdue ? 'overdue' : r.dueSoon ? 'soon' : 'ok');
  return (
    <section>
      <div className="page-head">
        <h1>{t('pm.title.due')}</h1>
        <div className="tools">
          <select aria-label={t('pm.field.source')} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t('pm.filter.any_source')}</option>
            {['plan', 'calibration'].map((s) => <option key={s} value={s}>{t(`pm.source.${s}`)}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> {t('pm.filter.only_due')}</label>
          {can('pm.plan.generate') ? <button className="primary" disabled={busy} onClick={() => void generate()}>{t('pm.act.generate')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      {result ? (
        <div className="banner info" role="status">
          {t('pm.generated', { count: String(result.generated.length) })} {result.generated.map((g) => `${g.planCode} → ${g.woNo}`).join('; ')}
          {result.skipped.filter((s) => !/Not due|already|still open/.test(s.reason)).map((s) => <div key={s.planCode}>{s.planCode}: {s.reason}</div>)}
        </div>
      ) : null}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('pm.field.source')}</th><th scope="col">{t('pm.field.title')}</th><th scope="col">{t('pm.field.equipment')}</th><th scope="col">{t('pm.field.due')}</th><th scope="col">{t('pm.field.status')}</th></tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={`${String(r.source)}:${String(r.refId)}`}>
              <td>{t(`pm.source.${String(r.source)}`)}</td><td>{String(r.title)}{r.refCode ? ` (${String(r.refCode)})` : ''}</td>
              <td>{r.assetId ? assets.label(r.assetId) : String(r.positionId ?? '')}</td>
              <td>{r.basis === 'running_hours' ? t('pm.hours_left', { left: fmtNum(r.remainingHours) }) : String(r.dueOn ?? '')}</td>
              <td><span className={`chip ${status(r) === 'overdue' ? 'warn' : status(r) === 'soon' ? 'warn' : 'muted'}`}>{t(`pm.dstatus.${status(r)}`)}</span>{r.workOrderId ? <> <span className="chip ok">{t('pm.has_order')}</span></> : null}</td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('pm.due.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
    </section>
  );
}
