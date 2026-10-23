/**
 * Command services for M05: authorization -> validation/business rules -> platform write path (records.ts).
 * Status lives on four independent axes as events (D10). Approvals and acceptances go through the ApprovalPort (M02 supplies it).
 * Numbers (defect, case, work order) come from this installation's own ranges, so they work offline.
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { nextNumber } from '../../platform/ranges.js';
import { appendEvent, createRecord, tombstoneRecord, updateRecord, writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { resolveParty } from '../m01-organization/index.js';
import { getAsset, getPosition } from '../m03-assets/index.js';
import { approvalsOf, authorize, withReason, type Actor } from './actor.js';
import { GATE_ACCEPT, GATE_APPROVE, perm, type WrkNoun } from './permissions.js';
import { currentAxes, exists, getLive, TABLES, toApi, type Axis, type Row, type SubjectType } from './queries.js';
import * as S from './schemas.js';

export const WORK_ORDER_SEQUENCE = 'work_order_no';
export const REPAIR_CASE_SEQUENCE = 'repair_case_no';
export const DEFECT_SEQUENCE = 'defect_no';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const invalid = (message: string, details?: Record<string, unknown>) => new AppError('VALIDATION_FAILED', message, details);
const reload = (db: Db, noun: WrkNoun, id: unknown): Row => db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE id = ?`).get(id) as Row;
const shipScope = (id: unknown): ScopeRef => (typeof id === 'string' ? { kind: 'ship', id } : { kind: 'fleet' });
const checkVersion = (cur: Row, expected: number): void => {
  if (cur.version !== expected) throw new AppError('VERSION_CONFLICT', 'Record changed since it was read', { currentVersion: cur.version, expectedVersion: expected });
};
const snake = (input: Record<string, unknown>): Row => Object.fromEntries(Object.entries(input).map(([k, v]) => [toSnake(k), v]));
const audit = (a: Actor, action: string, entityType: string, entityId: string): void => {
  writeAudit(a.wctx, { action, entityType, entityId });
};

/** A ship or workshop installation enters data only for the site it serves; the hub and commands may enter any. */
function assertSiteHeldHere(a: Actor, siteId: string): void {
  const inst = a.wctx.installation;
  if (inst.kind !== 'ship' && inst.kind !== 'workshop') return;
  const r = a.wctx.db.prepare('SELECT org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL').get(inst.installationId) as { org_unit_id: string | null } | undefined;
  if (r?.org_unit_id && r.org_unit_id !== siteId) {
    throw new AppError('NOT_OWNER', 'This installation serves a different site; enter data where it is held', { servedSiteId: r.org_unit_id, requestedSiteId: siteId });
  }
}
const requireOwner = (a: Actor, row: Row, what: string): void => {
  if (row.owner_installation_id !== a.wctx.installation.installationId) {
    throw new AppError('NOT_OWNER', `${what} is owned by another installation; ask its owner`, { ownerInstallationId: row.owner_installation_id });
  }
};
const requireParty = (db: Db, p: { kind: string; id: string } | null | undefined, label: string): void => {
  if (p && !resolveParty(db, p as Parameters<typeof resolveParty>[1])) throw missing(label, p.id);
};
const partyCols = (stem: string, p: { kind: string; id: string } | null | undefined): Row => ({ [`${stem}_kind`]: p?.kind ?? null, [`${stem}_id`]: p?.id ?? null });

/** Resolve what the work is about: an asset, a position, or just a ship. Returns the ship it belongs to (the home scope). */
function resolveTarget(db: Db, t: { assetId?: string | null | undefined; positionId?: string | null | undefined; shipId?: string | null | undefined }): { assetId: string | null; positionId: string | null; shipId: string } {
  let shipId = t.shipId ?? null;
  const assetId = t.assetId ?? null;
  const positionId = t.positionId ?? null;
  if (assetId) {
    const asset = getAsset(db, assetId);
    if (!asset) throw missing('Asset', assetId);
    if (asset.homeShipId) {
      if (shipId && shipId !== asset.homeShipId) throw invalid('The asset belongs to a different ship');
      shipId = asset.homeShipId;
    }
  }
  if (positionId) {
    const pos = getPosition(db, positionId);
    if (!pos) throw missing('Position', positionId);
    if (shipId && shipId !== pos.shipId) throw invalid('The position belongs to a different ship');
    shipId = pos.shipId;
  }
  if (!shipId) throw invalid('Give an asset, a position or a ship');
  if (!resolveParty(db, { kind: 'ship', id: shipId })) throw missing('Ship', shipId);
  return { assetId, positionId, shipId };
}

