import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { availableActions, PROGRESS_TARGET, type Axes, type WorkOrderAction } from './actions';
import { ORG, WRK } from './binding';

const PARTY_KINDS = ['command', 'ship', 'department', 'workshop', 'external_provider'];
const PARTY_PATH: Record<string, string> = { command: 'commands', ship: 'ships', department: 'departments', workshop: 'workshops', external_provider: 'providers' };

/** The four status axes as separate chips: progress, approval, return to service, closure. They never merge into one status. */
export function AxisChips({ axes }: { axes: Axes }) {
  return (
    <div className="axes" role="group" aria-label={t('wrk.axes')}>
      {([['progress', 'wrk.progress'], ['approval', 'wrk.approval'], ['returnToService', 'wrk.rts'], ['closure', 'wrk.closure']] as const).map(([k, prefix]) => (
        <span key={k} className="axis"><span className="axis-name">{t(`wrk.axis.${k}`)}</span> <StatusChip value={axes[k]} labelPrefix={prefix} /></span>
      ))}
    </div>
  );
}

function useParties() {
  const lists = {
    command: useList(`${ORG}/commands`), ship: useList(`${ORG}/ships`), department: useList(`${ORG}/departments`),
    workshop: useList(`${ORG}/workshops`), external_provider: useList(`${ORG}/providers`),
  };
  const options = (kind: string) => (lists[kind as keyof typeof lists]?.items ?? []).map((r) => ({ value: String(r.id), label: `${String(r.code)} – ${String(r.name)}` }));
  const name = (p: unknown) => {
    const x = p as { kind?: string; id?: string } | null;
    if (!x?.id) return '—';
    const r = lists[x.kind as keyof typeof lists]?.items.find((i) => i.id === x.id);
    return r ? `${t(`wrk.party.${String(x.kind)}`)}: ${String(r.name)}` : String(x.id);
  };
  return { options, name };
}
export { PARTY_KINDS, PARTY_PATH, useParties };

type Dialog = null | 'labour' | 'finding' | 'test' | 'jobcard' | 'accept' | 'decide' | 'review' | 'close' | 'reopen' | 'offer' | 'progress';

