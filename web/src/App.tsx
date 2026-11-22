import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { NAV, ROUTES } from './modules';
import { Account } from './platform/Account';
import { t } from './platform/i18n';
import { Login } from './platform/Login';
import { groupByModule, visibleNav } from './platform/nav';
import { can } from './platform/permissions';
import { AuthProvider, useAuth } from './platform/session';
import { SystemProvider, useSystem } from './platform/system';
import { toLocalDisplay } from './platform/time';

/** Per-browser layout preference; storage can be unavailable (private window), so failures are ignored. */
function stored<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function store(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

/** Desktop: the menu can be hidden to a thin strip, and each group folds; only the current page's group starts open. */
function useMenuLayout(groups: readonly string[], currentGroup: string | undefined) {
  const [hidden, setHidden] = useState(() => stored('cmms.nav.hidden', false));
  const [open, setOpen] = useState<string[]>(() => stored('cmms.nav.open', [] as string[]));
  // Arriving on a page opens its group (it can still be folded afterwards).
  useEffect(() => { if (currentGroup) setOpen((cur) => (cur.includes(currentGroup) ? cur : [...cur, currentGroup])); }, [currentGroup]);
  const isOpen = (g: string) => groups.length === 1 || open.includes(g);
  const toggleGroup = (g: string) => setOpen((cur) => {
    const next = isOpen(g) ? cur.filter((x) => x !== g) : [...cur, g];
    store('cmms.nav.open', next);
    return next;
  });
  const toggleHidden = () => setHidden((h) => { store('cmms.nav.hidden', !h); return !h; });
  return { hidden, toggleHidden, isOpen, toggleGroup };
}

function Shell() {
  const { info, tz, error } = useSystem();
  const { state, me } = useAuth();
  const items = visibleNav(NAV, can);
  /** Phones: the menu folds away behind a button so the screen shows the work first. */
  const [menuOpen, setMenuOpen] = useState(false);
  const first = items[0]?.path;
  const lease = me && !me.authority.hub ? me.authority : null;
  const groups = groupByModule(items);
  const { pathname } = useLocation();
  const currentGroup = items.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))?.module;
  const layout = useMenuLayout(groups.map((g) => g.module), currentGroup);

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
        <div className={`body${layout.hidden ? ' nav-hidden' : ''}`}>
          <button type="button" className="menu-toggle" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen((x) => !x)}>☰ {t('shell.menu')}</button>
          {layout.hidden ? (
            <button type="button" className="nav-rail" title={t('shell.show_menu')} aria-label={t('shell.show_menu')} aria-controls="main-nav" aria-expanded={false} onClick={layout.toggleHidden}>☰</button>
          ) : null}
          <nav id="main-nav" aria-label="Main" className={menuOpen ? 'open' : ''} onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenuOpen(false); }}>
            <button type="button" className="nav-hide" title={t('shell.hide_menu')} aria-label={t('shell.hide_menu')} onClick={layout.toggleHidden}>«</button>
            {groups.map((g) => {
              const open = layout.isOpen(g.module);
              return (
                <section key={g.module}>
                  <h3>
                    <button type="button" className="nav-group" aria-expanded={open} aria-controls={`nav-${g.module}`} onClick={() => layout.toggleGroup(g.module)}>
                      <span aria-hidden="true">{open ? '▾' : '▸'}</span> {t(`nav.group.${g.module}`)}
                    </button>
                  </h3>
                  <ul id={`nav-${g.module}`} hidden={!open}>
                    {g.items.map((i) => (
                      <li key={i.path}><NavLink to={i.path}>{t(i.labelKey)}</NavLink></li>
                    ))}
                  </ul>
                </section>
              );
            })}
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
