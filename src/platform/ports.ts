/**
 * Extension ports: the ONLY way modules talk across the dependency graph.
 * Types only in M00; implementations are registered at startup by the owning module.
 * (Entity registry and Authorizer are implemented in M00: entity-registry.ts, authz.ts.)
 */
import type { EntityRef, Principal, ScopeRef } from './contracts.js';
import { AppError } from './errors.js';

/** Owned by M02. Approval records are immutable and keyed by user id, never username. */
export interface ApprovalPort {
  evaluateGate(gateCode: string, subject: EntityRef, principal: Principal): GateEvaluation;
  recordApproval(input: {
    gateCode: string;
    subject: EntityRef;
    decision: 'approved' | 'rejected';
    principal: Principal;
    decidedAt: string; // actual decision time (UTC), may precede recordedAt
    comment?: string;
  }): { approvalId: string; provisional: boolean };
}
export interface GateEvaluation {
  /** mandatory_prior: work may not start until approved. review_pending_allowed: work may proceed, review pending. none: no gate. */
  mode: 'mandatory_prior' | 'review_pending_allowed' | 'none';
  satisfied: boolean;
  blockedReason?: string;
}

/** Permissive stand-in until M02 registers the real port: no gates apply, and nothing can be approved. */
export const noApprovalPort: ApprovalPort = {
  evaluateGate: () => ({ mode: 'none', satisfied: true }),
  recordApproval: () => {
    throw new AppError('WORKFLOW_BLOCKED', 'No approval service is registered (M02 not loaded)');
  },
};

/** Holds the one ApprovalPort implementation. Consumers call `current()` at use time, never at import time. */
export class ApprovalPortRegistry {
  private impl: ApprovalPort = noApprovalPort;
  register(p: ApprovalPort): void {
    this.impl = p;
  }
  current(): ApprovalPort {
    return this.impl;
  }
}

/** Registered by each module that supports Excel round-trips; consumed by M11. M11 never writes tables directly. */
export interface ImportExportPort {
  entityType: string;
  templateCode: string;
  /** Validates one row and, when commit=true, applies it through the owning module's command service (permissions + workflow apply). */
  importRow(row: Record<string, unknown>, principal: Principal, opts: { commit: boolean }): ImportRowResult;
  exportRows(scope: ScopeRef, principal: Principal): Array<Record<string, unknown>>;
}
export interface ImportRowResult {
  ok: boolean;
  action?: 'create' | 'update' | 'skip';
  errors?: string[];
  duplicateOf?: string;
}

/** Published read model (SQL view named `<prefix>_v_*`). M13 reads views only, never base tables. */
export interface ReadModelDescriptor {
  module: string;
  view: string;
  scopeColumn?: string;
  description: string;
}

/** Navigation convention for the single web UI shell. */
export interface NavItem {
  module: string;
  path: string;
  labelKey: string;
  requiredPermission?: string;
  order: number;
}
