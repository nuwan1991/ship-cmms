import { register } from '../../src/modules/m05-work/index.js';
import type { WrkActor } from '../../src/modules/m05-work/index.js';
import { ensureWorkSequences, grantWorkRanges } from '../../src/modules/m05-work/seed.js';
import { uuidv7 } from '../../src/platform/ids.js';
import type { ApprovalPort } from '../../src/platform/ports.js';
import { makeAstEnv, type AstEnv } from './ast-helpers.js';

type Mode = 'mandatory_prior' | 'review_pending_allowed' | 'none';
export interface StubApprovals extends ApprovalPort { decisions: Array<{ gateCode: string; subjectId: string; decision: string; provisional: boolean }>; setProvisional(v: boolean): void }

/** Stand-in for M02's approval service: per-gate modes, an approval is satisfied when the latest decision for the subject is `approved`. */
export function stubApprovals(modes: Record<string, Mode> = {}): StubApprovals {
  const latest = new Map<string, string>();
  let provisional = false;
  const decisions: StubApprovals['decisions'] = [];
  return {
    decisions,
    setProvisional: (v) => { provisional = v; },
    evaluateGate(gateCode, subject) {
      const mode = modes[gateCode] ?? 'none';
      if (mode === 'none') return { mode, satisfied: true };
      const d = latest.get(`${gateCode}:${subject.id}`);
      if (d === 'approved') return { mode, satisfied: true };
      return { mode, satisfied: false, blockedReason: d === 'rejected' ? 'Rejected' : 'Not yet approved' };
    },
    recordApproval(i) {
      latest.set(`${i.gateCode}:${i.subject.id}`, i.decision);
      decisions.push({ gateCode: i.gateCode, subjectId: i.subject.id, decision: i.decision, provisional });
      return { approvalId: uuidv7(), provisional };
    },
  };
}

export interface WrkEnv extends AstEnv {
  /** Hub actor carrying the given approval stand-in. */
  asHub(approvals?: ApprovalPort): WrkActor;
  /** Ship installation actor for the given ship. */
  asShip(shipId: string, approvals?: ApprovalPort): WrkActor;
  grantWork(installationId: string, size: number): void;
}

/** M03 environment plus M05 registered, the three number sequences defined and the hub holding `hubWork` of each. */
export function makeWrkEnv(opts: { devAuth?: boolean; hubWork?: number; hubRange?: number } = {}): WrkEnv {
  const env = makeAstEnv(opts);
  register(env.ctx, env.app);
  ensureWorkSequences(env.hubActor().wctx);
  const grantWork = (installationId: string, size: number) => grantWorkRanges(env.hubActor().wctx, installationId, size);
  if (opts.hubWork !== 0) grantWork(env.hub.installationId, opts.hubWork ?? 50);
  return {
    ...env,
    asHub: (approvals) => ({ ...env.hubActor(), ...(approvals ? { approvals } : {}) }),
    asShip: (shipId, approvals) => ({ ...env.shipActor(shipId), ...(approvals ? { approvals } : {}) }),
    grantWork,
  };
}
