import type { AppContext } from '../../src/platform/app-context.js';
import { AuthorizerRegistry, devAllowAllAuthorizer, type Authorizer } from '../../src/platform/authz.js';
import { applyMigrations, discoverMigrations } from '../../src/platform/db/migrate.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { createPlatformRegistry } from '../../src/platform/entity-registry.js';
import { ApprovalPortRegistry, ImportExportRegistry } from '../../src/platform/ports.js';
import { EventBus } from '../../src/platform/events.js';
import { setLocalIdentity, type LocalIdentity } from '../../src/platform/identity.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { createRecord } from '../../src/platform/records.js';
import { register } from '../../src/modules/m01-organization/index.js';
import { makeActor, type Actor } from '../../src/modules/m01-organization/actor.js';
import { createEntity } from '../../src/modules/m01-organization/service.js';
import { buildApp } from '../../src/app.js';

export const allowAll: Authorizer = { name: 'test-allow', check: () => ({ allowed: true }) };
export const denyOnly = (...denied: string[]): Authorizer => ({
  name: 'test-deny',
  check: (_p, permission) => (denied.includes(permission) ? { allowed: false, reason: `no ${permission}` } : { allowed: true }),
});

export interface OrgEnv {
  ctx: AppContext;
  hub: LocalIdentity;
  /** Actor at the hub installation (same database: tests simulate other installations by switching identity). */
  hubActor(authz?: Authorizer): Actor;
  /** Actor at a ship installation serving `siteId` (a sys_installation row with org_unit_id is created). */
  shipActor(siteId: string | null, authz?: Authorizer): Actor;
  app: ReturnType<typeof buildApp>;
}

export function makeOrgEnv(opts: { devAuth?: boolean } = {}): OrgEnv {
  const db = openDatabase(':memory:');
  applyMigrations(db, discoverMigrations());
  const hub = setLocalIdentity(db, { kind: 'hub', code: 'HQ', name: 'Fleet HQ' });
  const ctx: AppContext = {
    db,
    config: { dataDir: '', dbFile: ':memory:', host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: opts.devAuth ?? false },
    entities: createPlatformRegistry(),
    authz: new AuthorizerRegistry(),
    approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(),
    events: new EventBus(),
    identity: hub,
  };
  if (opts.devAuth) {
    process.env.CMMS_DEV_AUTH = '1';
    ctx.authz.register(devAllowAllAuthorizer);
  } else {
    ctx.authz.register(allowAll);
  }
  const app = buildApp(ctx);
  register(ctx, app);
  createRecord(
    { db, registry: ctx.entities, installation: hub, actor: { userId: 'system' }, correlationId: uuidv7() },
    'sys.installation',
    { id: hub.installationId, kind: 'hub', code: 'HQ', name: 'Fleet HQ' },
  );
  const principal = { userId: 'tester', installationId: hub.installationId, displayName: 'Test User' };
  return {
    ctx,
    hub,
    app,
    hubActor: (authz = allowAll) => ({ ...makeActor(ctx, principal), authz }),
    shipActor: (siteId, authz = allowAll) => {
      const ship: LocalIdentity = { installationId: uuidv7(), kind: 'ship', code: `S-${siteId?.slice(-4) ?? 'X'}`, name: 'Ship installation' };
      createRecord(
        { db, registry: ctx.entities, installation: hub, actor: { userId: 'system' }, correlationId: uuidv7() },
        'sys.installation',
        { id: ship.installationId, kind: 'ship', code: ship.code + uuidv7().slice(-6), name: ship.name, org_unit_kind: 'ship', org_unit_id: siteId },
      );
      const a = makeActor(ctx, { ...principal, installationId: ship.installationId });
      return { ...a, wctx: { ...a.wctx, installation: ship }, authz };
    },
  };
}

export interface Seeded {
  fleetId: string;
  commandIds: string[];
  shipId: string;
}

/** Minimal graph at the hub: one fleet, three commands, one ship (unattached). */
export function seedBasics(env: OrgEnv): Seeded {
  const a = env.hubActor();
  const fleet = createEntity(a, 'fleet', { code: 'F1', name: 'Fleet' });
  const commandIds = ['C1', 'C2', 'C3'].map((c) => createEntity(a, 'command', { code: c, name: `Command ${c}` }).id as string);
  const ship = createEntity(a, 'ship', { code: 'SH1', name: 'Ship One', pennantNo: 'P1' });
  return { fleetId: fleet.id as string, commandIds, shipId: ship.id as string };
}
