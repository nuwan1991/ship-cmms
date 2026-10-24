import { parseArgs } from 'node:util';
import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import type { Authorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from '../m01-organization/index.js';
import type { Actor } from './actor.js';
import { applyRemap, loadStandardCatalogue, remapPlan, retireLegacy } from './classification-merge.js';
import { AST_ENTITIES } from './entities.js';

/**
 * Standard classification catalogue and legacy merge (DECISIONS D62, CLASSIFICATION_MERGE.md). Run by the installation's
 * administrator at the console, so it acts as the system user; every change is audited with the reason "Classification merge".
 *
 *   npm run classifications -- load-standard        hub: create the standard electrical catalogue (safe to repeat)
 *   npm run classifications -- plan                 any installation: what the remap would change here
 *   npm run classifications -- remap [--apply]      any installation: re-point own positions and assets (dry run by default)
 *   npm run classifications -- retire [--apply]     hub: mark fully re-pointed legacy classifications inactive (dry run by default)
 */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { apply: { type: 'boolean' }, json: { type: 'boolean' } } });
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity) {
  console.error('This installation is not initialized (run init-installation)');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES]) registry.register(d);
const operator: Authorizer = { name: 'console-operator', check: () => ({ allowed: true }) };
const actor: Actor = {
  wctx: { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Classification merge' } }, correlationId: uuidv7() },
  principal: { userId: 'system', installationId: identity.installationId, displayName: 'Classification merge' },
  authz: operator,
};
const dryRun = values.apply !== true;
const print = (o: unknown, text: () => void) => (values.json ? console.log(JSON.stringify(o, null, 2)) : text());

try {
  const cmd = positionals[0];
  if (cmd === 'load-standard') {
    if (identity.kind !== 'hub') throw new Error('The standard catalogue is loaded at the hub; installations receive it by synchronization');
    const r = loadStandardCatalogue(actor);
    print(r, () => {
      console.log(`Standard catalogue ${r.version}: ${r.created.length} created, ${r.existing.length} already present`);
      for (const d of r.differences) console.log(`  differs: ${d.code} ${d.field} is "${d.current ?? ''}", standard "${d.standard ?? ''}" (left unchanged)`);
    });
  } else if (cmd === 'plan') {
    const p = remapPlan(db, identity.installationId);
    print(p, () => {
      console.log(`Automatic: ${p.auto.length}   needs a decision: ${p.manual.length}   owned by other installations: ${p.ownedElsewhere}`);
      for (const i of p.auto) console.log(`  auto    ${i.label}: ${i.fromCode} -> ${i.toCode ?? ''}`);
      for (const i of p.manual) console.log(`  decide  ${i.label}: ${i.fromCode} -> one of ${i.candidates.join(', ') || '(no standard class)'}`);
    });
  } else if (cmd === 'remap') {
    const r = applyRemap(actor, { dryRun });
    print(r, () => {
      console.log(`${dryRun ? 'Would re-point' : 'Re-pointed'} ${r.updated.length}; needs a decision ${r.manual.length}; failed ${r.failed.length}; owned elsewhere ${r.ownedElsewhere}`);
      for (const f of r.failed) console.log(`  failed  ${f.label}: ${f.error}`);
      if (dryRun) console.log('Dry run: nothing changed. Add --apply to make the changes.');
    });
  } else if (cmd === 'retire') {
    const r = retireLegacy(actor, { dryRun });
    print(r, () => {
      console.log(`${dryRun ? 'Would retire' : 'Retired'}: ${r.retired.join(', ') || 'none'}`);
      for (const s of r.stillInUse) console.log(`  still in use: ${s.code} (${s.positions} positions, ${s.assets} assets)`);
      if (dryRun) console.log('Dry run: nothing changed. Add --apply to make the changes.');
    });
  } else {
    console.error('Usage: classifications load-standard | plan | remap [--apply] | retire [--apply]  [--json]');
    process.exit(2);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
