import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { INSTALLATION_KINDS, type InstallationKind } from './contracts.js';
import { applyMigrations, discoverMigrations } from './db/migrate.js';
import { openDatabase } from './db/open.js';
import { createPlatformRegistry } from './entity-registry.js';
import { setLocalIdentity } from './identity.js';
import { createRecord } from './records.js';
import { uuidv7 } from './ids.js';

const { values } = parseArgs({
  options: { kind: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' } },
});
if (!values.kind || !values.code || !values.name || !INSTALLATION_KINDS.includes(values.kind as InstallationKind)) {
  console.error(`Usage: npm run init-installation -- --kind <${INSTALLATION_KINDS.join('|')}> --code <CODE> --name "<Name>" [--id <uuid from hub>]`);
  process.exit(2);
}
const db = openDatabase(loadConfig().dbFile);
applyMigrations(db, discoverMigrations());
const identity = setLocalIdentity(db, { kind: values.kind as InstallationKind, code: values.code, name: values.name, ...(values.id ? { installationId: values.id } : {}) });
if (identity.kind === 'hub') {
  createRecord(
    { db, registry: createPlatformRegistry(), installation: identity, actor: { userId: 'system' }, correlationId: uuidv7() },
    'sys.installation',
    { id: identity.installationId, kind: 'hub', code: identity.code, name: identity.name },
  );
}
console.log(`Initialized ${identity.kind} installation ${identity.code} (${identity.installationId})`);
db.close();
