/** Office structure: department > section (optional) > workshop > sub-section, with in-charge, officer and verify rule (A1, A5). */
import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, StatusChip } from '../../platform/ui';
import { usePeople } from '../wrk/people';
import { OFC, OfficePicker, useGet, useOffice, type Page } from './binding';

const PARENT: Record<string, string[]> = { department: [], section: ['department'], workshop: ['department', 'section'], subsection: ['workshop'] };
const LEVELS = ['department', 'section', 'workshop', 'subsection'];

/** Departments and sections are led by an officer; workshops and their subsections by a senior sailor (S/S). */
export const headLabelKey = (level: string): string => (level === 'workshop' || level === 'subsection' ? 'ofc.field.head_ss' : 'ofc.field.head_officer');

export function UnitsScreen() {
  const { tz } = useSystem();
  const office = useOffice();
  const people = usePeople();
  const [inactive, setInactive] = useState(false);
  const units = useGet<Page>(office.commandId ? `${OFC}/units` : null, { commandId: office.commandId, includeInactive: inactive ? 'true' : undefined });
  const [editing, setEditing] = useState<Rec | null | 'new'>(null);
  const items = units.data?.items ?? [];

  const fields: FieldDef[] = [
    { key: 'level', labelKey: 'ofc.field.level', type: 'select', required: true, createOnly: true, options: LEVELS.map((l) => ({ value: l, label: t(`ofc.level.${l}`) })) },
    {
      key: 'parentId', labelKey: 'ofc.field.parent', type: 'select', hintKey: 'ofc.hint.parent',
      options: (v) => items.filter((u) => (PARENT[String(v.level || (editing as Rec | null)?.level || '')] ?? []).includes(String(u.level))).map((u) => ({ value: String(u.id), label: String(u.path) })),
      showWhen: (v) => String(v.level || (editing as Rec | null)?.level || '') !== 'department',
    },
    { key: 'code', labelKey: 'ofc.field.code', type: 'text', required: true, maxLength: 40 },
    { key: 'name', labelKey: 'ofc.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'headUserId', labelKey: 'ofc.field.head', type: 'select', options: people.options, labelFor: (v) => t(headLabelKey(String(v.level || (editing as Rec | null)?.level || ''))) },
    { key: 'deputyUserId', labelKey: 'ofc.field.deputy', type: 'select', options: people.options, hintKey: 'ofc.hint.deputy' },
    { key: 'verifyRule', labelKey: 'ofc.field.verifyRule', type: 'select', options: ['in_charge', 'officer_required'].map((v) => ({ value: v, label: t(`ofc.verify.${v}`) })) },
    { key: 'sortOrder', labelKey: 'ofc.field.sortOrder', type: 'number' },
    { key: 'status', labelKey: 'ofc.field.status', type: 'select', options: ['active', 'inactive'].map((v) => ({ value: v, label: t(`ofc.ustatus.${v}`) })), showWhen: () => editing !== 'new' },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('ofc.title.units')}</h1>
        <div className="tools">
          <OfficePicker office={office} />
          <label className="check"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> {t('ofc.filter.inactive')}</label>
          {can('ofc.org_unit.create') && office.commandId ? <button className="primary" onClick={() => setEditing('new')}>{t('ofc.new.unit')}</button> : null}
        </div>
      </div>
      <p className="hint">{t('ofc.hint.units')}</p>
      <ErrorNotice error={office.error ?? units.error} />
      {!office.loading && !office.commandId ? <p className="empty">{t('ofc.no_office')}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('ofc.field.name')}</th><th scope="col">{t('ofc.field.level')}</th><th scope="col">{t('ofc.field.head')}</th><th scope="col">{t('ofc.field.deputy')}</th><th scope="col">{t('ofc.field.verifyRule')}</th><th scope="col">{t('ofc.field.status')}</th><th className="actions-col" /></tr></thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td><span className="indent" style={{ width: `${Number(u.depth) * 20}px` }} />{String(u.code)} – {String(u.name)}</td>
                <td>{t(`ofc.level.${String(u.level)}`)}</td>
                <td>{u.headUserId ? <><span className="muted">{t(headLabelKey(String(u.level)) + '_short')}:</span> {people.name(u.headUserId)}</> : '—'}</td><td>{people.name(u.deputyUserId)}</td>
                <td>{t(`ofc.verify.${String(u.verifyRule)}`)}</td>
                <td><StatusChip value={String(u.status)} labelPrefix="ofc.ustatus" /></td>
                <td className="actions-col">{can('ofc.org_unit.update') ? <button onClick={() => setEditing(u)}>{t('common.edit')}</button> : null}</td>
              </tr>
            ))}
            {!units.loading && office.commandId && items.length === 0 ? <tr><td colSpan={7} className="empty">{t('ofc.units.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <FormModal title={editing === 'new' ? t('ofc.new.unit') : t('ofc.edit.unit', { name: String(editing.name) })} fields={fields} record={editing === 'new' ? null : editing} tz={tz}
          defaults={{ verifyRule: 'in_charge' }} onClose={() => setEditing(null)}
          onFetchLatest={editing === 'new' ? undefined : () => api<Rec>('GET', `${OFC}/units/${editing.id}`)}
          onSubmit={async (body) => {
            if (editing === 'new') await api('POST', `${OFC}/units`, { ...body, commandId: office.commandId });
            else await api('PATCH', `${OFC}/units/${editing.id}`, body);
            units.reload();
          }} />
      ) : null}
    </section>
  );
}
