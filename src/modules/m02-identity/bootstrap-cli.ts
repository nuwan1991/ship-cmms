import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { EventBus } from '../../platform/events.js';
import { AuthorizerRegistry } from '../../platform/authz.js';
import { ApprovalPortRegistry } from '../../platform/ports.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { createFirstAdmin } from './bootstrap.js';
import { IDN_ENTITIES } from './entities.js';

/** npm run create-admin -- --username admin --name "Fleet Administrator" [--password ...]  (hub only, once). */
const { values } = parseArgs({ options: { username: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } } });
if (!values.username || !values.name) {
  console.error('Usage: npm run create-admin -- --username <name> --name "<Display name>" [--password <10+ chars>]');
  process.exit(2);
}
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
const registry = createPlatformRegistry();
for (const d of IDN_ENTITIES) registry.register(d);
const password = values.password ?? randomBytes(12).toString('base64url');
try {
  await createFirstAdmin({ db, config, entities: registry, authz: new AuthorizerRegistry(), approvals: new ApprovalPortRegistry(), events: new EventBus(), identity }, { username: values.username, password, displayName: values.name });
  console.log(`Created administrator "${values.username}".${values.password ? '' : ` Initial password (shown once, change it after signing in): ${password}`}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
