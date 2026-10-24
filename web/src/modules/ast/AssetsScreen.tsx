import { useEffect, useState } from 'react';
import { api, type Rec } from '../../platform/api';
import { FormModal, type FieldDef, type Values } from '../../platform/form';
import { t } from '../../platform/i18n';
import { can } from '../../platform/permissions';
import { ReasonModal } from '../../platform/reason';
import { useSystem } from '../../platform/system';
import { toLocalDisplay } from '../../platform/time';
import { ErrorNotice, FreshnessBanner, Modal } from '../../platform/ui';
import { useList } from '../../platform/useList';
import { AST, ORG, optionLabel } from './binding';

export const ASSET_STATUSES = ['in_service', 'in_store', 'under_repair', 'out_of_service', 'condemned'] as const;
export const PARTY_KINDS = ['command', 'ship', 'department', 'workshop', 'external_provider'] as const;
const PARTY_PATH: Record<string, string> = { command: 'commands', ship: 'ships', department: 'departments', workshop: 'workshops', external_provider: 'providers' };

/** Turns the flat "custodyKind + custodyId" form pair into the API's { custody: { kind, id } } and drops blanks. */
export function buildMovementBody(kind: string, v: Record<string, unknown>): Record<string, unknown> {
  const { custodyKind, custodyId, ...rest } = v;
  const body: Record<string, unknown> = { kind };
  for (const [k, val] of Object.entries(rest)) if (val !== '' && val !== undefined && val !== null) body[k] = val;
  if (custodyKind && custodyId) body.custody = { kind: custodyKind, id: custodyId };
  return body;
}

const opts = (items: Rec[]) => items.map((r) => ({ value: String(r.id), label: optionLabel(r) }));
const statusOpts = () => ASSET_STATUSES.map((s) => ({ value: s, label: t(`ast.astatus.${s}`) }));

function useParties() {
  const lists = {
    command: useList(`${ORG}/commands`), ship: useList(`${ORG}/ships`), department: useList(`${ORG}/departments`),
    workshop: useList(`${ORG}/workshops`), external_provider: useList(`${ORG}/providers`),
  };
  const options = (kind: string) => opts(lists[kind as keyof typeof lists]?.items ?? []);
  const name = (kind: unknown, id: unknown) => { const r = lists[kind as keyof typeof lists]?.items.find((x) => x.id === id); return r ? optionLabel(r) : String(id ?? ''); };
  return { options, name, ships: lists.ship.items, workshops: lists.workshop.items };
}

/** Physical locations (decks, compartments, stores) of every ship and workshop, labelled "SITE · Deck 2 / Engine room". */
function useLocations(parties: ReturnType<typeof useParties>) {
  const list = useList(`${ORG}/locations`, { limit: '500' });
  const byId = new Map(list.items.map((l) => [String(l.id), l]));
  const site = (id: unknown) => [...parties.ships, ...parties.workshops].find((x) => x.id === id);
  const name = (id: unknown): string => {
    const parts: string[] = [];
    for (let l = byId.get(String(id)), guard = 0; l && guard < 20; l = l.parentId ? byId.get(String(l.parentId)) : undefined, guard++) parts.unshift(String(l.name));
    const first = byId.get(String(id));
    if (!first) return id ? String(id) : '';
    const s = site(first.homeScopeId);
    return `${s ? `${String(s.code)} · ` : ''}${parts.join(' / ')}`;
  };
  const options = () => list.items.map((l) => ({ value: String(l.id), label: name(l.id) })).sort((a, b) => a.label.localeCompare(b.label));
  return { name, options };
}

/** `relocate` is a status_change that keeps the current status and only records a new location. */
type MoveKind = 'install' | 'remove' | 'custody_transfer' | 'status_change' | 'relocate' | 'void';

