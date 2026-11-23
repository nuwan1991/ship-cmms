/**
 * Daily crew attendance: the workshop in-charge marks the day's sheet (leave, sick, course and duty from the personnel
 * register are filled in already, so normally only exceptions change); officers read the roll-up by section and department.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ErrorNotice } from '../../platform/ui';
import { OFC, OfficePicker, todayIso, useGet, useMe, useOffice } from './binding';

export const ATT_STATUSES = ['present', 'late', 'leave', 'sick', 'duty', 'course', 'absent', 'off'] as const;
type Status = (typeof ATT_STATUSES)[number];
const AT_WORK: readonly string[] = ['present', 'late'];

interface SheetRow { personId: string; rank: string | null; name: string; serviceNo: string | null; unitId: string; unitPath: string | null; status: Status | null; remarks: string | null; markedBy: string | null; suggested: Status }
interface Sheet { date: string; unit: Rec; canRecord: boolean; future: boolean; rows: SheetRow[] }
type Counts = Record<Status, number> & { strength: number; marked: number; notMarked: number; atWork: number };
interface SummaryUnit { id: string; code: string; name: string; level: string; depth: number; path: string; own: Counts; total: Counts }
interface Summary { from: string; to: string; days: number; units: SummaryUnit[]; office: Counts | null }

/** At-work share of the marked man-days, as a whole percentage ("—" when nothing is marked). */
export function atWorkPercent(c: Pick<Counts, 'atWork' | 'marked'>): string {
  return c.marked ? `${Math.round((c.atWork / c.marked) * 100)}%` : '—';
}

/** The edits that differ from what is saved: every unmarked row (with its suggested or chosen status) and every changed mark. */
export function pendingEntries(rows: readonly SheetRow[], edits: Record<string, { status?: Status; remarks?: string }>) {
  return rows.flatMap((r) => {
    const e = edits[r.personId] ?? {};
    const status = e.status ?? r.status ?? r.suggested;
    const remarks = (e.remarks ?? r.remarks ?? '').trim() || null;
    if (r.status && r.status === status && (r.remarks ?? null) === remarks) return [];
    return [{ personId: r.personId, status, remarks }];
  });
}

