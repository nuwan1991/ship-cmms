import type { Db } from './db/open.js';
import type { AuthorizerRegistry } from './authz.js';
import type { ApprovalPortRegistry, ImportExportRegistry } from './ports.js';
import type { EntityRegistry } from './entity-registry.js';
import type { EventBus } from './events.js';
import type { LocalIdentity } from './identity.js';

export interface Config {
  dataDir: string;
  dbFile: string;
  host: string;
  port: number;
  displayTimeZone: string;
  devAuth: boolean;
}

/** Handed to every module's register() at startup (composition root: src/main.ts). */
export interface AppContext {
  db: Db;
  config: Config;
  entities: EntityRegistry;
  authz: AuthorizerRegistry;
  approvals: ApprovalPortRegistry;
  importExport: ImportExportRegistry;
  events: EventBus;
  identity: LocalIdentity | null;
}