// ------------------------------------------------------------------ status axes

const TRANSITIONS: Record<Axis, Record<string, string[]>> = {
  progress: { planned: ['in_progress'], in_progress: ['on_hold', 'work_complete'], on_hold: ['in_progress'], work_complete: ['in_progress'] },
  approval: { not_required: ['pending_review'], pending_review: ['approved', 'rejected'], approved: ['pending_review'], rejected: ['pending_review'] },
  return_to_service: { not_assessed: ['restricted', 'cleared', 'withheld'], restricted: ['cleared', 'withheld'], cleared: ['restricted', 'withheld'], withheld: ['restricted', 'cleared'] },
  closure: { open: ['closed'], closed: ['reopened'], reopened: ['closed'] },
};
function assertTransition(axis: Axis, from: string, to: string): void {
  if (!TRANSITIONS[axis][from]?.includes(to)) throw blocked(`${axis.replace('_', ' ')} cannot go from ${from} to ${to}`, { axis, from, to });
}

interface StatusExtra { note?: string | null | undefined; approvalId?: string | null; provisional?: boolean; occurredAt?: string | undefined }
function appendStatus(a: Actor, type: SubjectType, subject: Row, axis: Axis, value: string, x: StatusExtra = {}): void {
  appendEvent(a.wctx, 'wrk.status_event', {
    home_scope_id: subject.home_scope_id ?? null, ...(x.occurredAt ? { occurred_at: x.occurredAt } : {}),
    subject_type: type, subject_id: subject.id, axis, value, note: x.note ?? null, approval_id: x.approvalId ?? null, provisional: x.provisional ? 1 : 0,
  });
}
const notClosed = (db: Db, type: SubjectType, id: string): ReturnType<typeof currentAxes> => {
  const ax = currentAxes(db, type, id);
  if (ax.closure === 'closed') throw blocked('This record is closed; reopen it first', { closure: ax.closure });
  return ax;
};

// ------------------------------------------------------------------ defects

export function reportDefect(a: Actor, input: unknown): Row {
  const b = S.parse(S.DefectCreate, input);
  const db = a.wctx.db;
  const t = resolveTarget(db, b);
  authorize(a, perm('defect', 'create'), shipScope(t.shipId));
  assertSiteHeldHere(a, t.shipId);
  return db.transaction(() => {
    const { tag } = nextNumber(db, a.wctx.installation, DEFECT_SEQUENCE);
    const row = createRecord(a.wctx, 'wrk.defect', {
      defect_no: tag, title: b.title, description: b.description ?? null, severity: b.severity ?? 'minor', asset_id: t.assetId, position_id: t.positionId,
      home_scope_id: t.shipId, status: 'open', reported_at: b.reportedAt ?? nowUtc(),
    });
    return toApi(row);
  })();
}

const SEVERITY_PRIORITY: Record<string, string> = { minor: 'normal', major: 'high', critical: 'urgent' };