export function AttendanceScreen() {
  const office = useOffice();
  const [tab, setTab] = useState<'sheet' | 'summary'>(() => (can('ofc.attendance.record') ? 'sheet' : 'summary'));
  return (
    <section className="attendance print-area">
      <div className="page-head no-print">
        <h1>{t('ofc.title.attendance')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          <div className="segmented" role="group" aria-label={t('ofc.title.attendance')}>
            <button aria-pressed={tab === 'sheet'} onClick={() => setTab('sheet')}>{t('ofc.att.tab_sheet')}</button>
            <button aria-pressed={tab === 'summary'} onClick={() => setTab('summary')}>{t('ofc.att.tab_summary')}</button>
          </div>
        </div>
      </div>
      <ErrorNotice error={office.error} />
      {!office.loading && !office.commandId ? <p className="empty">{t('ofc.no_office')}</p> : null}
      {office.commandId ? (tab === 'sheet' ? <DailySheet commandId={office.commandId} /> : <SummaryView commandId={office.commandId} />) : null}
    </section>
  );
}

function DailySheet({ commandId }: { commandId: string }) {
  const units = useGet<{ items: Rec[] }>(`${OFC}/units`, { commandId });
  const me = useMe(commandId);
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(todayIso());
  // Start on the user's own unit (an in-charge marks their own workshop); otherwise the first workshop.
  useEffect(() => {
    if (unitId || !units.data) return;
    const items = units.data.items;
    const own = me?.unitId && items.some((u) => u.id === me.unitId) ? String(me.unitId) : '';
    setUnitId(own || String(items.find((u) => u.level === 'workshop')?.id ?? items[0]?.id ?? ''));
  }, [units.data, me, unitId]);
  const sheet = useGet<Sheet>(unitId ? `${OFC}/attendance/sheet` : null, { commandId, unitId, date });
  const [edits, setEdits] = useState<Record<string, { status?: Status; remarks?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => { setEdits({}); setSaved(null); setError(null); }, [unitId, date]);

  const rows = sheet.data?.rows ?? [];
  const pending = useMemo(() => pendingEntries(rows, edits), [rows, edits]);
  const editable = Boolean(sheet.data?.canRecord && !sheet.data.future);
  const current = (r: SheetRow): Status => edits[r.personId]?.status ?? r.status ?? r.suggested;
  const counts = ATT_STATUSES.map((s) => [s, rows.filter((r) => current(r) === s).length] as const).filter(([, n]) => n > 0);
  const notMarked = rows.filter((r) => !r.status).length;
  const showUnit = new Set(rows.map((r) => r.unitId)).size > 1;

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const r = await api<{ created: number; changed: number }>('POST', `${OFC}/attendance`, { commandId, date, entries: pending });
      setSaved(t('ofc.att.saved', { n: r.created + r.changed }));
      setEdits({});
      sheet.reload();
    } catch (e) { setError(e as ApiError); } finally { setSaving(false); }
  };
  const setAll = (status: Status) => setEdits(Object.fromEntries(rows.map((r) => [r.personId, { ...edits[r.personId], status }])));

  return (
    <>
      <div className="tools no-print">
        <label>{t('ofc.field.workshop')}{' '}
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {(units.data?.items ?? []).map((u) => <option key={String(u.id)} value={String(u.id)}>{' '.repeat(Number(u.depth) * 3)}{String(u.code)} – {String(u.name)}</option>)}
          </select>
        </label>
        <label>{t('ofc.att.date')} <input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <button onClick={() => setDate(todayIso())} disabled={date === todayIso()}>{t('ofc.att.today')}</button>
      </div>
      <ErrorNotice error={units.error ?? sheet.error ?? error} />
      {sheet.data ? (
        <>
          <p className="att-counts" role="status">
            <strong>{String(sheet.data.unit.code)} · {sheet.data.date}</strong>{' — '}
            {t('ofc.att.strength', { n: rows.length })}
            {counts.map(([s, n]) => <span key={s} className={`chip att-${s}`}>{t(`ofc.att.s.${s}`)} {n}</span>)}
            {notMarked ? <span className="chip warn">{t('ofc.att.not_saved', { n: notMarked })}</span> : <span className="chip ok">{t('ofc.att.all_saved')}</span>}
          </p>
          {!sheet.data.canRecord ? <p className="hint">{t('ofc.att.view_only')}</p> : null}
          {editable && rows.length ? (
            <div className="tools no-print">
              <span className="muted">{t('ofc.att.hint_prefill')}</span>
              <button onClick={() => setAll('present')}>{t('ofc.att.all_present')}</button>
            </div>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th scope="col">{t('ofc.field.name')}</th>
                {showUnit ? <th scope="col">{t('ofc.field.workshop')}</th> : null}
                <th scope="col">{t('ofc.att.status')}</th><th scope="col">{t('ofc.field.remarks')}</th><th scope="col">{t('ofc.att.marked_by')}</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const s = current(r);
                  const label = `${r.rank ? `${r.rank} ` : ''}${r.name}${r.serviceNo ? ` (${r.serviceNo})` : ''}`;
                  return (
                    <tr key={r.personId} className={r.status ? '' : 'att-unsaved'}>
                      <td>{label}</td>
                      {showUnit ? <td>{r.unitPath ?? '—'}</td> : null}
                      <td>
                        {editable ? (
                          <select aria-label={t('ofc.att.status_for', { name: label })} className={`att-${s}`} value={s} onChange={(e) => setEdits({ ...edits, [r.personId]: { ...edits[r.personId], status: e.target.value as Status } })}>
                            {ATT_STATUSES.map((x) => <option key={x} value={x}>{t(`ofc.att.s.${x}`)}</option>)}
                          </select>
                        ) : r.status ? <span className={`chip att-${r.status}`}>{t(`ofc.att.s.${r.status}`)}</span> : <span className="chip muted">{t('ofc.att.not_marked')}</span>}
                      </td>
                      <td>
                        {editable ? (
                          <input aria-label={t('ofc.att.remarks_for', { name: label })} maxLength={300} value={edits[r.personId]?.remarks ?? r.remarks ?? ''} onChange={(e) => setEdits({ ...edits, [r.personId]: { ...edits[r.personId], remarks: e.target.value } })} />
                        ) : (r.remarks ?? '—')}
                      </td>
                      <td className="muted">{r.markedBy ?? '—'}</td>
                    </tr>
                  );
                })}
                {!sheet.loading && rows.length === 0 ? <tr><td colSpan={showUnit ? 5 : 4} className="empty">{t('ofc.att.no_people')}</td></tr> : null}
              </tbody>
            </table>
          </div>
          {editable && rows.length ? (
            <div className="actions no-print">
              <button className="primary" disabled={saving || pending.length === 0} onClick={() => void save()}>{pending.length ? t('ofc.att.save', { n: pending.length }) : t('ofc.att.nothing_to_save')}</button>
              {saved ? <span className="chip ok" role="status">{saved}</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function SummaryView({ commandId }: { commandId: string }) {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [withBelow, setWithBelow] = useState(true);
  const s = useGet<Summary>(`${OFC}/attendance/summary`, { commandId, from, to: to < from ? from : to });
  const d = s.data;
  const cols: Array<keyof Counts> = ['strength', ...ATT_STATUSES, 'notMarked'];
  const head = (k: keyof Counts) => (k === 'strength' ? t('ofc.att.col_strength') : k === 'notMarked' ? t('ofc.att.not_marked') : t(`ofc.att.s.${k}`));
  const line = (c: Counts) => (
    <>
      {cols.map((k) => <td key={k} className={`num${k === 'notMarked' && c[k] ? ' late' : ''}`}>{c[k] || (k === 'strength' ? 0 : '')}</td>)}
      <td className="num"><strong>{atWorkPercent(c)}</strong></td>
    </>
  );
  return (
    <>
      <div className="tools no-print">
        <label>{t('ofc.att.from')} <input type="date" value={from} max={todayIso()} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <label>{t('ofc.att.to')} <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
        <button onClick={() => { setFrom(todayIso()); setTo(todayIso()); }}>{t('ofc.att.today')}</button>
        <label className="check"><input type="checkbox" checked={withBelow} onChange={(e) => setWithBelow(e.target.checked)} /> {t('ofc.att.with_below')}</label>
        <button className="primary" onClick={() => window.print()} disabled={!d}>{t('ofc.act.print_pdf')}</button>
      </div>
      <ErrorNotice error={s.error} />
      {d ? (
        <>
          <h2>{t('ofc.att.summary_title')} · {d.from === d.to ? d.from : `${d.from} – ${d.to}`}</h2>
          <p className="hint">{d.days > 1 ? t('ofc.att.hint_mandays', { n: d.days }) : t('ofc.att.hint_day')} {withBelow ? t('ofc.att.hint_rollup') : t('ofc.att.hint_own')}</p>
          <div className="table-wrap">
            <table className="att-summary">
              <thead><tr><th scope="col">{t('ofc.att.col_unit')}</th>{cols.map((k) => <th key={k} scope="col" className="num">{head(k)}</th>)}<th scope="col" className="num">{t('ofc.att.col_at_work')}</th></tr></thead>
              <tbody>
                {d.units.map((u) => (
                  <tr key={u.id} className={`level-${u.level}`}>
                    <th scope="row"><span className="indent" style={{ width: `${u.depth * 20}px` }} />{u.code} – {u.name}</th>
                    {line(withBelow ? u.total : u.own)}
                  </tr>
                ))}
                {d.units.length === 0 ? <tr><td colSpan={cols.length + 2} className="empty">{t('ofc.units.empty')}</td></tr> : null}
              </tbody>
              {d.office ? <tfoot><tr><th scope="row">{t('ofc.att.office_total')}</th>{line(d.office)}</tr></tfoot> : null}
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}
