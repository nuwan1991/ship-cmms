import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, Modal, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { coerceAnswers, type TemplateItem } from './items';
import { ORG, QR, optionLabel } from './binding';

const AST = '/api/v1/assets';
const ASSET_STATUSES = ['in_service', 'in_store', 'under_repair', 'out_of_service', 'condemned'];
const statusOptions = () => ASSET_STATUSES.map((s) => ({ value: s, label: t(`ast.astatus.${s}`) }));

/** Template questions become form fields `a_<key>`; the values are converted back to typed answers on submit. */
function questionFields(items: readonly TemplateItem[]): FieldDef[] {
  return items.map((i) => ({
    key: `a_${i.key}`, labelKey: '', label: i.label,
    type: i.kind === 'yesno' ? 'select' : i.kind === 'number' ? 'number' : 'text',
    ...(i.kind === 'yesno' ? { options: [{ value: 'yes', label: t('qr.yes') }, { value: 'no', label: t('qr.no') }] } : {}),
  } as FieldDef));
}
function answersFrom(items: readonly TemplateItem[], body: Record<string, unknown>): { answers: Record<string, string | number | boolean>; rest: Record<string, unknown> } {
  const raw: Record<string, string> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) { if (k.startsWith('a_')) raw[k.slice(2)] = String(v); else rest[k] = v; }
  return { answers: coerceAnswers(items, raw), rest };
}

