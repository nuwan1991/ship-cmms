import { buildApp } from '../../src/app.js';
import type { AppContext } from '../../src/platform/app-context.js';
import { AuthorizerRegistry } from '../../src/platform/authz.js';
import { applyMigrations, discoverMigrations } from '../../src/platform/db/migrate.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { createPlatformRegistry } from '../../src/platform/entity-registry.js';
import { EventBus } from '../../src/platform/events.js';
import { setLocalIdentity } from '../../src/platform/identity.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { ApprovalPortRegistry, ImportExportRegistry } from '../../src/platform/ports.js';
import { createRecord, updateRecord, type WriteContext } from '../../src/platform/records.js';
import { register as m01 } from '../../src/modules/m01-organization/index.js';
import { register as m02 } from '../../src/modules/m02-identity/index.js';
import { register as m10 } from '../../src/modules/m10-sync/index.js';
import { handleHello, handlePull, handlePush, joinHub, provisionPeer, type ProvisioningPackage, type Transport } from '../../src/modules/m10-sync/engine.js';
import { allowAll } from './org-helpers.js';

export interface Node {
  ctx: AppContext;
  app: ReturnType<typeof buildApp>;
  wctx(): WriteContext;
  rows(sql: string, ...p: unknown[]): Array<Record<string, any>>;
}

export function makeShipNode(): Node { return node(); }

function node(): Node {
  const db = openDatabase(':memory:');
  applyMigrations(db, discoverMigrations());
  const ctx: AppContext = {
    db, config: { dataDir: '', dbFile: ':memory:', host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: true },
    entities: createPlatformRegistry(), authz: new AuthorizerRegistry(), approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(), events: new EventBus(), identity: null,
  };
  ctx.authz.register(allowAll);
  const app = buildApp(ctx);
  m01(ctx, app);
  m02(ctx, app);
  m10(ctx, app);
  return {
    ctx, app,
    wctx: () => ({ db, registry: ctx.entities, installation: ctx.identity!, actor: { userId: 'tester' }, correlationId: uuidv7() }),
    rows: (sql, ...p) => db.prepare(sql).all(...p) as Array<Record<string, any>>,
  };
}

export function makeHub(): Node {
  const n = node();
  n.ctx.identity = setLocalIdentity(n.ctx.db, { kind: 'hub', code: 'HQ', name: 'Fleet HQ' });
  createRecord(n.wctx(), 'sys.installation', { id: n.ctx.identity.installationId, kind: 'hub', code: 'HQ', name: 'Fleet HQ', status: 'active' });
  return n;
}

/** Direct call from a replica to the hub's handlers (what HTTP would carry). */
export const directTransport = (hub: Node, tap?: (path: string) => void): Transport => async (path, env) => {
  tap?.(path);
  return path === 'hello' ? handleHello(hub.ctx, env) : path === 'push' ? handlePush(hub.ctx, env) : handlePull(hub.ctx, env);
};

export interface Fleet { hub: Node; fleetId: string; shipAId: string; shipBId: string }

/** A hub with a fleet and two ships (org reference data). */
export function makeFleet(): Fleet {
  const hub = makeHub();
  const w = hub.wctx();
  const fleetId = createRecord(w, 'org.fleet', { code: 'F1', name: 'Fleet' }).id as string;
  const shipAId = createRecord(w, 'org.ship', { fleet_id: fleetId, code: 'SHA', name: 'Ship A', pennant_no: 'P1' }).id as string;
  const shipBId = createRecord(w, 'org.ship', { fleet_id: fleetId, code: 'SHB', name: 'Ship B', pennant_no: 'P2' }).id as string;
  return { hub, fleetId, shipAId, shipBId };
}

/** Provision a ship installation at the hub and join it (fresh database). */
export function addShip(hub: Node, code: string, scopeId: string | null, opts: { includeUnscopedHub?: boolean } = {}): { ship: Node; pkg: ProvisioningPackage } {
  const pkg = provisionPeer(hub.ctx, hub.wctx(), { kind: 'ship', code, name: `Ship ${code}`, scopes: scopeId ? [{ kind: 'ship', id: scopeId }] : [], includeUnscopedHub: opts.includeUnscopedHub ?? true });
  const ship = node();
  joinHub(ship.ctx, pkg, 'http://hub.invalid');
  return { ship, pkg };
}

export const addLocation = (n: Node, shipId: string, code: string, name = code): Record<string, unknown> =>
  createRecord(n.wctx(), 'org.location', { home_scope_id: shipId, site_kind: 'ship', code, name });

export const renameLocation = (n: Node, id: string, name: string): Record<string, unknown> => {
  const cur = n.rows('SELECT version FROM org_location WHERE id = ?', id)[0]!;
  return updateRecord(n.wctx(), 'org.location', id, cur.version, { name });
};
