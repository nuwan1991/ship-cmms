import { buildApp } from '../../src/app.js';
import type { AppContext } from '../../src/platform/app-context.js';
import { AuthorizerRegistry } from '../../src/platform/authz.js';
import { applyMigrations, discoverMigrations } from '../../src/platform/db/migrate.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { createPlatformRegistry } from '../../src/platform/entity-registry.js';
import { EventBus } from '../../src/platform/events.js';
import { setLocalIdentity, type LocalIdentity } from '../../src/platform/identity.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { ApprovalPortRegistry, ImportExportRegistry } from '../../src/platform/ports.js';
import { createRecord } from '../../src/platform/records.js';
import { register as m01 } from '../../src/modules/m01-organization/index.js';
import { register as m02 } from '../../src/modules/m02-identity/index.js';
import { makeActor, type Actor } from '../../src/modules/m02-identity/actor.js';
import { createFirstAdmin } from '../../src/modules/m02-identity/bootstrap.js';
import { setCredential } from '../../src/modules/m02-identity/auth.js';
import { createResource } from '../../src/modules/m02-identity/service.js';

export const ADMIN_PW = 'Harbour-Master-123';
export const USER_PW = 'Anchor-Chain-456';

export interface IdnEnv {
  ctx: AppContext;
  app: ReturnType<typeof buildApp>;
  hub: LocalIdentity;
  adminId: string;
  /** Actor for a user at the current installation; authorizer is the real one. */
  actor(userId: string): Actor;
  /** Create a user with a credential and a role holding `permissions` at `scope`; returns ids. */
  addUser(o: { username: string; displayName?: string; permissions?: string[]; scopeKind?: string; scopeId?: string | null; validFrom?: string; validUntil?: string | null; roleCode?: string }): Promise<{ userId: string; roleId: string; assignmentId: string }>;
  login(username: string, password?: string): Promise<string>;
  /** Flip this database into a ship installation (simulates provisioning); returns the ship's installation id. */
  becomeShip(opts?: { provision?: string[] }): LocalIdentity;
  call(token: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown): Promise<{ status: number; json: any }>;
}

export async function makeIdnEnv(): Promise<IdnEnv> {
  const db = openDatabase(':memory:');
  applyMigrations(db, discoverMigrations());
  const hub = setLocalIdentity(db, { kind: 'hub', code: 'HQ', name: 'Fleet HQ' });
  const ctx: AppContext = {
    db,
    config: { dataDir: '', dbFile: ':memory:', host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: false },
    entities: createPlatformRegistry(), authz: new AuthorizerRegistry(), approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(), events: new EventBus(), identity: hub,
  };
  const app = buildApp(ctx);
  m01(ctx, app);
  m02(ctx, app);
  createRecord({ db, registry: ctx.entities, installation: hub, actor: { userId: 'system' }, correlationId: uuidv7() }, 'sys.installation', { id: hub.installationId, kind: 'hub', code: 'HQ', name: 'Fleet HQ' });
  const admin = await createFirstAdmin(ctx, { username: 'admin', password: ADMIN_PW, displayName: 'Fleet Admin' });

  const env: IdnEnv = {
    ctx, app, hub, adminId: admin.userId,
    actor: (userId) => makeActor(ctx, { userId, installationId: ctx.identity!.installationId, displayName: userId }),
    async addUser(o) {
      const a = env.actor(admin.userId);
      const user = createResource(a, 'user', { displayName: o.displayName ?? o.username });
      await setCredential(a, ctx, user.id as string, { username: o.username, password: USER_PW });
      const role = createResource(a, 'role', { code: o.roleCode ?? `R-${o.username}`.toUpperCase(), name: `Role ${o.username}` });
      for (const p of o.permissions ?? []) createResource(a, 'role_permission', { roleId: role.id, permission: p });
      const asg = createResource(a, 'role_assignment', { userId: user.id, roleId: role.id, scopeKind: o.scopeKind ?? 'fleet', scopeId: o.scopeId ?? null, ...(o.validFrom ? { validFrom: o.validFrom } : {}), validUntil: o.validUntil ?? null });
      return { userId: user.id as string, roleId: role.id as string, assignmentId: asg.id as string };
    },
    async login(username, password = USER_PW) {
      const r = await app.inject({ method: 'POST', url: '/api/v1/identity/login', payload: { username, password } });
      if (r.statusCode !== 200) throw new Error(`login failed: ${r.body}`);
      return r.json().token as string;
    },
    becomeShip(opts = {}) {
      const id = uuidv7();
      createRecord({ db, registry: ctx.entities, installation: hub, actor: { userId: 'system' }, correlationId: uuidv7() }, 'sys.installation', { id, kind: 'ship', code: `S${id.slice(-6)}`, name: 'Test ship' });
      for (const userId of opts.provision ?? []) {
        createRecord({ db, registry: ctx.entities, installation: hub, actor: { userId: 'system' }, correlationId: uuidv7() }, 'idn.user_installation', { user_id: userId, installation_id: id });
      }
      db.prepare("UPDATE sys_local_identity SET kind = 'ship', installation_id = ?, code = 'SHIP1', name = 'Test ship' WHERE singleton = 1").run(id);
      ctx.identity = { installationId: id, kind: 'ship', code: 'SHIP1', name: 'Test ship' };
      return ctx.identity;
    },
    async call(token, method, url, payload) {
      const r = await app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}), headers: token ? { authorization: `Bearer ${token}` } : {} });
      return { status: r.statusCode, json: r.body ? r.json() : null };
    },
  };
  return env;
}

export const iso = (msFromNow: number): string => new Date(Date.now() + msFromNow).toISOString();
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