/** Turn an open defect into (or attach it to) a repair case. */
export function convertDefect(a: Actor, id: string, input: unknown): { defect: Row; repairCase: Row } {
  const b = S.parse(S.DefectConvert, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'defect', id);
  if (!cur) throw notFound('Defect', id);
  authorize(a, perm('defect', 'convert'), shipScope(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  if (cur.status !== 'open') throw blocked(`Defect is ${String(cur.status)}; only an open defect can be converted`);
  return db.transaction(() => {
    let caseRow: Row;
    if (b.repairCaseId) {
      const c = getLive(db, 'repair_case', b.repairCaseId);
      if (!c) throw missing('Repair case', b.repairCaseId);
      if (c.home_scope_id !== cur.home_scope_id) throw invalid('The repair case belongs to a different ship');
      notClosed(db, 'repair_case', c.id as string);
      caseRow = c;
    } else {
      const { tag } = nextNumber(db, a.wctx.installation, REPAIR_CASE_SEQUENCE);
      caseRow = createRecord(a.wctx, 'wrk.repair_case', {
        case_no: tag, title: b.title ?? cur.title, description: cur.description ?? null, asset_id: cur.asset_id ?? null, position_id: cur.position_id ?? null,
        priority: b.priority ?? SEVERITY_PRIORITY[cur.severity as string] ?? 'normal', home_scope_id: cur.home_scope_id, opened_at: nowUtc(),
      });
    }
    updateRecord(a.wctx, 'wrk.defect', id, b.expectedVersion, { status: 'converted', repair_case_id: caseRow.id });
    audit(a, 'defect.convert', 'wrk.defect', id);
    return { defect: toApi(reload(db, 'defect', id)), repairCase: toApi(caseRow) };
  })();
}

export function dismissDefect(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.DefectDismiss, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'defect', id);
  if (!cur) throw notFound('Defect', id);
  authorize(a, perm('defect', 'dismiss'), shipScope(cur.home_scope_id));
  checkVersion(cur, b.expectedVersion);
  if (cur.status !== 'open') throw blocked(`Defect is ${String(cur.status)}; only an open defect can be dismissed`);
  updateRecord(withReason(a, b.reason).wctx, 'wrk.defect', id, b.expectedVersion, { status: 'dismissed', dismiss_reason: b.reason });
  return toApi(reload(db, 'defect', id));
}

// ------------------------------------------------------------------ repair cases

export function createCase(a: Actor, input: unknown): Row {
  const b = S.parse(S.CaseCreate, input);
  const db = a.wctx.db;
  const t = resolveTarget(db, b);
  authorize(a, perm('repair_case', 'create'), shipScope(t.shipId));
  assertSiteHeldHere(a, t.shipId);
  return db.transaction(() => {
    const { tag } = nextNumber(db, a.wctx.installation, REPAIR_CASE_SEQUENCE);
    return toApi(createRecord(a.wctx, 'wrk.repair_case', {
      case_no: tag, title: b.title, description: b.description ?? null, asset_id: t.assetId, position_id: t.positionId, priority: b.priority ?? 'normal',
      home_scope_id: t.shipId, opened_at: nowUtc(),
    }));
  })();
}

export function caseProgress(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ProgressChange, input);
  const db = a.wctx.db;
  const c = getLive(db, 'repair_case', id);
  if (!c) throw notFound('Repair case', id);
  authorize(a, perm('repair_case', 'progress'), shipScope(c.home_scope_id));
  const ax = notClosed(db, 'repair_case', id);
  assertTransition('progress', ax.progress, b.to);
  appendStatus(a, 'repair_case', c, 'progress', b.to, { note: b.note, occurredAt: b.occurredAt });
  return { ...toApi(c), axes: currentAxes(db, 'repair_case', id) };
}

export function closeCase(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.CloseRequest, input);
  const db = a.wctx.db;
  const c = getLive(db, 'repair_case', id);
  if (!c) throw notFound('Repair case', id);
  authorize(a, perm('repair_case', 'close'), shipScope(c.home_scope_id));
  const ax = currentAxes(db, 'repair_case', id);
  assertTransition('closure', ax.closure, 'closed');
  const open = db.prepare("SELECT wo_no FROM wrk_v_work_order_overview WHERE repair_case_id = ? AND closure <> 'closed' ORDER BY wo_no").all(id) as Array<{ wo_no: string }>;
  if (open.length) throw blocked(`Work orders still open: ${open.map((o) => o.wo_no).join(', ')}`, { openWorkOrders: open.map((o) => o.wo_no) });
  appendStatus(a, 'repair_case', c, 'closure', 'closed', { note: b.note });
  audit(a, 'repair_case.close', 'wrk.repair_case', id);
  return { ...toApi(c), axes: currentAxes(db, 'repair_case', id) };
}

export function reopenCase(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ReopenRequest, input);
  const db = a.wctx.db;
  const c = getLive(db, 'repair_case', id);
  if (!c) throw notFound('Repair case', id);
  authorize(a, perm('repair_case', 'reopen'), shipScope(c.home_scope_id));
  const ax = currentAxes(db, 'repair_case', id);
  assertTransition('closure', ax.closure, 'reopened');
  db.transaction(() => {
    appendStatus(a, 'repair_case', c, 'closure', 'reopened', { note: b.reason });
    if (ax.progress === 'work_complete') appendStatus(a, 'repair_case', c, 'progress', 'in_progress', { note: b.reason });
    audit(withReason(a, b.reason), 'repair_case.reopen', 'wrk.repair_case', id);
  })();
  return { ...toApi(c), axes: currentAxes(db, 'repair_case', id) };
}

// ------------------------------------------------------------------ work orders

