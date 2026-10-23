import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/app.js';
import { register as m01 } from '../../src/modules/m01-organization/index.js';
import { register as m10 } from '../../src/modules/m10-sync/index.js';
import { register as m14 } from '../../src/modules/m14-operations/index.js';
import type { AppContext } from '../../src/platform/app-context.js';
import { AuthorizerRegistry } from '../../src/platform/authz.js';
import { applyMigrations, discoverMigrations } from '../../src/platform/db/migrate.js';
import { openDatabase, type Db } from '../../src/platform/db/open.js';
import { createPlatformRegistry } from '../../src/platform/entity-registry.js';
import { EventBus } from '../../src/platform/events.js';
import { setLocalIdentity } from '../../src/platform/identity.js';
import { uuidv7 } from '../../src/platform/ids.js';
import { ApprovalPortRegistry, ImportExportRegistry } from '../../src/platform/ports.js';
import { createRecord, type WriteContext } from '../../src/platform/records.js';
import { allowAll } from './org-helpers.js';

export interface OpsEnv { ctx: AppContext; app: ReturnType<typeof buildApp>; dir: string; dbFile: string; wctx(): WriteContext; db: Db }

/** A hub with a real database file in a temporary folder (backups need a file), with M01, M10 and M14 registered. */
export function makeOpsEnv(): OpsEnv {
  const dir = mkdtempSync(join(tmpdir(), 'cmms-ops-'));
  const dbFile = join(dir, 'cmms.sqlite');
  const db = openDatabase(dbFile);
  applyMigrations(db, discoverMigrations());
  const ctx: AppContext = {
    db, config: { dataDir: dir, dbFile, host: '127.0.0.1', port: 0, displayTimeZone: 'Asia/Colombo', devAuth: true },
    entities: createPlatformRegistry(), authz: new AuthorizerRegistry(), approvals: new ApprovalPortRegistry(), importExport: new ImportExportRegistry(), events: new EventBus(), identity: null,
  };
  ctx.authz.register(allowAll);
  ctx.identity = setLocalIdentity(db, { kind: 'hub', code: 'HQ', name: 'Fleet HQ' });
  const app = buildApp(ctx);
  m01(ctx, app); m10(ctx, app); m14(ctx, app);
  const wctx = (): WriteContext => ({ db, registry: ctx.entities, installation: ctx.identity!, actor: { userId: 'tester' }, correlationId: uuidv7() });
  createRecord(wctx(), 'sys.installation', { id: ctx.identity.installationId, kind: 'hub', code: 'HQ', name: 'Fleet HQ', status: 'active' });
  return { ctx, app, dir, dbFile, wctx, db };
}

export const openReadonly = (file: string): Database.Database => new Database(file, { readonly: true });