function AssetDetail({ assetId, onClose, onChanged }: { assetId: string; onClose(): void; onChanged(): void }) {
  const { tz } = useSystem();
  const parties = useParties();
  const locations = useLocations(parties);
  const [asset, setAsset] = useState<Rec | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  const history = useList(`${AST}/assets/${assetId}/movements`, { limit: '100' });
  const positions = useList(`${AST}/positions`, { limit: '500' });
  const [move, setMove] = useState<MoveKind | null>(null);
  const [voiding, setVoiding] = useState<Rec | null>(null);
  const reloadAsset = () => api<Rec>('GET', `${AST}/assets/${assetId}`).then(setAsset, setErr);
  useEffect(() => { void reloadAsset(); }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = (asset?.state ?? null) as Rec | null;
  const posName = (id: unknown) => { const p = positions.items.find((x) => x.id === id); return p ? `${String(p.positionTag)} – ${String(p.name)}` : id ? String(id) : ''; };
  const mayMove = can('ast.asset_movement.create');
  const done = () => { void reloadAsset(); history.reload(); onChanged(); };

  const custodyFields: FieldDef[] = [
    { key: 'custodyKind', labelKey: 'ast.field.custodyKind', type: 'select', options: PARTY_KINDS.map((k) => ({ value: k, label: t(`ast.party.${k}`) })) },
    { key: 'custodyId', labelKey: 'ast.field.custodyParty', type: 'select', options: (v: Values) => parties.options(String(v.custodyKind ?? '')) },
  ];
  const locationField: FieldDef = { key: 'locationId', labelKey: 'ast.field.location', type: 'select', hintKey: 'ast.hint.location', options: locations.options() };
  const common: FieldDef[] = [
    locationField,
    { key: 'occurredAt', labelKey: 'ast.field.occurredAt', type: 'datetime', hintKey: 'ast.hint.occurredAt' },
    { key: 'note', labelKey: 'ast.field.note', type: 'textarea', maxLength: 500 },
  ];
  const fieldsFor = (k: MoveKind): FieldDef[] => {
    switch (k) {
      case 'install': return [{ key: 'positionId', labelKey: 'ast.field.position', type: 'select', required: true, options: opts(positions.items.map((p) => ({ ...p, code: p.positionTag }))) }, ...common];
      case 'remove': return [{ key: 'assetStatus', labelKey: 'ast.field.assetStatus', type: 'select', options: statusOpts() }, ...custodyFields, ...common];
      case 'custody_transfer': return [...custodyFields.map((f) => ({ ...f, required: true })), ...common];
      case 'status_change': return [{ key: 'assetStatus', labelKey: 'ast.field.assetStatus', type: 'select', required: true, options: statusOpts() }, ...common];
      case 'relocate': return [{ ...locationField, required: true, hintKey: 'ast.hint.relocate' }, ...common.slice(1)];
      default: return common;
    }
  };

  return (
    <Modal title={asset ? `${String(asset.assetTag)} – ${String(asset.name)}` : t('common.loading')} onClose={onClose} wide>
      <ErrorNotice error={err ?? history.error} />
      {asset ? (
        <dl className="facts">
          <dt>{t('ast.field.assetStatus')}</dt><dd>{state?.assetStatus ? t(`ast.astatus.${String(state.assetStatus)}`) : '—'}</dd>
          <dt>{t('ast.field.position')}</dt><dd>{asset.installation ? posName((asset.installation as Rec).positionId) : t('ast.detail.not_installed')}</dd>
          <dt>{t('ast.field.location')}</dt><dd>{asset.location ? locations.name((asset.location as Rec).id) : '—'}</dd>
          <dt>{t('ast.field.custodyParty')}</dt><dd>{state?.custody ? parties.name((state.custody as Rec).kind, (state.custody as Rec).id) : '—'}</dd>
          <dt>{t('ast.field.serialNumber')}</dt><dd>{String(asset.serialNumber ?? '')}</dd>
          <dt>{t('ast.field.manufacturer')}</dt><dd>{[asset.manufacturer, asset.model].filter(Boolean).join(' ')}</dd>
        </dl>
      ) : null}
      {mayMove ? (
        <div className="tools">
          {asset?.installation ? <button onClick={() => setMove('remove')}>{t('ast.move.remove')}</button> : <button onClick={() => setMove('install')}>{t('ast.move.install')}</button>}
          <button onClick={() => setMove('custody_transfer')}>{t('ast.move.custody_transfer')}</button>
          <button onClick={() => setMove('status_change')}>{t('ast.move.status_change')}</button>
          <button onClick={() => setMove('relocate')}>{t('ast.move.relocate')}</button>
        </div>
      ) : null}
      <h3>{t('ast.detail.history')}</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">{t('ast.field.occurredAt')}</th><th scope="col">{t('ast.field.movement')}</th><th scope="col">{t('ast.field.details')}</th><th scope="col">{t('ast.field.note')}</th><th scope="col" className="actions-col">{t('common.actions')}</th></tr></thead>
          <tbody>
            {history.items.map((m) => (
              <tr key={m.id} className={m.voided ? 'voided' : undefined}>
                <td>{toLocalDisplay(String(m.occurredAt), tz)}</td>
                <td>{t(`ast.move.${String(m.kind)}`)}{m.voided ? ` (${t('ast.move.voided')})` : ''}</td>
                <td>{[m.positionId ? posName(m.positionId) : '', m.locationId ? locations.name(m.locationId) : '', m.custodyPartyId ? parties.name(m.custodyPartyKind, m.custodyPartyId) : '', m.assetStatus ? t(`ast.astatus.${String(m.assetStatus)}`) : ''].filter(Boolean).join(' · ')}</td>
                <td>{String(m.note ?? '')}</td>
                <td className="actions">{mayMove && !m.voided && m.kind !== 'void' && m.kind !== 'register' ? <button className="link-danger" onClick={() => setVoiding(m)}>{t('ast.move.void')}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer><button onClick={onClose}>{t('common.close')}</button></footer>
      {move ? (
        <FormModal
          title={t(`ast.move.${move}`)} fields={fieldsFor(move)} record={null} tz={tz} submitKey="common.save" onClose={() => setMove(null)}
          onSubmit={async (body) => {
            const payload = move === 'relocate' ? buildMovementBody('status_change', { ...body, assetStatus: state?.assetStatus }) : buildMovementBody(move, body);
            await api('POST', `${AST}/assets/${assetId}/movements`, payload);
            done();
          }}
        />
      ) : null}
      {voiding ? (
        <ReasonModal
          title={t('ast.move.void_title')} confirmKey="ast.move.void" onClose={() => setVoiding(null)}
          onConfirm={async (note) => { await api('POST', `${AST}/assets/${assetId}/movements`, { kind: 'void', correctsMovementId: voiding.id, note }); done(); }}
        />
      ) : null}
    </Modal>
  );
}

/** Asset register: every physical item with its permanent tag, where it is installed, who holds it, and its history. */
export function AssetsScreen() {
  const { tz } = useSystem();
  const parties = useParties();
  const locations = useLocations(parties);
  const classes = useList(`${AST}/classifications`);
  const [q, setQ] = useState('');
  const [shipId, setShipId] = useState('');
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const list = useList(`${AST}/assets`, { q: q || undefined, homeShipId: shipId || undefined, status: status || undefined, locationId: locationId || undefined });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const mayCreate = can('ast.asset.create');
  useEffect(() => { if (mayCreate) api<{ remaining: number }>('GET', `${AST}/tag-ranges/remaining`).then((r) => setRemaining(r.remaining), () => setRemaining(null)); }, [mayCreate, list.items.length]);
  const positions = useList(creating ? `${AST}/positions` : null, { limit: '500' });

  const fields: FieldDef[] = [
    { key: 'name', labelKey: 'ast.field.name', type: 'text', required: true, maxLength: 120 },
    { key: 'classificationId', labelKey: 'ast.field.classification', type: 'select', options: opts(classes.items.filter((c) => c.kind === 'equipment')) },
    { key: 'homeShipId', labelKey: 'ast.field.homeShip', type: 'select', options: opts(parties.ships) },
    { key: 'serialNumber', labelKey: 'ast.field.serialNumber', type: 'text', maxLength: 80 },
    { key: 'manufacturer', labelKey: 'ast.field.manufacturer', type: 'text', maxLength: 120 },
    { key: 'model', labelKey: 'ast.field.model', type: 'text', maxLength: 120 },
    { key: 'assetStatus', labelKey: 'ast.field.assetStatus', type: 'select', options: statusOpts() },
    { key: 'locationId', labelKey: 'ast.field.location', type: 'select', hintKey: 'ast.hint.location', options: locations.options() },
    { key: 'positionId', labelKey: 'ast.field.position', type: 'select', hintKey: 'ast.hint.install_on_register', options: opts(positions.items.map((p) => ({ ...p, code: p.positionTag }))) },
    { key: 'notes', labelKey: 'ast.field.note', type: 'textarea', maxLength: 1000 },
  ];

  return (
    <section>
      <div className="page-head">
        <h1>{t('ast.title.assets')}</h1>
        <div className="tools">
          <input type="search" aria-label={t('common.search')} placeholder={t('ast.search')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select aria-label={t('ast.field.homeShip')} value={shipId} onChange={(e) => setShipId(e.target.value)}>
            <option value="">{t('ast.filter.all_ships')}</option>
            {opts(parties.ships).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select aria-label={t('ast.field.assetStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('ast.filter.all_status')}</option>
            {statusOpts().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select aria-label={t('ast.field.location')} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">{t('ast.filter.all_locations')}</option>
            {locations.options().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {mayCreate ? <button className="primary" onClick={() => setCreating(true)}>{t('ast.new.asset')}</button> : null}
        </div>
      </div>
      {remaining !== null && remaining < 50 ? <p role="alert" className="notice warn">{remaining === 0 ? t('ast.tags.none_left') : t('ast.tags.low', { n: String(remaining) })}</p> : null}
      <FreshnessBanner freshness={list.freshness} />
      <ErrorNotice error={list.error} />
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th scope="col">{t('ast.field.assetTag')}</th><th scope="col">{t('ast.field.name')}</th><th scope="col">{t('ast.field.classification')}</th>
            <th scope="col">{t('ast.field.position')}</th><th scope="col">{t('ast.field.location')}</th><th scope="col">{t('ast.field.assetStatus')}</th><th scope="col">{t('ast.field.custodyParty')}</th>
          </tr></thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={String(r.assetId)}>
                <td><button className="link" onClick={() => setOpen(String(r.assetId))}>{String(r.assetTag)}</button></td>
                <td>{String(r.name)}</td><td>{String(r.classificationName ?? '')}</td>
                <td>{r.positionTag ? `${String(r.positionTag)} – ${String(r.positionName)}` : t('ast.detail.not_installed')}</td>
                <td>{r.locationId ? locations.name(r.locationId) : ''}</td>
                <td>{r.assetStatus ? t(`ast.astatus.${String(r.assetStatus)}`) : ''}</td>
                <td>{r.custodyPartyId ? parties.name(r.custodyPartyKind, r.custodyPartyId) : ''}</td>
              </tr>
            ))}
            {!list.loading && list.items.length === 0 ? <tr><td colSpan={7} className="empty">{t('ast.assets.empty')}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {list.hasMore ? <button onClick={list.loadMore}>{t('common.more')}</button> : null}
      {open ? <AssetDetail assetId={open} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
      {creating ? (
        <FormModal
          title={t('ast.new.asset')} fields={fields} record={null} tz={tz} submitKey="common.create" onClose={() => setCreating(false)}
          onSubmit={async (body) => { await api('POST', `${AST}/assets`, body); list.reload(); }}
        />
      ) : null}
    </section>
  );
}