export function createWorkOrder(a: Actor, input: unknown): Row {
  const b = S.parse(S.WorkOrderCreate, input);
  const db = a.wctx.db;
  let kase: Row | undefined;
  if (b.repairCaseId) {
    kase = getLive(db, 'repair_case', b.repairCaseId);
    if (!kase) throw missing('Repair case', b.repairCaseId);
  }
  const t = resolveTarget(db, { assetId: b.assetId ?? (kase?.asset_id as string | null) ?? null, positionId: b.positionId ?? (kase?.position_id as string | null) ?? null, shipId: b.shipId ?? (kase?.home_scope_id as string | null) ?? null });
  if (kase && kase.home_scope_id !== t.shipId) throw invalid('The repair case belongs to a different ship');
  authorize(a, perm('work_order', 'create'), shipScope(t.shipId));
  assertSiteHeldHere(a, t.shipId);
  requireParty(db, b.operatingParty, 'Operating party');
  requireParty(db, b.executingParty, 'Executing party');
  return db.transaction(() => {
    if (kase) notClosed(db, 'repair_case', kase.id as string);
    const { tag } = nextNumber(db, a.wctx.installation, WORK_ORDER_SEQUENCE);
    const row = createRecord(a.wctx, 'wrk.work_order', {
      wo_no: tag, repair_case_id: kase?.id ?? null, title: b.title, description: b.description ?? null, work_type: b.workType ?? 'corrective', priority: b.priority ?? 'normal',
      asset_id: t.assetId, position_id: t.positionId, home_scope_id: t.shipId, requested_due: b.requestedDue ?? null,
      ...partyCols('operating_party', b.operatingParty ?? (t.assetId || t.positionId ? { kind: 'ship', id: t.shipId } : null)), ...partyCols('executing_party', b.executingParty),
    });
    audit(a, 'work_order.create', 'wrk.work_order', row.id as string);
    return { ...toApi(row), axes: currentAxes(db, 'work_order', row.id as string) };
  })();
}

export function updateWorkOrder(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, operatingParty, executingParty, ...rest } = S.parse(S.WorkOrderUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'work_order', id);
  if (!cur) throw notFound('Work order', id);
  authorize(a, perm('work_order', 'update'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  notClosed(db, 'work_order', id);
  requireParty(db, operatingParty, 'Operating party');
  requireParty(db, executingParty, 'Executing party');
  updateRecord(a.wctx, 'wrk.work_order', id, expectedVersion, {
    ...snake(rest), ...(operatingParty !== undefined ? partyCols('operating_party', operatingParty) : {}), ...(executingParty !== undefined ? partyCols('executing_party', executingParty) : {}),
  });
  return toApi(reload(db, 'work_order', id));
}

function requireWorkOrder(db: Db, id: string): Row {
  const w = getLive(db, 'work_order', id);
  if (!w) throw notFound('Work order', id);
  return w;
}

export function changeProgress(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ProgressChange, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'progress'), shipScope(w.home_scope_id));
  return db.transaction(() => {
    const ax = notClosed(db, 'work_order', id);
    assertTransition('progress', ax.progress, b.to);
    if (ax.progress === 'planned' && b.to === 'in_progress') {
      if (ax.approval === 'rejected') throw blocked('The approval was rejected; request a new review before starting');
      const g = approvalsOf(a).evaluateGate(GATE_APPROVE, { type: 'wrk.work_order', id }, a.principal);
      if (g.mode === 'mandatory_prior' && !g.satisfied) throw blocked(g.blockedReason ? `Approval is required before work starts: ${g.blockedReason}` : 'Approval is required before work starts', { gate: GATE_APPROVE, mode: g.mode });
      if (g.mode === 'review_pending_allowed' && !g.satisfied && ax.approval === 'not_required') appendStatus(a, 'work_order', w, 'approval', 'pending_review', { note: 'Started before approval; review pending' });
    }
    appendStatus(a, 'work_order', w, 'progress', b.to, { note: b.note, occurredAt: b.occurredAt });
    audit(a, `work_order.${b.to}`, 'wrk.work_order', id);
    return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
  })();
}

export function requestReview(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ReviewRequest, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'request_review'), shipScope(w.home_scope_id));
  const ax = notClosed(db, 'work_order', id);
  assertTransition('approval', ax.approval, 'pending_review');
  appendStatus(a, 'work_order', w, 'approval', 'pending_review', { note: b.note });
  return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
}

