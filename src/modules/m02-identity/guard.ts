import { requirePermission, type AuthDecision } from '../../platform/authz.js';
import type { ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../../platform/records.js';
import type { Actor } from './actor.js';

/** Authorization-then-write helper. Denials are audited (CONTRACTS §3); an expired lease reports AUTHORITY_EXPIRED. */
export function authorize(a: Actor, permission: string, scope?: ScopeRef): AuthDecision {
  try {
    const d = requirePermission(a.authz, a.principal, permission, scope);
    a.wctx.authorityBasis = { ...(d.basis ?? {}), ...(d.provisional ? { provisional: true } : {}) };
    return d;
  } catch (e) {
    if (e instanceof AppError && e.code === 'FORBIDDEN') {
      writeAudit(a.wctx, { action: `denied:${permission}`, entityType: `idn.${permission.split('.')[1] ?? 'unknown'}`, outcome: 'denied' });
      if (e.message.startsWith('AUTHORITY_EXPIRED')) throw new AppError('AUTHORITY_EXPIRED', e.message, e.details);
      if (e.message.startsWith('CLOCK_SUSPECT')) throw new AppError('WORKFLOW_BLOCKED', e.message, e.details);
    }
    throw e;
  }
}
