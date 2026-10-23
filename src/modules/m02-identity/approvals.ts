/**
 * ApprovalPort implementation. Approvals are immutable events keyed by user id with an actor snapshot and the
 * actual decision time. They are never edited: a late revocation or an expired offline lease only *flags* them
 * (idn_v_approval_status), and a competent authority resolves the flag with a ratification event (SYNC_RULES §6).
 *
 * Scope: the port checks the actor holds the gate permission somewhere (plus lease, clock and revocation rules).
 * The calling module has already made the scoped Authorizer check for the case being approved.
 */
import type { AppContext } from '../../platform/app-context.js';
import type { EntityRef, Principal } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import type { ApprovalPort, GateEvaluation } from '../../platform/ports.js';
import { appendEvent, writeAudit } from '../../platform/records.js';
import { isUtcIso, nowUtc } from '../../platform/time.js';
import { makeActor, snapshotFor, type Actor } from './actor.js';
import { CLOCK_TOLERANCE_MS, checkAuthority, touchClock } from './authority.js';
import { perm } from './permissions.js';
import { authorize } from './guard.js';

type Row = Record<string, unknown>;

function requireAuthority(a: Actor, gateCode: string): { provisional: boolean; basis: Record<string, unknown> } {
  const d = checkAuthority(a.wctx.db, a.principal, gateCode, 'any');
  if (!d.allowed) {
    writeAudit(a.wctx, { action: `denied:${gateCode}`, entityType: 'idn.approval', outcome: 'denied' });
    const reason = d.reason ?? 'Permission denied';
    if (reason.startsWith('AUTHORITY_EXPIRED')) throw new AppError('AUTHORITY_EXPIRED', reason, { permission: gateCode });
    if (reason.startsWith('CLOCK_SUSPECT')) throw new AppError('WORKFLOW_BLOCKED', reason, { permission: gateCode });
    throw new AppError('FORBIDDEN', reason, { permission: gateCode });
  }
  return { provisional: d.provisional === true, basis: { ...(d.basis ?? {}), ...(d.provisional ? { provisional: true } : {}) } };
}

export function recordApproval(ctx: AppContext, input: Parameters<ApprovalPort['recordApproval']>[0], correlationId?: string): { approvalId: string; provisional: boolean } {
  const a = makeActor(ctx, input.principal, correlationId);
  const now = nowUtc();
  const decidedAt = input.decidedAt ?? now;
  if (!isUtcIso(decidedAt)) throw new AppError('VALIDATION_FAILED', 'decidedAt must be a UTC instant like 2026-10-21T17:59:00.000Z');
  if (Date.parse(decidedAt) > Date.parse(now) + CLOCK_TOLERANCE_MS) throw new AppError('VALIDATION_FAILED', 'decidedAt is in the future');
  const { provisional, basis } = requireAuthority(a, input.gateCode);

  const snapshot = snapshotFor(ctx, input.principal.userId);
  const wctx = { ...a.wctx, actor: { userId: input.principal.userId, snapshot }, authorityBasis: basis, occurredAt: decidedAt };
  const row = ctx.db.transaction(() => {
    const ev = appendEvent(wctx, 'idn.approval', {
      gate_code: input.gateCode, subject_type: input.subject.type, subject_id: input.subject.id, decision: input.decision,
      actor_user_id: input.principal.userId, actor_snapshot: snapshot, authority_basis: basis,
      confirmation_state: provisional ? 'pending_confirmation' : 'confirmed', comment: input.comment ?? null,
    });
    writeAudit(wctx, { action: input.decision === 'approved' ? 'approve' : 'reject', entityType: input.subject.type, entityId: input.subject.id });
    return ev;
  })();
  touchClock(ctx.db, now);
  ctx.events.publish({ type: 'idn.approval.recorded', occurredAt: decidedAt, payload: { approvalId: row.id, gateCode: input.gateCode, subject: input.subject, decision: input.decision, provisional } });
  return { approvalId: row.id as string, provisional };
}

/** `satisfied` = the latest effective decision for this subject is a valid approval. Callers decide what an unsatisfied gate means for `mode`. */
export function evaluateGate(ctx: AppContext, gateCode: string, subject: EntityRef): GateEvaluation {
  const p = ctx.db.prepare('SELECT mode FROM idn_gate_policy WHERE gate_code = ? AND deleted_at IS NULL').get(gateCode) as { mode: GateEvaluation['mode'] } | undefined;
  const mode = p?.mode ?? 'none';
  if (mode === 'none') return { mode, satisfied: true };
  const latest = ctx.db
    .prepare('SELECT decision, authority_disputed, decided_at FROM idn_v_approval_status WHERE gate_code = ? AND subject_type = ? AND subject_id = ? ORDER BY decided_at DESC, approval_id DESC LIMIT 1')
    .get(gateCode, subject.type, subject.id) as { decision: string; authority_disputed: number } | undefined;
  if (!latest) return { mode, satisfied: false, blockedReason: 'Not yet approved' };
  if (latest.decision === 'rejected') return { mode, satisfied: false, blockedReason: 'Rejected' };
  if (latest.authority_disputed) return { mode, satisfied: false, blockedReason: "The approver's authority was withdrawn at the time of the decision; a competent authority must ratify it" };
  return { mode, satisfied: true };
}

/** A different holder of the gate permission confirms a flagged approval (provisional or authority-disputed). New event; the original is untouched. */
export function ratifyApproval(a: Actor, ctx: AppContext, approvalId: string, comment: string | null | undefined): Row {
  authorize(a, perm('approval', 'create'));
  const target = ctx.db.prepare('SELECT * FROM idn_v_approval_status WHERE approval_id = ?').get(approvalId) as (Row & { needs_review: number }) | undefined;
  if (!target) throw new AppError('NOT_FOUND', `approval ${approvalId} not found`);
  if (!target.needs_review) throw new AppError('WORKFLOW_BLOCKED', 'This approval is not awaiting confirmation');
  if (target.decision !== 'approved') throw new AppError('WORKFLOW_BLOCKED', 'Only approvals can be ratified');
  if (target.actor_user_id === a.principal.userId) throw new AppError('WORKFLOW_BLOCKED', 'A different authority must ratify this approval');
  const { provisional, basis } = requireAuthority(a, target.gate_code as string);
  if (provisional) throw new AppError('WORKFLOW_BLOCKED', 'Ratification needs current authority; synchronize with headquarters first');
  const snapshot = snapshotFor(ctx, a.principal.userId);
  const wctx = { ...a.wctx, actor: { userId: a.principal.userId, snapshot }, authorityBasis: basis };
  return ctx.db.transaction(() => {
    const ev = appendEvent(wctx, 'idn.approval', {
      gate_code: target.gate_code, subject_type: target.subject_type, subject_id: target.subject_id, decision: 'ratified',
      actor_user_id: a.principal.userId, actor_snapshot: snapshot, authority_basis: basis, confirmation_state: 'confirmed',
      ratifies_approval_id: approvalId, comment: comment ?? null,
    });
    writeAudit(wctx, { action: 'ratify', entityType: target.subject_type as string, entityId: target.subject_id as string });
    return ev;
  })();
}

export function createApprovalPort(ctx: AppContext): ApprovalPort {
  return {
    evaluateGate: (gateCode, subject, _principal: Principal) => evaluateGate(ctx, gateCode, subject),
    recordApproval: (input) => recordApproval(ctx, input),
  };
}