/** Approve or reject a work order awaiting review. The decision itself is an M02 approval (immutable, keyed by user id); the axis records it. */
export function decideApproval(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ApprovalDecision, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, GATE_APPROVE, shipScope(w.home_scope_id));
  return db.transaction(() => {
    const ax = notClosed(db, 'work_order', id);
    if (ax.approval !== 'pending_review') throw blocked('The work order is not awaiting review', { approval: ax.approval });
    const decidedAt = b.decidedAt ?? nowUtc();
    const rec = approvalsOf(a).recordApproval({ gateCode: GATE_APPROVE, subject: { type: 'wrk.work_order', id }, decision: b.decision, principal: a.principal, decidedAt, ...(b.comment ? { comment: b.comment } : {}) });
    appendStatus(a, 'work_order', w, 'approval', b.decision, { note: b.comment, approvalId: rec.approvalId, provisional: rec.provisional, occurredAt: decidedAt });
    return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
  })();
}

/** Repair acceptance by the operating side: accepted (cleared / restricted) or rejected (withheld, back to rework). */
export function acceptRepair(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.Acceptance, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('acceptance', 'create'), shipScope(w.home_scope_id));
  let rts: 'cleared' | 'restricted' | 'withheld';
  if (b.decision === 'accepted') {
    rts = b.returnToService ?? 'cleared';
    if (rts === 'withheld') throw invalid('An accepted repair is cleared or restricted; reject it to withhold return to service');
    if (rts === 'restricted' && !b.restrictions) throw invalid('Say what the restrictions are');
  } else {
    if (b.returnToService && b.returnToService !== 'withheld') throw invalid('A rejected repair withholds return to service');
    if (!b.remarks) throw invalid('Say why the repair was rejected');
    rts = 'withheld';
  }
  return db.transaction(() => {
    const ax = notClosed(db, 'work_order', id);
    if (ax.progress !== 'work_complete') throw blocked('Work must be complete before the repair can be accepted', { progress: ax.progress });
    const decidedAt = b.decidedAt ?? nowUtc();
    const g = approvalsOf(a).evaluateGate(GATE_ACCEPT, { type: 'wrk.work_order', id }, a.principal);
    let approvalId: string | null = null;
    let provisional = false;
    if (g.mode !== 'none') {
      authorize(a, GATE_ACCEPT, shipScope(w.home_scope_id));
      const rec = approvalsOf(a).recordApproval({ gateCode: GATE_ACCEPT, subject: { type: 'wrk.work_order', id }, decision: b.decision === 'accepted' ? 'approved' : 'rejected', principal: a.principal, decidedAt, ...(b.remarks ? { comment: b.remarks } : {}) });
      approvalId = rec.approvalId;
      provisional = rec.provisional;
    }
    appendEvent(a.wctx, 'wrk.acceptance', {
      home_scope_id: w.home_scope_id ?? null, occurred_at: decidedAt, work_order_id: id, decision: b.decision, return_to_service: rts,
      restrictions: b.restrictions ?? null, remarks: b.remarks ?? null, approval_id: approvalId, provisional: provisional ? 1 : 0,
    });
    if (ax.returnToService !== rts) appendStatus(a, 'work_order', w, 'return_to_service', rts, { note: b.restrictions ?? b.remarks, approvalId, provisional, occurredAt: decidedAt });
    if (b.decision === 'rejected') appendStatus(a, 'work_order', w, 'progress', 'in_progress', { note: `Acceptance rejected: ${b.remarks}`, occurredAt: decidedAt });
    audit(a, `work_order.repair_${b.decision}`, 'wrk.work_order', id);
    return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
  })();
}

export function closeWorkOrder(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.CloseRequest, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'close'), shipScope(w.home_scope_id));
  return db.transaction(() => {
    const ax = currentAxes(db, 'work_order', id);
    assertTransition('closure', ax.closure, 'closed');
    if (ax.progress !== 'work_complete') throw blocked('Work must be complete before the order is closed', { progress: ax.progress });
    if (ax.approval === 'pending_review' || ax.approval === 'rejected') throw blocked(`Approval is ${ax.approval.replace('_', ' ')}; resolve it before closing`, { approval: ax.approval });
    if (w.work_type === 'corrective' && ax.returnToService === 'not_assessed') throw blocked('Record the repair acceptance (return to service) before closing', { returnToService: ax.returnToService });
    if (ax.returnToService === 'withheld') throw blocked('Return to service is withheld; rework or accept the repair before closing');
    const open = db.prepare("SELECT seq FROM wrk_job_card WHERE work_order_id = ? AND deleted_at IS NULL AND status IN ('draft','issued') ORDER BY seq").all(id) as Array<{ seq: number }>;
    if (open.length) throw blocked(`Job cards not completed: ${open.map((o) => o.seq).join(', ')}`, { jobCards: open.map((o) => o.seq) });
    appendStatus(a, 'work_order', w, 'closure', 'closed', { note: b.note });
    audit(a, 'work_order.close', 'wrk.work_order', id);
    return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
  })();
}

