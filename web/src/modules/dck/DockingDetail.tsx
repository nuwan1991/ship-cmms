import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ApiError, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice } from '../../platform/ui';
import { AST, DCK, show, tone, useDocks, useShips } from './binding';
import { dockingFields, itemFields, reqItemFields, surveyFields } from './fields';

type Detail = Rec & { items: Rec[]; surveys: Rec[]; conflicts: Rec[]; requirements: Rec[] };
type Action = 'edit' | 'dock_in' | 'undock' | 'complete' | 'cancel' | 'remove' | 'new_item' | 'survey' | 'new_req';

/** Resolve an equipment tag typed in a form to the asset id (empty tag = no equipment). */
async function assetIdFor(tag: unknown): Promise<string | null> {
  const s = String(tag ?? '').trim().toUpperCase();
  if (!s) return null;
  return (await api<Rec>('GET', `${AST}/assets/resolve?tag=${encodeURIComponent(s)}`)).id;
}

/** One docking: its dates and state, the actions its state allows, the work list and the underwater survey. */
export function DockingDetailScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { tz } = useSystem();
  const ships = useShips();
  const docks = useDocks();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [editingItem, setEditingItem] = useState<Rec | null>(null);
  const [removingItem, setRemovingItem] = useState<Rec | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removingReq, setRemovingReq] = useState<Rec | null>(null);
  const [ticking, setTicking] = useState<{ req: Rec; status: 'done' | 'not_applicable' } | null>(null);

  const load = useCallback(() => {
    api<Detail>('GET', `${DCK}/dockings/${id}`).then((r) => { setD(r); setError(null); }, (e: ApiError) => setError(e));
  }, [id]);
  useEffect(load, [load]);

  const open = d ? ['planned', 'in_dock', 'undocked'].includes(String(d.status)) : false;
  const act = async (path: string, body: Record<string, unknown>) => { await api('POST', `${DCK}/dockings/${id}/${path}`, { expectedVersion: d?.version, ...body }); load(); };
  async function raiseWorkOrder(item: Rec) {
    try { const r = await api<Rec>('POST', `${DCK}/work-items/${item.id}/work-order`, {}); setNotice(t('dck.wo_raised', { no: String(r.workOrderNo) })); setError(null); load(); } catch (e) { setError(e as Error); }
  }

  async function refreshChecklist() {
    try { const r = await api<{ added: number }>('POST', `${DCK}/dockings/${id}/requirements/refresh`, {}); setNotice(t('dck.req_refreshed', { n: String(r.added) })); setError(null); load(); } catch (e) { setError(e as Error); }
  }
  async function reopen(req: Rec) {
    try { await api('PATCH', `${DCK}/requirements/${String(req.requirementId)}`, { expectedVersion: req.version, status: 'pending' }); setError(null); load(); } catch (e) { setError(e as Error); }
  }

  const button = (a: Action, labelKey: string, permission: string, when: boolean, primary = false) =>
    when && can(permission) ? <button className={primary ? 'primary' : undefined} onClick={() => setAction(a)}>{t(labelKey)}</button> : null;

  if (!d) return <section><ErrorNotice error={error} />{error ? null : <p>{t('common.loading')}</p>}</section>;
  const status = String(d.status);
  const completeFields: FieldDef[] = [
    { key: 'intervalMonths', labelKey: 'dck.field.intervalMonths', type: 'number', hintKey: 'dck.hint.interval' },
    { key: 'nextDueOn', labelKey: 'dck.field.nextDueOn', type: 'date', hintKey: 'dck.hint.next_due' },
    { key: 'remarks', labelKey: 'dck.field.remarks', type: 'textarea', maxLength: 2000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('dck.title.docking', { ship: `${show(d.shipCode)} – ${show(d.shipName)}`, ref: d.reference ? ` · ${String(d.reference)}` : '' })}</h1>
        <div className="tools">
          <Link to="/docking/dockings">{t('dck.back')}</Link>
          {button('edit', 'common.edit', 'dck.docking.update', open)}
          {button('dock_in', 'dck.act.dock_in', 'dck.docking.dock_in', status === 'planned', true)}
          {button('undock', 'dck.act.undock', 'dck.docking.undock', status === 'in_dock', true)}
          {button('complete', 'dck.act.complete', 'dck.docking.complete', status === 'undocked', true)}
          {button('cancel', 'dck.act.cancel', 'dck.docking.cancel', status === 'planned')}
          {button('remove', 'common.remove', 'dck.docking.remove', status === 'planned' || status === 'cancelled')}
        </div>
      </div>
      <ErrorNotice error={error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      {d.conflicts.length > 0 ? <div className="banner warn" role="status">{t('dck.conflict_here', { ships: d.conflicts.map((c) => ships.label(c.otherShipId)).join(', ') })}</div> : null}
      <dl className="facts">
        <dt>{t('dck.field.status')}</dt>
        <dd>
          <span className={`chip ${tone(status)}`}>{t(`dck.status.${status}`)}</span>
          {d.lateDockIn ? <> <span className="chip warn">{t('dck.late.dock_in')}</span></> : null}
          {d.lateUndock ? <> <span className="chip warn">{t('dck.late.undock')}</span></> : null}
        </dd>
        <dt>{t('dck.field.dock')}</dt><dd>{d.dockCode ? `${String(d.dockCode)} – ${String(d.dockName)}` : '—'}</dd>
        <dt>{t('dck.field.type')}</dt><dd>{t(`dck.type.${String(d.dockingType)}`)}</dd>
        <dt>{t('dck.field.planned')}</dt><dd>{String(d.plannedDockIn)} → {String(d.plannedUndock)}</dd>
        <dt>{t('dck.field.dockedAt')}</dt><dd>{d.dockedAt ? toLocalDisplay(String(d.dockedAt), tz) : '—'}</dd>
        <dt>{t('dck.field.undockedAt')}</dt><dd>{d.undockedAt ? toLocalDisplay(String(d.undockedAt), tz) : '—'}{d.daysInDock != null ? ` (${t('dck.days', { n: String(d.daysInDock) })})` : ''}</dd>
        <dt>{t('dck.field.nextDueOn')}</dt><dd>{show(d.nextDueOn)}</dd>
        <dt>{t('dck.field.purpose')}</dt><dd>{show(d.purpose)}</dd>
        <dt>{t('dck.field.authority')}</dt><dd>{show(d.authority)}</dd>
        <dt>{t('dck.field.remarks')}</dt><dd>{show(d.remarks)}</dd>
        {d.cancelReason ? <><dt>{t('dck.field.cancelReason')}</dt><dd>{String(d.cancelReason)}</dd></> : null}
      </dl>

      <div className="page-head">
        <h2>{t('dck.title.requirements')}</h2>
        <div className="tools">
          {status === 'planned' && can('dck.requirement.create') ? <button onClick={() => void refreshChecklist()}>{t('dck.act.refresh_checklist')}</button> : null}
          {open && can('dck.requirement.create') ? <button className="primary" onClick={() => setAction('new_req')}>{t('dck.new.requirement')}</button> : null}
        </div>
      </div>
      <p className="muted">{t('dck.req_summary', { pending: String(d.reqPending ?? 0), total: String(d.reqTotal ?? 0), mandatory: String(d.reqMandatoryPending ?? 0) })}</p>
      {d.requirementsWaiver ? <div className="banner warn" role="status">{t('dck.waived', { reason: String(d.requirementsWaiver) })}</div> : null}
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.no')}</th><th scope="col">{t('dck.field.category')}</th><th scope="col">{t('dck.field.requirement')}</th><th scope="col">{t('dck.field.source')}</th>
          <th scope="col">{t('dck.field.responsible')}</th><th scope="col">{t('dck.field.dueBy')}</th><th scope="col">{t('dck.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
        </tr></thead>
        <tbody>
          {d.requirements.map((q) => (
            <tr key={String(q.requirementId)}>
              <td>{String(q.seq)}</td><td>{t(`dck.rcat.${String(q.category)}`)}</td>
              <td>{String(q.title)}{q.mandatory ? <> <span className="chip warn">{t('dck.mandatory')}</span></> : null}
                {q.reference || q.note ? <div className="muted">{[q.reference, q.note].filter(Boolean).map(String).join(' · ')}</div> : null}</td>
              <td>{t(`dck.rsource.${String(q.source)}`)}</td><td>{show(q.responsible)}</td>
              <td>{String(q.dueOn)}{q.overdue ? <> <span className="chip warn">{t('dck.overdue')}</span></> : null}</td>
              <td><span className={`chip ${tone(q.status)}`}>{t(`dck.rstatus.${String(q.status)}`)}</span></td>
              <td className="actions">
                {open && can('dck.requirement.update') && q.status === 'pending' ? <>
                  <button onClick={() => setTicking({ req: q, status: 'done' })}>{t('dck.act.req_done')}</button>
                  <button onClick={() => setTicking({ req: q, status: 'not_applicable' })}>{t('dck.act.req_na')}</button>
                </> : null}
                {open && can('dck.requirement.update') && q.status !== 'pending' ? <button onClick={() => void reopen(q)}>{t('dck.act.reopen')}</button> : null}
                {open && q.source === 'adhoc' && can('dck.requirement.remove') ? <button className="link-danger" onClick={() => setRemovingReq(q)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {d.requirements.length === 0 ? <tr><td colSpan={8} className="empty">{t('dck.requirements.empty')}</td></tr> : null}
        </tbody>
      </table></div>

      <div className="page-head">
        <h2>{t('dck.title.work_list')}</h2>
        <div className="tools">{open && can('dck.work_item.create') ? <button className="primary" onClick={() => setAction('new_item')}>{t('dck.new.item')}</button> : null}</div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.no')}</th><th scope="col">{t('dck.field.category')}</th><th scope="col">{t('dck.field.title')}</th><th scope="col">{t('dck.field.executedBy')}</th>
          <th scope="col">{t('dck.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
        </tr></thead>
        <tbody>
          {d.items.map((it) => (
            <tr key={String(it.id)}>
              <td>{String(it.itemNo)}</td><td>{t(`dck.cat.${String(it.category)}`)}</td>
              <td>{String(it.title)}{it.note ? <div className="muted">{String(it.note)}</div> : null}</td><td>{show(it.executedBy)}</td>
              <td><span className={`chip ${tone(it.status)}`}>{t(`dck.istatus.${String(it.status)}`)}</span>{it.workOrderId ? <> <span className="chip ok">{t('dck.has_order')}</span></> : null}</td>
              <td className="actions">
                {open && can('dck.work_item.update') ? <button onClick={() => setEditingItem(it)}>{t('common.edit')}</button> : null}
                {open && !it.workOrderId && !['done', 'cancelled'].includes(String(it.status)) && can('dck.work_item.update') && can('wrk.work_order.create')
                  ? <button onClick={() => void raiseWorkOrder(it)}>{t('dck.act.raise_wo')}</button> : null}
                {open && !it.workOrderId && can('dck.work_item.remove') ? <button className="link-danger" onClick={() => setRemovingItem(it)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {d.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('dck.items.empty')}</td></tr> : null}
        </tbody>
      </table></div>

      <div className="page-head">
        <h2>{t('dck.title.survey')}</h2>
        <div className="tools">{(status === 'in_dock' || status === 'undocked') && can('dck.survey.create') ? <button className="primary" onClick={() => setAction('survey')}>{t('dck.new.survey')}</button> : null}</div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">{t('dck.field.surveyedAt')}</th><th scope="col">{t('dck.field.area')}</th><th scope="col">{t('dck.field.condition')}</th><th scope="col">{t('dck.field.finding')}</th>
          <th scope="col">{t('dck.field.measurement')}</th><th scope="col">{t('dck.field.surveyedBy')}</th>
        </tr></thead>
        <tbody>
          {d.surveys.map((s) => (
            <tr key={String(s.id)}>
              <td>{toLocalDisplay(String(s.occurredAt), tz)}</td><td>{t(`dck.area.${String(s.area)}`)}</td>
              <td><span className={`chip ${tone(s.condition)}`}>{t(`dck.cond.${String(s.condition)}`)}</span>{s.actionRequired ? <> <span className="chip warn">{t('dck.action_required')}</span></> : null}</td>
              <td>{String(s.finding)}</td><td>{show(s.measurement)}</td><td>{show(s.surveyedBy)}</td>
            </tr>
          ))}
          {d.surveys.length === 0 ? <tr><td colSpan={6} className="empty">{t('dck.survey.empty')}</td></tr> : null}
        </tbody>
      </table></div>

      {action === 'edit' ? (
        <FormModal title={t('dck.edit.docking')} fields={dockingFields(ships.options, docks, false, status !== 'planned')} record={d} tz={tz} submitKey="common.save" onClose={() => setAction(null)}
          onFetchLatest={() => api<Rec>('GET', `${DCK}/dockings/${id}`)}
          onSubmit={async (body) => { await api('PATCH', `${DCK}/dockings/${id}`, body); load(); }} />
      ) : null}
      {action === 'dock_in' ? (
        <FormModal title={t('dck.act.dock_in')} record={null} tz={tz} submitKey="dck.act.dock_in" onClose={() => setAction(null)} defaults={{ dockId: String(d.dockId ?? '') }}
          extra={Number(d.reqMandatoryPending) > 0 ? <div className="banner warn">{t('dck.dock_in_pending', { n: String(d.reqMandatoryPending) })}</div> : undefined}
          fields={[
            { key: 'dockId', labelKey: 'dck.field.dock', type: 'select', required: true, options: docks }, { key: 'dockedAt', labelKey: 'dck.field.dockedAt', type: 'datetime', hintKey: 'dck.hint.now' },
            ...(Number(d.reqMandatoryPending) > 0 ? [{ key: 'requirementsWaiver', labelKey: 'dck.field.waiver', type: 'textarea' as const, required: true, maxLength: 500, hintKey: 'dck.hint.waiver' }] : []),
          ]}
          onSubmit={(body) => act('dock-in', body)} />
      ) : null}
      {action === 'undock' ? (
        <FormModal title={t('dck.act.undock')} record={null} tz={tz} submitKey="dck.act.undock" onClose={() => setAction(null)}
          fields={[{ key: 'undockedAt', labelKey: 'dck.field.undockedAt', type: 'datetime', hintKey: 'dck.hint.now' }]}
          onSubmit={(body) => act('undock', body)} />
      ) : null}
      {action === 'complete' ? (
        <FormModal title={t('dck.act.complete')} record={null} tz={tz} submitKey="dck.act.complete" onClose={() => setAction(null)} fields={completeFields} defaults={{ intervalMonths: '24' }}
          onSubmit={(body) => act('complete', body.nextDueOn ? { nextDueOn: body.nextDueOn, remarks: body.remarks } : body)} />
      ) : null}
      {action === 'cancel' ? (
        <ReasonModal title={t('dck.act.cancel')} confirmKey="dck.act.cancel" onClose={() => setAction(null)} onConfirm={(reason) => act('cancel', { reason })} />
      ) : null}
      {action === 'remove' ? (
        <ReasonModal title={t('dck.remove.docking')} onClose={() => setAction(null)}
          onConfirm={async (reason) => { await api('POST', `${DCK}/dockings/${id}/tombstone`, { expectedVersion: d.version, reason }); navigate('/docking/dockings'); }} />
      ) : null}
      {action === 'new_item' ? (
        <FormModal title={t('dck.new.item')} fields={itemFields(false)} record={null} tz={tz} submitKey="common.create" onClose={() => setAction(null)}
          onSubmit={async ({ assetTag, ...body }) => {
            const assetId = await assetIdFor(assetTag);
            await api('POST', `${DCK}/dockings/${id}/work-items`, { ...body, ...(assetId ? { assetId } : {}) });
            load();
          }} />
      ) : null}
      {editingItem ? (
        <FormModal title={t('dck.edit.item', { no: String(editingItem.itemNo) })} fields={itemFields(true)} record={editingItem} tz={tz} submitKey="common.save" onClose={() => setEditingItem(null)}
          onSubmit={async ({ assetTag, ...body }) => {
            const tagged = typeof assetTag === 'string' && assetTag.trim() !== '';
            await api('PATCH', `${DCK}/work-items/${editingItem.id}`, { ...body, ...(tagged ? { assetId: await assetIdFor(assetTag) } : {}) });
            load();
          }} />
      ) : null}
      {removingItem ? (
        <ReasonModal title={t('dck.remove.item', { no: String(removingItem.itemNo) })} onClose={() => setRemovingItem(null)}
          onConfirm={async (reason) => { await api('POST', `${DCK}/work-items/${removingItem.id}/tombstone`, { expectedVersion: removingItem.version, reason }); load(); }} />
      ) : null}
      {action === 'new_req' ? (
        <FormModal title={t('dck.new.requirement')} fields={reqItemFields(false)} record={null} tz={tz} defaults={{ mandatory: true, leadDays: '7' }} submitKey="common.create" onClose={() => setAction(null)}
          onSubmit={async (body) => { await api('POST', `${DCK}/dockings/${id}/requirements`, body); load(); }} />
      ) : null}
      {ticking ? (
        <FormModal title={t(ticking.status === 'done' ? 'dck.act.req_done' : 'dck.act.req_na')} record={null} tz={tz} submitKey={ticking.status === 'done' ? 'dck.act.req_done' : 'dck.act.req_na'}
          onClose={() => setTicking(null)}
          fields={ticking.status === 'done'
            ? [{ key: 'reference', labelKey: 'dck.field.reqReference', type: 'text', maxLength: 120, hintKey: 'dck.hint.req_reference' }, { key: 'note', labelKey: 'dck.field.note', type: 'textarea', maxLength: 1000 }]
            : [{ key: 'note', labelKey: 'dck.field.naReason', type: 'textarea', required: true, maxLength: 1000 }]}
          onSubmit={async (body) => { await api('PATCH', `${DCK}/requirements/${String(ticking.req.requirementId)}`, { expectedVersion: ticking.req.version, status: ticking.status, ...body }); load(); }} />
      ) : null}
      {removingReq ? (
        <ReasonModal title={t('dck.remove.requirement', { no: String(removingReq.seq) })} onClose={() => setRemovingReq(null)}
          onConfirm={async (reason) => { await api('POST', `${DCK}/requirements/${String(removingReq.requirementId)}/tombstone`, { expectedVersion: removingReq.version, reason }); load(); }} />
      ) : null}
      {action === 'survey' ? (
        <FormModal title={t('dck.new.survey')} fields={surveyFields()} record={null} tz={tz} submitKey="common.create" onClose={() => setAction(null)}
          onSubmit={async (body) => { await api('POST', `${DCK}/dockings/${id}/surveys`, body); load(); }} />
      ) : null}
    </section>
  );
}
