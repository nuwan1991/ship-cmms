/**
 * M10 public surface (MODULE_MAP). M10 reads and writes other modules' tables only through the entity registry and the shared change log; it imports no other module.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { SYN_PERMISSIONS } from './permissions.js';
import { mountSyncRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...SYN_PERMISSIONS] } });
  mountSyncRoutes(ctx, app);
}

export { SYN_PERMISSIONS, perm as synPermission } from './permissions.js';
export type { Actor as SynActor } from './actor.js';
export { SYN_API_PREFIX, setTransportOverride } from './routes.js';
export { APPLIED_EVENT, freshness, status as syncStatus, syncOnce, httpTransport, provisionPeer, joinHub, exportBundle, importBundle, handleHello, handlePush, handlePull, retryQuarantined } from './engine.js';
export type { ProvisioningPackage, Bundle, Transport, SyncReport } from './engine.js';