export function reopenWorkOrder(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.ReopenRequest, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'reopen'), shipScope(w.home_scope_id));
  return db.transaction(() => {
    const ax = currentAxes(db, 'work_order', id);
    assertTransition('closure', ax.closure, 'reopened');
    appendStatus(a, 'work_order', w, 'closure', 'reopened', { note: b.reason });
    if (ax.progress !== 'in_progress') appendStatus(a, 'work_order', w, 'progress', 'in_progress', { note: b.reason });
    if (ax.returnToService !== 'not_assessed') appendStatus(a, 'work_order', w, 'return_to_service', 'not_assessed', { note: 'Reopened: return to service must be assessed again' });
    audit(withReason(a, b.reason), 'work_order.reopen', 'wrk.work_order', id);
    return { ...toApi(w), axes: currentAxes(db, 'work_order', id) };
  })();
}

export function tombstoneWorkOrder(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'remove'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  const used = ['wrk_status_event WHERE subject_id', 'wrk_labour_entry WHERE work_order_id', 'wrk_finding WHERE work_order_id', 'wrk_test_record WHERE work_order_id', 'wrk_acceptance WHERE work_order_id', 'wrk_handover WHERE work_order_id']
    .some((t) => exists(db, `SELECT 1 FROM ${t} = ?`, id));
  if (used) throw blocked('Work has been recorded against this order; close it instead of removing it');
  return db.transaction(() => {
    for (const j of db.prepare('SELECT id, version FROM wrk_job_card WHERE work_order_id = ? AND deleted_at IS NULL').all(id) as Array<{ id: string; version: number }>) tombstoneRecord(a.wctx, 'wrk.job_card', j.id, j.version, reason);
    tombstoneRecord(a.wctx, 'wrk.work_order', id, expectedVersion, reason);
    return toApi(reload(db, 'work_order', id));
  })();
}

// ------------------------------------------------------------------ hand-over of execution

export function offerHandover(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.HandoverOffer, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  authorize(a, perm('work_order', 'handover'), shipScope(w.home_scope_id));
  requireOwner(a, w, 'This work order');
  requireParty(db, b.toParty, 'Receiving party');
  return db.transaction(() => {
    notClosed(db, 'work_order', id);
    if (exists(db, "SELECT 1 FROM wrk_v_handover_state WHERE work_order_id = ? AND status = 'pending'", id)) throw blocked('A hand-over offer is already waiting for a reply; withdraw it first');
    const ev = appendEvent(a.wctx, 'wrk.handover', { home_scope_id: w.home_scope_id ?? null, work_order_id: id, kind: 'offer', to_party_kind: b.toParty.kind, to_party_id: b.toParty.id, note: b.note ?? null });
    audit(a, 'work_order.handover_offer', 'wrk.work_order', id);
    return toApi(ev);
  })();
}

/** The receiving side accepts or declines; the owner can withdraw. Accepting makes the receiving party the executing party; the record itself stays with its owner until M10 moves it. */
export function respondHandover(a: Actor, id: string, input: unknown): Row {
  const b = S.parse(S.HandoverRespond, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, id);
  const offer = db.prepare("SELECT * FROM wrk_v_handover_state WHERE offer_id = ? AND work_order_id = ?").get(b.offerId, id) as Row | undefined;
  if (!offer) throw notFound('Hand-over offer', b.offerId);
  if (b.action === 'withdraw') {
    authorize(a, perm('work_order', 'handover'), shipScope(w.home_scope_id));
    requireOwner(a, w, 'This work order');
  } else {
    authorize(a, perm('work_order', 'accept_handover'), shipScope(w.home_scope_id));
    const kind = offer.to_party_kind as string;
    if (kind === 'ship' || kind === 'workshop') assertSiteHeldHere(a, offer.to_party_id as string);
  }
  return db.transaction(() => {
    const state = db.prepare('SELECT status FROM wrk_v_handover_state WHERE offer_id = ?').get(b.offerId) as { status: string };
    if (state.status !== 'pending') throw blocked(`The offer was already ${state.status}`, { status: state.status });
    const ev = appendEvent(a.wctx, 'wrk.handover', { home_scope_id: w.home_scope_id ?? null, work_order_id: id, kind: b.action, offer_id: b.offerId, note: b.note ?? null });
    audit(a, `work_order.handover_${b.action}`, 'wrk.work_order', id);
    return toApi(ev);
  })();
}

