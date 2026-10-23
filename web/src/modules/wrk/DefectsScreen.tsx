import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { normalizeTag } from './actions';
import { AST, ORG, WRK } from './binding';

const SEVERITIES = ['minor', 'major', 'critical'];

/** Defects: something wrong, reported against a ship, a position or a piece of equipment. Triage turns a defect into a repair case, or dismisses it with a reason. */
export function DefectsScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const [shipId, setShipId] = useState('');
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const list = useList(`${WRK}/defects`, { shipId: shipId || undefined, status: status || undefined, q: q || undefined });
  const [reporting, setReporting] = useState(false);
  const [converting, setConverting] = useState<Rec | null>(null);
  const [dismissing, setDismissing] = useState<Rec | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const shipName = (id: unknown) => String(ships.items.find((s) => s.id === id)?.name ?? id ?? '');

  const fields: FieldDef[] = [
    { key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'shipId', labelKey: 'wrk.field.ship', type: 'select', hintKey: 'wrk.hint.defect_target', options: ships.items.map((s) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` })) },
    { key: 'assetTag', labelKey: 'wrk.field.assetTag', type: 'text', maxLength: 40, hintKey: 'wrk.hint.asset_tag' },
    { key: 'severity', labelKey: 'wrk.field.severity', type: 'select', options: SEVERITIES.map((s) => ({ value: s, label: t(`wrk.severity.${s}`) })) },
    { key: 'description', labelKey: 'wrk.field.description', type: 'textarea', maxLength: 2000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('wrk.title.defects')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('wrk.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('wrk.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('wrk.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{String(s.name)}</option>)}
          </select>
          <select aria-label={t('wrk.field.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('wrk.filter.any_status')}</option>
            {['open', 'converted', 'dismissed'].map((s) => <option key={s} value={s}>{t(`wrk.dstatus.${s}`)}</option>)}
          </select>
          {can('wrk.defect.create') ? <button className="primary" onClick={() => setReporting(true)}>{t('wrk.new.defect')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('wrk.field.number')}</th><th scope="col">{t('wrk.field.title')}</th><th scope="col">{t('wrk.field.ship')}</th>
            <th scope="col">{t('wrk.field.severity')}</th><th scope="col">{t('wrk.field.reportedAt')}</th><th scope="col">{t('wrk.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{String(r.defectNo)}</td><td>{String(r.title)}</td><td>{shipName(r.homeScopeId)}</td>
                <td><StatusChip value={String(r.severity)} labelPrefix="wrk.severity" /></td>
                <td>{toLocalDisplay(String(r.reportedAt), tz)}</td>
                <td><StatusChip value={String(r.status)} labelPrefix="wrk.dstatus" /></td>
                <td className="actions">
                  {r.status === 'open' && can('wrk.defect.convert') ? <button onClick={() => setConverting(r)}>{t('wrk.defect.convert')}</button> : null}
                  {r.status === 'open' && can('wrk.defect.dismiss') ? <button className="link-danger" onClick={() => setDismissing(r)}>{t('wrk.defect.dismiss')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('wrk.defects.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {reporting ? (
        <FormModal title={t('wrk.new.defect')} fields={fields} record={null} tz={tz} defaults={{ severity: 'minor' }} submitKey="common.create" onClose={() => setReporting(false)}
          onSubmit={async (body) => {
            const { assetTag, ...rest } = body;
            const payload: Record<string, unknown> = { ...rest };
            if (assetTag) {
              const a = await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`);
              payload.assetId = a.id;
            }
            await api('POST', `${WRK}/defects`, payload);
            list.reload();
          }} />
      ) : null}
      {converting ? (
        <FormModal title={t('wrk.defect.convert_title', { name: String(converting.defectNo) })} fields={[{ key: 'title', labelKey: 'wrk.field.title', type: 'text', maxLength: 160, hintKey: 'wrk.hint.case_title' }]} record={null} tz={tz} submitKey="wrk.defect.convert" onClose={() => setConverting(null)}
          onSubmit={async (body) => { try { await api('POST', `${WRK}/defects/${converting.id}/convert`, { expectedVersion: converting.version, ...body }); setError(null); list.reload(); } catch (e) { setError(e as Error); throw e; } }} />
      ) : null}
      {dismissing ? (
        <ReasonModal title={t('wrk.defect.dismiss_title', { name: String(dismissing.defectNo) })} confirmKey="wrk.defect.dismiss" onClose={() => setDismissing(null)}
          onConfirm={async (reason) => { await api('POST', `${WRK}/defects/${dismissing.id}/dismiss`, { expectedVersion: dismissing.version, reason }); list.reload(); }} />
      ) : null}
    </section>
  );
}
