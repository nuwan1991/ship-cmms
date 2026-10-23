import { parseArgs } from 'node:util';
import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { denyAllAuthorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from '../m01-organization/index.js';
import { AST_ENTITIES } from './entities.js';
import { ensureTagSequence, grantTagRange, seedDemoAssets } from './seed.js';

/**
 *   npm run asset-tags -- setup [--prefix SLN-EQ] [--width 8] [--size 1000]   hub: define the sequence, grant the hub a range
 *   npm run asset-tags -- grant --installation <id> --size 500                 hub: grant another installation a range
 *   npm run seed:demo-assets                                                    hub: demo classifications, positions, assets
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
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Asset setup' } }, correlationId: uuidv7() };

const cmd = values.demo ? 'demo' : positionals[0];
try {
  if (cmd === 'demo') {
    const r = seedDemoAssets({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' }, authz: denyAllAuthorizer });
    console.log(`Seeded demo assets: ${r.classifications} classifications, ${r.positions} positions, ${r.assets} assets`);
  } else if (cmd === 'setup') {
    ensureTagSequence(wctx, { ...(values.prefix ? { prefix: values.prefix } : {}), ...(values.width ? { width: Number(values.width) } : {}) });
    const g = grantTagRange(wctx, identity.installationId, Number(values.size ?? 1000));
    console.log(`Equipment tag numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${identity.code}`);
  } else if (cmd === 'grant' && values.installation) {
    const g = grantTagRange(wctx, values.installation, Number(values.size ?? 500));
    console.log(`Equipment tag numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${values.installation}`);
  } else {
    console.error('Usage: asset-tags setup [--prefix P --width N --size N] | grant --installation <id> --size N | --demo');
    process.exit(2);
  }
} finally {
  db.close();
}
