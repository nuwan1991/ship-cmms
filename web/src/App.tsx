import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { NAV, ROUTES } from './modules';
import { t } from './platform/i18n';
import { groupByModule, visibleNav } from './platform/nav';
import { can } from './platform/permissions';
import { SystemProvider, useSystem } from './platform/system';

function Shell() {
  const { info, tz, error } = useSystem();
  const items = visibleNav(NAV, can);
  const first = items[0]?.path;

  return (
    <div className="shell">
      <a className="skip" href="#main">{t('shell.skip')}</a>
      <header className="topbar">
        <strong>Fleet CMMS</strong>
        <span className="muted">
          {info?.installation ? `${t('shell.installation')}: ${info.installation.name} (${info.installation.code})` : ''}
        </span>
        <span className="muted spacer">{t('shell.zone', { zone: tz })}</span>
      </header>

      {info?.authorizer === 'dev-allow-all' ? <div className="banner warn" role="status">{t('shell.dev_banner')}</div> : null}
      {error ? <div className="banner warn" role="alert">{t('shell.unreachable')}</div> : null}
      {info && info.status === 'uninitialized' ? <div className="banner warn" role="alert">{t('shell.uninitialized')}</div> : null}

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
    </div>
  );
}

export function App() {
  return (
    <SystemProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </SystemProvider>
  );
}
