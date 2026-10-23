import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { AST, normalizeTag, PM, useAssets } from './binding';

/** Calibration records. The latest record for an item decides when its next calibration is due. */
export function CalibrationScreen() {
  const { tz } = useSystem();
  const assets = useAssets();
  const [result, setResult] = useState('');
  const list = useList(`${PM}/calibrations`, { result: result || undefined });
  const [creating, setCreating] = useState(false);
  const fields: FieldDef[] = [
    { key: 'assetTag', labelKey: 'pm.field.assetTag', type: 'text', required: true, maxLength: 40, hintKey: 'pm.hint.asset_tag' },
    { key: 'result', labelKey: 'pm.field.result', type: 'select', required: true, options: ['pass', 'adjusted', 'fail'].map((r) => ({ value: r, label: t(`pm.cresult.${r}`) })) },
    { key: 'nextDueOn', labelKey: 'pm.field.nextDueOn', type: 'text', hintKey: 'pm.hint.next_due', maxLength: 10, showWhen: (v) => v.result !== 'fail' },
    { key: 'certificateNo', labelKey: 'pm.field.certificateNo', type: 'text', maxLength: 80 },
    { key: 'calibratedBy', labelKey: 'pm.field.calibratedBy', type: 'text', maxLength: 120 },
    { key: 'note', labelKey: 'pm.field.note', type: 'textarea', maxLength: 500 },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('pm.title.calibration')}</h1>
        <div className="tools">
          <select aria-label={t('pm.field.result')} value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">{t('pm.filter.any_result')}</option>
            {['pass', 'adjusted', 'fail'].map((r) => <option key={r} value={r}>{t(`pm.cresult.${r}`)}</option>)}
          </select>
          {can('pm.calibration.create') ? <button className="primary" onClick={() => setCreating(true)}>{t('pm.new.calibration')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('pm.field.equipment')}</th><th scope="col">{t('pm.field.when')}</th><th scope="col">{t('pm.field.result')}</th><th scope="col">{t('pm.field.nextDueOn')}</th><th scope="col">{t('pm.field.certificateNo')}</th><th scope="col">{t('pm.field.calibratedBy')}</th></tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={r.id}>
              <td>{assets.label(r.assetId)}</td><td>{toLocalDisplay(String(r.occurredAt), tz)}</td>
              <td><span className={`chip ${r.result === 'fail' ? 'warn' : 'ok'}`}>{t(`pm.cresult.${String(r.result)}`)}</span></td>
              <td>{String(r.nextDueOn ?? '')}</td><td>{String(r.certificateNo ?? '')}</td><td>{String(r.calibratedBy ?? '')}</td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('pm.calibration.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {creating ? (
        <FormModal title={t('pm.new.calibration')} fields={fields} record={null} tz={tz} defaults={{ result: 'pass' }} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const { assetTag, ...rest } = body;
            const asset = await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`);
            for (const k of Object.keys(rest)) if (rest[k] === '') delete rest[k];
            await api('POST', `${PM}/calibrations`, { ...rest, assetId: asset.id });
            list.reload();
          }} />
      ) : null}
    </section>
  );
}
