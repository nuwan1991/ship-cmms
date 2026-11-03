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
import { createSiteStore } from './seed.js';

/**
 * Create a stock location (store) for a ship or workshop, at the hub or at that ship's own installation.
 *   npm run store -- create --ship SAGARA --code MAIN-STORE --name "SLNS Sagara Main Store" [--kind store|locker|workshop|other] [--compartment <location code>]
 *   npm run store -- list --ship SAGARA
 * --ship takes the ship's code or its exact name ("SLNS Sagara"). Repeating create with the same code changes nothing.
 */
const USAGE = 'Usage: store create --ship <code or name> --code <STORE-CODE> --name "<store name>" [--kind store|locker|workshop|other] [--compartment <code>]\n       store list --ship <code or name>';
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { ship: { type: 'string' }, code: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' }, compartment: { type: 'string' } },
});
const KINDS = ['store', 'locker', 'workshop', 'other'] as const;
const cmd = positionals[0];
if (!values.ship || (cmd === 'create' && (!values.code || !values.name)) || (cmd !== 'create' && cmd !== 'list') || (values.kind && !KINDS.includes(values.kind as never))) {
  console.error(USAGE);
  process.exit(2);
}

const config = loadConfig();
const db = openDatabase(config.dbFile);
applyMigrations(db, discoverMigrations());
const identity = getLocalIdentity(db);
if (!identity) {
  console.error('This installation is not initialized: npm run init-installation -- --kind hub --code HQ --name "Fleet HQ"');
  process.exit(2);
}
const registry = createPlatformRegistry();
for (const d of [...ORG_ENTITIES, ...AST_ENTITIES, ...STK_ENTITIES]) registry.register(d);
const actor = {
  wctx: { db, registry, installation: identity, actor: { userId: 'system', snapshot: { displayName: 'Store setup' } }, correlationId: uuidv7() },
  principal: { userId: 'system', installationId: identity.installationId, displayName: 'Store setup' },
  authz: denyAllAuthorizer,
};

try {
  if (cmd === 'create') {
    const r = createSiteStore(actor, {
      site: values.ship, code: values.code as string, name: values.name as string,
      ...(values.kind ? { kind: values.kind as (typeof KINDS)[number] } : {}), ...(values.compartment ? { compartment: values.compartment } : {}),
    });
    const s = r.store;
    console.log(`${r.created ? 'Created' : 'Already exists:'} ${String(s.code)} "${String(s.name)}" (${String(s.kind)}) for ${r.site.name} [${r.site.code}], id ${String(s.id)}`);
  } else {
    const r = db.prepare(
      `SELECT l.code, l.name, l.kind, l.status FROM stk_location l
        WHERE l.deleted_at IS NULL AND l.home_scope_id IN (SELECT id FROM org_ship WHERE (code = upper(?) OR lower(name) = lower(?)) AND deleted_at IS NULL
                                                          UNION SELECT id FROM org_workshop WHERE (code = upper(?) OR lower(name) = lower(?)) AND deleted_at IS NULL)
        ORDER BY l.code`,
    ).all(values.ship, values.ship, values.ship, values.ship) as { code: string; name: string; kind: string; status: string }[];
    if (!r.length) console.log(`No stores for "${values.ship}"`);
    for (const l of r) console.log(`${l.code.padEnd(16)} ${l.kind.padEnd(9)} ${l.status.padEnd(9)} ${l.name}`);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
