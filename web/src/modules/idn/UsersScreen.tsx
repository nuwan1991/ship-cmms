import { useEffect, useState } from 'react';
import { api, ApiError, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { ErrorNotice, Modal } from '../../platform/ui';
import { IDN, IdnResourceScreen } from './binding';
import { userConfig } from './resources';

const FIELDS: FieldDef[] = [
  { key: 'username', labelKey: 'idn.field.username', type: 'text', required: true, maxLength: 32, hintKey: 'idn.hint.username' },
  { key: 'password', labelKey: 'idn.field.password', type: 'password', required: true, hintKey: 'idn.hint.password' },
];

/** Set or replace a user's sign-in. An existing credential is replaced by a new version; history is untouched (approvals key on the user id). */
function CredentialModal({ user, onClose }: { user: Rec; onClose(): void }) {
  const { tz } = useSystem();
  const [state, setState] = useState<{ loaded: boolean; credential: Rec | null; error: Error | null }>({ loaded: false, credential: null, error: null });
  const path = `${IDN}/users/${user.id}/credential`;
  useEffect(() => {
    api<Rec>('GET', path).then(
      (credential) => setState({ loaded: true, credential, error: null }),
      (e: Error) => setState(e instanceof ApiError && e.status === 404 ? { loaded: true, credential: null, error: null } : { loaded: true, credential: null, error: e }),
    );
  }, [path]);

  if (!state.loaded) return <Modal title={t('idn.credential.title', { name: String(user.displayName) })} onClose={onClose}><p>{t('common.loading')}</p></Modal>;
  if (state.error) return <Modal title={t('idn.credential.title', { name: String(user.displayName) })} onClose={onClose}><ErrorNotice error={state.error} /></Modal>;
  return (
    <FormModal
      title={t('idn.credential.title', { name: String(user.displayName) })}
      fields={FIELDS}
      record={state.credential}
      tz={tz}
      submitKey="common.save"
      onClose={onClose}
      onFetchLatest={() => api<Rec>('GET', path)}
      onSubmit={async (body) => { await api('PUT', path, body); }}
    />
  );
}

export function UsersScreen() {
  const [credentialFor, setCredentialFor] = useState<Rec | null>(null);
  return (
    <>
      <IdnResourceScreen
        config={userConfig}
        rowActions={(row) => (can('idn.credential.create') || can('idn.credential.update') ? <button onClick={() => setCredentialFor(row)}>{t('idn.credential.action')}</button> : null)}
      />
      {credentialFor ? <CredentialModal user={credentialFor} onClose={() => setCredentialFor(null)} /> : null}
    </>
  );
}
