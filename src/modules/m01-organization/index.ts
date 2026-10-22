/**
 * M01 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { ORG_ENTITIES } from './entities.js';
import { mountOrgRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of ORG_ENTITIES) ctx.entities.register(d);
  mountOrgRoutes(ctx, app);
}

export { getShipCommandAt, listShipsByCommand, getLocation, resolveParty, resolveParties } from './queries.js';
export type { ShipCommandAt, ShipSummary, LocationInfo, ResolvedParty } from './queries.js';
export { ORG_PERMISSIONS, ORG_NOUNS, perm as orgPermission } from './permissions.js';
export type { OrgNoun, OrgAction } from './permissions.js';
export { ORG_ENTITIES } from './entities.js';
export { ORG_API_PREFIX } from './routes.js';
