import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { denyAllAuthorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from '../m01-organization/index.js';
import { AST_ENTITIES } from '../m03-assets/index.js';
import { WRK_ENTITIES } from '../m05-work/index.js';
import { PM_ENTITIES } from './entities.js';
import { seedDemoPm } from './seed.js';

/** npm run seed:demo-pm: demo task template, meter with readings, two plans, a calibration, and the work orders now due (needs work numbers). */
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity || identity.kind !== 'hub') {
  console.error('Run this at an initialized hub: npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...WRK_ENTITIES, ...PM_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Planned maintenance seed' } }, correlationId: uuidv7() };
try {
  const r = seedDemoPm({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' }, authz: denyAllAuthorizer });
  console.log(`Seeded demo planned maintenance: ${r.templates} template, ${r.meters} meter, ${r.plans} plans, ${r.workOrders} work order(s) generated`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
