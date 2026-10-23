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
import { QR_ENTITIES } from './entities.js';
import { ensureLabelSequence, grantLabelRange, seedDemoSurvey } from './seed.js';

/**
 *   npm run label-numbers -- setup [--prefix SLN-LB] [--width 8] [--size 1000]   hub: define the sequence, grant the hub a range
 *   npm run label-numbers -- grant --installation <id> --size 500                hub: grant another installation a range
 *   npm run seed:demo-survey                                                      hub: demo template, labels and one open survey
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
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...QR_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Label setup' } }, correlationId: uuidv7() };

const cmd = values.demo ? 'demo' : positionals[0];
try {
  if (cmd === 'demo') {
    const r = seedDemoSurvey({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Demo seed' }, authz: denyAllAuthorizer });
    console.log(`Seeded demo survey: ${r.templates} template, ${r.labels} labels, ${r.surveys} survey, ${r.items} items`);
  } else if (cmd === 'setup') {
    ensureLabelSequence(wctx, { ...(values.prefix ? { prefix: values.prefix } : {}), ...(values.width ? { width: Number(values.width) } : {}) });
    const g = grantLabelRange(wctx, identity.installationId, Number(values.size ?? 1000));
    console.log(`Label numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${identity.code}`);
  } else if (cmd === 'grant' && values.installation) {
    const g = grantLabelRange(wctx, values.installation, Number(values.size ?? 500));
    console.log(`Label numbers ${String(g.range_start)}–${String(g.range_end)} granted to ${values.installation}`);
  } else {
    console.error('Usage: label-numbers setup [--prefix P --width N --size N] | grant --installation <id> --size N | --demo');
    process.exit(2);
  }
} finally {
  db.close();
}
