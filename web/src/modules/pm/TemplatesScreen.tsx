import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { ErrorNotice, StatusChip } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { PM } from './binding';

const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** Standard maintenance tasks: a checklist and estimate that plans copy into the work orders they create. Hub reference data. */
export function TemplatesScreen() {
  const { tz, info } = useSystem();
  const list = useList(`${PM}/task-templates`);
  const [editing, setEditing] = useState<Rec | 'new' | null>(null);
  const [removing, setRemoving] = useState<Rec | null>(null);
  const hub = info?.installation?.kind === 'hub';
  const fields: FieldDef[] = [
    { key: 'code', labelKey: 'pm.field.code', type: 'text', required: true, createOnly: true, maxLength: 40 },
    { key: 'name', labelKey: 'pm.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'description', labelKey: 'pm.field.description', type: 'textarea', maxLength: 2000 },
    { key: 'checklistText', labelKey: 'pm.field.checklist', type: 'textarea', hintKey: 'pm.hint.checklist', maxLength: 4000 },
    { key: 'estimatedMinutes', labelKey: 'pm.field.estimatedMinutes', type: 'text', hintKey: 'pm.hint.whole' },
    { key: 'priority', labelKey: 'pm.field.priority', type: 'select', options: PRIORITIES.map((p) => ({ value: p, label: t(`pm.priority.${p}`) })) },
    { key: 'status', labelKey: 'pm.field.status', type: 'select', options: ['active', 'inactive'].map((s) => ({ value: s, label: t(`status.${s}`) })) },
  ];
  const record = (r: Rec | 'new' | null): Rec | null => (r && r !== 'new' ? ({ ...r, checklistText: ((r.checklist as string[] | undefined) ?? []).join('\n'), estimatedMinutes: r.estimatedMinutes ?? '' } as Rec) : null);
  return (
    <section>
      <div className="page-head">
        <h1>{t('pm.title.templates')}</h1>
        <div className="tools">{hub && can('pm.task_template.create') ? <button className="primary" onClick={() => setEditing('new')}>{t('pm.new.template')}</button> : null}</div>
      </div>
      <ErrorNotice error={list.error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('pm.field.code')}</th><th scope="col">{t('pm.field.name')}</th><th scope="col">{t('pm.field.checklist')}</th><th scope="col">{t('pm.field.priority')}</th><th scope="col">{t('pm.field.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((r) => (
            <tr key={r.id}>
              <td>{String(r.code)}</td><td>{String(r.name)}</td><td>{((r.checklist as string[]) ?? []).length}</td>
              <td>{t(`pm.priority.${String(r.priority)}`)}</td><td><StatusChip value={String(r.status)} labelPrefix="status" /></td>
              <td className="actions">
                {hub && can('pm.task_template.update') ? <button onClick={() => setEditing(r)}>{t('common.edit')}</button> : null}
                {hub && can('pm.task_template.remove') ? <button className="link-danger" onClick={() => setRemoving(r)}>{t('common.remove')}</button> : null}
              </td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('pm.templates.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {editing ? (
        <FormModal title={editing === 'new' ? t('pm.new.template') : t('pm.edit.template', { name: String(editing.code) })} fields={fields} record={record(editing)} tz={tz} defaults={{ priority: 'normal', status: 'active' }}
          submitKey={editing === 'new' ? 'common.create' : 'common.save'} onClose={() => setEditing(null)}
          onFetchLatest={editing !== 'new' ? () => api<Rec>('GET', `${PM}/task-templates/${editing.id}`).then((r) => record(r) as Rec) : undefined}
          onSubmit={async (body) => {
            const { checklistText, estimatedMinutes, ...rest } = body;
            const payload: Record<string, unknown> = { ...rest, checklist: String(checklistText ?? '').split('\n').map((l) => l.trim()).filter(Boolean) };
            payload.estimatedMinutes = estimatedMinutes === '' || estimatedMinutes === undefined ? null : Number(estimatedMinutes);
            if (payload.estimatedMinutes !== null && !Number.isInteger(payload.estimatedMinutes)) throw new Error(t('pm.err.whole', { field: t('pm.field.estimatedMinutes') }));
            if (editing === 'new') await api('POST', `${PM}/task-templates`, payload);
            else await api('PATCH', `${PM}/task-templates/${editing.id}`, payload);
            list.reload();
          }} />
      ) : null}
      {removing ? (
        <ReasonModal title={t('pm.remove.template', { name: String(removing.code) })} confirmKey="common.remove" onClose={() => setRemoving(null)}
          onConfirm={async (reason) => { await api('POST', `${PM}/task-templates/${removing.id}/tombstone`, { expectedVersion: removing.version, reason }); list.reload(); }} />
      ) : null}
    </section>
  );
}