// ------------------------------------------------------------------ job cards

export function createJobCard(a: Actor, input: unknown): Row {
  const b = S.parse(S.JobCardCreate, input);
  const db = a.wctx.db;
  const w = requireWorkOrder(db, b.workOrderId);
  authorize(a, perm('job_card', 'create'), shipScope(w.home_scope_id));
  assertSiteHeldHere(a, w.home_scope_id as string);
  return db.transaction(() => {
    notClosed(db, 'work_order', b.workOrderId);
    const next = ((db.prepare('SELECT MAX(seq) AS m FROM wrk_job_card WHERE work_order_id = ?').get(b.workOrderId) as { m: number | null }).m ?? 0) + 1;
    return toApi(createRecord(a.wctx, 'wrk.job_card', {
      work_order_id: b.workOrderId, home_scope_id: w.home_scope_id, seq: next, title: b.title, instructions: b.instructions ?? null,
      checklist_json: JSON.stringify(b.checklist.map((text) => ({ text, done: false }))), status: 'draft',
    }));
  })();
}

export function updateJobCard(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, checklist, status, ...rest } = S.parse(S.JobCardUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'job_card', id);
  if (!cur) throw notFound('Job card', id);
  authorize(a, perm('job_card', 'update'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (cur.status === 'completed' || cur.status === 'void') throw blocked(`Job card is ${String(cur.status)} and can no longer be changed`);
  notClosed(db, 'work_order', cur.work_order_id as string);
  const items = checklist ?? (JSON.parse(String(cur.checklist_json)) as Array<{ text: string; done: boolean }>);
  const patch: Row = { ...snake(rest), ...(checklist ? { checklist_json: JSON.stringify(checklist) } : {}) };
  if (status) {
    if (status === 'issued' && cur.status !== 'draft') throw blocked('Only a draft job card can be issued');
    if (status === 'completed') {
      if (cur.status !== 'issued') throw blocked('Issue the job card before completing it');
      const undone = items.filter((i) => !i.done);
      if (undone.length) throw blocked(`${undone.length} checklist item(s) are not done`, { undone: undone.map((i) => i.text) });
      patch.completed_at = nowUtc();
    }
    patch.status = status;
  }
  updateRecord(a.wctx, 'wrk.job_card', id, expectedVersion, patch);
  return toApi(reload(db, 'job_card', id));
}

export function tombstoneJobCard(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'job_card', id);
  if (!cur) throw notFound('Job card', id);
  authorize(a, perm('job_card', 'remove'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (cur.status !== 'draft') throw blocked('Only a draft job card can be removed; void an issued one');
  tombstoneRecord(a.wctx, 'wrk.job_card', id, expectedVersion, reason);
  return toApi(reload(db, 'job_card', id));
}

// ------------------------------------------------------------------ labour, findings, tests (events)

function workEvent(a: Actor, workOrderId: string, noun: 'labour_entry' | 'finding' | 'test_record', type: string, values: Row, occurredAt?: string): Row {
  const db = a.wctx.db;
  const w = requireWorkOrder(db, workOrderId);
  authorize(a, perm(noun, 'create'), shipScope(w.home_scope_id));
  return db.transaction(() => {
    notClosed(db, 'work_order', workOrderId);
    return toApi(appendEvent(a.wctx, type, { home_scope_id: w.home_scope_id ?? null, ...(occurredAt ? { occurred_at: occurredAt } : {}), work_order_id: workOrderId, ...values }));
  })();
}
export function addLabour(a: Actor, workOrderId: string, input: unknown): Row {
  const b = S.parse(S.LabourCreate, input);
  return workEvent(a, workOrderId, 'labour_entry', 'wrk.labour_entry', { worker_name: b.workerName, trade: b.trade ?? null, minutes: b.minutes, note: b.note ?? null }, b.occurredAt);
}
export function addFinding(a: Actor, workOrderId: string, input: unknown): Row {
  const b = S.parse(S.FindingCreate, input);
  return workEvent(a, workOrderId, 'finding', 'wrk.finding', { kind: b.kind, text: b.text }, b.occurredAt);
}
export function addTestRecord(a: Actor, workOrderId: string, input: unknown): Row {
  const b = S.parse(S.TestCreate, input);
  return workEvent(a, workOrderId, 'test_record', 'wrk.test_record', { test_name: b.testName, result: b.result, measured_value: b.measuredValue ?? null, note: b.note ?? null }, b.occurredAt);
}

// ------------------------------------------------------------------ defect / case edits and removal

export function updateDefect(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.DefectUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'defect', id);
  if (!cur) throw notFound('Defect', id);
  authorize(a, perm('defect', 'update'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (cur.status !== 'open') throw blocked(`Defect is ${String(cur.status)} and can no longer be edited`);
  updateRecord(a.wctx, 'wrk.defect', id, expectedVersion, snake(rest));
  return toApi(reload(db, 'defect', id));
}
export function tombstoneDefect(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'defect', id);
  if (!cur) throw notFound('Defect', id);
  authorize(a, perm('defect', 'remove'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (cur.status === 'converted') throw blocked('Defect was converted to a repair case and must be kept');
  tombstoneRecord(a.wctx, 'wrk.defect', id, expectedVersion, reason);
  return toApi(reload(db, 'defect', id));
}
export function updateCase(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.CaseUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'repair_case', id);
  if (!cur) throw notFound('Repair case', id);
  authorize(a, perm('repair_case', 'update'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  notClosed(db, 'repair_case', id);
  updateRecord(a.wctx, 'wrk.repair_case', id, expectedVersion, snake(rest));
  return toApi(reload(db, 'repair_case', id));
}
export function tombstoneCase(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'repair_case', id);
  if (!cur) throw notFound('Repair case', id);
  authorize(a, perm('repair_case', 'remove'), shipScope(cur.home_scope_id));
  checkVersion(cur, expectedVersion);
  if (exists(db, 'SELECT 1 FROM wrk_work_order WHERE repair_case_id = ? AND deleted_at IS NULL', id) || exists(db, 'SELECT 1 FROM wrk_defect WHERE repair_case_id = ? AND deleted_at IS NULL', id)) {
    throw blocked('Work orders or defects are attached to this case; close it instead of removing it');
  }
  tombstoneRecord(a.wctx, 'wrk.repair_case', id, expectedVersion, reason);
  return toApi(reload(db, 'repair_case', id));
}

// ------------------------------------------------------------------ advisories (hub reference data)

function assertHub(a: Actor): void {
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'wrk.advisory is hub-owned reference data; it can only be changed at the hub', { entityType: 'wrk.advisory' });
}
export function createAdvisory(a: Actor, input: unknown): Row {
  const b = S.parse(S.AdvisoryCreate, input);
  authorize(a, perm('advisory', 'create'), { kind: 'fleet' });
  assertHub(a);
  if (exists(a.wctx.db, 'SELECT 1 FROM wrk_advisory WHERE code = ? AND deleted_at IS NULL', b.code)) throw new AppError('DUPLICATE', 'An advisory with this code already exists', { fields: ['code'] });
  const { issuedAt, ...rest } = b;
  return toApi(createRecord(a.wctx, 'wrk.advisory', { ...snake(rest), issued_at: issuedAt ?? nowUtc() }));
}
export function updateAdvisory(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.AdvisoryUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'advisory', id);
  if (!cur) throw notFound('Advisory', id);
  authorize(a, perm('advisory', 'update'), { kind: 'fleet' });
  assertHub(a);
  checkVersion(cur, expectedVersion);
  updateRecord(a.wctx, 'wrk.advisory', id, expectedVersion, snake(rest));
  return toApi(reload(db, 'advisory', id));
}
export function tombstoneAdvisory(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'advisory', id);
  if (!cur) throw notFound('Advisory', id);
  authorize(a, perm('advisory', 'remove'), { kind: 'fleet' });
  assertHub(a);
  checkVersion(cur, expectedVersion);
  tombstoneRecord(a.wctx, 'wrk.advisory', id, expectedVersion, reason);
  return toApi(reload(db, 'advisory', id));
}

/** Active advisories that apply to an asset (same classification), newest first. */
export function advisoriesForAsset(db: Db, assetId: string): Row[] {
  const asset = getAsset(db, assetId);
  if (!asset?.classificationId) return [];
  return (db.prepare("SELECT * FROM wrk_advisory WHERE classification_id = ? AND status = 'active' AND deleted_at IS NULL ORDER BY issued_at DESC, id DESC").all(asset.classificationId) as Row[]).map(toApi);
}
