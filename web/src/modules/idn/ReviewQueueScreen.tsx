import { useState, type FormEvent } from 'react';
import { api, type ApiError, type Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, Modal } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { IDN } from './binding';

function RatifyModal({ approval, onDone, onClose }: { approval: Rec; onDone(): void; onClose(): void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `${IDN}/approvals/${String(approval.approvalId)}/ratify`, comment.trim() ? { comment: comment.trim() } : {});
      onDone();
      onClose();
    } catch (err) {
      setError(err as Error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('idn.review.ratify_title')} onClose={onClose}>
      <p>{t('idn.review.ratify_body')}</p>
      <form onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="rc">{t('idn.review.comment')}</label>
          <textarea id="rc" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} autoFocus />
        </div>
        <ErrorNotice error={error} />
        <footer>
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="primary" disabled={busy}>{t('idn.review.ratify')}</button>
        </footer>
      </form>
    </Modal>
  );
}

/** Approvals awaiting confirmation: made on an expired offline lease, or by someone whose authority was withdrawn effective before the decision. */
export function ReviewQueueScreen() {
  const { tz } = useSystem();
  const list = useList(`${IDN}/approvals/review-queue`);
  const [ratifying, setRatifying] = useState<Rec | null>(null);
  const mayRatify = can('idn.approval.create');
  return (
    <section>
      <div className="page-head"><h1>{t('idn.title.review')}</h1></div>
      <FreshnessBanner freshness={list.freshness} />
      <p className="help">{t('idn.review.help')}</p>
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('idn.field.decidedAt')}</th><th scope="col">{t('idn.field.gateCode')}</th><th scope="col">{t('idn.field.subject')}</th>
              <th scope="col">{t('idn.field.decision')}</th><th scope="col">{t('idn.field.reason')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={String(r.approvalId)}>
                <td>{toLocalDisplay(String(r.decidedAt), tz)}</td>
                <td>{String(r.gateCode)}</td>
                <td>{String(r.subjectType)} {String(r.subjectId).slice(-8)}</td>
                <td>{t(`idn.decision.${String(r.decision)}`)}</td>
                <td>
                  {r.pendingConfirmation ? <span className="chip warn">{t('idn.review.pending')}</span> : null}{' '}
                  {r.authorityDisputed ? <span className="chip warn">{t('idn.review.disputed')}</span> : null}
                </td>
                <td className="actions">{mayRatify && r.decision === 'approved' ? <button onClick={() => setRatifying(r)}>{t('idn.review.ratify')}</button> : null}</td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={6} className="empty">{t('idn.review.empty')}</td></tr> : null}
            {list.loading ? <tr><td colSpan={6} className="empty">{t('common.loading')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {ratifying ? <RatifyModal approval={ratifying} onDone={list.reload} onClose={() => setRatifying(null)} /> : null}
    </section>
  );
}
