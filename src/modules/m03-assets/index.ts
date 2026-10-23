/**
 * M03 public surface (MODULE_MAP). Other modules import ONLY from here.
 * Lookups take the Db handle as first argument; they read local (replicated) data and never write.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { AST_ENTITIES } from './entities.js';
import { AST_PERMISSIONS } from './permissions.js';
import { assetsPort } from './import-export.js';
import { mountAssetRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of AST_ENTITIES) ctx.entities.register(d);
  // M02 cannot be imported here; it learns the permission codes from this announcement (D25).
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...AST_PERMISSIONS] } });
  ctx.importExport.register(assetsPort(ctx));
  mountAssetRoutes(ctx, app);
}

export { getAsset, findAssetByName, resolveTag, getPosition, currentInstallation, assetAtPosition, getAssetState, positionChain } from './queries.js';
export type { AssetInfo, PositionInfo, AssetState, CurrentInstallation } from './queries.js';
export { responsibilityAt, EQUIPMENT_TAG_SEQUENCE, createAsset } from './service.js';
export type { Actor as AstActor } from './actor.js';
export { rebuildAssetCurrent, refoldAsset, foldMovements } from './movements.js';
export { AST_PERMISSIONS, AST_NOUNS, perm as astPermission } from './permissions.js';
export type { AstNoun, AstAction } from './permissions.js';
export { AST_ENTITIES } from './entities.js';
export { AST_API_PREFIX } from './routes.js';
