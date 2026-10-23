import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { NAV, ROUTES } from './modules';
import { Account } from './platform/Account';
import { t } from './platform/i18n';
import { Login } from './platform/Login';
import { groupByModule, visibleNav } from './platform/nav';
import { can } from './platform/permissions';
import { AuthProvider, useAuth } from './platform/session';
import { SystemProvider, useSystem } from './platform/system';
import { toLocalDisplay } from './platform/time';

function Shell() {
  const { info, tz, error } = useSystem();
  const { state, me } = useAuth();
  const items = visibleNav(NAV, can);
  const first = items[0]?.path;
  const lease = me && !me.authority.hub ? me.authority : null;

  return (
    <div className="shell">
      <a className="skip" href="#main">{t('shell.skip')}</a>
      <header className="topbar">
        <strong>Fleet CMMS</strong>
        <span className="muted">
          {info?.installation ? `${t('shell.installation')}: ${info.installation.name} (${info.installation.code})` : ''}
        </span>
        <span className="muted spacer">
          {lease && !lease.expired && lease.leaseExpiresAt ? `${t('shell.lease_until', { when: toLocalDisplay(lease.leaseExpiresAt, tz) })} · ` : ''}
          {t('shell.zone', { zone: tz })}
        </span>
        <Account />
      </header>

      {info?.authorizer === 'dev-allow-all' ? <div className="banner warn" role="status">{t('shell.dev_banner')}</div> : null}
      {error || state === 'unreachable' ? <div className="banner warn" role="alert">{t('shell.unreachable')}</div> : null}
      {info && info.status === 'uninitialized' ? <div className="banner warn" role="alert">{t('shell.uninitialized')}</div> : null}
      {lease?.expired ? <div className="banner warn" role="alert">{t('shell.authority_expired')}</div> : null}
      {me?.clock.suspect ? <div className="banner warn" role="alert">{t('shell.clock_suspect')}</div> : null}

      {state === 'loading' || state === 'unreachable' ? (
        <main id="main" className="center">{state === 'loading' ? t('shell.loading') : null}</main>
      ) : state === 'anonymous' ? (
        <Login />
      ) : (
        <div className="body">
          <nav aria-label="Main">
            {groupByModule(items).map((g) => (
              <section key={g.module}>
                <h3>{t(`nav.group.${g.module}`)}</h3>
                <ul>
                  {g.items.map((i) => (
                    <li key={i.path}><NavLink to={i.path}>{t(i.labelKey)}</NavLink></li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          <main id="main" tabIndex={-1}>
            <Routes>
              {ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
              <Route path="*" element={first ? <Navigate to={first} replace /> : null} />
            </Routes>
          </main>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <SystemProvider>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </SystemProvider>
  );
}
