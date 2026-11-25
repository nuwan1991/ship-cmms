/**
 * M16 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { DCK_ENTITIES } from './entities.js';
import { DCK_PERMISSIONS } from './permissions.js';
import { mountDckRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of DCK_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...DCK_PERMISSIONS] } });
  mountDckRoutes(ctx, app);
}

export { currentDocking, dockingDueForShip } from './queries.js';
export type { CurrentDocking, ShipDockingDue, DueState } from './queries.js';
export { DCK_PERMISSIONS, perm as dckPermission } from './permissions.js';
export type { Actor as DckActor } from './actor.js';
export { DCK_ENTITIES } from './entities.js';
export { DCK_API_PREFIX } from './routes.js';
