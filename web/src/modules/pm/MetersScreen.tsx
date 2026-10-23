import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { AST, fmtNum, normalizeTag, PM, useAssets } from './binding';

type Action = { kind: 'new' } | { kind: 'reading' | 'replace'; meter: Rec };
const dec = (v: unknown, field: string): number => {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n) || n < 0) throw new Error(t('pm.err.number', { field }));
  return n;
};

/** Running-hour meters and their readings. A replaced dial keeps the running total. */
export function MetersScreen() {
  const { tz } = useSystem();
  const assets = useAssets();
  const list = useList(`${PM}/meters`);
  const [action, setAction] = useState<Action | null>(null);
  const [history, setHistory] = useState<{ meter: Rec; rows: Rec[] } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  async function showHistory(meter: Rec) {
    try { const r = await api<{ items: Rec[] }>('GET', `${PM}/meters/${meter.id}/readings`); setHistory({ meter, rows: r.items }); setError(null); } catch (e) { setError(e as Error); }
  }
  const fields = (a: Action): FieldDef[] => a.kind === 'new'
    ? [
        { key: 'assetTag', labelKey: 'pm.field.assetTag', type: 'text', required: true, maxLength: 40, hintKey: 'pm.hint.asset_tag' },
        { key: 'name', labelKey: 'pm.field.name', type: 'text', required: true, maxLength: 160, hintKey: 'pm.hint.meter_name' },
        { key: 'kind', labelKey: 'pm.field.kind', type: 'select', options: ['running_hours', 'counter'].map((k) => ({ value: k, label: t(`pm.mkind.${k}`) })) },
        { key: 'unit', labelKey: 'pm.field.unit', type: 'text', maxLength: 12 },
      ]
    : [
        { key: 'reading', labelKey: a.kind === 'reading' ? 'pm.field.reading' : 'pm.field.startReading', type: 'text', required: true, hintKey: a.kind === 'reading' ? 'pm.hint.reading' : 'pm.hint.replace' },
        { key: 'note', labelKey: 'pm.field.note', type: 'textarea', maxLength: 300 },
      ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('pm.title.meters')}</h1>
        <div className="tools">{can('pm.meter.create') ? <button className="primary" onClick={() => setAction({ kind: 'new' })}>{t('pm.new.meter')}</button> : null}</div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('pm.field.equipment')}</th><th scope="col">{t('pm.field.name')}</th><th scope="col">{t('pm.field.kind')}</th><th scope="col" className="num">{t('pm.field.total')}</th><th scope="col">{t('pm.field.lastRead')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((m) => {
            const cur = m.current as { cumulative: number; readAt: string } | null;
            return (
              <tr key={m.id}>
                <td>{assets.label(m.assetId)}</td><td>{String(m.name)}</td><td>{t(`pm.mkind.${String(m.kind)}`)}</td>
                <td className="num">{cur ? `${fmtNum(cur.cumulative)} ${String(m.unit)}` : '–'}</td><td>{cur ? toLocalDisplay(cur.readAt, tz) : ''}</td>
                <td className="actions">
                  {can('pm.meter_reading.create') && m.status === 'active' ? <><button onClick={() => setAction({ kind: 'reading', meter: m })}>{t('pm.act.reading')}</button><button onClick={() => setAction({ kind: 'replace', meter: m })}>{t('pm.act.replace')}</button></> : null}
                  {can('pm.meter_reading.view') ? <button onClick={() => void showHistory(m)}>{t('pm.act.history')}</button> : null}
                </td>
              </tr>
            );
          })}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('pm.meters.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {history ? (
        <div>
          <h2>{t('pm.history_title', { name: String(history.meter.name) })} <button onClick={() => setHistory(null)}>{t('common.close')}</button></h2>
          <div className="table-wrap"><table>
            <thead><tr><th scope="col">{t('pm.field.when')}</th><th scope="col">{t('pm.field.kind')}</th><th scope="col" className="num">{t('pm.field.reading')}</th><th scope="col" className="num">{t('pm.field.total')}</th><th scope="col">{t('pm.field.note')}</th></tr></thead>
            <tbody>{history.rows.map((r) => <tr key={r.id}><td>{toLocalDisplay(String(r.occurredAt), tz)}</td><td>{t(`pm.rkind.${String(r.kind)}`)}</td><td className="num">{fmtNum(r.reading)}</td><td className="num">{fmtNum(r.cumulative)}</td><td>{String(r.note ?? '')}</td></tr>)}</tbody>
          </table></div>
        </div>
      ) : null}

      {action ? (
        <FormModal title={t(action.kind === 'new' ? 'pm.new.meter' : action.kind === 'reading' ? 'pm.act.reading' : 'pm.act.replace')} fields={fields(action)} record={null} tz={tz} defaults={{ kind: 'running_hours' }}
          submitKey="common.create" onClose={() => setAction(null)}
          onSubmit={async (body) => {
            if (action.kind === 'new') {
              const { assetTag, ...rest } = body;
              const asset = await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`);
              for (const k of Object.keys(rest)) if (rest[k] === '') delete rest[k];
              await api('POST', `${PM}/meters`, { ...rest, assetId: asset.id });
            } else {
              const payload: Record<string, unknown> = { [action.kind === 'reading' ? 'reading' : 'startReading']: dec(body.reading, t('pm.field.reading')) };
              if (body.note) payload.note = body.note;
              await api('POST', `${PM}/meters/${action.meter.id}/${action.kind === 'reading' ? 'readings' : 'replace'}`, payload);
            }
            list.reload();
          }} />
      ) : null}
    </section>
  );
}
