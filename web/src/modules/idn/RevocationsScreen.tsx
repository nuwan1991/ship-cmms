import { useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useRefOptions } from '../../platform/ResourceScreen';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { IDN } from './binding';

const USERS = { users: { apiBase: IDN, collection: 'users', label: (r: Rec) => String(r.displayName) } };

/** Withdraw or restore authority. Allowed at any installation (a ship's administrator acts without the hub). History is never edited. */
export function RevocationsScreen() {
  const { tz } = useSystem();
  const list = useList(`${IDN}/revocations`);
  const refs = useRefOptions(USERS, IDN);
  const [open, setOpen] = useState(false);
  const fields: FieldDef[] = [
    { key: 'userId', labelKey: 'idn.field.user', type: 'select', required: true, options: refs.users ?? [] },
    { key: 'kind', labelKey: 'idn.field.kind', type: 'select', required: true, options: [{ value: 'revoke', label: t('idn.kind.revoke') }, { value: 'reinstate', label: t('idn.kind.reinstate') }] },
    { key: 'roleAssignmentId', labelKey: 'idn.field.assignmentId', type: 'text', hintKey: 'idn.hint.assignmentId' },
    { key: 'effectiveAt', labelKey: 'idn.field.effectiveAt', type: 'datetime', hintKey: 'idn.hint.effectiveAt' },
    { key: 'reason', labelKey: 'idn.field.reason', type: 'textarea', required: true, maxLength: 500 },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('idn.title.revocations')}</h1>
        {can('idn.revocation.create') ? <div className="tools"><button className="primary" onClick={() => setOpen(true)}>{t('idn.new.revocation')}</button></div> : null}
      </div>
      <FreshnessBanner freshness={list.freshness} />
      <p className="help">{t('idn.revocations.help')}</p>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('idn.field.effectiveAt')}</th><th scope="col">{t('idn.field.user')}</th><th scope="col">{t('idn.field.kind')}</th>
              <th scope="col">{t('idn.field.assignmentId')}</th><th scope="col">{t('idn.field.reason')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{toLocalDisplay(String(r.effectiveAt), tz)}</td>
                <td>{refs.users?.find((o) => o.value === r.userId)?.label ?? String(r.userId)}</td>
                <td>{t(`idn.kind.${String(r.kind)}`)}</td>
                <td>{r.roleAssignmentId ? String(r.roleAssignmentId).slice(-8) : t('idn.all')}</td>
                <td>{String(r.reason)}</td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('common.empty')}</td></tr> : null}
            {list.loading ? <tr><td colSpan={5} className="empty">{t('common.loading')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {open ? (
        <FormModal
          title={t('idn.new.revocation')}
          fields={fields}
          record={null}
          tz={tz}
          defaults={{ kind: 'revoke' }}
          submitKey="common.create"
          onClose={() => setOpen(false)}
          onSubmit={async (body) => { await api('POST', `${IDN}/revocations`, body); list.reload(); }}
        />
      ) : null}
    </section>
  );
}
