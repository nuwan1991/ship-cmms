import type { AppContext } from '../../platform/app-context.js';
import type { ActorSnapshot, Principal } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import type { WriteContext } from '../../platform/records.js';
import type { Authorizer } from '../../platform/authz.js';
import { activeGrants } from './authority.js';

/** Everything a M02 service needs: write context, principal, authorizer. */
export interface Actor {
  wctx: WriteContext;
  principal: Principal;
  authz: Authorizer;
}

/** Name/rank/number and role codes as they are at this moment; stored with approvals so later renames never rewrite history. */
export function snapshotFor(ctx: AppContext, userId: string): ActorSnapshot {
  const u = ctx.db.prepare('SELECT display_name, rank, service_number FROM idn_user WHERE id = ?').get(userId) as { display_name: string; rank: string | null; service_number: string | null } | undefined;
  if (!u) return { displayName: userId };
  const roles = [...new Set(activeGrants(ctx.db, userId).map((g) => g.roleCode))];
  return { displayName: u.display_name, ...(u.rank ? { rank: u.rank } : {}), ...(u.service_number ? { serviceNumber: u.service_number } : {}), ...(roles.length ? { roles } : {}) };
}

export function makeActor(ctx: AppContext, principal: Principal, correlationId: string = uuidv7(), authz?: Authorizer): Actor {
  const installation = ctx.identity ?? getLocalIdentity(ctx.db);
  if (!installation) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized (run init-installation)');
  return {
    wctx: { db: ctx.db, registry: ctx.entities, installation, actor: { userId: principal.userId, snapshot: principal.snapshot ?? snapshotFor(ctx, principal.userId) }, correlationId },
    principal,
    authz: authz ?? ctx.authz.current(),
  };
}
