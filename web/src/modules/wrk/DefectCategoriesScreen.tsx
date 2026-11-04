import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { categoryStyle } from '../../platform/colors';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal, StatusChip } from '../../platform/ui';
import { WRK, WrkResourceScreen, type WrkConfig } from './binding';

const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });

/** Defect categories (D67): main categories with a colour and the departments that suggest them, and their subcategories. Kept at the hub. */
const categoryConfig: WrkConfig = {
  noun: 'defect_category', collection: 'defect-categories', titleKey: 'wrk.title.categories', newKey: 'wrk.new.category', hubOnly: true,
  rowName: (r: Rec) => `${String(r.code)} – ${String(r.name)}`,
  refs: { mains: { apiBase: WRK, collection: 'defect-categories', label: (r: Rec) => String(r.name), filter: (r: Rec) => !r.parentId } },
  columns: [
    { key: 'name', labelKey: 'wrk.field.category', render: (r, _tz, refs) => r.parentId
      ? <span className="cat-sub">↳ {String(r.name)} <small>({(refs.mains ?? []).find((m) => m.value === r.parentId)?.label ?? ''})</small></span>
      : <span className="cat" style={categoryStyle(r.color ? String(r.color) : null)}>{String(r.name)}</span> },
    { key: 'code', labelKey: 'wrk.field.code' },
    { key: 'departmentCodes', labelKey: 'wrk.field.departments' },
    { key: 'sortOrder', labelKey: 'wrk.field.sortOrder' },
    { key: 'status', labelKey: 'wrk.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> },
  ],
  fields: (refs) => [
    { key: 'code', labelKey: 'wrk.field.code', type: 'text', required: true, createOnly: true, maxLength: 32, hintKey: 'wrk.hint.category_code' },
    { key: 'name', labelKey: 'wrk.field.name', type: 'text', required: true, maxLength: 120 },
    { key: 'parentId', labelKey: 'wrk.field.parentCategory', type: 'select', options: refs.mains ?? [], hintKey: 'wrk.hint.parent_category' },
    { key: 'color', labelKey: 'wrk.field.color', type: 'text', maxLength: 7, hintKey: 'wrk.hint.color', showWhen: (v) => !v.parentId },
    { key: 'departmentCodes', labelKey: 'wrk.field.departments', type: 'text', maxLength: 200, hintKey: 'wrk.hint.departments', showWhen: (v) => !v.parentId },
    { key: 'sortOrder', labelKey: 'wrk.field.sortOrder', type: 'number' },
    { key: 'status', labelKey: 'wrk.field.status', type: 'select', options: [opt('active', 'status.active'), opt('inactive', 'status.inactive')] },
  ],
  defaults: { status: 'active' },
};

interface Catchup { uncategorised: number; matched: number; applied: number; left: Array<{ defectNo: string; title: string }> }

export function DefectCategoriesScreen() {
  const { info } = useSystem();
  const hub = info?.installation?.kind === 'hub';
  const [tick, setTick] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  const [catchup, setCatchup] = useState<Catchup | null>(null);
  async function loadStandard() {
    try { const r = await api<{ added: number }>('POST', `${WRK}/defect-categories/load-standard`, {}); setNotice(t('wrk.categories.loaded', { n: String(r.added) })); setError(null); setTick((x) => x + 1); } catch (e) { setError(e as Error); }
  }
  async function preview() {
    try { setCatchup(await api<Catchup>('POST', `${WRK}/defects/categorise-existing`, { apply: false })); setError(null); } catch (e) { setError(e as Error); }
  }
  async function apply() {
    try { const r = await api<Catchup>('POST', `${WRK}/defects/categorise-existing`, { apply: true }); setNotice(t('wrk.categories.applied', { n: String(r.applied) })); setCatchup(null); } catch (e) { setError(e as Error); }
  }
  return (
    <>
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      <ErrorNotice error={error} />
      <WrkResourceScreen
        key={tick}
        config={categoryConfig}
        headerExtra={<>
          {hub && can('wrk.defect_category.create') ? <button onClick={() => void loadStandard()}>{t('wrk.categories.load_standard')}</button> : null}
          {can('wrk.defect.update') ? <button onClick={() => void preview()}>{t('wrk.categories.catchup')}</button> : null}
        </>}
      />
      <p className="hint">{t('wrk.categories.help')}</p>
      {catchup ? (
        <Modal title={t('wrk.categories.catchup')} onClose={() => setCatchup(null)}>
          <p>{t('wrk.categories.catchup_found', { n: String(catchup.uncategorised), m: String(catchup.matched) })}</p>
          {catchup.left.length ? <><p className="help">{t('wrk.categories.catchup_left')}</p><ul className="plain">{catchup.left.slice(0, 30).map((d) => <li key={d.defectNo}>{d.defectNo} – {d.title}</li>)}</ul></> : null}
          <footer>
            <button type="button" onClick={() => setCatchup(null)}>{t('common.cancel')}</button>
            <button type="button" className="primary" disabled={catchup.matched === 0} onClick={() => void apply()}>{t('wrk.categories.catchup_apply', { n: String(catchup.matched) })}</button>
          </footer>
        </Modal>
      ) : null}
    </>
  );
}
