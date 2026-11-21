/** Supply demands (FR-S1..S5): stages with dates, overdue demands, paste import from the logistics system that updates by Supply reference. */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal } from '../../platform/ui';
import { DueCell, OFC, OfficePicker, show, todayIso, useGet, useOffice, type Page } from './binding';
import { parseSupplyPaste } from './paste';
import { RecordPanel } from './RecordPanel';

export function SupplyScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const C = office.commandId;
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') ?? 'open');
  const [stage, setStage] = useState('');
  const [q, setQ] = useState('');
  const list = useGet<Page & { stages: string[] }>(C ? `${OFC}/supply` : null, { commandId: C, view, stage: stage || undefined, q: q || undefined, limit: '1000' });
  const stages = list.data?.stages ?? [];
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editStages, setEditStages] = useState(false);
  const [open, setOpen] = useState<Rec | null>(null);
  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.supply')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          {can('ofc.settings.update') ? <button onClick={() => setEditStages(true)}>{t('ofc.act.edit_stages')}</button> : null}
          {can('ofc.supply.update') && C ? <button onClick={() => setImporting(true)}>{t('ofc.act.paste_logistics')}</button> : null}
          {can('ofc.supply.create') && C ? <button className="primary" onClick={() => setCreating(true)}>{t('ofc.new.demand')}</button> : null}
        </div>
      </div>
      <div className="tools">
        <input type="search" aria-label={t('common.search')} placeholder={t('ofc.search.supply')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('ofc.filter.view')} value={view} onChange={(e) => setView(e.target.value)}>{['open', 'overdue', 'closed', 'all'].map((v) => <option key={v} value={v}>{t(`ofc.sview.${v}`)}</option>)}</select>
        <select aria-label={t('ofc.field.stage')} value={stage} onChange={(e) => setStage(e.target.value)}><option value="">{t('ofc.filter.any_stage')}</option>{stages.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <span className="muted">{t('ofc.count', { n: list.data?.total ?? 0 })}</span>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ofc.field.refNo')}</th><th scope="col">{t('ofc.field.supplyRef')}</th><th scope="col">{t('ofc.field.demandDate')}</th><th scope="col">{t('ofc.field.item')}</th><th scope="col">{t('ofc.field.quantity')}</th>
            <th scope="col">{t('ofc.field.stage')}</th><th scope="col">{t('ofc.field.daysInStage')}</th><th scope="col">{t('ofc.field.expectedDate')}</th>
          </tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td><button className="link" onClick={() => setOpen(r)}>{String(r.refNo)}</button></td><td>{show(r.supplyRef)}</td><td>{String(r.demandDate)}</td>
                <td>{String(r.item)}{r.partNo ? <small className="muted"> {String(r.partNo)}</small> : null}</td><td>{r.quantity == null ? '—' : `${String(r.quantity)} ${String(r.unitOfIssue ?? '')}`}</td>
                <td>{String(r.stage)}</td><td>{String(r.daysInStage)}</td><td><DueCell date={r.expectedDate} overdue={r.overdue} /></td>
              </tr>
            ))}
            {!list.loading && C && (list.data?.items.length ?? 0) === 0 ? <tr><td colSpan={8} className="empty">{t('ofc.supply.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {creating ? (
        <FormModal title={t('ofc.new.demand')} record={null} tz={tz} defaults={{ demandDate: todayIso(), stage: stages[0] ?? '' }} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (b) => { await api('POST', `${OFC}/supply`, { ...b, commandId: C }); list.reload(); }}
          fields={[
            { key: 'item', labelKey: 'ofc.field.item', type: 'text', required: true, maxLength: 300 }, { key: 'partNo', labelKey: 'ofc.field.partNo', type: 'text', maxLength: 80 },
            { key: 'quantity', labelKey: 'ofc.field.quantity', type: 'number' }, { key: 'unitOfIssue', labelKey: 'ofc.field.unitOfIssue', type: 'text', maxLength: 20 },
            { key: 'supplyRef', labelKey: 'ofc.field.supplyRef', type: 'text', maxLength: 80, hintKey: 'ofc.hint.supplyRef' }, { key: 'demandDate', labelKey: 'ofc.field.demandDate', type: 'date', required: true },
            { key: 'demandingUnit', labelKey: 'ofc.field.demandingUnit', type: 'text', maxLength: 200 },
            { key: 'stage', labelKey: 'ofc.field.stage', type: 'select', required: true, options: stages.map((s) => ({ value: s, label: s })) },
            { key: 'expectedDate', labelKey: 'ofc.field.expectedDate', type: 'date' }, { key: 'supplyContact', labelKey: 'ofc.field.supplyContact', type: 'text', maxLength: 200 },
            { key: 'remarks', labelKey: 'ofc.field.remarks', type: 'textarea', maxLength: 4000 },
          ]} />
      ) : null}
      {open ? <DemandDetail rec={open} stages={stages} onClose={() => setOpen(null)} onChanged={() => { list.reload(); setOpen(null); }} /> : null}
      {importing ? <SupplyPaste commandId={C} onClose={() => setImporting(false)} onDone={list.reload} /> : null}
      {editStages ? (
        <FormModal title={t('ofc.act.edit_stages')} record={null} tz={tz} defaults={{ stages: stages.join('\n') }} onClose={() => setEditStages(false)}
          extra={<p className="hint">{t('ofc.hint.stages')}</p>}
          fields={[{ key: 'stages', labelKey: 'ofc.field.stages', type: 'textarea', required: true, maxLength: 3000 }]}
          onSubmit={async (b) => { await api('PUT', `${OFC}/settings/supply-stages?commandId=${C}`, { stages: String(b.stages).split('\n').map((s) => s.trim()).filter(Boolean) }); list.reload(); }} />
      ) : null}
    </section>
  );
}

