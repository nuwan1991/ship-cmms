import { useState, type FormEvent } from 'react';
import type { ApiError } from './api';
import { t } from './i18n';
import { ErrorNotice, Modal } from './ui';

/** Removal needs a reason (recorded in the audit trail); records are tombstoned, never deleted. */
export function ReasonModal({ title, confirmKey = 'common.remove', onConfirm, onClose }: { title: string; confirmKey?: string; onConfirm(reason: string): Promise<void>; onClose(): void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="reason">{t('common.reason')} *</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} autoFocus />
          <small>{t('common.reason_hint')}</small>
        </div>
        <ErrorNotice error={error} />
        <footer>
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="danger" disabled={busy || !reason.trim()}>{t(confirmKey)}</button>
        </footer>
      </form>
    </Modal>
  );
}
