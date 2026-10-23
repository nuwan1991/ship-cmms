import { useEffect, type ReactNode } from 'react';
import type { ApiError, Freshness } from './api';
import { summarizeFreshness } from './freshness';
import { t } from './i18n';
import { useSystem } from './system';
import { toLocalDisplay } from './time';

export function Modal({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon" aria-label={t('common.close')} onClick={onClose}>×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Shows an API error with its correlation id so a technician can quote it to support. */
export function ErrorNotice({ error }: { error: ApiError | Error | null }) {
  if (!error) return null;
  const api = error as ApiError;
  const reason = api.body?.details?.rule ? ` (${String(api.body.details.rule)})` : '';
  return (
    <div className="notice error" role="alert">
      <strong>{api.code ? t(`error.${api.code}`) : t('error.INTERNAL')}</strong>
      <span>{error.message}{reason}</span>
      {api.body?.correlationId && api.body.correlationId !== '-' ? <small>{t('common.reference')}: {api.body.correlationId}</small> : null}
    </div>
  );
}

/** Version conflict (CONTRACTS §10): someone changed the record since it was opened. The user chooses; nothing is silently overwritten. */
export function ConflictDialog({ currentVersion, onReload, onOverwrite, onCancel }: { currentVersion?: number | undefined; onReload(): void; onOverwrite(): void; onCancel(): void }) {
  return (
    <Modal title={t('conflict.title')} onClose={onCancel}>
      <p>{t('conflict.body', { version: currentVersion ?? '?' })}</p>
      <footer>
        <button type="button" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" onClick={onReload}>{t('conflict.reload')}</button>
        <button type="button" className="primary" onClick={onOverwrite}>{t('conflict.overwrite')}</button>
      </footer>
    </Modal>
  );
}

const CHIP: Record<string, string> = {
  active: 'ok', inactive: 'muted', laid_up: 'warn', decommissioned: 'muted',
  in_progress: 'ok', work_complete: 'ok', approved: 'ok', cleared: 'ok', closed: 'muted',
  on_hold: 'warn', pending_review: 'warn', restricted: 'warn', rejected: 'warn', withheld: 'warn', reopened: 'warn', urgent: 'warn', critical: 'warn',
};
export function StatusChip({ value, labelPrefix }: { value: string; labelPrefix: string }) {
  return <span className={`chip ${CHIP[value] ?? 'muted'}`}>{t(`${labelPrefix}.${value}`)}</span>;
}

/** Every screen that shows synchronized data states how fresh it is for its scope. */
export function FreshnessBanner({ freshness }: { freshness: readonly Freshness[] }) {
  const { info, tz } = useSystem();
  const s = summarizeFreshness(freshness, info?.installation?.kind);
  if (!s) return null;
  const pending = s.pendingOutbound > 0 ? ` ${t('freshness.pending', { count: s.pendingOutbound })}` : '';
  const text =
    s.level === 'never' ? t('freshness.never')
    : s.level === 'stale' ? t('freshness.stale', { when: toLocalDisplay(s.asOf, tz) })
    : s.level === 'authoritative' ? t('freshness.authoritative')
    : t('freshness.ok');
  return (
    <div className={`banner ${s.level === 'never' || s.level === 'stale' ? 'warn' : 'info'}`} role="status">
      {text}{pending}
    </div>
  );
}
