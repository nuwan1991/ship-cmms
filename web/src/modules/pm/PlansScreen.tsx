import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { AST, fmtNum, normalizeTag, PM, useAssets } from './binding';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const num = (v: unknown, field: string, whole = false): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || (whole && !Number.isInteger(n))) throw new Error(t(whole ? 'pm.err.whole' : 'pm.err.number', { field }));
  return n;
};

/** Planned maintenance: when each equipment item needs its routine work, by calendar or by running hours. */
export function PlansScreen() {
  const { tz } = useSystem();
  const assets = useAssets();
  const templates = useList(`${PM}/task-templates`, { status: 'active' });
  const list = useList(`${PM}/plans`);
  const meters = useList(`${PM}/meters`);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Rec | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const fields: FieldDef[] = [
    { key: 'code', labelKey: 'pm.field.code', type: 'text', required: true, maxLength: 40 },
    { key: 'title', labelKey: 'pm.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'assetTag', labelKey: 'pm.field.assetTag', type: 'text', required: true, maxLength: 40, hintKey: 'pm.hint.asset_tag' },
    { key: 'templateId', labelKey: 'pm.field.template', type: 'select', options: templates.items.map((x) => ({ value: String(x.id), label: `${String(x.code)} – ${String(x.name)}` })) },
    { key: 'triggerKind', labelKey: 'pm.field.basis', type: 'select', required: true, options: ['calendar', 'running_hours'].map((k) => ({ value: k, label: t(`pm.basis.${k}`) })) },
    { key: 'intervalDays', labelKey: 'pm.field.intervalDays', type: 'text', showWhen: (v) => v.triggerKind === 'calendar', hintKey: 'pm.hint.whole' },
    { key: 'leadDays', labelKey: 'pm.field.leadDays', type: 'text', showWhen: (v) => v.triggerKind === 'calendar', hintKey: 'pm.hint.lead_days' },
    { key: 'meterId', labelKey: 'pm.field.meter', type: 'select', showWhen: (v) => v.triggerKind === 'running_hours', hintKey: 'pm.hint.meter',
      options: meters.items.map((m) => ({ value: String(m.id), label: `${assets.label(m.assetId)} · ${String(m.name)}` })) },
    { key: 'intervalHours', labelKey: 'pm.field.intervalHours', type: 'text', showWhen: (v) => v.triggerKind === 'running_hours' },
    { key: 'leadHours', labelKey: 'pm.field.leadHours', type: 'text', showWhen: (v) => v.triggerKind === 'running_hours', hintKey: 'pm.hint.lead_hours' },
    { key: 'priority', labelKey: 'pm.field.priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: t(`pm.priority.${p}`) })) },
  ];

  async function setStatus(r: Rec, status: 'active' | 'suspended') {
    try { const cur = await api<Rec>('GET', `${PM}/plans/${r.planId}`); await api('PATCH', `${PM}/plans/${r.planId}`, { expectedVersion: cur.version, status }); setError(null); list.reload(); } catch (e) { setError(e as Error); }
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t('pm.title.plans')}</h1>
        <div className="tools">{can('pm.plan.create') ? <button className="primary" onClick={() => setCreating(true)}>{t('pm.new.plan')}</button> : null}</div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error ?? error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('pm.field.code')}</th><th scope="col">{t('pm.field.title')}</th><th scope="col">{t('pm.field.equipment')}</th><th scope="col">{t('pm.field.basis')}</th><th scope="col">{t('pm.field.next')}</th><th scope="col">{t('pm.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={String(r.planId)}>
              <td>{String(r.code)}</td><td>{String(r.title)}</td><td>{r.assetId ? assets.label(r.assetId) : String(r.positionId ?? '')}</td>
              <td>{t(`pm.basis.${String(r.triggerKind)}`)}</td>
              <td>{r.triggerKind === 'calendar' ? String(r.dueAt ?? '').slice(0, 10) : t('pm.next_hours', { due: fmtNum(r.dueHours), left: fmtNum(r.remainingHours) })}</td>
              <td><StatusChip value={String(r.status)} labelPrefix="pm.pstatus" /></td>
              <td className="actions">
                {can('pm.plan.complete') ? <button onClick={() => setCompleting(r)}>{t('pm.act.complete')}</button> : null}
                {can('pm.plan.update') ? <button onClick={() => void setStatus(r, r.status === 'active' ? 'suspended' : 'active')}>{t(r.status === 'active' ? 'pm.act.suspend' : 'pm.act.resume')}</button> : null}
                {can('pm.plan.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('pm.plans.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}

      {creating ? (
        <FormModal title={t('pm.new.plan')} fields={fields} record={null} tz={tz} defaults={{ triggerKind: 'calendar', priority: 'normal' }} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            const { assetTag, intervalDays, leadDays, intervalHours, leadHours, ...rest } = body;
            const payload: Record<string, unknown> = { ...rest };
            for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];
            const asset = await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(normalizeTag(String(assetTag)))}`);
            payload.assetId = asset.id;
            const set = (k: string, v: number | undefined) => { if (v !== undefined) payload[k] = v; };
            set('intervalDays', num(intervalDays, t('pm.field.intervalDays'), true)); set('leadDays', num(leadDays, t('pm.field.leadDays'), true));
            set('intervalHours', num(intervalHours, t('pm.field.intervalHours'))); set('leadHours', num(leadHours, t('pm.field.leadHours')));
            await api('POST', `${PM}/plans`, payload);
            list.reload();
          }} />
      ) : null}
      {completing ? (
        <FormModal title={t('pm.complete_title', { name: String(completing.code) })} fields={[{ key: 'doneHours', labelKey: 'pm.field.doneHours', type: 'text', hintKey: 'pm.hint.done_hours', showWhen: () => completing.triggerKind === 'running_hours' }]} record={null} tz={tz} submitKey="pm.act.complete" onClose={() => setCompleting(null)}
          onSubmit={async (body) => {
            const h = num(body.doneHours, t('pm.field.doneHours'));
            await api('POST', `${PM}/plans/${completing.planId}/complete`, h === undefined ? {} : { doneHours: h });
            list.reload();
          }} />
      ) : null}
      {removing ? (
        <ReasonModal title={t('pm.remove.plan', { name: String(removing.code) })} confirmKey="common.remove" onClose={() => setRemoving(null)}
          onConfirm={async (reason) => {
            const cur = await api<Rec>('GET', `${PM}/plans/${removing.planId}`);
            await api('POST', `${PM}/plans/${removing.planId}/tombstone`, { expectedVersion: cur.version, reason });
            list.reload();
          }} />
      ) : null}
    </section>
  );
}
