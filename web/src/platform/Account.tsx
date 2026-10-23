import { useState } from 'react';
import { api } from './api';
import { FormModal, type FieldDef } from './form';
import { t } from './i18n';
import { useAuth } from './session';
import { getToken } from './sessionStore';
import { useSystem } from './system';

const FIELDS: FieldDef[] = [
  { key: 'currentPassword', labelKey: 'auth.current_password', type: 'password', required: true },
  { key: 'newPassword', labelKey: 'auth.new_password', type: 'password', required: true, hintKey: 'idn.hint.password' },
];

/** Header controls for a signed-in session (hidden in development mode, where there is no session token). */
export function Account() {
  const { me, signOut } = useAuth();
  const { tz } = useSystem();
  const [changing, setChanging] = useState(false);
  if (!me || !getToken()) return null;
  return (
    <span className="account">
      <span className="muted">{t('auth.signed_in_as', { name: me.user.displayName })}</span>
      <button type="button" onClick={() => setChanging(true)}>{t('auth.change_password')}</button>
      <button type="button" onClick={() => void signOut()}>{t('auth.signout')}</button>
      {changing ? (
        <FormModal
          title={t('auth.change_password')}
          fields={FIELDS}
          record={null}
          tz={tz}
          onClose={() => setChanging(false)}
          onSubmit={async (body) => { await api('POST', '/api/v1/identity/me/password', body); }}
        />
      ) : null}
    </span>
  );
}
