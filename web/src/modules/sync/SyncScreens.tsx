import { useEffect, useState } from 'react';
import { api, apiDownload, saveBlob, type Rec } from '../../platform/api';
import { FormModal, type FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { Modal, ErrorNotice } from '../../platform/ui';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { useList } from '../../platform/useList';

export const SYN = '/api/v1/sync';
const ORG = '/api/v1/org';

interface PeerRow { installationId: string; role: string; kind: string; code: string; name: string; status: string; url: string | null; lastSyncAt: string | null; skewMs: number | null; skewWarning: boolean; stale: boolean; pendingOutbound?: number; scopes: Array<{ kind: string; id: string }>; includeUnscopedHub: boolean }
interface Status { installation: { kind: string; code: string; name: string }; freshness: { asOf: string | null; stale: boolean }; pendingOutbound: number; openConflicts: number; peers: PeerRow[] }
interface RunReport { pushed: number; pulled: number; rejected: number; quarantined: number; skewMs: number; skewWarning: boolean }

export function StatusScreen() {
  const { tz } = useSystem();
  const [st, setSt] = useState<Status | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const sessions = useList(`${SYN}/sessions`);
  const reload = () => api<Status>('GET', `${SYN}/status`).then(setSt, (e: Error) => setError(e));
  useEffect(() => { void reload(); }, []);
  const replica = st && st.installation.kind !== 'hub';
  const hub = st?.peers.find((p) => p.role === 'hub');

  async function run(url: string) {
    setBusy(true); setNotice(''); setError(null);
    try {
      const r = await api<RunReport>('POST', `${SYN}/run`, url ? { url } : {});
      setNotice(t('syn.run.done', { pushed: String(r.pushed), pulled: String(r.pulled), rejected: String(r.rejected), quarantined: String(r.quarantined) }) + (r.skewWarning ? ` ${t('syn.run.skew', { seconds: String(Math.round(r.skewMs / 1000)) })}` : ''));
      void reload(); sessions.reload();
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <section>
      <div className="page-head">
        <h1>{t('syn.title.status')}</h1>
        <div className="tools">{replica && can('syn.session.run') ? <button className="primary" disabled={busy} onClick={() => (hub?.url ? void run('') : setAsking(true))}>{t('syn.act.run')}</button> : null}</div>
      </div>
      <ErrorNotice error={error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      {st ? (
        <>
          <p><strong>{t('syn.me')}:</strong> {st.installation.code} – {st.installation.name} ({t(`syn.kind.${st.installation.kind}`)})</p>
          {replica ? <p>{st.freshness.asOf ? toLocalDisplay(st.freshness.asOf, tz) : t('syn.never')}{st.freshness.stale ? ` · ${t('syn.stale')}` : ''} · {t('syn.pending_outbound', { count: String(st.pendingOutbound) })}</p> : null}
          <p>{t('syn.open_conflicts', { count: String(st.openConflicts) })}</p>
        </>
      ) : null}
      <h2>{t('syn.sessions')}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('syn.sess.when')}</th><th scope="col">{t('syn.sess.how')}</th><th scope="col">{t('syn.sess.counts')}</th></tr></thead>
        <tbody>{sessions.items.map((s) => (
          <tr key={s.id}><td>{toLocalDisplay(String(s.startedAt), tz)}</td><td>{t(`syn.dir.${String(s.direction)}`)}</td>
            <td>{s.error ? String(s.error) : `↑ ${String(s.pushed)} ✓ ${String(s.accepted)} = ${String(s.duplicates)} ✗ ${String(s.rejected)} ⏸ ${String(s.quarantined)} ↓ ${String(s.pulled)}`}</td></tr>
        ))}</tbody>
      </table></div>
      {asking ? (
        <FormModal title={t('syn.act.run')} fields={[{ key: 'url', labelKey: 'syn.field.url', type: 'text', required: true, maxLength: 300, hintKey: 'syn.hint.url' }]} record={null} tz={tz} submitKey="syn.act.run" onClose={() => setAsking(false)}
          onSubmit={async (b) => { setAsking(false); await run(String(b.url)); }} />
      ) : null}
    </section>
  );
}

function ScopesModal({ peer, options, onClose, onSave }: { peer: PeerRow; options: Array<{ value: string; label: string }>; onClose(): void; onSave(ids: string[], unscoped: boolean): Promise<void> }) {
  const [ids, setIds] = useState<string[]>(peer.scopes.map((s) => s.id));
  const [unscoped, setUnscoped] = useState(peer.includeUnscopedHub);
  const [error, setError] = useState<Error | null>(null);
  return (
    <Modal title={t('syn.scopes.title', { name: peer.name })} onClose={onClose}>
      <ErrorNotice error={error} />
      <p className="hint">{t('syn.scopes.hint')}</p>
      {options.map((o) => (
        <label key={o.value} className="check"><input type="checkbox" checked={ids.includes(o.value)} onChange={(e) => setIds(e.target.checked ? [...ids, o.value] : ids.filter((x) => x !== o.value))} /> {o.label}</label>
      ))}
      <label className="check"><input type="checkbox" checked={unscoped} onChange={(e) => setUnscoped(e.target.checked)} /> {t('syn.field.unscoped')}</label>
      <footer>
        <button onClick={onClose}>{t('common.cancel')}</button>
        <button className="primary" onClick={() => { onSave(ids, unscoped).catch((e: Error) => setError(e)); }}>{t('common.save')}</button>
      </footer>
    </Modal>
  );
}

export function InstallationsScreen() {
  const { tz } = useSystem();
  const [peers, setPeers] = useState<PeerRow[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const ships = useList(`${ORG}/ships`, { limit: '500' });
  const [provisioning, setProvisioning] = useState(false);
  const [pkg, setPkg] = useState<Record<string, unknown> | null>(null);
  const [scoping, setScoping] = useState<PeerRow | null>(null);
  const [removing, setRemoving] = useState<PeerRow | null>(null);
  const load = () => api<{ items: PeerRow[] }>('GET', `${SYN}/peers`).then((r) => setPeers(r.items), (e: Error) => setError(e));
  useEffect(() => { void load(); }, []);
  const shipName = (id: string) => String(ships.items.find((s) => s.id === id)?.name ?? id);
  const shipOptions = ships.items.map((s) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` }));
  const fields: FieldDef[] = [
    { key: 'kind', labelKey: 'syn.field.kind', type: 'select', required: true, options: ['ship', 'workshop', 'command'].map((k) => ({ value: k, label: t(`syn.kind.${k}`) })) },
    { key: 'code', labelKey: 'syn.field.code', type: 'text', required: true, maxLength: 20, hintKey: 'syn.hint.code' },
    { key: 'name', labelKey: 'syn.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'shipId', labelKey: 'syn.field.ship', type: 'select', options: shipOptions, hintKey: 'syn.hint.ship' },
    { key: 'includeUnscopedHub', labelKey: 'syn.field.unscoped', type: 'checkbox' },
  ];
  return (
    <section>
      <div className="page-head">
        <h1>{t('syn.title.installations')}</h1>
        <div className="tools">{can('syn.peer.provision') ? <button className="primary" onClick={() => setProvisioning(true)}>{t('syn.act.provision')}</button> : null}</div>
      </div>
      <ErrorNotice error={error} />
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('syn.col.code')}</th><th scope="col">{t('syn.col.name')}</th><th scope="col">{t('syn.col.kind')}</th><th scope="col">{t('syn.col.status')}</th><th scope="col">{t('syn.col.last')}</th><th scope="col">{t('syn.col.clock')}</th><th scope="col">{t('syn.col.scopes')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>{peers.map((p) => (
          <tr key={p.installationId}>
            <td>{p.code}</td><td>{p.name}</td><td>{t(`syn.kind.${p.kind}`)}</td>
            <td><span className={`chip ${p.status === 'active' ? 'ok' : 'muted'}`}>{t(`syn.status.${p.status}`)}</span></td>
            <td>{p.lastSyncAt ? toLocalDisplay(p.lastSyncAt, tz) : t('syn.never')}{p.stale ? <> <span className="chip warn">{t('syn.stale')}</span></> : null}</td>
            <td>{p.skewMs === null ? '' : p.skewWarning ? <span className="chip warn">{t('syn.clock_bad', { seconds: String(Math.round(p.skewMs / 1000)) })}</span> : t('syn.clock_ok')}</td>
            <td>{p.scopes.map((s) => shipName(s.id)).join(', ')}</td>
            <td className="actions">
              {p.role === 'replica' && can('syn.subscription.update') && p.status !== 'decommissioned' ? <button onClick={() => setScoping(p)}>{t('syn.act.scopes')}</button> : null}
              {p.role === 'replica' && can('syn.peer.decommission') && p.status !== 'decommissioned' ? <button className="link-danger" onClick={() => setRemoving(p)}>{t('syn.act.decommission')}</button> : null}
            </td>
          </tr>
        ))}</tbody>
      </table></div>

      {provisioning ? (
        <FormModal title={t('syn.act.provision')} fields={fields} record={null} tz={tz} defaults={{ kind: 'ship', includeUnscopedHub: true }} submitKey="common.create" onClose={() => setProvisioning(false)}
          onSubmit={async (b) => {
            const { shipId, ...rest } = b;
            const made = await api<Record<string, unknown>>('POST', `${SYN}/peers`, { ...rest, scopes: shipId ? [{ kind: 'ship', id: shipId }] : [] });
            setPkg(made); void load();
          }} />
      ) : null}
      {pkg ? (
        <Modal title={t('syn.provision.title')} onClose={() => { setPkg(null); setProvisioning(false); }}>
          <p>{t('syn.provision.body')}</p>
          <p><small>{t('syn.provision.how')}</small></p>
          <footer><button className="primary" onClick={() => saveBlob(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }), `provision-${String((pkg.installation as { code: string }).code)}.json`)}>{t('syn.provision.save')}</button></footer>
        </Modal>
      ) : null}
      {scoping ? (
        <ScopesModal peer={scoping} options={shipOptions} onClose={() => setScoping(null)}
          onSave={async (ids, unscoped) => {
            await api('PUT', `${SYN}/peers/${scoping.installationId}/subscription`, { scopes: ids.map((id) => ({ kind: 'ship', id })), includeUnscopedHub: unscoped });
            setScoping(null); void load();
          }} />
      ) : null}
      {removing ? (
        <Modal title={t('syn.decommission.title', { name: removing.name })} onClose={() => setRemoving(null)}>
          <p>{t('syn.decommission.body')}</p>
          <footer>
            <button onClick={() => setRemoving(null)}>{t('common.cancel')}</button>
            <button className="primary" onClick={() => { api('POST', `${SYN}/peers/${removing.installationId}/decommission`, {}).then(() => { setRemoving(null); void load(); }, (e: Error) => { setRemoving(null); setError(e); }); }}>{t('syn.act.decommission')}</button>
          </footer>
        </Modal>
      ) : null}
    </section>
  );
}

export function ConflictsScreen() {
  const { tz } = useSystem();
  const [state, setState] = useState('open');
  const list = useList(`${SYN}/conflicts`, { status: state || undefined });
  const [deciding, setDeciding] = useState<Rec | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<Error | null>(null);
  async function retry() {
    try { const r = await api<{ retried: number; applied: number }>('POST', `${SYN}/conflicts/retry`, {}); setNotice(t('syn.retry.done', { applied: String(r.applied), retried: String(r.retried) })); setError(null); list.reload(); } catch (e) { setError(e as Error); }
  }
  return (
    <section>
      <div className="page-head">
        <h1>{t('syn.title.conflicts')}</h1>
        <div className="tools">
          <select aria-label={t('syn.cf.status')} value={state} onChange={(e) => setState(e.target.value)}>
            {['open', 'resolved', 'dismissed', ''].map((s) => <option key={s} value={s}>{s ? t(`syn.cstate.${s}`) : '—'}</option>)}
          </select>
          {can('syn.conflict.resolve') ? <button onClick={() => void retry()}>{t('syn.act.retry')}</button> : null}
        </div>
      </div>
      <ErrorNotice error={list.error ?? error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">{t('syn.cf.record')}</th><th scope="col">{t('syn.cf.problem')}</th><th scope="col">{t('syn.cf.when')}</th><th scope="col">{t('syn.cf.status')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
        <tbody>
          {list.items.map((c) => (
            <tr key={c.id}>
              <td>{String(c.entityType)}<br /><small>{String(c.entityId)} v{String(c.incomingVersion)}</small></td>
              <td>{t(`syn.code.${String(c.code)}`)}<br /><small>{String(c.detail)}</small></td>
              <td>{toLocalDisplay(String(c.detectedAt), tz)}</td>
              <td>{t(`syn.cstate.${String(c.status)}`)}{c.resolution ? <><br /><small>{String(c.resolution)}</small></> : null}</td>
              <td className="actions">{c.status === 'open' && can('syn.conflict.resolve') ? <button onClick={() => setDeciding(c)}>{t('syn.act.resolve')}</button> : null}</td>
            </tr>
          ))}
          {!list.loading && list.items.length === 0 ? <tr><td colSpan={5} className="empty">{t('syn.conflicts.empty')}</td></tr> : null}
        </tbody>
      </table></div>
      {deciding ? (
        <FormModal title={t('syn.resolve.title', { entity: String(deciding.entityType) })} fields={[
          { key: 'action', labelKey: 'syn.resolve.action', type: 'select', required: true, options: ['accept_incoming', 'keep_local', 'dismiss'].map((a) => ({ value: a, label: t(`syn.resolve.${a}`) })) },
          { key: 'note', labelKey: 'syn.resolve.note', type: 'textarea', required: true, maxLength: 500 },
        ]} record={null} tz={tz} defaults={{ action: 'keep_local' }} submitKey="syn.act.resolve" onClose={() => setDeciding(null)}
          onSubmit={async (b) => { await api('POST', `${SYN}/conflicts/${deciding.id}/resolve`, { action: b.action, note: b.note }); list.reload(); }} />
      ) : null}
    </section>
  );
}

export function BundlesScreen() {
  const { info } = useSystem();
  const hub = info?.installation?.kind === 'hub';
  const peers = useList(`${SYN}/peers`);
  const [peerId, setPeerId] = useState('');
  const [all, setAll] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function exportFile() {
    setBusy(true);
    try {
      const res = await apiDownload(`${SYN}/bundles/export`, 'POST', { ...(peerId ? { peerId } : {}), ...(all ? { all: true } : {}) });
      saveBlob(res.blob, res.fileName); setError(null);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setNotice('');
    try {
      const r = await api<{ accepted: number; duplicates: number; rejected: number; quarantined: number }>('POST', `${SYN}/bundles/import`, JSON.parse(await file.text()));
      setNotice(t('syn.bundle.result', { accepted: String(r.accepted), duplicates: String(r.duplicates), rejected: String(r.rejected), quarantined: String(r.quarantined) })); setError(null);
    } catch (e) { setError(e as Error); } finally { setBusy(false); }
  }
  return (
    <section>
      <div className="page-head"><h1>{t('syn.title.bundles')}</h1></div>
      <ErrorNotice error={error} />
      {notice ? <div className="banner info" role="status">{notice}</div> : null}
      {can('syn.bundle.export') ? (
        <fieldset>
          <legend>{hub ? t('syn.bundle.export_hub') : t('syn.bundle.export_replica')}</legend>
          {hub ? (
            <label>{t('syn.bundle.for')}
              <select value={peerId} onChange={(e) => setPeerId(e.target.value)}>
                <option value="">—</option>
                {peers.items.filter((p) => p.role === 'replica' && p.status !== 'decommissioned').map((p) => <option key={String(p.installationId)} value={String(p.installationId)}>{String(p.code)} – {String(p.name)}</option>)}
              </select>
            </label>
          ) : <label className="check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t('syn.bundle.emergency')}</label>}
          <button className="primary" disabled={busy || (hub && !peerId)} onClick={() => void exportFile()}>{hub ? t('syn.bundle.export_hub') : t('syn.bundle.export_replica')}</button>
        </fieldset>
      ) : null}
      {can('syn.bundle.import') ? (
        <fieldset>
          <legend>{t('syn.bundle.import')}</legend>
          <p className="hint">{t('syn.bundle.import_hint')}</p>
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
        </fieldset>
      ) : null}
    </section>
  );
}
