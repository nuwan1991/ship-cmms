import { parseArgs } from 'node:util';
import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { denyAllAuthorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from '../m01-organization/index.js';
import { AST_ENTITIES } from '../m03-assets/index.js';
import { STK_ENTITIES } from './entities.js';
import { ensureStoreSequence, grantStoreRange, seedDemoStores } from './seed.js';

/**
 *   npm run store-numbers -- setup [--prefix SLN-LB] [--width 8] [--size 1000]   hub: define the transfer sequence, grant the hub a range
 *   npm run store-numbers -- grant --installation <id> --size 500                hub: grant another installation a range
 *   npm run seed:demo-stores                                                      hub: demo parts, two stores and a transfer in transit
 */
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { prefix: { type: 'string' }, width: { type: 'string' }, size: { type: 'string' }, installation: { type: 'string' }, demo: { type: 'boolean' } },
});
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity || identity.kind !== 'hub') {
  console.error('Run this at an initialized hub: npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...STK_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Store setup' } }, correlationId: uuidv7() };

const cmd = values.demo ? 'demo' : positionals[0];
try {
  if (cmd === 'demo') {
    const r = seedDemoStores({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' }, authz: denyAllAuthorizer });
    console.log(`Seeded demo stores: ${r.parts} parts, ${r.locations} locations, ${r.transactions} transactions, ${r.transfers} transfer`);
  } else if (cmd === 'setup') {
    ensureStoreSequence(wctx, { ...(values.prefix ? { prefix: values.prefix } : {}), ...(values.width ? { width: Number(values.width) } : {}) });
    const g = grantStoreRange(wctx, identity.installationId, Number(values.size ?? 1000));
    console.log(`Transfer numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${identity.code}`);
  } else if (cmd === 'grant' && values.installation) {
    const g = grantStoreRange(wctx, values.installation, Number(values.size ?? 500));
    console.log(`Transfer numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${values.installation}`);
  } else {
    console.error('Usage: store-numbers setup [--prefix P --width N --size N] | grant --installation <id> --size N | --demo');
    process.exit(2);
  }
} finally {
  db.close();
}
