/**
 * M04 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { QR_ENTITIES } from './entities.js';
import { QR_PERMISSIONS } from './permissions.js';
import { mountLabelRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of QR_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...QR_PERMISSIONS] } });
  mountLabelRoutes(ctx, app);
}

export { resolveLabel, labelForAsset } from './queries.js';
export type { LabelInfo } from './queries.js';
export { LABEL_SEQUENCE } from './service.js';
export { QR_PERMISSIONS, perm as qrPermission } from './permissions.js';
export { QR_ENTITIES } from './entities.js';
export { QR_API_PREFIX } from './routes.js';
