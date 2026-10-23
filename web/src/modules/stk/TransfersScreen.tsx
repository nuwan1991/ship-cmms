import { useMemo, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { STK } from './binding';

const fmt = (n: unknown): string => String(Math.round(Number(n) * 1000) / 1000);

/** Dispatch stock to another location, record its arrival, or call it back while it is still in transit. */
export function TransfersScreen() {
  const { tz } = useSystem();
  const [state, setState] = useState('in_transit');
  const list = useList(`${STK}/transfers`, { state: state || undefined });
  const locations = useList(`${STK}/locations`, { status: 'active' });
  const parts = useList(`${STK}/parts`, { status: 'active', limit: '500' });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<Rec | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const locName = (id: unknown) => { const l = locations.items.find((x) => x.id === id); return l ? String(l.code) : String(id ?? ''); };
  const partName = (id: unknown) => { const p = parts.items.find((x) => x.id === id); return p ? String(p.partNo) : String(id ?? ''); };
  const locOptions = useMemo(() => locations.items.map((l) => ({ value: String(l.id), label: `${String(l.code)} – ${String(l.name)}` })), [locations.items]);
  const partOptions = useMemo(() => parts.items.map((p) => ({ value: String(p.id), label: `${String(p.partNo)} – ${String(p.name)}` })), [parts.items]);
  const linesOf = (r: Rec): Array<{ partId: string; quantity: number }> => (Array.isArray(r.lines) ? (r.lines as Array<{ partId: string; quantity: number }>) : []);

  const fields: FieldDef[] = [
    { key: 'fromLocationId', labelKey: 'stk.field.from', type: 'select', required: true, options: locOptions },
    { key: 'toLocationId', labelKey: 'stk.field.to', type: 'select', required: true, options: locOptions },
    { key: 'partId', labelKey: 'stk.field.part', type: 'select', required: true, options: partOptions },
    { key: 'quantity', labelKey: 'stk.field.quantity', type: 'text', required: true, hintKey: 'stk.hint.quantity' },
    { key: 'note', labelKey: 'stk.field.note', type: 'textarea', maxLength: 500 },
  ];

  async function receive(r: Rec) {
    try { await api('POST', `${STK}/transfers/${r.transferId}/receive`, {}); setError(null); list.reload(); } catch (e) { setError(e as Error); }
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t('stk.title.transfers')}</h1>
        <div className="tools">
          <select aria-label={t('stk.field.status')} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{t('stk.filter.any_state')}</option>
            {['in_transit', 'received', 'cancelled'].map((s) => <option key={s} value={s}>{t(`stk.tstate.${s}`)}</option>)}
          </select>
          {can('stk.transfer.dispatch') ? <button className="primary" onClick={() => setCreating(true)}>{t('stk.new.transfer')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('stk.field.number')}</th><th scope="col">{t('stk.field.from')}</th><th scope="col">{t('stk.field.to')}</th><th scope="col">{t('stk.field.lines')}</th>
            <th scope="col">{t('stk.field.dispatchedAt')}</th><th scope="col">{t('stk.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={String(r.transferId)}>
                <td>{String(r.transferNo)}</td><td>{locName(r.fromLocationId)}</td><td>{locName(r.toLocationId)}</td>
                <td>{linesOf(r).map((l) => `${partName(l.partId)} × ${fmt(l.quantity)}`).join(', ')}</td>
                <td>{toLocalDisplay(String(r.dispatchedAt), tz)}</td>
                <td><span className={`chip ${r.state === 'in_transit' ? 'warn' : r.state === 'received' ? 'ok' : 'muted'}`}>{t(`stk.tstate.${String(r.state)}`)}</span></td>
                <td className="actions">
                  {r.state === 'in_transit' && can('stk.transfer.receive') ? <button onClick={() => void receive(r)}>{t('stk.act.receive_transfer')}</button> : null}
                  {r.state === 'in_transit' && can('stk.transfer.cancel') ? <button className="link-danger" onClick={() => setCancelling(r)}>{t('stk.act.cancel_transfer')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('stk.transfers.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {creating ? (
        <FormModal title={t('stk.new.transfer')} fields={fields} record={null} tz={tz} submitKey="stk.act.dispatch" onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const { partId, quantity, ...rest } = body;
            const n = Number(quantity);
            if (!Number.isFinite(n)) throw new Error(t('stk.err.number', { field: t('stk.field.quantity') }));
            if (!rest.note) delete rest.note;
            await api('POST', `${STK}/transfers`, { ...rest, lines: [{ partId, quantity: n }] });
            list.reload();
          }} />
      ) : null}
      {cancelling ? (
        <ReasonModal title={t('stk.cancel_title', { name: String(cancelling.transferNo) })} confirmKey="stk.act.cancel_transfer" onClose={() => setCancelling(null)}
          onConfirm={async (reason) => { await api('POST', `${STK}/transfers/${cancelling.transferId}/cancel`, { expectedVersion: cancelling.version, reason }); list.reload(); }} />
      ) : null}
    </section>
  );
}
