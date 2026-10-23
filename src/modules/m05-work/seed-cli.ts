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
import { WRK_ENTITIES } from './entities.js';
import { ensureWorkSequences, grantWorkRanges, seedDemoWork } from './seed.js';

/**
 *   npm run work-numbers -- setup [--width 8] [--size 1000]   hub: define the three sequences, grant the hub a range
 *   npm run work-numbers -- grant --installation <id> --size 500                hub: grant another installation a range
 *   npm run seed:demo-work                                                      hub: demo defects, a repair case and a work order
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
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...WRK_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Work setup' } }, correlationId: uuidv7() };

const cmd = values.demo ? 'demo' : positionals[0];
try {
  if (cmd === 'demo') {
    const r = seedDemoWork({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' }, authz: denyAllAuthorizer });
    console.log(`Seeded demo work: ${r.defects} defects, ${r.repairCases} repair case, ${r.workOrders} work order, ${r.advisories} advisory`);
  } else if (cmd === 'setup') {
    ensureWorkSequences(wctx, { ...(values.width ? { width: Number(values.width) } : {}) });
    grantWorkRanges(wctx, identity.installationId, Number(values.size ?? 1000));
    console.log(`Defect, repair case and work order numbers granted to ${identity.code}`);
  } else if (cmd === 'grant' && values.installation) {
    grantWorkRanges(wctx, values.installation, Number(values.size ?? 500));
    console.log(`Defect, repair case and work order numbers granted to ${values.installation}`);
  } else {
    console.error('Usage: work-numbers setup [--width N --size N] | grant --installation <id> --size N | --demo');
    process.exit(2);
  }
} finally {
  db.close();
}
