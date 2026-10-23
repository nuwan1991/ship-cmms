/**
 * M07 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { STK_ENTITIES } from './entities.js';
import { STK_PERMISSIONS } from './permissions.js';
import { mountStoreRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of STK_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...STK_PERMISSIONS] } });
  mountStoreRoutes(ctx, app);
}

export { getPart, findPartByNo, getBalance, partsForAsset, onHandAtSite, partsIssuedTo } from './queries.js';
export type { PartInfo, Balance, IssuedPart } from './queries.js';
export { issueToWorkOrder, TRANSFER_SEQUENCE } from './service.js';
export { STK_PERMISSIONS, perm as stkPermission } from './permissions.js';
export type { Actor as StkActor } from './actor.js';
export { STK_ENTITIES } from './entities.js';
export { STK_API_PREFIX } from './routes.js';
