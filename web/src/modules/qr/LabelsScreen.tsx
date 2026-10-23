import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, Modal, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { rangeWarning } from './items';
import { ORG, QR, optionLabel } from './binding';

interface Cell { labelId: string; labelNo: string; assetTag: string | null; assetName: string | null; svg: string; reprint: boolean }
interface Printed { jobId: string; columns: number; sheets: Array<{ page: number; cells: Cell[] }> }

/** A4 sheet preview. The browser print dialog does the printing; the QR carries the label number only. */
function PrintModal({ printed, onClose }: { printed: Printed; onClose(): void }) {
  return (
    <Modal title={t('qr.print.title')} onClose={onClose} wide>
      <p className="help">{t('qr.print.help')}</p>
      <div className="print-area">
        {printed.sheets.map((s) => (
          <section key={s.page} className="sheet" style={{ gridTemplateColumns: `repeat(${printed.columns}, 1fr)` }} aria-label={t('qr.print.sheet', { n: String(s.page) })}>
            {s.cells.map((c) => (
              <figure key={c.labelId} className="sticker">
                <div className="qr" dangerouslySetInnerHTML={{ __html: c.svg }} />
                <figcaption>
                  <strong>{c.labelNo}</strong>
                  {c.assetTag ? <span>{c.assetTag}</span> : null}
                  {c.assetName ? <span>{c.assetName}</span> : null}
                  {c.reprint ? <em>{t('qr.print.reprint')}</em> : null}
                </figcaption>
              </figure>
            ))}
          </section>
        ))}
      </div>
      <footer>
        <button onClick={onClose}>{t('common.close')}</button>
        <button className="primary" onClick={() => window.print()}>{t('qr.print.now')}</button>
      </footer>
    </Modal>
  );
}

export function LabelsScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const list = useList(`${QR}/labels`, { state: state || undefined, q: q || undefined });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [assigning, setAssigning] = useState<Rec | null>(null);
  const [voiding, setVoiding] = useState<Rec | null>(null);
  const [printed, setPrinted] = useState<Printed | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const mayIssue = can('qr.label.create');
  useEffect(() => { if (mayIssue) api<{ remaining: number }>('GET', `${QR}/labels/remaining`).then((r) => setRemaining(r.remaining), () => setRemaining(null)); }, [mayIssue, list.items.length]);

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const print = async () => {
    try { setError(null); setPrinted(await api<Printed>('POST', `${QR}/labels/print`, { labelIds: [...selected] })); setSelected(new Set()); list.reload(); }
    catch (e) { setError(e as Error); }
  };
  const issueFields: FieldDef[] = [
    { key: 'count', labelKey: 'qr.field.count', type: 'number', required: true, hintKey: 'qr.hint.count' },
    { key: 'shipId', labelKey: 'qr.field.ship', type: 'select', hintKey: 'qr.hint.ship', options: ships.items.map((s) => ({ value: String(s.id), label: optionLabel(s) })) },
  ];
  const assignFields: FieldDef[] = [{ key: 'assetTag', labelKey: 'qr.field.assetTag', type: 'text', required: true, maxLength: 40, hintKey: 'qr.hint.assetTag' }];
  const warn = rangeWarning(remaining, 1);

  return (
    <section>
      <div className="page-head">
        <h1>{t('qr.title.labels')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('qr.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('qr.field.state')} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{t('qr.filter.any_state')}</option>
            {['reserved', 'assigned', 'void'].map((s) => <option key={s} value={s}>{t(`qr.state.${s}`)}</option>)}
          </select>
          {can('qr.label.print') ? <button disabled={selected.size === 0} onClick={() => void print()}>{t('qr.print.selected', { n: String(selected.size) })}</button> : null}
          {mayIssue ? <button className="primary" onClick={() => setIssuing(true)}>{t('qr.new.labels')}</button> : null}
        </div>
      </div>
      {warn === 'none' ? <p role="alert" className="notice warn">{t('qr.numbers.none_left')}</p> : remaining !== null && remaining < 50 ? <p role="alert" className="notice warn">{t('qr.numbers.low', { n: String(remaining) })}</p> : null}
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col" aria-label={t('qr.select')} />
            <th scope="col">{t('qr.field.labelNo')}</th><th scope="col">{t('qr.field.state')}</th><th scope="col">{t('qr.field.asset')}</th>
            <th scope="col">{t('qr.field.note')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{r.state !== 'void' ? <input type="checkbox" aria-label={t('qr.select_label', { name: String(r.labelNo) })} checked={selected.has(String(r.id))} onChange={() => toggle(String(r.id))} /> : null}</td>
                <td>{String(r.labelNo)}</td>
                <td><StatusChip value={String(r.state)} labelPrefix="qr.state" /></td>
                <td>{r.assetTag ? `${String(r.assetTag)} – ${String(r.assetName)}` : ''}</td>
                <td>{String(r.voidReason ?? r.note ?? '')}</td>
                <td className="actions">
                  {r.state === 'reserved' && can('qr.label.assign') ? <button onClick={() => setAssigning(r)}>{t('qr.assign')}</button> : null}
                  {r.state !== 'void' && can('qr.label.void') ? <button className="link-danger" onClick={() => setVoiding(r)}>{t('qr.void')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('qr.labels.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {issuing ? (
        <FormModal title={t('qr.new.labels')} fields={issueFields} record={null} tz={tz} defaults={{ count: '10' }} submitKey="qr.issue" onClose={() => setIssuing(false)}
          onSubmit={async (body) => { await api('POST', `${QR}/labels/issue`, body); list.reload(); }} />
      ) : null}
      {assigning ? (
        <FormModal title={t('qr.assign_title', { name: String(assigning.labelNo) })} fields={assignFields} record={null} tz={tz} submitKey="qr.assign" onClose={() => setAssigning(null)}
          onSubmit={async (body) => { await api('POST', `${QR}/labels/${assigning.id}/assign`, { ...body, expectedVersion: assigning.version }); list.reload(); }} />
      ) : null}
      {voiding ? (
        <ReasonModal title={t('qr.void_title', { name: String(voiding.labelNo) })} confirmKey="qr.void" onClose={() => setVoiding(null)}
          onConfirm={async (reason) => { await api('POST', `${QR}/labels/${voiding.id}/void`, { expectedVersion: voiding.version, reason }); list.reload(); }} />
      ) : null}
      {printed ? <PrintModal printed={printed} onClose={() => setPrinted(null)} /> : null}
    </section>
  );
}
