/** Mandatory reports (spec §1.9): date range, filters, print layout (Print / Save as PDF), Excel. */
import { useState } from 'react';
import { apiDownload, qs, saveBlob } from '../../platform/api';
import { t } from '../../platform/i18n';
import { useAuth } from '../../platform/session';
import { ErrorNotice } from '../../platform/ui';
import { OFC, OfficePicker, useGet, useOffice, usePersons, type Page } from './binding';

export const REPORTS = ['daily_outstanding', 'weekly_progress', 'monthly_summary', 'overdue_tasks', 'pending_correspondence', 'handover_completion', 'equipment_pending', 'workshop_progress', 'personnel_allocation', 'supply_status'];
interface Section { title: string; columns: Array<{ key: string; label: string }>; rows: Array<Record<string, string | number | null>> }
interface Report { code: string; title: string; period: { from: string; to: string } | null; asOf: string; sections: Section[] }

export function ReportsScreen() {
  const office = useOffice();
  const C = office.commandId;
  const { me } = useAuth();
  const people = usePersons(C);
  const units = useGet<Page>(C ? `${OFC}/units` : null, { commandId: C });
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('report') ?? 'daily_outstanding');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [unitId, setUnitId] = useState('');
  const [personId, setPersonId] = useState('');
  const params = { commandId: C, from: from || undefined, to: to || undefined, unitId: unitId || undefined, personId: personId || undefined };
  const r = useGet<Report>(C ? `${OFC}/reports/${code}` : null, params);
  const [error, setError] = useState<Error | null>(null);
  const excel = async () => {
    try { const f = await apiDownload(`${OFC}/reports/${code}/xlsx${qs(params)}`); saveBlob(f.blob, f.fileName); setError(null); } catch (e) { setError(e as Error); }
  };
  const unitName = (units.data?.items ?? []).find((u) => u.id === unitId)?.path;
  const d = r.data;
  return (
    <section className="report print-area">
      <div className="page-head no-print">
        <h1>{t('ofc.title.reports')}</h1>
        <div className="tools"><OfficePicker office={office} /><button onClick={() => void excel()} disabled={!d}>{t('ofc.act.excel')}</button><button className="primary" onClick={() => window.print()} disabled={!d}>{t('ofc.act.print_pdf')}</button></div>
      </div>
      <div className="tools no-print">
        <select aria-label={t('ofc.field.report')} value={code} onChange={(e) => setCode(e.target.value)}>{REPORTS.map((c, i) => <option key={c} value={c}>{i + 1}. {t(`ofc.report.${c}`)}</option>)}</select>
        <label className="inline">{t('ofc.filter.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">{t('ofc.filter.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select aria-label={t('ofc.field.unit')} value={unitId} onChange={(e) => setUnitId(e.target.value)}><option value="">{t('ofc.filter.any_unit')}</option>{(units.data?.items ?? []).map((u) => <option key={u.id} value={u.id}>{String(u.path)}</option>)}</select>
        <select aria-label={t('ofc.field.responsible')} value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">{t('ofc.filter.anyone')}</option>{people.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      </div>
      <p className="hint no-print">{t('ofc.hint.reports')}</p>
      <ErrorNotice error={r.error ?? error} />
      {d ? (
        <>
          <header className="report-head">
            <div>{t('ofc.report.office')}</div>
            <h1>{d.title}</h1>
            <div>{d.period ? t('ofc.report.period', { from: d.period.from, to: d.period.to }) : t('ofc.report.as_of', { date: d.asOf })}{unitName ? ` · ${String(unitName)}` : ''}{personId ? ` · ${people.name(personId)}` : ''}</div>
            <small>{t('ofc.report.generated', { when: new Date().toLocaleString(), who: me?.user.displayName ?? '' })}</small>
          </header>
          {d.sections.map((s) => (
            <div key={s.title} className="report-section">
              <h2>{s.title}</h2>
              <table>
                <thead><tr>{s.columns.map((c) => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
                <tbody>
                  {s.rows.map((row, i) => <tr key={i}>{s.columns.map((c) => <td key={c.key} className={c.key === 'overdue' && row[c.key] ? 'late' : ''}>{row[c.key] ?? ''}</td>)}</tr>)}
                  {s.rows.length === 0 ? <tr><td colSpan={s.columns.length} className="empty">{t('ofc.report.none')}</td></tr> : null}
                </tbody>
              </table>
            </div>
          ))}
          <div className="signatures"><div>{t('ofc.report.prepared')}</div><div>{t('ofc.report.checked')}</div></div>
        </>
      ) : null}
    </section>
  );
}
