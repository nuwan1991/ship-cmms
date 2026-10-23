import { useMemo, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { STK, WRK } from './binding';

type Mode = 'receipts' | 'issues' | 'returns' | 'adjustments';
const MODE_PERM: Record<Mode, string> = { receipts: 'stk.transaction.receive', issues: 'stk.transaction.issue', returns: 'stk.transaction.return', adjustments: 'stk.transaction.adjust' };
const MODES: Mode[] = ['receipts', 'issues', 'returns', 'adjustments'];
const fmt = (n: unknown): string => String(Math.round(Number(n) * 1000) / 1000);

/** Resolve a typed work order number to its id (the server checks the order is open and on the same ship as the store). */
async function workOrderId(no: string): Promise<string> {
  const r = await api<{ items: Rec[] }>('GET', `${WRK}/work-orders?q=${encodeURIComponent(no.trim().toUpperCase())}&limit=5`);
  const hit = r.items.find((w) => String(w.woNo).toUpperCase() === no.trim().toUpperCase());
  if (!hit) throw new Error(t('stk.err.no_work_order', { no: no.trim().toUpperCase() }));
  return String(hit.workOrderId ?? hit.id);
}

/** Stock on hand per part and location, with the movement actions a storekeeper needs. */
export function StockScreen() {
  const { tz } = useSystem();
  const locations = useList(`${STK}/locations`, { status: 'active' });
  const [locationId, setLocationId] = useState('');
  const [below, setBelow] = useState(false);
  const [q, setQ] = useState('');
  const list = useList(`${STK}/stock`, { locationId: locationId || undefined, belowMinimum: below ? 'true' : undefined, q: q || undefined });
  const parts = useList(`${STK}/parts`, { status: 'active', limit: '500' });
  const [action, setAction] = useState<{ mode: Mode; row: Rec | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const partOptions = useMemo(() => parts.items.map((p) => ({ value: String(p.id), label: `${String(p.partNo)} – ${String(p.name)}` })), [parts.items]);
  const locOptions = useMemo(() => locations.items.map((l) => ({ value: String(l.id), label: `${String(l.code)} – ${String(l.name)}` })), [locations.items]);

  const fields = (mode: Mode): FieldDef[] => [
    { key: 'partId', labelKey: 'stk.field.part', type: 'select', required: true, options: partOptions },
    { key: 'locationId', labelKey: 'stk.field.location', type: 'select', required: true, options: locOptions },
    ...(mode === 'adjustments'
      ? [
          { key: 'delta', labelKey: 'stk.field.delta', type: 'text', required: true, hintKey: 'stk.hint.delta' } as FieldDef,
          { key: 'reason', labelKey: 'stk.field.reason', type: 'textarea', required: true, maxLength: 500 } as FieldDef,
        ]
      : [{ key: 'quantity', labelKey: 'stk.field.quantity', type: 'text', required: true, hintKey: 'stk.hint.quantity' } as FieldDef]),
    ...(mode === 'receipts'
      ? [
          { key: 'unitCost', labelKey: 'stk.field.unitCost', type: 'text' } as FieldDef,
          { key: 'currency', labelKey: 'stk.field.currency', type: 'text', maxLength: 3, hintKey: 'stk.hint.currency', showWhen: (v) => !!v.unitCost } as FieldDef,
          { key: 'reference', labelKey: 'stk.field.reference', type: 'text', maxLength: 120, hintKey: 'stk.hint.receipt_ref' } as FieldDef,
        ]
      : []),
    ...(mode === 'issues' || mode === 'returns'
      ? [
          { key: 'woNo', labelKey: 'stk.field.workOrder', type: 'text', maxLength: 40, hintKey: 'stk.hint.work_order', required: mode === 'issues' ? false : false } as FieldDef,
          { key: 'reference', labelKey: 'stk.field.usedFor', type: 'text', maxLength: 120, hintKey: 'stk.hint.used_for' } as FieldDef,
        ]
      : []),
    ...(mode === 'adjustments' ? [] : [{ key: 'note', labelKey: 'stk.field.note', type: 'textarea', maxLength: 500 } as FieldDef]),
  ];

  async function submit(mode: Mode, body: Record<string, unknown>) {
    const { woNo, quantity, delta, unitCost, ...rest } = body;
    const payload: Record<string, unknown> = { ...rest };
    for (const [k, v] of Object.entries({ quantity, delta, unitCost })) {
      if (v === undefined || v === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(t('stk.err.number', { field: t(`stk.field.${k}`) }));
      payload[k] = n;
    }
    if (typeof woNo === 'string' && woNo.trim()) payload.workOrderId = await workOrderId(woNo);
    for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];
    if (payload.currency) payload.currency = String(payload.currency).toUpperCase();
    try { await api('POST', `${STK}/${mode}`, payload); setError(null); list.reload(); } catch (e) { setError(e as Error); throw e; }
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t('stk.title.stock')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('stk.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('stk.field.location')} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('stk.filter.all_locations')}</option>
            {locOptions.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={below} onChange={(e) => setBelow(e.target.checked)} /> {t('stk.filter.below')}</label>
          {MODES.filter((m) => can(MODE_PERM[m])).map((m) => <button key={m} className={m === 'receipts' ? 'primary' : ''} onClick={() => setAction({ mode: m, row: null })}>{t(`stk.act.${m}`)}</button>)}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('stk.field.partNo')}</th><th scope="col">{t('stk.field.name')}</th><th scope="col">{t('stk.field.location')}</th>
            <th scope="col" className="num">{t('stk.field.onHand')}</th><th scope="col" className="num">{t('stk.field.reserved')}</th><th scope="col" className="num">{t('stk.field.available')}</th>
            <th scope="col" className="num">{t('stk.field.min')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={`${String(r.partId)}:${String(r.locationId)}`}>
                <td>{String(r.partNo)}</td><td>{String(r.partName)}</td><td>{String(r.locationCode)}</td>
                <td className="num">{fmt(r.onHand)} {String(r.unit)}</td><td className="num">{fmt(r.reserved)}</td>
                <td className="num">{r.belowMinimum === 1 ? <span className="chip warn">{fmt(r.available)} · {t('stk.low')}</span> : fmt(r.available)}</td>
                <td className="num">{r.minLevel === null || r.minLevel === undefined ? '' : fmt(r.minLevel)}</td>
                <td className="actions">
                  {(['receipts', 'issues', 'adjustments'] as Mode[]).filter((m) => can(MODE_PERM[m])).map((m) => <button key={m} onClick={() => setAction({ mode: m, row: r })}>{t(`stk.act1.${m}`)}</button>)}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={8} className="empty">{t('stk.stock.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {action ? (
        <FormModal title={t(`stk.act.${action.mode}`)} fields={fields(action.mode)} record={null} tz={tz} submitKey="common.create"
          defaults={{ partId: String(action.row?.partId ?? ''), locationId: String(action.row?.locationId ?? '') }} onClose={() => setAction(null)}
          onSubmit={(body) => submit(action.mode, body)} />
      ) : null}
    </section>
  );
}