function DemandDetail({ rec, stages, onClose, onChanged }: { rec: Rec; stages: string[]; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const [stageForm, setStageForm] = useState(false);
  return (
    <Modal title={`${String(rec.refNo)} – ${String(rec.item)}`} onClose={onClose} wide>
      <dl className="facts">
        <dt>{t('ofc.field.supplyRef')}</dt><dd>{show(rec.supplyRef)}</dd><dt>{t('ofc.field.stage')}</dt><dd>{String(rec.stage)} ({t('ofc.supply.since', { date: String(rec.stageDate), n: Number(rec.daysInStage) })})</dd>
        <dt>{t('ofc.field.expectedDate')}</dt><dd>{show(rec.expectedDate)}</dd><dt>{t('ofc.field.demandingUnit')}</dt><dd>{show(rec.demandingUnit)}</dd>
        <dt>{t('ofc.field.supplyContact')}</dt><dd>{show(rec.supplyContact)}</dd><dt>{t('ofc.field.remarks')}</dt><dd>{show(rec.remarks)}</dd>
      </dl>
      {can('ofc.supply.update') ? <div className="actions"><button className="primary" onClick={() => setStageForm(true)}>{t('ofc.act.update_stage')}</button></div> : null}
      <RecordPanel type="ofc.supply_demand" id={rec.id} />
      {stageForm ? (
        <FormModal title={t('ofc.act.update_stage')} record={null} tz={tz} defaults={{ stage: String(rec.stage), stageDate: todayIso(), expectedDate: String(rec.expectedDate ?? '') }} onClose={() => setStageForm(false)}
          onSubmit={async (b) => { await api('POST', `${OFC}/supply/${rec.id}/stage`, { ...b, expectedVersion: rec.version }); onChanged(); }}
          fields={[
            { key: 'stage', labelKey: 'ofc.field.stage', type: 'select', required: true, options: stages.map((s) => ({ value: s, label: s })) },
            { key: 'stageDate', labelKey: 'ofc.field.stageDate', type: 'date', required: true }, { key: 'expectedDate', labelKey: 'ofc.field.expectedDate', type: 'date' },
            { key: 'note', labelKey: 'ofc.field.note', type: 'textarea', maxLength: 2000 },
          ]} />
      ) : null}
    </Modal>
  );
}

interface Preview { committed: boolean; summary: { rows: number; errors: number; create: number; update: number; unchanged: number }; rows: Array<{ row: number; action: string; errors: string[]; warnings: string[] }> }

function SupplyPaste({ commandId, onClose, onDone }: { commandId: string; onClose(): void; onDone(): void }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseSupplyPaste(text) : null;
  async function send(commit: boolean) {
    if (!parsed) return;
    setBusy(true); setError(null);
    try { const r = await api<Preview>('POST', `${OFC}/supply/bulk`, { commandId, rows: parsed.rows, commit }); setPreview(r); if (r.committed) onDone(); } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <Modal title={t('ofc.act.paste_logistics')} onClose={onClose} wide>
      <p className="hint">{t('ofc.paste.supply_help')}</p>
      <textarea aria-label={t('ofc.paste.area')} className="paste" value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder={'Supply ref\tDate\tItem\tQty\tStage\tETA'} />
      {parsed ? <p>{t('ofc.paste.columns')}: {parsed.headings.map((h) => <span key={h.heading} className={`chip ${h.field ? 'ok' : 'muted'}`}>{h.heading}{h.field ? ` → ${t(`ofc.field.${h.field}`)}` : ` (${t('ofc.paste.ignored')})`}</span>)}</p> : null}
      <ErrorNotice error={error} />
      {preview ? (
        <>
          <p>{t(preview.committed ? 'ofc.paste.supply_done' : 'ofc.paste.supply_summary', preview.summary)}</p>
          <ul className="plain">{preview.rows.filter((r) => r.errors.length || r.warnings.length).map((r) => <li key={r.row}><strong>{t('ofc.paste.row', { n: r.row + 1 })}</strong> {r.errors.map((e) => <span key={e} className="chip warn">{e}</span>)} {r.warnings.map((w) => <span key={w} className="chip muted">{w}</span>)}</li>)}</ul>
        </>
      ) : null}
      <footer>
        <button onClick={onClose}>{t('common.close')}</button>
        {!preview?.committed ? <button disabled={busy || !parsed?.rows.length} onClick={() => void send(false)}>{t('ofc.paste.check')}</button> : null}
        {preview && !preview.committed && preview.summary.errors === 0 ? <button className="primary" disabled={busy} onClick={() => void send(true)}>{t('ofc.paste.apply')}</button> : null}
      </footer>
    </Modal>
  );
}
