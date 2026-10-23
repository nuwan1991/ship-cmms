import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { moduleRegistrations } from './modules/index.js';
import { upgradeWithBackup } from './modules/m14-operations/index.js';
import type { AppContext, Config } from './platform/app-context.js';
import { AuthorizerRegistry, devAllowAllAuthorizer } from './platform/authz.js';
import { openDatabase } from './platform/db/open.js';
import { createPlatformRegistry } from './platform/entity-registry.js';
import { EventBus } from './platform/events.js';
import { getLocalIdentity } from './platform/identity.js';
import { ApprovalPortRegistry, ImportExportRegistry } from './platform/ports.js';
import { verifySyncedTables } from './platform/records.js';

/**
 * Composition root: open DB, migrate, register modules, then verify. Fails closed:
 * without a real Authorizer (M02) startup is refused unless dev mode is explicit.
 */
export function boot(config: Config): { ctx: AppContext; app: FastifyInstance } {
  const db = openDatabase(config.dbFile);
  // Existing data is backed up before any database change (ARCHITECTURE: upgrades are always preceded by a backup).
  upgradeWithBackup(db, config.dataDir, config.dbFile === ':memory:');

  const authz = new AuthorizerRegistry();
  if (config.devAuth) authz.register(devAllowAllAuthorizer);

  const ctx: AppContext = {
    db,
    config,
    entities: createPlatformRegistry(),
    authz,
    approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(),
    events: new EventBus(),
    identity: getLocalIdentity(db),
  };

  const app = buildApp(ctx);
  for (const m of moduleRegistrations) m.register(ctx, app);

  if (!config.devAuth) authz.assertProductionReady();
  const problems = [...ctx.entities.validate(), ...verifySyncedTables(db, ctx.entities)];
  if (problems.length) throw new Error(`Schema/registry problems:\n  ${problems.join('\n  ')}`);
  return { ctx, app };
}