export function WorkOrderDetail({ workOrderId, onClose, onChanged }: { workOrderId: string; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const parties = useParties();
  const [wo, setWo] = useState<Rec | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const labour = useList(`${WRK}/work-orders/${workOrderId}/labour`);
  const findings = useList(`${WRK}/work-orders/${workOrderId}/findings`);
  const tests = useList(`${WRK}/work-orders/${workOrderId}/tests`);
  const history = useList(`${WRK}/status-events`, { subjectId: workOrderId });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [target, setTarget] = useState<'in_progress' | 'on_hold' | 'work_complete'>('in_progress');
  const [card, setCard] = useState<Rec | null>(null);
  const load = () => api<Rec>('GET', `${WRK}/work-orders/${workOrderId}`).then(setWo, setErr);
  useEffect(() => { void load(); }, [workOrderId]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => { void load(); labour.reload(); findings.reload(); tests.reload(); history.reload(); onChanged(); setErr(null); };
  const axes = wo?.axes as Axes | undefined;
  const actions = axes ? availableActions(axes) : new Set<WorkOrderAction>();
  const post = (path: string, body: unknown) => api('POST', `${WRK}/work-orders/${workOrderId}/${path}`, body).then(done, (e: Error) => { setErr(e); throw e; });
  const note: FieldDef = { key: 'note', labelKey: 'wrk.field.note', type: 'textarea', maxLength: 500 };
  const cards = ((wo?.jobCards as Rec[]) ?? []);
  const handovers = ((wo?.handovers as Rec[]) ?? []);
  const pending = handovers.find((h) => h.status === 'pending');
  const act = (a: WorkOrderAction) => {
    if (PROGRESS_TARGET[a]) { setTarget(PROGRESS_TARGET[a]!); setDialog('progress'); }
    else if (a === 'request_review') setDialog('review');
    else setDialog(a as Dialog);
  };
  const BUTTONS: Array<[WorkOrderAction, string, string]> = [
    ['start', 'wrk.act.start', 'wrk.work_order.progress'], ['resume', 'wrk.act.resume', 'wrk.work_order.progress'], ['hold', 'wrk.act.hold', 'wrk.work_order.progress'],
    ['complete', 'wrk.act.complete', 'wrk.work_order.progress'], ['rework', 'wrk.act.rework', 'wrk.work_order.progress'],
    ['request_review', 'wrk.act.request_review', 'wrk.work_order.request_review'], ['decide', 'wrk.act.decide', 'wrk.work_order.approve'],
    ['accept', 'wrk.act.accept', 'wrk.acceptance.create'], ['close', 'wrk.act.close', 'wrk.work_order.close'], ['reopen', 'wrk.act.reopen', 'wrk.work_order.reopen'],
  ];

  return (
    <Modal title={wo ? `${String(wo.woNo)} – ${String(wo.title)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={err ?? history.error} />
      {wo && axes ? (
        <>
          <AxisChips axes={axes} />
          <dl className="facts">
            <dt>{t('wrk.field.workType')}</dt><dd>{t(`wrk.wtype.${String(wo.workType)}`)} · {t(`wrk.priority.${String(wo.priority)}`)}</dd>
            <dt>{t('wrk.field.operatingParty')}</dt><dd>{parties.name(wo.operatingParty)}</dd>
            <dt>{t('wrk.field.executingParty')}</dt><dd>{parties.name(wo.effectiveExecutingParty)}{pending ? ` (${t('wrk.handover.pending')})` : ''}</dd>
            <dt>{t('wrk.field.labour')}</dt><dd>{t('wrk.labour.total', { h: (Number(wo.labourMinutes) / 60).toFixed(1) })}</dd>
            {wo.description ? <><dt>{t('wrk.field.description')}</dt><dd>{String(wo.description)}</dd></> : null}
          </dl>
          <div className="tools">
            {BUTTONS.filter(([a, , perm]) => actions.has(a) && can(perm)).map(([a, key]) => <button key={a} className={a === 'start' || a === 'accept' ? 'primary' : undefined} onClick={() => act(a)}>{t(key)}</button>)}
            {can('wrk.work_order.handover') && !pending && axes.closure !== 'closed' ? <button onClick={() => setDialog('offer')}>{t('wrk.act.offer')}</button> : null}
            {pending && can('wrk.work_order.accept_handover') ? <>
              <button onClick={() => void post('handover/respond', { offerId: pending.offerId, action: 'accept' })}>{t('wrk.act.accept_handover')}</button>
              <button onClick={() => void post('handover/respond', { offerId: pending.offerId, action: 'decline' })}>{t('wrk.act.decline_handover')}</button>
            </> : null}
            {pending && can('wrk.work_order.handover') ? <button className="link-danger" onClick={() => void post('handover/respond', { offerId: pending.offerId, action: 'withdraw' })}>{t('wrk.act.withdraw_handover')}</button> : null}
          </div>

          <h3>{t('wrk.section.jobcards')} {can('wrk.job_card.create') && axes.closure !== 'closed' ? <button onClick={() => setDialog('jobcard')}>{t('wrk.add')}</button> : null}</h3>
          <ul className="plain">
            {cards.map((c) => {
              const items = (c.checklist as Array<{ text: string; done: boolean }>) ?? [];
              return (
                <li key={String(c.id)}>
                  <button className="link" onClick={() => setCard(c)}>#{String(c.seq)} {String(c.title)}</button> <StatusChip value={String(c.status)} labelPrefix="wrk.jstatus" /> {items.length ? `(${items.filter((i) => i.done).length}/${items.length})` : ''}
                </li>
              );
            })}
            {cards.length === 0 ? <li className="empty">{t('wrk.jobcards.none')}</li> : null}
          </ul>

          <h3>{t('wrk.section.labour')} {can('wrk.labour_entry.create') && axes.closure !== 'closed' ? <button onClick={() => setDialog('labour')}>{t('wrk.add')}</button> : null}</h3>
          <ul className="plain">{labour.items.map((l) => <li key={l.id}>{toLocalDisplay(String(l.occurredAt), tz)} · {String(l.workerName)}{l.trade ? ` (${String(l.trade)})` : ''} · {String(l.minutes)} min{l.note ? ` · ${String(l.note)}` : ''}</li>)}{labour.items.length === 0 ? <li className="empty">{t('common.empty')}</li> : null}</ul>

          <h3>{t('wrk.section.findings')} {can('wrk.finding.create') && axes.closure !== 'closed' ? <button onClick={() => setDialog('finding')}>{t('wrk.add')}</button> : null}</h3>
          <ul className="plain">{findings.items.map((f) => <li key={f.id}><strong>{t(`wrk.fkind.${String(f.kind)}`)}:</strong> {String(f.text)}</li>)}{findings.items.length === 0 ? <li className="empty">{t('common.empty')}</li> : null}</ul>

          <h3>{t('wrk.section.tests')} {can('wrk.test_record.create') && axes.closure !== 'closed' ? <button onClick={() => setDialog('test')}>{t('wrk.add')}</button> : null}</h3>
          <ul className="plain">{tests.items.map((x) => <li key={x.id}>{String(x.testName)} · {t(`wrk.result.${String(x.result)}`)}{x.measuredValue ? ` · ${String(x.measuredValue)}` : ''}</li>)}{tests.items.length === 0 ? <li className="empty">{t('common.empty')}</li> : null}</ul>

          <h3>{t('wrk.section.history')}</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">{t('wrk.field.when')}</th><th scope="col">{t('wrk.field.axis')}</th><th scope="col">{t('wrk.field.value')}</th><th scope="col">{t('wrk.field.note')}</th></tr></thead>
              <tbody>
                {history.items.map((e) => (
                  <tr key={e.id}>
                    <td>{toLocalDisplay(String(e.occurredAt), tz)}</td><td>{t(`wrk.axis.${String(e.axis).replace(/_(\w)/g, (_m, c: string) => c.toUpperCase())}`)}</td>
                    <td>{t(`${e.axis === 'return_to_service' ? 'wrk.rts' : `wrk.${String(e.axis)}`}.${String(e.value)}`)}{e.provisional ? ` (${t('wrk.provisional')})` : ''}</td><td>{String(e.note ?? '')}</td>
                  </tr>
                ))}
                {history.items.length === 0 ? <tr><td colSpan={4} className="empty">{t('common.empty')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <footer><button onClick={onClose}>{t('common.close')}</button></footer>

      {dialog === 'progress' ? <FormModal title={t(`wrk.progress.${target}`)} fields={[note]} record={null} tz={tz} submitKey="common.save" onClose={() => setDialog(null)} onSubmit={(b) => post('progress', { to: target, ...b })} /> : null}
      {dialog === 'review' ? <FormModal title={t('wrk.act.request_review')} fields={[note]} record={null} tz={tz} submitKey="common.save" onClose={() => setDialog(null)} onSubmit={(b) => post('request-review', b)} /> : null}
      {dialog === 'decide' ? (
        <FormModal title={t('wrk.act.decide')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)} defaults={{ decision: 'approved' }}
          fields={[{ key: 'decision', labelKey: 'wrk.field.decision', type: 'select', required: true, options: [{ value: 'approved', label: t('wrk.approval.approved') }, { value: 'rejected', label: t('wrk.approval.rejected') }] }, { key: 'comment', labelKey: 'wrk.field.note', type: 'textarea', maxLength: 500 }]}
          onSubmit={(b) => post('decide', b)} />
      ) : null}
      {dialog === 'accept' ? (
        <FormModal title={t('wrk.act.accept')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)} defaults={{ decision: 'accepted', returnToService: 'cleared' }}
          fields={[
            { key: 'decision', labelKey: 'wrk.field.decision', type: 'select', required: true, options: [{ value: 'accepted', label: t('wrk.decision.accepted') }, { value: 'rejected', label: t('wrk.decision.rejected') }] },
            { key: 'returnToService', labelKey: 'wrk.field.rts', type: 'select', showWhen: (v) => v.decision === 'accepted', options: [{ value: 'cleared', label: t('wrk.rts.cleared') }, { value: 'restricted', label: t('wrk.rts.restricted') }] },
            { key: 'restrictions', labelKey: 'wrk.field.restrictions', type: 'textarea', showWhen: (v) => v.decision === 'accepted' && v.returnToService === 'restricted', maxLength: 500 },
            { key: 'remarks', labelKey: 'wrk.field.remarks', type: 'textarea', maxLength: 1000, hintKey: 'wrk.hint.remarks' },
          ]}
          onSubmit={(b) => post('accept', b)} />
      ) : null}
      {dialog === 'close' ? <FormModal title={t('wrk.act.close')} fields={[note]} record={null} tz={tz} submitKey="wrk.act.close" onClose={() => setDialog(null)} onSubmit={(b) => post('close', b)} /> : null}
      {dialog === 'reopen' ? <ReasonModal title={t('wrk.act.reopen')} confirmKey="wrk.act.reopen" onClose={() => setDialog(null)} onConfirm={(reason) => post('reopen', { reason })} /> : null}
      {dialog === 'labour' ? (
        <FormModal title={t('wrk.section.labour')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)}
          fields={[{ key: 'workerName', labelKey: 'wrk.field.worker', type: 'text', required: true, maxLength: 120 }, { key: 'trade', labelKey: 'wrk.field.trade', type: 'text', maxLength: 60 }, { key: 'minutes', labelKey: 'wrk.field.minutes', type: 'number', required: true }, { key: 'occurredAt', labelKey: 'wrk.field.when', type: 'datetime', hintKey: 'wrk.hint.when' }, note]}
          onSubmit={(b) => api('POST', `${WRK}/work-orders/${workOrderId}/labour`, b).then(done)} />
      ) : null}
      {dialog === 'finding' ? (
        <FormModal title={t('wrk.section.findings')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)} defaults={{ kind: 'observation' }}
          fields={[{ key: 'kind', labelKey: 'wrk.field.kind', type: 'select', required: true, options: ['observation', 'cause', 'recommendation', 'additional_defect'].map((k) => ({ value: k, label: t(`wrk.fkind.${k}`) })) }, { key: 'text', labelKey: 'wrk.field.text', type: 'textarea', required: true, maxLength: 2000 }]}
          onSubmit={(b) => api('POST', `${WRK}/work-orders/${workOrderId}/findings`, b).then(done)} />
      ) : null}
      {dialog === 'test' ? (
        <FormModal title={t('wrk.section.tests')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)} defaults={{ result: 'pass' }}
          fields={[{ key: 'testName', labelKey: 'wrk.field.testName', type: 'text', required: true, maxLength: 160 }, { key: 'result', labelKey: 'wrk.field.result', type: 'select', required: true, options: ['pass', 'fail', 'not_applicable'].map((k) => ({ value: k, label: t(`wrk.result.${k}`) })) }, { key: 'measuredValue', labelKey: 'wrk.field.measured', type: 'text', maxLength: 120 }, note]}
          onSubmit={(b) => api('POST', `${WRK}/work-orders/${workOrderId}/tests`, b).then(done)} />
      ) : null}
      {dialog === 'jobcard' ? (
        <FormModal title={t('wrk.section.jobcards')} tz={tz} record={null} submitKey="common.create" onClose={() => setDialog(null)}
          fields={[{ key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 }, { key: 'instructions', labelKey: 'wrk.field.instructions', type: 'textarea', maxLength: 4000 }, { key: 'checklistText', labelKey: 'wrk.field.checklist', type: 'textarea', hintKey: 'wrk.hint.checklist' }]}
          onSubmit={async (b) => { const { checklistText, ...rest } = b; await api('POST', `${WRK}/job-cards`, { ...rest, workOrderId, checklist: String(checklistText ?? '').split('\n').map((s) => s.trim()).filter(Boolean) }); done(); }} />
      ) : null}
      {dialog === 'offer' ? (
        <FormModal title={t('wrk.act.offer')} tz={tz} record={null} submitKey="common.save" onClose={() => setDialog(null)} defaults={{ kind: 'workshop' }}
          fields={[{ key: 'kind', labelKey: 'wrk.field.partyKind', type: 'select', required: true, options: PARTY_KINDS.map((k) => ({ value: k, label: t(`wrk.party.${k}`) })) }, { key: 'id', labelKey: 'wrk.field.party', type: 'select', required: true, options: (v) => parties.options(String(v.kind ?? '')) }, note]}
          onSubmit={(b) => post('handover/offer', { toParty: { kind: b.kind, id: b.id }, note: b.note })} />
      ) : null}
      {card ? <JobCardModal card={card} locked={axes?.closure === 'closed'} onChanged={() => { setCard(null); done(); }} /> : null}
    </Modal>
  );
}

/** Job card: instructions, a checklist to tick off, and the issue → complete steps. */
function JobCardModal({ card, locked, onChanged }: { card: Rec; locked: boolean; onChanged(): void }) {
  const [items, setItems] = useState((card.checklist as Array<{ text: string; done: boolean }>) ?? []);
  const [version, setVersion] = useState(Number(card.version));
  const [status, setStatus] = useState(String(card.status));
  const [err, setErr] = useState<Error | null>(null);
  const editable = !locked && (status === 'draft' || status === 'issued') && can('wrk.job_card.update');
  const patch = async (body: Record<string, unknown>) => {
    try { const r = await api<Rec>('PATCH', `${WRK}/job-cards/${card.id}`, { expectedVersion: version, ...body }); setVersion(Number(r.version)); setStatus(String(r.status)); setItems(r.checklist as typeof items); setErr(null); } catch (e) { setErr(e as Error); }
  };
  return (
    <Modal title={`#${String(card.seq)} ${String(card.title)}`} onClose={onChanged} wide>
      <ErrorNotice error={err} />
      <p><StatusChip value={status} labelPrefix="wrk.jstatus" /></p>
      {card.instructions ? <p style={{ whiteSpace: 'pre-wrap' }}>{String(card.instructions)}</p> : null}
      <ul className="plain">
        {items.map((i, n) => (
          <li key={n}><label><input type="checkbox" checked={i.done} disabled={!editable || status !== 'issued'} onChange={(e) => void patch({ checklist: items.map((x, m) => (m === n ? { ...x, done: e.target.checked } : x)) })} /> {i.text}</label></li>
        ))}
        {items.length === 0 ? <li className="empty">{t('wrk.checklist.none')}</li> : null}
      </ul>
      <footer>
        <button onClick={onChanged}>{t('common.close')}</button>
        {editable && status === 'draft' ? <button className="primary" onClick={() => void patch({ status: 'issued' })}>{t('wrk.jobcard.issue')}</button> : null}
        {editable && status === 'issued' ? <button className="primary" onClick={() => void patch({ status: 'completed' })}>{t('wrk.jobcard.complete')}</button> : null}
        {editable ? <button className="link-danger" onClick={() => void patch({ status: 'void' })}>{t('wrk.jobcard.void')}</button> : null}
      </footer>
    </Modal>
  );
}
