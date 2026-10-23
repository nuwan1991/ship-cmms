/**
 * M02 public surface. Other modules never import this module (MODULE_MAP rule 2): they use the Authorizer and
 * ApprovalPort registered at startup and the `idn_v_approval_status` view. Exports here serve the composition root, CLI and tests.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { IDN_ENTITIES } from './entities.js';
import { createApprovalPort } from './approvals.js';
import { createIdentityAuthorizer } from './authority.js';
import { PermissionCatalogue } from './permissions.js';
import { mountIdentityRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of IDN_ENTITIES) ctx.entities.register(d);
  const catalogue = new PermissionCatalogue();
  // Modules that cannot import M02 announce their permission codes on the bus (D25).
  ctx.events.subscribe('sys.permissions.declared', (e) => catalogue.add((e.payload as { codes?: string[] }).codes ?? []));
  // Development mode keeps the allow-all authorizer so the system can be explored before users exist; production gets the real one.
  if (!ctx.config.devAuth) ctx.authz.register(createIdentityAuthorizer(ctx.db));
  ctx.approvals.register(createApprovalPort(ctx));
  mountIdentityRoutes(ctx, app, catalogue);
}

export { IDN_ENTITIES } from './entities.js';
export { IDN_PERMISSIONS, IDN_NOUNS, PermissionCatalogue, defaultOfflinePolicy, permissionMatches, isValidRolePermission, perm as idnPermission } from './permissions.js';
export { checkAuthority, createIdentityAuthorizer, effectivePermissions, leaseInfo, clockState, SETTING as AUTHORITY_SETTING, DEFAULT_LEASE_DAYS } from './authority.js';
export { recordApproval, evaluateGate, ratifyApproval } from './approvals.js';
export { IDN_API_PREFIX } from './routes.js';
