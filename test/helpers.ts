import { applyMigrations, discoverMigrations, expandMacros } from '../src/platform/db/migrate.js';
import { openDatabase, type Db } from '../src/platform/db/open.js';
import { createPlatformRegistry, type EntityRegistry } from '../src/platform/entity-registry.js';
import { uuidv7 } from '../src/platform/ids.js';
import type { LocalIdentity } from '../src/platform/identity.js';
import type { WriteContext } from '../src/platform/records.js';

export const hubIdentity: LocalIdentity = { installationId: uuidv7(), kind: 'hub', code: 'HQ', name: 'Fleet HQ' };
export const shipIdentity: LocalIdentity = { installationId: uuidv7(), kind: 'ship', code: 'SHIP1', name: 'Test Ship' };

export interface TestEnv {
  db: Db;
  registry: EntityRegistry;
  ctx(who?: LocalIdentity): WriteContext;
}

/** In-memory DB with platform migrations and two throwaway entities (one mutable, one event). */
export function makeEnv(): TestEnv {
  const db = openDatabase(':memory:');
  applyMigrations(db, discoverMigrations());
  db.exec(
    expandMacros(`
    CREATE TABLE ast_thing ({{SYNC_COLUMNS}} name TEXT NOT NULL, meta TEXT);
    {{TRIGGERS_MUTABLE ast_thing}}
    CREATE TABLE ast_thing_event ({{EVENT_COLUMNS}} thing_id TEXT NOT NULL, note TEXT);
    {{TRIGGERS_EVENT ast_thing_event}}
  `),
  );
  const registry = createPlatformRegistry();
  registry.register({ type: 'ast.thing', module: 'M03', table: 'ast_thing', recordClass: 'owner_mutable', distribution: 'record' });
  registry.register({ type: 'ast.thing_event', module: 'M03', table: 'ast_thing_event', recordClass: 'event', requires: ['ast.thing'], distribution: 'record' });
  return {
    db,
    registry,
    ctx: (who = hubIdentity) => ({
      db,
      registry,
      installation: who,
      actor: { userId: 'user-1', snapshot: { displayName: 'Test User' } },
      correlationId: uuidv7(),
    }),
  };
}
