import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { ORG_ENTITIES } from './entities.js';
import { allowAllAuthorizer } from './seed-authz.js';
import { ensureDefaultSections } from './service.js';

/**
 * npm run org-sections  - gives every ship at the hub the default sections (Electrical, Engineering, General) it does not have yet.
 * Safe to run again. New ships get them automatically; this is for ships created before sections existed.
 */
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity || identity.kind !== 'hub') {
  console.error('Ship sections are hub reference data; run this at the hub');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of ORG_ENTITIES) registry.register(d);
const r = ensureDefaultSections({
  wctx: { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Default ship sections' } }, correlationId: uuidv7() },
  principal: { userId: 'system', installationId: identity.installationId, displayName: 'Default ship sections' },
  authz: allowAllAuthorizer,
});
console.log(`Default sections: ${r.created} created across ${r.ships} ships`);
db.close();
