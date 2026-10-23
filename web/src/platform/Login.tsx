import { useState, type FormEvent } from 'react';
import type { ApiError } from './api';
import { t } from './i18n';
import { useAuth } from './session';
import { ErrorNotice } from './ui';

export function Login() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err as Error);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login" id="main">
      <form onSubmit={(e) => void submit(e)}>
        <h1>{t('auth.signin')}</h1>
        <div className="field">
          <label htmlFor="u">{t('auth.username')}</label>
          <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor="p">{t('auth.password')}</label>
          <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <ErrorNotice error={error} />
        <button type="submit" className="primary" disabled={busy || !username || !password}>{t('auth.submit')}</button>
      </form>
    </main>
  );
}
