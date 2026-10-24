/**
 * M06 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { PM_ENTITIES } from './entities.js';
import { PM_PERMISSIONS } from './permissions.js';
import { mountPmRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of PM_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...PM_PERMISSIONS] } });
  mountPmRoutes(ctx, app);
}

export { currentMeterValue, dueForAsset, templatesForAsset } from './queries.js';
export type { MeterValue, DueItem } from './queries.js';
export { generateDue } from './service.js';
export type { GenerateResult } from './service.js';
export { PM_PERMISSIONS, perm as pmPermission } from './permissions.js';
export type { Actor as PmActor } from './actor.js';
export { PM_ENTITIES } from './entities.js';
export { PM_API_PREFIX } from './routes.js';
