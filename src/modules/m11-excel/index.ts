/**
 * M11 public surface (MODULE_MAP). M11 acts on other modules only through the ImportExportPort registry (ctx.importExport),
 * which modules fill in their own register(); it imports no other module.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { XLS_ENTITIES } from './entities.js';
import { XLS_PERMISSIONS } from './permissions.js';
import { mountExcelRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of XLS_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...XLS_PERMISSIONS] } });
  mountExcelRoutes(ctx, app);
}

export { XLS_PERMISSIONS, perm as xlsPermission } from './permissions.js';
export type { Actor as XlsActor } from './actor.js';
export { XLS_ENTITIES } from './entities.js';
export { XLS_API_PREFIX } from './routes.js';
