import { parseArgs } from 'node:util';
import { loadConfig } from '../../platform/config.js';
import { applyMigrations, discoverMigrations } from '../../platform/db/migrate.js';
import { openDatabase } from '../../platform/db/open.js';
import { createPlatformRegistry } from '../../platform/entity-registry.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import type { Authorizer } from '../../platform/authz.js';
import { ORG_ENTITIES } from '../m01-organization/index.js';
import { AST_ENTITIES } from '../m03-assets/index.js';
import { WRK_ENTITIES } from './entities.js';
import { categoriseExistingDefects, ensureDefectCategories } from './categories.js';

/**
 * Defect categories (D67):
 *   npm run defect-categories -- setup              hub: load the standard list (Electrical, Marine Engineering, Weapon and subcategories); safe to repeat
 *   npm run defect-categories -- list               any installation: show the list this installation holds
 *   npm run defect-categories -- backfill [--apply] any installation: give old defects entered here the category of their equipment's department
 */
const { values, positionals } = parseArgs({ allowPositionals: true, options: { apply: { type: 'boolean' } } });
const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity) {
  console.error('This installation is not initialized (npm run ops -- setup at the hub, or npm run sync -- join at a ship).');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...WRK_ENTITIES]) registry.register(d);
const wctx = { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Defect categories' } }, correlationId: uuidv7() };
const operator: Authorizer = { name: 'cli-operator', check: () => ({ allowed: true, reason: 'operator command' }) };

try {
  const cmd = positionals[0];
  if (cmd === 'setup') {
    if (identity.kind !== 'hub') throw new Error('The category list is kept at the hub; ships receive it at their next synchronization.');
    const added = ensureDefectCategories(wctx);
    console.log(added ? `Loaded ${added} standard categories. Ships receive them at their next synchronization.` : 'The standard categories are already loaded.');
  } else if (cmd === 'list') {
    const rows = db.prepare('SELECT code, name, parent_code, department_codes, color, status FROM wrk_v_defect_category ORDER BY COALESCE(parent_code, code), is_main DESC, sort_order, code').all() as Array<Record<string, string | null>>;
    if (rows.length === 0) console.log('No categories here yet. At the hub run: npm run defect-categories -- setup; a ship receives them when it synchronizes.');
    for (const r of rows) console.log(`${r.parent_code ? '    ' : ''}${r.code}  ${r.name}${r.department_codes ? `  (departments ${r.department_codes})` : ''}${r.status === 'inactive' ? '  [inactive]' : ''}`);
  } else if (cmd === 'backfill') {
    const r = categoriseExistingDefects({ wctx, principal: { userId: 'system', installationId: identity.installationId, displayName: 'Defect categories' }, authz: operator }, { apply: values.apply === true });
    console.log(`${r.uncategorised} defect(s) entered here have no category; ${r.matched} can be matched from their equipment's department.`);
    if (values.apply) console.log(`${r.applied} defect(s) categorised.`);
    else if (r.matched) console.log('Nothing changed. Run again with --apply to save.');
    if (r.left.length) console.log(`Still to choose by hand (Work > Defects, Edit):\n  ${r.left.slice(0, 50).map((d) => `${d.defectNo}  ${d.title}`).join('\n  ')}${r.left.length > 50 ? `\n  ... and ${r.left.length - 50} more` : ''}`);
  } else {
    console.error('Usage: npm run defect-categories -- setup | list | backfill [--apply]');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  db.close();
}
