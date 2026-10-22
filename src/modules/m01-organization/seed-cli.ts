import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { denyAllAuthorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from './entities.js';
import { seedDemoOrganization } from './seed.js';

/** npm run seed:demo-org  - loads DEMO organization data into the hub database (never run on production data). */
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity || identity.kind !== 'hub') {
  console.error('Initialize a hub first: npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of ORG_ENTITIES) registry.register(d);
const result = seedDemoOrganization({
  wctx: { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Demo seed' } }, correlationId: uuidv7() },
  principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' },
  authz: denyAllAuthorizer,
});
console.log(`Seeded demo organization: ${result.commands} commands, ${result.ships} ships, ${result.locations} locations`);
db.close();
