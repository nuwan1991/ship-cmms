/**
 * One authorization mechanism for the whole system. Modules ask the platform
 * `Authorizer` port; M02 supplies the real implementation at startup. Modules
 * never import M02 and never test roles directly.
 */
import { AppError } from './errors.js';
import type { Principal, ScopeRef } from './contracts.js';

/** Permission codes: `<prefix>.<resource>.<action>`, e.g. wrk.job_card.approve */
export const PERMISSION_RE = /^[a-z]{2,4}\.[a-z0-9_]+\.[a-z0-9_]+$/;

export interface AuthDecision {
  allowed: boolean;
  reason?: string;
  /** What granted it: recorded into the audit envelope and approvals. */
  basis?: { roleAssignmentId?: string; offlineGrantId?: string };
  /** Allowed only under an expired offline lease: action is recorded as provisional and needs confirmation on sync. */
  provisional?: boolean;
}

export interface Authorizer {
  readonly name: string;
  check(principal: Principal, permission: string, scope?: ScopeRef): AuthDecision;
}

export const denyAllAuthorizer: Authorizer = {
  name: 'deny-all',
  check: () => ({ allowed: false, reason: 'No authorizer registered' }),
};

/** Development/test only. Refused unless CMMS_DEV_AUTH=1. */
export const devAllowAllAuthorizer: Authorizer = {
  name: 'dev-allow-all',
  check: () => ({ allowed: true, reason: 'dev' }),
};

export class AuthorizerRegistry {
  private impl: Authorizer = denyAllAuthorizer;

  register(a: Authorizer): void {
    if (a === devAllowAllAuthorizer && process.env.CMMS_DEV_AUTH !== '1') {
      throw new Error('dev-allow-all authorizer requires CMMS_DEV_AUTH=1');
    }
    this.impl = a;
  }

  current(): Authorizer {
    return this.impl;
  }

  /** Call at startup: production must not run on deny-all (nobody could do anything) or dev auth. */
  assertProductionReady(): void {
    if (this.impl === denyAllAuthorizer) throw new Error('No Authorizer registered (M02 not loaded)');
    if (this.impl === devAllowAllAuthorizer) throw new Error('Dev authorizer is not allowed in production');
  }
}

export function requirePermission(
  authz: Authorizer,
  principal: Principal,
  permission: string,
  scope?: ScopeRef,
): AuthDecision {
  if (!PERMISSION_RE.test(permission)) throw new Error(`Malformed permission code: ${permission}`);
  const d = authz.check(principal, permission, scope);
  if (!d.allowed) {
    throw new AppError('FORBIDDEN', d.reason ?? 'Permission denied', { permission });
  }
  return d;
}
