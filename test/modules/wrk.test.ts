import { describe, expect, it } from 'vitest';
import { createAsset, createEntity as createAstEntity } from '../../src/modules/m03-assets/service.js';
import {
  advisoriesForAsset, createWorkOrder, currentAxes, GATE_ACCEPT, GATE_APPROVE, getWorkOrder, openWorkOrdersForAsset, resolveWorkOrderNo, WRK_PERMISSIONS,
} from '../../src/modules/m05-work/index.js';
import {
  acceptRepair, addFinding, addLabour, addTestRecord, caseProgress, changeProgress, closeCase, closeWorkOrder, convertDefect, createAdvisory, createCase,
  createJobCard, decideApproval, dismissDefect, offerHandover, reopenCase, reopenWorkOrder, reportDefect, requestReview, respondHandover, tombstoneDefect,
  tombstoneJobCard, tombstoneWorkOrder, updateJobCard, updateWorkOrder,
} from '../../src/modules/m05-work/service.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { appendEvent, verifySyncedTables } from '../../src/platform/records.js';
import { denyOnly } from './org-helpers.js';
import { DAY, HOUR, codeOf, iso, sql } from './ast-helpers.js';
import { makeWrkEnv, stubApprovals, type WrkEnv } from './wrk-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;
const asset = (env: WrkEnv, over: Record<string, unknown> = {}) => createAsset(env.hubActor(), { name: 'Pump', homeShipId: env.shipId, ...over }).asset;
const wo = (env: WrkEnv, over: Record<string, unknown> = {}, a = env.asHub()) => createWorkOrder(a, { title: 'Replace seal', shipId: env.shipId, ...over });
/** Drive a work order through to work_complete. */
const complete = (a: ReturnType<WrkEnv['asHub']>, workOrderId: string) => {
  changeProgress(a, workOrderId, { to: 'in_progress' });
  return changeProgress(a, workOrderId, { to: 'work_complete' });
};

describe('registration', () => {
  it('registers cleanly with well-formed, unique permission codes', () => {
    const env = makeWrkEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('wrk.status_event').recordClass).toBe('event');
    expect(env.ctx.entities.get('wrk.work_order').recordClass).toBe('owner_mutable');
    expect(env.ctx.entities.get('wrk.advisory').recordClass).toBe('hub_reference');
    for (const p of WRK_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(new Set(WRK_PERMISSIONS).size).toBe(WRK_PERMISSIONS.length);
    expect(WRK_PERMISSIONS).toContain(GATE_APPROVE);
    expect(WRK_PERMISSIONS).toContain(GATE_ACCEPT);
  });
});

