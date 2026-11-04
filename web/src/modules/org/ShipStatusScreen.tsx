import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay, utcIsoToLocalInput } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, Modal } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { ORG } from './ResourceScreen';

export const STATUSES = ['operational', 'semi_operational', 'non_operational'] as const;

/** Operational status pill (green / amber / red); "not recorded" when the ship has no status yet. */
export function StatusPill({ status }: { status: unknown }) {
  const s = typeof status === 'string' && status ? status : null;
  return <span className={`pill st-${s ?? 'none'}`}>{t(`org.opstatus.${s ?? 'none'}`)}</span>;
}

const daysSince = (iso: unknown): string => (iso ? String(Math.max(0, Math.floor((Date.now() - Date.parse(String(iso))) / 86_400_000))) : '');

/**
 * Operational status of every ship (D66): operational, semi-operational or non-operational, with the reason, who set it and the
 * OPDEF reference. Command authority or NHQ records changes; each change starts a new period. The ship's current sea deployment
 * is shown beside it.
 */
export function ShipStatusScreen() {
  const { tz } = useSystem();
  const commands = useList(`${ORG}/commands`, { limit: '500' });
  const [commandId, setCommandId] = useState('');
  const list = useList(`${ORG}/ship-status`, { commandId: commandId || undefined });
  const [recording, setRecording] = useState<Rec | null>(null);
  const [history, setHistory] = useState<Rec | null>(null);
  const canRecord = can('org.ship_status.record');

  const fields: FieldDef[] = [
    { key: 'status', labelKey: 'org.field.opstatus', type: 'select', required: true, options: STATUSES.map((s) => ({ value: s, label: t(`org.opstatus.${s}`) })) },
    { key: 'effectiveFrom', labelKey: 'org.field.statusFrom', type: 'datetime', required: true, hintKey: 'org.hint.status_from' },
    { key: 'reason', labelKey: 'org.field.statusReason', type: 'textarea', maxLength: 500, hintKey: 'org.hint.status_reason' },
    { key: 'authority', labelKey: 'org.field.authority', type: 'text', maxLength: 120, hintKey: 'org.hint.authority' },
    { key: 'opdefRef', labelKey: 'org.field.opdefRef', type: 'text', maxLength: 60, hintKey: 'org.hint.opdef' },
    { key: 'opdefCategory', labelKey: 'org.field.opdefCategory', type: 'text', maxLength: 20 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('org.title.ship_status')}</h1>
        <div className="tools">
          <select aria-label={t('org.field.commandId')} value={commandId} onChange={(e) => setCommandId(e.target.value)}>
            <option value="">{t('org.filter.all_commands')}</option>
            {commands.items.map((c) => <option key={c.id} value={c.id}>{String(c.name)}</option>)}
          </select>
        </div>
      </div>
      <p className="hint">{t('org.ship_status.help')}</p>
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('org.field.shipId')}</th><th scope="col">{t('org.field.commandId')}</th><th scope="col">{t('org.field.opstatus')}</th>
            <th scope="col">{t('org.field.since')}</th><th scope="col">{t('org.field.statusReason')}</th><th scope="col">{t('org.field.opdefRef')}</th>
            <th scope="col">{t('org.field.deployment')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td><strong>{String(r.shipName)}</strong>{r.pennantNo ? <div className="muted">{String(r.pennantNo)}</div> : null}</td>
                <td>{String(r.commandName ?? '')}</td>
                <td><StatusPill status={r.status} /></td>
                <td>{r.statusSince ? <>{toLocalDisplay(String(r.statusSince), tz)}<div className="muted">{t('org.days', { n: daysSince(r.statusSince) })}</div></> : ''}</td>
                <td>{String(r.reason ?? '')}{r.authority ? <div className="muted">{t('org.set_by', { who: String(r.authority) })}</div> : null}</td>
                <td>{[r.opdefRef, r.opdefCategory].filter(Boolean).join(' · ')}</td>
                <td>{r.deploymentId ? <span className="pill sea" title={String(r.deploymentArea ?? '')}>{t('org.at_sea')}: {String(r.deploymentName)}</span> : <span className="muted">{t('org.alongside')}</span>}</td>
                <td className="actions">
                  {canRecord ? <button onClick={() => setRecording(r)}>{t('org.ship_status.change')}</button> : null}
                  <button onClick={() => setHistory(r)}>{t('org.ship_status.history')}</button>
                </td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={8} className="empty">{t('common.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>

      {recording ? (
        <FormModal
          title={t('org.ship_status.change_title', { name: String(recording.shipName) })}
          fields={fields}
          record={null}
          tz={tz}
          defaults={{ effectiveFrom: utcIsoToLocalInput(new Date().toISOString(), tz) }}
          submitKey="org.ship_status.record"
          extra={<p className="help">{t('org.ship_status.now', { status: t(`org.opstatus.${String(recording.status ?? 'none')}`) })}</p>}
          onClose={() => setRecording(null)}
          onSubmit={async (body) => { await api('POST', `${ORG}/ships/${recording.shipId}/status`, body); list.reload(); }}
        />
      ) : null}
      {history ? <StatusHistoryModal ship={history} onClose={() => { setHistory(null); list.reload(); }} /> : null}
    </section>
  );
}

function StatusHistoryModal({ ship, onClose }: { ship: Rec; onClose(): void }) {
  const { tz } = useSystem();
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ periods: Rec[]; voided: Rec[] } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [withdrawing, setWithdrawing] = useState<Rec | null>(null);
  useEffect(() => {
    let live = true;
    api<{ periods: Rec[]; voided: Rec[] }>('GET', `${ORG}/ships/${String(ship.shipId)}/status-history`).then((d) => live && setData(d), (e: Error) => live && setError(e));
    return () => { live = false; };
  }, [ship.shipId, tick]);
  const canVoid = can('org.ship_status.void');
  const now = new Date().toISOString();
  return (
    <Modal title={t('org.ship_status.history_title', { name: String(ship.shipName) })} onClose={onClose} wide>
      <ErrorNotice error={error} />
      {data && data.periods.length === 0 ? <p>{t('org.ship_status.history_empty')}</p> : null}
      {data && data.periods.length > 0 ? (
        <div className="table-wrap"><table>
          <thead><tr>
            <th scope="col">{t('org.field.opstatus')}</th><th scope="col">{t('org.field.effectiveFrom')}</th><th scope="col">{t('org.field.effectiveTo')}</th>
            <th scope="col">{t('org.field.statusReason')}</th><th scope="col">{t('org.field.opdefRef')}</th><th scope="col" className="actions-col">{t('common.actions')}</th>
          </tr></thead>
          <tbody>
            {data.periods.map((p) => (
              <tr key={String(p.eventId)}>
                <td><StatusPill status={p.status} /> {String(p.effectiveFrom) > now ? <span className="chip warn">{t('org.planned')}</span> : null}</td>
                <td>{toLocalDisplay(String(p.effectiveFrom), tz)}</td>
                <td>{p.effectiveTo ? toLocalDisplay(String(p.effectiveTo), tz) : ''}</td>
                <td>{String(p.reason ?? '')}{p.authority ? <div className="muted">{t('org.set_by', { who: String(p.authority) })}</div> : null}</td>
                <td>{[p.opdefRef, p.opdefCategory].filter(Boolean).join(' · ')}</td>
                <td className="actions">{canVoid ? <button className="link-danger" onClick={() => setWithdrawing(p)}>{t('org.ship_status.withdraw')}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}
      {data && data.voided.length > 0 ? (
        <>
          <h3>{t('org.ship_status.withdrawn')}</h3>
          <ul className="plain">
            {data.voided.map((v) => <li key={String(v.eventId)}><StatusPill status={v.status} /> {toLocalDisplay(String(v.effectiveFrom), tz)} — <span className="muted">{String(v.voidReason ?? '')}</span></li>)}
          </ul>
        </>
      ) : null}
      {withdrawing ? (
        <ReasonModal
          title={t('org.ship_status.withdraw_title')}
          confirmKey="org.ship_status.withdraw"
          onClose={() => setWithdrawing(null)}
          onConfirm={async (reason) => { await api('POST', `${ORG}/ship-status-events/${withdrawing.eventId}/void`, { reason }); setTick((x) => x + 1); }}
        />
      ) : null}
    </Modal>
  );
}
