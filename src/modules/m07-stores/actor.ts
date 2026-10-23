import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { requirePermission, type AuthDecision, type Authorizer } from '../../platform/authz.js';
import type { Principal, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { writeAudit, type WriteContext } from '../../platform/records.js';

/** Everything a service needs to act: write context (db, installation, actor, correlation), principal and authorizer. */
export interface Actor {
  wctx: WriteContext;
  principal: Principal;
  authz: Authorizer;
}

/** Authorization-then-write helper. Denials are audited (CONTRACTS §3) and rethrown as FORBIDDEN. */
export function authorize(a: Actor, permission: string, scope?: ScopeRef): AuthDecision {
  try {
    const d = requirePermission(a.authz, a.principal, permission, scope);
    a.wctx.authorityBasis = { ...(d.basis ?? {}), ...(d.provisional ? { provisional: true } : {}) };
    return d;
  } catch (e) {
    if (e instanceof AppError && e.code === 'FORBIDDEN') {
      const [, noun = 'unknown'] = permission.split('.');
      writeAudit(a.wctx, { action: `denied:${permission}`, entityType: `stk.${noun}`, outcome: 'denied' });
    }
    throw e;
  }
}

export function withReason(a: Actor, reason: string | null | undefined): Actor {
  return reason ? { ...a, wctx: { ...a.wctx, reason } } : a;
}

/** Build an Actor outside HTTP (tests, seed, import jobs). */
export function makeActor(ctx: AppContext, principal: Principal, correlationId: string = uuidv7()): Actor {
  const installation = ctx.identity ?? getLocalIdentity(ctx.db);
  if (!installation) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized (run init-installation)');
  return {
    wctx: {
      db: ctx.db, registry: ctx.entities, installation,
      actor: { userId: principal.userId, snapshot: principal.snapshot ?? { displayName: principal.displayName } },
      correlationId,
    },
    principal,
    authz: ctx.authz.current(),
  };
}

/** Principal set by M02's session hook; with CMMS_DEV_AUTH=1 and no session, a development user. Nothing here checks credentials. */
export function actorFromRequest(ctx: AppContext, req: FastifyRequest): Actor {
  let principal = req.principal ?? null;
  if (!principal && ctx.config.devAuth) {
    const h = req.headers['x-dev-user'];
    const userId = typeof h === 'string' && /^[\w.-]{1,64}$/.test(h) ? h : 'dev-user';
    const installation = ctx.identity ?? getLocalIdentity(ctx.db);
    if (installation) principal = { userId, installationId: installation.installationId, displayName: `Dev ${userId}` };
  }
  if (!principal) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return makeActor(ctx, principal, req.id);
}