describe('defects and repair cases', () => {
  it('reports against an asset (ship derived), a position, or a ship; needs at least one', () => {
    const env = makeWrkEnv();
    const a = asset(env);
    const d1 = reportDefect(env.asHub(), { title: 'Leaking', assetId: id(a), severity: 'major' });
    expect(d1).toMatchObject({ defectNo: 'SLN-DF-00000001', homeScopeId: env.shipId, status: 'open', severity: 'major', assetId: id(a) });
    const pos = createAstEntity(env.hubActor(), 'position', { shipId: env.ship2Id, positionTag: '1', name: 'Pumps' });
    expect(reportDefect(env.asHub(), { title: 'Noise', positionId: id(pos) })).toMatchObject({ homeScopeId: env.ship2Id, defectNo: 'SLN-DF-00000002' });
    expect(reportDefect(env.asHub(), { title: 'Smell', shipId: env.shipId }).homeScopeId).toBe(env.shipId);
    expect(codeOf(() => reportDefect(env.asHub(), { title: 'Nothing' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => reportDefect(env.asHub(), { title: 'Mismatch', assetId: id(a), shipId: env.ship2Id }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => reportDefect(env.asHub(), { title: 'Ghost', assetId: '0198f000-0000-7000-8000-000000000000' }))).toBe('DEPENDENCY_MISSING');
  });

  it('converts to a repair case, attaches to an existing case, dismisses with a reason', () => {
    const env = makeWrkEnv();
    const a = asset(env);
    const d1 = reportDefect(env.asHub(), { title: 'Leaking', assetId: id(a), severity: 'critical' });
    const out = convertDefect(env.asHub(), id(d1), { expectedVersion: 1 });
    expect(out.repairCase).toMatchObject({ caseNo: 'SLN-RC-00000001', priority: 'urgent', assetId: id(a), title: 'Leaking' });
    expect(out.defect).toMatchObject({ status: 'converted', repairCaseId: id(out.repairCase), version: 2 });
    expect(codeOf(() => convertDefect(env.asHub(), id(d1), { expectedVersion: 2 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneDefect(env.asHub(), id(d1), { expectedVersion: 2, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');

    const d2 = reportDefect(env.asHub(), { title: 'Leaking again', assetId: id(a) });
    const again = convertDefect(env.asHub(), id(d2), { expectedVersion: 1, repairCaseId: id(out.repairCase) });
    expect(again.repairCase.id).toBe(id(out.repairCase));
    expect(sql(env, 'SELECT COUNT(*) n FROM wrk_repair_case')[0]!.n).toBe(1);

    const d3 = reportDefect(env.asHub(), { title: 'False alarm', shipId: env.shipId });
    expect(codeOf(() => dismissDefect(env.asHub(), id(d3), { expectedVersion: 1, reason: ' ' }))).toBe('VALIDATION_FAILED');
    expect(dismissDefect(env.asHub(), id(d3), { expectedVersion: 1, reason: 'Sensor fault' })).toMatchObject({ status: 'dismissed', dismissReason: 'Sensor fault' });
    expect(codeOf(() => convertDefect(env.asHub(), id(d3), { expectedVersion: 2 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => convertDefect(env.asHub(), id(d2), { expectedVersion: 99 }))).toBe('VERSION_CONFLICT');
  });

  it('a ship reports only for itself; numbers come from its own range', () => {
    const env = makeWrkEnv();
    const ship = env.asShip(env.shipId);
    expect(codeOf(() => reportDefect(ship, { title: 'x', shipId: env.shipId }))).toBe('RANGE_EXHAUSTED');
    env.grantWork(ship.wctx.installation.installationId, 5);
    expect(reportDefect(ship, { title: 'Mine', shipId: env.shipId }).defectNo).toBe('SLN-DF-00000051');
    expect(codeOf(() => reportDefect(ship, { title: 'Theirs', shipId: env.ship2Id }))).toBe('NOT_OWNER');
  });

  it('a repair case closes only when its work orders are closed; reopening is explicit', () => {
    const env = makeWrkEnv();
    const c = createCase(env.asHub(), { title: 'Generator trips', shipId: env.shipId });
    expect(c.caseNo).toBe('SLN-RC-00000001');
    const w = wo(env, { repairCaseId: id(c) });
    expect(codeOf(() => closeCase(env.asHub(), id(c), {}))).toBe('WORKFLOW_BLOCKED');
    complete(env.asHub(), id(w));
    acceptRepair(env.asHub(), id(w), { decision: 'accepted' });
    closeWorkOrder(env.asHub(), id(w), {});
    caseProgress(env.asHub(), id(c), { to: 'in_progress' });
    expect((closeCase(env.asHub(), id(c), { note: 'done' }).axes as { closure: string }).closure).toBe('closed');
    expect(codeOf(() => caseProgress(env.asHub(), id(c), { to: 'on_hold' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => wo(env, { repairCaseId: id(c) }))).toBe('WORKFLOW_BLOCKED');
    expect((reopenCase(env.asHub(), id(c), { reason: 'Fault returned' }).axes as { closure: string }).closure).toBe('reopened');
    expect(wo(env, { repairCaseId: id(c) }).woNo).toBe('SLN-WO-00000002');
  });
});

describe('work orders: four independent axes', () => {
  it('starts planned / not required / not assessed / open and numbers from the range', () => {
    const env = makeWrkEnv();
    const a = asset(env);
    const w = wo(env, { assetId: id(a) });
    expect(w).toMatchObject({ woNo: 'SLN-WO-00000001', homeScopeId: env.shipId, workType: 'corrective', priority: 'normal', operatingParty: { kind: 'ship', id: env.shipId }, executingParty: null });
    expect(w.axes).toEqual({ progress: 'planned', approval: 'not_required', returnToService: 'not_assessed', closure: 'open' });
    expect(resolveWorkOrderNo(env.ctx.db, 'sln-wo-00000001')?.id).toBe(id(w));
    expect(getWorkOrder(env.ctx.db, id(w))?.axes.progress).toBe('planned');
    expect(openWorkOrdersForAsset(env.ctx.db, id(a)).map((x) => x.id)).toEqual([id(w)]);
  });

  it('runs a repair end to end: progress, labour, findings, tests, acceptance, close, reopen', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    const W = id(w);
    expect(codeOf(() => changeProgress(env.asHub(), W, { to: 'work_complete' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => acceptRepair(env.asHub(), W, { decision: 'accepted' }))).toBe('WORKFLOW_BLOCKED'); // work not complete
    changeProgress(env.asHub(), W, { to: 'in_progress', note: 'Started' });
    addLabour(env.asHub(), W, { workerName: 'A. Perera', trade: 'Fitter', minutes: 90 });
    addLabour(env.asHub(), W, { workerName: 'B. Silva', minutes: 30 });
    addFinding(env.asHub(), W, { kind: 'cause', text: 'Seal worn' });
    addTestRecord(env.asHub(), W, { testName: 'Pressure test', result: 'pass', measuredValue: '6 bar' });
    expect(sql(env, 'SELECT labour_minutes FROM wrk_v_work_order_overview WHERE work_order_id = ?', W)[0]!.labour_minutes).toBe(120);
    expect(codeOf(() => addLabour(env.asHub(), W, { workerName: 'X', minutes: 0 }))).toBe('VALIDATION_FAILED');

    changeProgress(env.asHub(), W, { to: 'on_hold' });
    changeProgress(env.asHub(), W, { to: 'in_progress' });
    changeProgress(env.asHub(), W, { to: 'work_complete' });
    expect(codeOf(() => closeWorkOrder(env.asHub(), W, {}))).toBe('WORKFLOW_BLOCKED'); // corrective: needs return-to-service decision
    const accepted = acceptRepair(env.asHub(), W, { decision: 'accepted', remarks: 'Tested OK' });
    expect(accepted.axes).toMatchObject({ progress: 'work_complete', returnToService: 'cleared', closure: 'open' });
    expect(closeWorkOrder(env.asHub(), W, { note: 'All done' }).axes).toMatchObject({ closure: 'closed' });

    expect(codeOf(() => addLabour(env.asHub(), W, { workerName: 'Late', minutes: 5 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => updateWorkOrder(env.asHub(), W, { expectedVersion: 1, title: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => reopenWorkOrder(env.asHub(), W, { reason: '' }))).toBe('VALIDATION_FAILED');
    expect(reopenWorkOrder(env.asHub(), W, { reason: 'Seal leaks again' }).axes).toEqual({ progress: 'in_progress', approval: 'not_required', returnToService: 'not_assessed', closure: 'reopened' });
    expect(codeOf(() => closeWorkOrder(env.asHub(), W, {}))).toBe('WORKFLOW_BLOCKED'); // progress not complete again
    expect(sql(env, "SELECT COUNT(*) n FROM wrk_status_event WHERE subject_id = ? AND axis = 'closure'", W)[0]!.n).toBe(2);
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE action = 'work_order.close' AND entity_id = ?", W)[0]!.n).toBe(1);
  });

  it('derives the current axis from the latest event by time, so late-arriving older events cannot overwrite (D20)', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    changeProgress(env.asHub(), id(w), { to: 'in_progress' });
    // An event recorded elsewhere earlier in time arrives late: accepted, but it does not become the current value.
    appendEvent(env.asHub().wctx, 'wrk.status_event', { home_scope_id: env.shipId, occurred_at: iso(-3 * DAY), subject_type: 'work_order', subject_id: id(w), axis: 'progress', value: 'on_hold', note: 'replicated' });
    expect(currentAxes(env.ctx.db, 'work_order', id(w)).progress).toBe('in_progress');
    appendEvent(env.asHub().wctx, 'wrk.status_event', { home_scope_id: env.shipId, occurred_at: iso(HOUR), subject_type: 'work_order', subject_id: id(w), axis: 'progress', value: 'work_complete' });
    expect(currentAxes(env.ctx.db, 'work_order', id(w)).progress).toBe('work_complete');
  });

  it('acceptance: restricted needs restrictions, rejection needs remarks and sends the order back to rework', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    complete(env.asHub(), id(w));
    expect(codeOf(() => acceptRepair(env.asHub(), id(w), { decision: 'accepted', returnToService: 'withheld' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => acceptRepair(env.asHub(), id(w), { decision: 'accepted', returnToService: 'restricted' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => acceptRepair(env.asHub(), id(w), { decision: 'rejected' }))).toBe('VALIDATION_FAILED');
    expect(acceptRepair(env.asHub(), id(w), { decision: 'accepted', returnToService: 'restricted', restrictions: 'Max 80% load' }).axes).toMatchObject({ returnToService: 'restricted' });
    const rej = acceptRepair(env.asHub(), id(w), { decision: 'rejected', remarks: 'Still vibrating' });
    expect(rej.axes).toMatchObject({ returnToService: 'withheld', progress: 'in_progress' });
    expect(codeOf(() => closeWorkOrder(env.asHub(), id(w), {}))).toBe('WORKFLOW_BLOCKED');
    expect(sql(env, 'SELECT decision, return_to_service FROM wrk_acceptance WHERE work_order_id = ? ORDER BY occurred_at, id', id(w))).toEqual([
      { decision: 'accepted', return_to_service: 'restricted' }, { decision: 'rejected', return_to_service: 'withheld' },
    ]);
  });

  it('preventive work does not need a return-to-service decision to close', () => {
    const env = makeWrkEnv();
    const w = wo(env, { workType: 'preventive' });
    complete(env.asHub(), id(w));
    expect(closeWorkOrder(env.asHub(), id(w), {}).axes).toMatchObject({ closure: 'closed', returnToService: 'not_assessed' });
  });

  it('validates parties and keeps parties separate from the record owner', () => {
    const env = makeWrkEnv();
    expect(codeOf(() => wo(env, { executingParty: { kind: 'workshop', id: '0198f000-0000-7000-8000-000000000000' } }))).toBe('DEPENDENCY_MISSING');
    const w = wo(env, { operatingParty: { kind: 'department', id: env.meId }, executingParty: { kind: 'department', id: env.eeId }, requestedDue: '2026-12-01' });
    expect(w).toMatchObject({ operatingParty: { kind: 'department', id: env.meId }, executingParty: { kind: 'department', id: env.eeId }, requestedDue: '2026-12-01', ownerInstallationId: env.hub.installationId });
    expect(codeOf(() => wo(env, { requestedDue: '01/12/2026' }))).toBe('VALIDATION_FAILED');
    expect(updateWorkOrder(env.asHub(), id(w), { expectedVersion: 1, executingParty: null }).executingParty).toBeNull();
  });

  it('removes only an untouched work order', () => {
    const env = makeWrkEnv();
    const w1 = wo(env);
    expect(tombstoneWorkOrder(env.asHub(), id(w1), { expectedVersion: 1, reason: 'Duplicate' }).deletedAt).toBeTruthy();
    const w2 = wo(env);
    changeProgress(env.asHub(), id(w2), { to: 'in_progress' });
    expect(codeOf(() => tombstoneWorkOrder(env.asHub(), id(w2), { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('is atomic: an exhausted number range creates nothing', () => {
    const env = makeWrkEnv({ hubWork: 0 });
    expect(codeOf(() => wo(env))).toBe('RANGE_EXHAUSTED');
    expect(sql(env, 'SELECT COUNT(*) n FROM wrk_work_order')[0]!.n).toBe(0);
  });
});

describe('approval gates (through the ApprovalPort)', () => {
  it('mandatory_prior blocks starting until an authorized approval is recorded', () => {
    const env = makeWrkEnv();
    const ap = stubApprovals({ [GATE_APPROVE]: 'mandatory_prior' });
    const a = env.asHub(ap);
    const w = wo(env, {}, a);
    expect(codeOf(() => changeProgress(a, id(w), { to: 'in_progress' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => decideApproval(a, id(w), { decision: 'approved' }))).toBe('WORKFLOW_BLOCKED'); // not pending review yet
    requestReview(a, id(w), { note: 'Please approve' });
    expect(codeOf(() => requestReview(a, id(w), {}))).toBe('WORKFLOW_BLOCKED');
    const approved = decideApproval(a, id(w), { decision: 'approved', comment: 'OK' });
    expect(approved.axes).toMatchObject({ approval: 'approved' });
    expect(ap.decisions).toEqual([{ gateCode: GATE_APPROVE, subjectId: id(w), decision: 'approved', provisional: false }]);
    expect((changeProgress(a, id(w), { to: 'in_progress' }).axes as { progress: string }).progress).toBe('in_progress');
    expect(sql(env, "SELECT approval_id FROM wrk_status_event WHERE subject_id = ? AND axis = 'approval' AND value = 'approved'", id(w))[0]!.approval_id).toBeTruthy();
  });

  it('a rejected review blocks the start until a new review is requested', () => {
    const env = makeWrkEnv();
    const a = env.asHub(stubApprovals({ [GATE_APPROVE]: 'mandatory_prior' }));
    const w = wo(env, {}, a);
    requestReview(a, id(w), {});
    decideApproval(a, id(w), { decision: 'rejected', comment: 'Wrong scope' });
    expect(codeOf(() => changeProgress(a, id(w), { to: 'in_progress' }))).toBe('WORKFLOW_BLOCKED');
    requestReview(a, id(w), {});
    decideApproval(a, id(w), { decision: 'approved' });
    expect((changeProgress(a, id(w), { to: 'in_progress' }).axes as { approval: string }).approval).toBe('approved');
  });

  it('review_pending_allowed lets work start with the review pending, and closing waits for the decision', () => {
    const env = makeWrkEnv();
    const ap = stubApprovals({ [GATE_APPROVE]: 'review_pending_allowed' });
    const a = env.asHub(ap);
    const w = wo(env, { workType: 'preventive' }, a);
    expect(changeProgress(a, id(w), { to: 'in_progress' }).axes).toMatchObject({ progress: 'in_progress', approval: 'pending_review' });
    changeProgress(a, id(w), { to: 'work_complete' });
    expect(codeOf(() => closeWorkOrder(a, id(w), {}))).toBe('WORKFLOW_BLOCKED');
    ap.setProvisional(true); // decision taken after the authority lease expired: stamped provisional, not lost
    decideApproval(a, id(w), { decision: 'approved' });
    expect(sql(env, "SELECT provisional FROM wrk_status_event WHERE subject_id = ? AND axis = 'approval' AND value = 'approved'", id(w))[0]!.provisional).toBe(1);
    expect(closeWorkOrder(a, id(w), {}).axes).toMatchObject({ closure: 'closed' });
  });

  it('without an approval service, deciding is blocked but gate-free work proceeds', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    requestReview(env.asHub(), id(w), {});
    expect(codeOf(() => decideApproval(env.asHub(), id(w), { decision: 'approved' }))).toBe('WORKFLOW_BLOCKED');
    expect((changeProgress(env.asHub(), id(w), { to: 'in_progress' }).axes as { progress: string }).progress).toBe('in_progress');
  });

  it('acceptance records an approval only when its gate is configured', () => {
    const env = makeWrkEnv();
    const ap = stubApprovals({ [GATE_ACCEPT]: 'mandatory_prior' });
    const a = env.asHub(ap);
    const w = wo(env, {}, a);
    complete(a, id(w));
    acceptRepair(a, id(w), { decision: 'accepted', remarks: 'Fine' });
    expect(ap.decisions).toEqual([{ gateCode: GATE_ACCEPT, subjectId: id(w), decision: 'approved', provisional: false }]);
    expect(sql(env, 'SELECT approval_id FROM wrk_acceptance WHERE work_order_id = ?', id(w))[0]!.approval_id).toBeTruthy();
    const w2 = wo(env);
    complete(env.asHub(), id(w2));
    acceptRepair(env.asHub(), id(w2), { decision: 'accepted' });
    expect(sql(env, 'SELECT approval_id FROM wrk_acceptance WHERE work_order_id = ?', id(w2))[0]!.approval_id).toBeNull();
  });
});

describe('job cards', () => {
  it('numbers cards, requires a complete checklist, and blocks closing until cards are done or voided', () => {
    const env = makeWrkEnv();
    const w = wo(env, { workType: 'preventive' });
    const c1 = createJobCard(env.asHub(), { workOrderId: id(w), title: 'Isolate', checklist: ['Lock out', 'Tag out'] });
    const c2 = createJobCard(env.asHub(), { workOrderId: id(w), title: 'Inspect' });
    expect([c1.seq, c2.seq]).toEqual([1, 2]);
    expect(c1.checklist).toEqual([{ text: 'Lock out', done: false }, { text: 'Tag out', done: false }]);
    expect(codeOf(() => updateJobCard(env.asHub(), id(c1), { expectedVersion: 1, status: 'completed' }))).toBe('WORKFLOW_BLOCKED'); // not issued
    const issued = updateJobCard(env.asHub(), id(c1), { expectedVersion: 1, status: 'issued' });
    expect(codeOf(() => updateJobCard(env.asHub(), id(c1), { expectedVersion: 2, status: 'completed' }))).toBe('WORKFLOW_BLOCKED'); // checklist not done
    updateJobCard(env.asHub(), id(c1), { expectedVersion: 2, checklist: [{ text: 'Lock out', done: true }, { text: 'Tag out', done: true }] });
    const done = updateJobCard(env.asHub(), id(c1), { expectedVersion: 3, status: 'completed' });
    expect(done).toMatchObject({ status: 'completed' });
    expect(done.completedAt).toBeTruthy();
    expect(issued.status).toBe('issued');
    expect(codeOf(() => updateJobCard(env.asHub(), id(c1), { expectedVersion: 4, title: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneJobCard(env.asHub(), id(c1), { expectedVersion: 4, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');

    complete(env.asHub(), id(w));
    expect(codeOf(() => closeWorkOrder(env.asHub(), id(w), {}))).toBe('WORKFLOW_BLOCKED'); // card 2 still draft
    updateJobCard(env.asHub(), id(c2), { expectedVersion: 1, status: 'void' });
    expect(closeWorkOrder(env.asHub(), id(w), {}).axes).toMatchObject({ closure: 'closed' });
    expect(createJobCard(env.asHub(), { workOrderId: id(createWorkOrder(env.asHub(), { title: 'Other', shipId: env.shipId })), title: 'A' }).seq).toBe(1);
  });
});

describe('hand-over of execution', () => {
  it('offer, accept: the receiving party becomes the executing party; decline and withdraw are final', () => {
    const env = makeWrkEnv();
    const workshop = id(createOrgWorkshop(env));
    const w = wo(env, { executingParty: { kind: 'ship', id: env.shipId } });
    const effective = () => sql(env, 'SELECT executing_party_kind k, executing_party_id i, handover_pending p FROM wrk_v_work_order_overview WHERE work_order_id = ?', id(w))[0]!;
    expect(effective()).toMatchObject({ k: 'ship', i: env.shipId, p: 0 });

    const o1 = offerHandover(env.asHub(), id(w), { toParty: { kind: 'workshop', id: workshop }, note: 'Needs specialist' });
    expect(effective().p).toBe(1);
    expect(codeOf(() => offerHandover(env.asHub(), id(w), { toParty: { kind: 'workshop', id: workshop } }))).toBe('WORKFLOW_BLOCKED');
    expect(respondHandover(env.asHub(), id(w), { offerId: id(o1), action: 'decline' })).toMatchObject({ kind: 'decline', offerId: id(o1) });
    expect(effective()).toMatchObject({ k: 'ship', p: 0 });
    expect(codeOf(() => respondHandover(env.asHub(), id(w), { offerId: id(o1), action: 'accept' }))).toBe('WORKFLOW_BLOCKED');

    const o2 = offerHandover(env.asHub(), id(w), { toParty: { kind: 'workshop', id: workshop } });
    respondHandover(env.asHub(), id(w), { offerId: id(o2), action: 'accept' });
    expect(effective()).toMatchObject({ k: 'workshop', i: workshop, p: 0 });
    expect(sql(env, 'SELECT owner_installation_id o FROM wrk_work_order WHERE id = ?', id(w))[0]!.o).toBe(env.hub.installationId); // record owner unchanged

    const o3 = offerHandover(env.asHub(), id(w), { toParty: { kind: 'external_provider', id: id(createProvider(env)) } });
    respondHandover(env.asHub(), id(w), { offerId: id(o3), action: 'withdraw' });
    expect(effective()).toMatchObject({ k: 'workshop' });
    expect(sql(env, 'SELECT status FROM wrk_v_handover_state WHERE work_order_id = ? ORDER BY occurred_at, offer_id', id(w)).map((r) => r.status)).toEqual(['declined', 'accepted', 'withdrawn']);
  });

  it('only the owning installation offers or withdraws; the other side can still add work events', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    const ship = env.asShip(env.shipId);
    expect(codeOf(() => offerHandover(ship, id(w), { toParty: { kind: 'ship', id: env.shipId } }))).toBe('NOT_OWNER');
    env.grantWork(ship.wctx.installation.installationId, 5);
    expect(addLabour(ship, id(w), { workerName: 'Ship fitter', minutes: 45 }).minutes).toBe(45); // events are not owner-gated
    const o = offerHandover(env.asHub(), id(w), { toParty: { kind: 'ship', id: env.shipId } });
    expect(codeOf(() => respondHandover(ship, id(w), { offerId: id(o), action: 'withdraw' }))).toBe('NOT_OWNER');
    expect(codeOf(() => respondHandover(env.asShip(env.ship2Id), id(w), { offerId: id(o), action: 'accept' }))).toBe('NOT_OWNER'); // wrong site
    expect(respondHandover(ship, id(w), { offerId: id(o), action: 'accept' }).kind).toBe('accept');
  });
});

describe('advisories and recurring faults', () => {
  it('advisories are hub reference data matched to an asset by classification', () => {
    const env = makeWrkEnv();
    const cls = createAstEntity(env.hubActor(), 'classification', { code: 'PUMP', name: 'Pump', kind: 'equipment' });
    const a = asset(env, { classificationId: id(cls) });
    const plain = asset(env, { name: 'Other' });
    expect(codeOf(() => createAdvisory(env.asShip(env.shipId), { code: 'A1', title: 'x' }))).toBe('NOT_OWNER');
    const adv = createAdvisory(env.asHub(), { code: 'adv-1', title: 'Check seals', severity: 'warning', classificationId: id(cls) });
    expect(adv.code).toBe('ADV-1');
    expect(codeOf(() => createAdvisory(env.asHub(), { code: 'ADV-1', title: 'dup' }))).toBe('DUPLICATE');
    expect(advisoriesForAsset(env.ctx.db, id(a)).map((x) => x.code)).toEqual(['ADV-1']);
    expect(advisoriesForAsset(env.ctx.db, id(plain))).toEqual([]);
  });

  it('flags an asset with three or more faults in the window (defects and standalone corrective orders count)', () => {
    const env = makeWrkEnv();
    const a = asset(env);
    const b = asset(env, { name: 'Quiet' });
    reportDefect(env.asHub(), { title: 'one', assetId: id(a) });
    reportDefect(env.asHub(), { title: 'two', assetId: id(a) });
    expect(sql(env, 'SELECT * FROM wrk_v_recurring_faults')).toEqual([]);
    wo(env, { assetId: id(a), title: 'three' });
    reportDefect(env.asHub(), { title: 'single', assetId: id(b) });
    expect(sql(env, 'SELECT asset_id, occurrences FROM wrk_v_recurring_faults')).toEqual([{ asset_id: id(a), occurrences: 3 }]);
    const d = reportDefect(env.asHub(), { title: 'dismissed', assetId: id(a) });
    dismissDefect(env.asHub(), id(d), { expectedVersion: 1, reason: 'Not a fault' });
    expect(sql(env, 'SELECT occurrences FROM wrk_v_recurring_faults')[0]!.occurrences).toBe(3);
  });
});

describe('authorization', () => {
  it('denies without permission and audits the denial', () => {
    const env = makeWrkEnv();
    const w = wo(env);
    const d = env.hubActor(denyOnly('wrk.work_order.progress', 'wrk.defect.create', 'wrk.acceptance.create', 'wrk.work_order.close'));
    expect(codeOf(() => changeProgress(d, id(w), { to: 'in_progress' }))).toBe('FORBIDDEN');
    expect(codeOf(() => reportDefect(d, { title: 'x', shipId: env.shipId }))).toBe('FORBIDDEN');
    expect(codeOf(() => acceptRepair(d, id(w), { decision: 'accepted' }))).toBe('FORBIDDEN');
    expect(codeOf(() => closeWorkOrder(d, id(w), {}))).toBe('FORBIDDEN');
    expect(sql(env, "SELECT COUNT(*) n FROM sys_audit_event WHERE outcome = 'denied' AND action LIKE 'denied:wrk.%'")[0]!.n).toBe(4);
    expect(sql(env, 'SELECT COUNT(*) n FROM wrk_status_event')[0]!.n).toBe(0);
  });
});

// ---- local helpers (organization records used by the hand-over tests)
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
function createOrgWorkshop(env: WrkEnv) {
  return createOrg(env.hubActor(), 'workshop', { code: 'WS1', name: 'Electrical workshop', kind: 'specialist' });
}
function createProvider(env: WrkEnv) {
  return createOrg(env.hubActor(), 'external_provider', { code: 'EXT1', name: 'Marine Services Ltd' });
}
