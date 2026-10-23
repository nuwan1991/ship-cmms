import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, FreshnessBanner, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { formatTemplateItems, parseTemplateItems, type TemplateItem } from './items';
import { QR } from './binding';

/** Survey forms are hub reference data: the hub edits them, every installation uses them. */
export function TemplatesScreen() {
  const { tz } = useSystem();
  const list = useList(`${QR}/survey-templates`);
  const [editing, setEditing] = useState<{ rec: Rec | null } | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const fields = (rec: Rec | null): FieldDef[] => [
    { key: 'code', labelKey: 'qr.field.code', type: 'text', required: true, createOnly: true, maxLength: 32 },
    { key: 'name', labelKey: 'qr.field.name', type: 'text', required: true, maxLength: 120 },
    { key: 'description', labelKey: 'qr.field.description', type: 'textarea', maxLength: 500 },
    { key: 'itemsText', labelKey: 'qr.field.questions', type: 'textarea', hintKey: 'qr.hint.questions' },
    ...(rec ? [{ key: 'status', labelKey: 'qr.field.status', type: 'select', options: [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] } as FieldDef] : []),
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('qr.title.templates')}</h1>
        <div className="tools">{can('qr.survey_template.create') ? <button className="primary" onClick={() => setEditing({ rec: null })}>{t('qr.new.template')}</button> : null}</div>
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('qr.field.code')}</th><th scope="col">{t('qr.field.name')}</th><th scope="col">{t('qr.field.questions')}</th><th scope="col">{t('qr.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{String(r.code)}</td><td>{String(r.name)}</td><td>{((r.items as TemplateItem[]) ?? []).length}</td>
                <td><StatusChip value={String(r.status)} labelPrefix="status" /></td>
                <td className="actions">
                  {can('qr.survey_template.update') ? <button onClick={() => setEditing({ rec: { ...r, itemsText: formatTemplateItems(r.items as TemplateItem[]) } })}>{t('common.edit')}</button> : null}
                  {can('qr.survey_template.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('common.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <FormModal
          title={editing.rec ? t('qr.edit.record', { name: String(editing.rec.name) }) : t('qr.new.template')} fields={fields(editing.rec)} record={editing.rec} tz={tz}
          defaults={{ status: 'active' }} submitKey={editing.rec ? 'common.save' : 'common.create'} onClose={() => setEditing(null)}
          onFetchLatest={editing.rec ? () => api<Rec>('GET', `${QR}/survey-templates/${editing.rec?.id}`).then((r) => ({ ...r, itemsText: formatTemplateItems(r.items as TemplateItem[]) })) : undefined}
          onSubmit={async (body) => {
            const { itemsText, ...rest } = body;
            const parsed = parseTemplateItems(String(itemsText ?? ''));
            if ('badLine' in parsed) throw new Error(t('qr.err.question_line', { n: String(parsed.badLine) }));
            if (editing.rec) await api('PATCH', `${QR}/survey-templates/${editing.rec.id}`, { ...rest, items: parsed.items });
            else await api('POST', `${QR}/survey-templates`, { ...rest, items: parsed.items });
            list.reload();
          }}
        />
      ) : null}
      {removing ? (
        <ReasonModal title={t('qr.remove.record', { name: String(removing.name) })} onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${QR}/survey-templates/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); list.reload(); }} />
      ) : null}
    </section>
  );
}
