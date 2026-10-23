/**
 * M05 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { WRK_ENTITIES } from './entities.js';
import { WRK_PERMISSIONS } from './permissions.js';
import { mountWorkRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of WRK_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes (and the two gate codes) from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...WRK_PERMISSIONS] } });
  mountWorkRoutes(ctx, app);
}

export { getWorkOrder, resolveWorkOrderNo, openWorkOrdersForAsset, currentAxes } from './queries.js';
export type { WorkOrderRef, AxesState, SubjectType, Axis } from './queries.js';
export { createWorkOrder, advisoriesForAsset, WORK_ORDER_SEQUENCE, REPAIR_CASE_SEQUENCE, DEFECT_SEQUENCE } from './service.js';
export { WRK_PERMISSIONS, GATE_APPROVE, GATE_ACCEPT, perm as wrkPermission } from './permissions.js';
export type { Actor as WrkActor } from './actor.js';
export { WRK_ENTITIES } from './entities.js';
export { WRK_API_PREFIX } from './routes.js';