function SurveyDetail({ surveyId, onClose, onChanged }: { surveyId: string; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const [survey, setSurvey] = useState<Rec | null>(null);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [err, setErr] = useState<Error | null>(null);
  const found = useList(`${QR}/surveys/${surveyId}/items`);
  const classes = useList(`${AST}/classifications`);
  const spare = useList(`${QR}/labels`, { state: 'reserved' });
  const [mode, setMode] = useState<'scan' | 'pending' | 'close' | null>(null);
  const [converting, setConverting] = useState<Rec | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const reload = () => api<Rec>('GET', `${QR}/surveys/${surveyId}`).then(setSurvey, setErr);
  useEffect(() => { void reload(); }, [surveyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (survey?.templateId) api<Rec>('GET', `${QR}/survey-templates/${survey.templateId}`).then((r) => setItems((r.items as TemplateItem[]) ?? []), () => setItems([]));
  }, [survey?.templateId]);
  const open = survey?.status === 'open';
  const done = () => { void reload(); found.reload(); spare.reload(); onChanged(); };
  const base: FieldDef[] = [
    { key: 'observedStatus', labelKey: 'qr.field.observedStatus', type: 'select', options: statusOptions() },
    ...questionFields(items),
    { key: 'note', labelKey: 'qr.field.note', type: 'textarea', maxLength: 500 },
  ];
  const scanFields: FieldDef[] = [
    { key: 'by', labelKey: 'qr.field.scanBy', type: 'select', required: true, options: [{ value: 'labelNo', label: t('qr.field.labelNo') }, { value: 'assetTag', label: t('qr.field.assetTag') }] },
    { key: 'code', labelKey: 'qr.field.scanCode', type: 'text', required: true, maxLength: 40, hintKey: 'qr.hint.scan' },
    ...base,
  ];
  const pendingFields: FieldDef[] = [
    { key: 'description', labelKey: 'qr.field.description', type: 'text', required: true, maxLength: 120 },
    { key: 'manufacturer', labelKey: 'qr.field.manufacturer', type: 'text', maxLength: 120 },
    { key: 'model', labelKey: 'qr.field.model', type: 'text', maxLength: 120 },
    { key: 'serialNumber', labelKey: 'qr.field.serialNumber', type: 'text', maxLength: 80 },
    ...base,
  ];
  const convertFields: FieldDef[] = [
    { key: 'name', labelKey: 'qr.field.name', type: 'text', maxLength: 120, hintKey: 'qr.hint.convert_name' },
    { key: 'classificationId', labelKey: 'qr.field.classification', type: 'select', options: classes.items.filter((c) => c.kind === 'equipment').map((c) => ({ value: String(c.id), label: optionLabel(c) })) },
    { key: 'labelId', labelKey: 'qr.field.spareLabel', type: 'select', hintKey: 'qr.hint.convert_label', options: spare.items.map((l) => ({ value: String(l.id), label: String(l.labelNo) })) },
  ];

  return (
    <Modal title={survey ? t('qr.survey.title', { date: toLocalDisplay(String(survey.startedAt), tz) }) : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={err ?? found.error} />
      {survey ? <p><StatusChip value={String(survey.status)} labelPrefix="qr.sstatus" /> {survey.note ? String(survey.note) : ''}</p> : null}
      {open && can('qr.survey_item.create') ? (
        <div className="tools">
          <button className="primary" onClick={() => setMode('scan')}>{t('qr.survey.add_scanned')}</button>
          <button onClick={() => setMode('pending')}>{t('qr.survey.add_pending')}</button>
          {can('qr.survey.close') ? <button onClick={() => setMode('close')}>{t('qr.survey.close')}</button> : null}
        </div>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('qr.field.item')}</th><th scope="col">{t('qr.field.kind')}</th><th scope="col">{t('qr.field.observedStatus')}</th><th scope="col">{t('qr.field.note')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
          <tbody>
            {found.items.map((r) => (
              <tr key={r.id}>
                <td>{r.kind === 'scanned' ? `${String(r.assetTag)} – ${String(r.assetName)}` : String(r.description)}{r.convertedAssetId ? ` → ${String(r.assetTag)}` : ''}</td>
                <td>{r.convertedAssetId ? t('qr.kind.converted') : t(`qr.kind.${String(r.kind)}`)}</td>
                <td>{r.observedStatus ? t(`ast.astatus.${String(r.observedStatus)}`) : ''}</td>
                <td>{String(r.note ?? '')}</td>
                <td className="actions">
                  {r.kind === 'pending' && !r.convertedAssetId && can('qr.survey_item.convert') ? <button onClick={() => setConverting(r)}>{t('qr.survey.convert')}</button> : null}
                  {open && !r.convertedAssetId && can('qr.survey_item.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
                </td>
              </tr>
            ))}
            {!found.loading && found.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('qr.survey.no_items')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer><button onClick={onClose}>{t('common.close')}</button></footer>

      {mode === 'scan' ? (
        <FormModal title={t('qr.survey.add_scanned')} fields={scanFields} record={null} tz={tz} defaults={{ by: 'labelNo' }} submitKey="common.save" onClose={() => setMode(null)}
          onSubmit={async (body) => {
            const { answers, rest } = answersFrom(items, body);
            const { by, code, ...more } = rest;
            await api('POST', `${QR}/surveys/${surveyId}/items`, { kind: 'scanned', [String(by)]: code, answers, ...more });
            done();
          }} />
      ) : null}
      {mode === 'pending' ? (
        <FormModal title={t('qr.survey.add_pending')} fields={pendingFields} record={null} tz={tz} submitKey="common.save" onClose={() => setMode(null)}
          onSubmit={async (body) => {
            const { answers, rest } = answersFrom(items, body);
            await api('POST', `${QR}/surveys/${surveyId}/items`, { kind: 'pending', answers, ...rest });
            done();
          }} />
      ) : null}
      {mode === 'close' && survey ? (
        <FormModal title={t('qr.survey.close')} fields={[{ key: 'note', labelKey: 'qr.field.note', type: 'textarea', maxLength: 500 }]} record={null} tz={tz} defaults={{ note: String(survey.note ?? '') }} submitKey="qr.survey.close" onClose={() => setMode(null)}
          onSubmit={async (body) => { await api('POST', `${QR}/surveys/${surveyId}/close`, { expectedVersion: survey.version, ...body }); done(); }} />
      ) : null}
      {converting ? (
        <FormModal title={t('qr.survey.convert_title', { name: String(converting.description) })} fields={convertFields} record={null} tz={tz} submitKey="qr.survey.convert" onClose={() => setConverting(null)}
          onSubmit={async (body) => { await api('POST', `${QR}/survey-items/${converting.id}/convert`, { expectedVersion: converting.version, ...body }); done(); }} />
      ) : null}
      {removing ? (
        <ReasonModal title={t('qr.remove.record', { name: String(removing.description ?? removing.assetTag) })} onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${QR}/survey-items/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); done(); }} />
      ) : null}
    </Modal>
  );
}

/** Compartment surveys: walk a space, scan what has a label, note what does not, then turn the unregistered items into assets. */
export function SurveysScreen() {
  const { tz } = useSystem();
  const ships = useList(`${ORG}/ships`);
  const locations = useList(`${ORG}/locations`, { limit: '500' });
  const templates = useList(`${QR}/survey-templates`, { status: 'active' });
  const [shipId, setShipId] = useState('');
  const [status, setStatus] = useState('');
  const list = useList(`${QR}/surveys`, { shipId: shipId || undefined, status: status || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const locName = (id: unknown) => { const l = locations.items.find((x) => x.id === id); return l ? String(l.name) : String(id); };
  const shipName = (id: unknown) => { const s = ships.items.find((x) => x.id === id); return s ? String(s.name) : String(id); };
  const fields: FieldDef[] = [
    { key: 'shipId', labelKey: 'qr.field.ship', type: 'select', required: true, options: ships.items.map((s) => ({ value: String(s.id), label: optionLabel(s) })) },
    { key: 'locationId', labelKey: 'qr.field.compartment', type: 'select', required: true, options: (v) => locations.items.filter((l) => l.siteId === v.shipId).map((l) => ({ value: String(l.id), label: String(l.name) })) },
    { key: 'templateId', labelKey: 'qr.field.template', type: 'select', options: templates.items.map((x) => ({ value: String(x.id), label: optionLabel(x) })) },
    { key: 'note', labelKey: 'qr.field.note', type: 'textarea', maxLength: 500 },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('qr.title.surveys')}</h1>
        <div className="tools">
          <select aria-label={t('qr.field.ship')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('qr.filter.all_ships')}</option>
            {ships.items.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
          </select>
          <select aria-label={t('qr.field.state')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('qr.filter.any_state')}</option>
            <option value="open">{t('qr.sstatus.open')}</option><option value="closed">{t('qr.sstatus.closed')}</option>
          </select>
          {can('qr.survey.create') ? <button className="primary" onClick={() => setStarting(true)}>{t('qr.new.survey')}</button> : null}
        </div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('qr.field.ship')}</th><th scope="col">{t('qr.field.compartment')}</th><th scope="col">{t('qr.field.started')}</th><th scope="col">{t('qr.field.state')}</th><th scope="col">{t('qr.field.found')}</th></tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={String(r.surveyId)}>
                <td>{shipName(r.shipId)}</td>
                <td><button className="link" onClick={() => setOpen(String(r.surveyId))}>{locName(r.locationId)}</button></td>
                <td>{toLocalDisplay(String(r.startedAt), tz)}</td>
                <td><StatusChip value={String(r.status)} labelPrefix="qr.sstatus" /></td>
                <td>{t('qr.survey.counts', { scanned: String(r.scannedCount), pending: String(r.pendingCount), converted: String(r.convertedCount) })}</td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('qr.surveys.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {open ? <SurveyDetail surveyId={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {starting ? (
        <FormModal title={t('qr.new.survey')} fields={fields} record={null} tz={tz} submitKey="qr.survey.start" onClose={() => setStarting(false)}
          onSubmit={async (body) => { const { shipId: _s, ...rest } = body; void _s; await api('POST', `${QR}/surveys`, rest); list.reload(); }} />
      ) : null}
    </section>
  );
}
