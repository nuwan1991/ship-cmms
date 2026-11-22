import { describe, expect, it } from 'vitest';
import { makeActor } from '../../src/modules/m15-office/actor.js';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { createCorrespondence } from '../../src/modules/m15-office/correspondence.js';
import { createEquipment, equipmentDetail, listEquipment, recordMovement, updateEquipment } from '../../src/modules/m15-office/equipment.js';
import { createPerson } from '../../src/modules/m15-office/persons.js';
import { linksOf } from '../../src/modules/m15-office/queries.js';
import { createUnit } from '../../src/modules/m15-office/service.js';
import {
  approveWorkOrder, assignWorkOrder, cancelWorkOrder, closeWorkOrder, completeWorkOrder, createWorkOrder, getWorkOrderDetail, listWorkOrders, reopenWorkOrder, setWorkOrderStatus, verifyWorkOrder,
} from '../../src/modules/m15-office/workorders.js';
import { codeOf, sql } from './ast-helpers.js';
import { allowAll, denyOnly } from './org-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();

function office() {
  const env = makeOfcEnv();
  const C = env.commandId;
  const oic = env.hubActor();
  const as = (userId: string, ...denied: string[]) => ({ ...makeActor(env.ctx, { userId, installationId: env.hub.installationId, displayName: userId }), authz: denied.length ? denyOnly(...denied) : allowAll });
  const radar = createUnit(oic, { commandId: C, level: 'department', code: 'RADAR', name: 'Radar', headUserId: 'u-po' }).id as string;
  const pumps = createUnit(oic, { commandId: C, level: 'department', code: 'PUMPS', name: 'Pumps', headUserId: 'u-pump' }).id as string;
  const P = (name: string, userId: string | null, unitId: string) => createPerson(oic, { commandId: C, name, userId, unitId }).id as string;
  const people = { po: P('po', 'u-po', radar), tech: P('tech', 'u-tech', radar), tech2: P('tech2', null, radar), pump: P('pump', 'u-pumptech', pumps) };
  return { env, C, oic, as, radar, pumps, people, sup: (u: string) => as(u, 'ofc.scope.all', 'ofc.work_order.approve') };
}

describe('M15 equipment register', () => {
  it('follows equipment from receipt for repair to collection (AT-09, WF3)', () => {
    const o = office();
    const e = createEquipment(o.oic, { commandId: o.C, name: 'Radar display unit', makeModel: 'Furuno FR-2', serialNo: 'SN-778', owningUnit: 'SLNS Example', ownerUnitId: o.radar, receivedForRepair: true, documentRef: 'SLNS-EX/ENG/12', defect: 'No picture', condition: 'unserviceable' });
    expect(e).toMatchObject({ ref_no: 'EQM-00001', state: 'in_workshop', condition: 'unserviceable' });
    expect(codeOf(() => createEquipment(o.oic, { commandId: o.C, name: 'x', serialNo: ' sn-778 ' }))).toBe('DUPLICATE');
    const step = (kind: string, extra: Record<string, unknown> = {}) => {
      const cur = sql(o.env, 'SELECT version FROM ofc_equipment WHERE id = ?', e.id)[0]!;
      return recordMovement(o.oic, e.id as string, { expectedVersion: cur.version, kind, ...extra });
    };
    expect(codeOf(() => step('returned_from_issue'))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => step('sent_out'))).toBe('VALIDATION_FAILED');
    step('sent_out', { toText: 'Furuno agent, Colombo', expectedReturn: addDays(today, -1), documentRef: 'GP/45' });
    expect(listEquipment(o.oic, { commandId: o.C, view: 'overdue_return' }).total).toBe(1);
    expect(listEquipment(o.oic, { commandId: o.C, view: 'at_external' }).items[0]).toMatchObject({ location_text: 'Furuno agent, Colombo', overdueReturn: true });
    step('returned_from_external', { toText: 'Radar workshop', condition: 'repairable' });
    step('repair_completed', { condition: 'serviceable', note: 'Board replaced' });
    expect(listEquipment(o.oic, { commandId: o.C, view: 'pending_collection' }).total).toBe(1);
    step('collected', { personId: o.people.po, documentRef: 'Receipt 991' });
    const d = equipmentDetail(o.oic, e.id as string);
    expect(d.equipment).toMatchObject({ state: 'returned', condition: 'serviceable', location_text: 'SLNS Example' });
    expect(d.movements.map((m) => m.kind)).toEqual(['received_for_repair', 'sent_out', 'returned_from_external', 'repair_completed', 'collected']);
    expect(listEquipment(o.oic, { commandId: o.C }).total).toBe(0); // "with us" excludes returned
    expect(codeOf(() => updateEquipment(o.oic, e.id as string, { expectedVersion: d.equipment.version as number, serialNo: 'SN-779' }))).toBe('VALIDATION_FAILED');
  });

  it('tracks temporary issue and overdue return (AT-10, WF4)', () => {
    const o = office();
    const e = createEquipment(o.oic, { commandId: o.C, name: 'Oscilloscope', equipNo: 'TE-01', ownerUnitId: o.radar, condition: 'serviceable' });
    expect(codeOf(() => recordMovement(o.oic, e.id as string, { expectedVersion: 1, kind: 'issued', toText: 'Pump workshop' }))).toBe('VALIDATION_FAILED');
    const issued = recordMovement(o.oic, e.id as string, { expectedVersion: 1, kind: 'issued', toText: 'Pump workshop', personId: o.people.pump, expectedReturn: addDays(today, -2) });
    expect(listEquipment(o.oic, { commandId: o.C, view: 'overdue_return' }).items.map((r) => r.id)).toEqual([e.id]);
    // the borrower (custodian) can see it even though it belongs to another unit
    expect(listEquipment(o.as('u-pumptech', 'ofc.scope.all'), { commandId: o.C }).total).toBe(1);
    recordMovement(o.oic, e.id as string, { expectedVersion: issued.version as number, kind: 'returned_from_issue', condition: 'serviceable' });
    expect(listEquipment(o.oic, { commandId: o.C, view: 'overdue_return' }).total).toBe(0);
    expect(codeOf(() => recordMovement(o.oic, e.id as string, { expectedVersion: 3, kind: 'collected', date: addDays(today, 1) }))).toBe('VALIDATION_FAILED');
  });
});

describe('M15 work orders', () => {
  it('runs request → review → approve → assign → progress → spares → complete → verify → close (AT-11, WF5)', () => {
    const o = office();
    const e = createEquipment(o.oic, { commandId: o.C, name: 'Radar display unit', ownerUnitId: o.radar, receivedForRepair: true });
    const letter = createCorrespondence(o.oic, { commandId: o.C, kind: 'incoming', subject: 'Repair radar display', originator: 'SLNS Example', unitId: o.radar, priority: 'high' });
    let w = createWorkOrder(o.oic, { sourceLetterId: letter.id, equipmentId: e.id, reportedDefect: 'No picture', targetDate: addDays(today, 7) });
    expect(w).toMatchObject({ ref_no: 'OWO-00001', status: 'requested', title: 'Repair radar display', requesting_unit: 'SLNS Example', unit_id: o.radar, priority: 'high' });
    expect(linksOf(o.env.ctx.db, 'ofc.correspondence', letter.id as string)).toHaveLength(1);
    const V = () => sql(o.env, 'SELECT version FROM ofc_work_order WHERE id = ?', w.id)[0]!.version as number;
    const id = w.id as string;
    expect(codeOf(() => assignWorkOrder(o.oic, id, { expectedVersion: V(), crew: [o.people.tech] }))).toBe('WORKFLOW_BLOCKED');
    setWorkOrderStatus(o.oic, id, { expectedVersion: V(), status: 'under_review' });
    expect(codeOf(() => approveWorkOrder(o.sup('u-po'), id, { expectedVersion: V() }))).toBe('FORBIDDEN');
    w = approveWorkOrder(o.oic, id, { expectedVersion: V(), approvalRef: 'OIC minute 14/26' });
    expect(w).toMatchObject({ status: 'approved', approval_ref: 'OIC minute 14/26', approved_by: 'tester' });
    w = assignWorkOrder(o.sup('u-po'), id, { expectedVersion: V(), supervisorPersonId: o.people.po, crew: [o.people.tech, o.people.tech2] });
    expect(w.status).toBe('assigned');
    const tech = o.as('u-tech', 'ofc.scope.all', 'ofc.work_order.assign', 'ofc.work_order.approve', 'ofc.work_order.verify', 'ofc.work_order.cancel');
    expect(getWorkOrderDetail(tech, id).permissions).toMatchObject({ update: true, complete: true, verify: false, assign: false });
    setWorkOrderStatus(tech, id, { expectedVersion: V(), status: 'in_progress' });
    setWorkOrderStatus(tech, id, { expectedVersion: V(), status: 'awaiting_spares', note: 'Display board demanded' });
    expect(listWorkOrders(o.oic, { commandId: o.C, view: 'waiting' }).total).toBe(1);
    expect(codeOf(() => setWorkOrderStatus(tech, id, { expectedVersion: V(), status: 'awaiting_external' }))).toBe('VALIDATION_FAILED');
    setWorkOrderStatus(tech, id, { expectedVersion: V(), status: 'in_progress' });
    w = completeWorkOrder(tech, id, { expectedVersion: V(), completionDetails: 'Board replaced, tested 4 h', actionsTaken: 'Fault traced to PSU board' });
    expect(w.status).toBe('completed');
    // the supervisor who ran the job cannot verify it; the crew cannot either
    expect(codeOf(() => setWorkOrderStatus(tech, id, { expectedVersion: V(), status: 'in_progress' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => closeWorkOrder(o.oic, id, { expectedVersion: V() }))).toBe('WORKFLOW_BLOCKED');
    const pumpHead = o.sup('u-pump');
    expect(codeOf(() => reopenWorkOrder(o.oic, id, { expectedVersion: V(), reason: '' }))).toBe('VALIDATION_FAILED');
    w = reopenWorkOrder(o.oic, id, { expectedVersion: V(), reason: 'Picture still flickers' });
    w = completeWorkOrder(tech, id, { expectedVersion: V(), completionDetails: 'Connector re-seated' });
    expect(codeOf(() => closeWorkOrder(pumpHead, id, { expectedVersion: V() }))).toBe('FORBIDDEN');
    // verify by the OIC (holds scope.all) — the PO is the supervisor of this job, so PO cannot verify
    expect(codeOf(() => verifyWorkOrder(o.sup('u-po'), id, { expectedVersion: V() }))).toBe('FORBIDDEN');
    expect(codeOf(() => verifyWorkOrder(pumpHead, id, { expectedVersion: V() }))).toBe('FORBIDDEN');
    w = verifyWorkOrder(o.oic, id, { expectedVersion: V(), note: 'Seen working on trial' });
    expect(w).toMatchObject({ status: 'verified', verified_by: 'tester' });
    w = closeWorkOrder(o.oic, id, { expectedVersion: V() });
    expect(w).toMatchObject({ status: 'closed', closed_at: today });
    expect(equipmentDetail(o.oic, e.id as string).workOrders.map((x) => x.ref_no)).toEqual(['OWO-00001']);
    const statuses = sql(o.env, "SELECT to_value FROM ofc_record_event WHERE record_id = ? AND kind = 'status' ORDER BY occurred_at, id", id).map((r) => r.to_value);
    expect(statuses).toEqual(['under_review', 'approved', 'assigned', 'in_progress', 'awaiting_spares', 'in_progress', 'completed', 'in_progress', 'completed', 'verified', 'closed']);
  });

  it('restricts work orders to the unit, crew and supervisor; overdue needs a delay reason; cancel keeps the record', () => {
    const o = office();
    const r = createWorkOrder(o.oic, { commandId: o.C, title: 'Radar job', unitId: o.radar, targetDate: addDays(today, -1) });
    const p = createWorkOrder(o.oic, { commandId: o.C, title: 'Pump job', unitId: o.pumps });
    expect(listWorkOrders(o.sup('u-po'), { commandId: o.C }).items.map((x) => x.title)).toEqual(['Radar job']);
    expect(codeOf(() => getWorkOrderDetail(o.sup('u-po'), p.id as string))).toBe('FORBIDDEN');
    expect(listWorkOrders(o.oic, { commandId: o.C, view: 'overdue' }).total).toBe(1);
    approveWorkOrder(o.oic, r.id as string, { expectedVersion: 1 });
    // staff from another workshop: the in-charge may add them, but only with a reason that is kept in the history
    expect(codeOf(() => assignWorkOrder(o.sup('u-po'), r.id as string, { expectedVersion: 2, crew: [o.people.pump] }))).toBe('VALIDATION_FAILED');
    assignWorkOrder(o.sup('u-po'), r.id as string, { expectedVersion: 2, crew: [o.people.pump], outsideReason: 'Radar staff on leave' });
    expect(String(sql(o.env, "SELECT note FROM ofc_record_event WHERE record_id = ? AND kind = 'assign'", r.id)[0]!.note)).toContain('Radar staff on leave');
    // a crew member from another unit sees the job through the crew list
    expect(listWorkOrders(o.as('u-pumptech', 'ofc.scope.all'), { commandId: o.C }).items.map((x) => x.title).sort()).toEqual(['Pump job', 'Radar job']);
    expect(codeOf(() => setWorkOrderStatus(o.oic, r.id as string, { expectedVersion: 3, status: 'in_progress' }))).toBe('VALIDATION_FAILED');
    setWorkOrderStatus(o.oic, r.id as string, { expectedVersion: 3, status: 'in_progress', delayReason: 'Crew on another job' });
    expect(cancelWorkOrder(o.oic, p.id as string, { expectedVersion: 1, reason: 'Duplicate request' }).status).toBe('cancelled');
    expect(sql(o.env, 'SELECT deleted_at FROM ofc_work_order WHERE id = ?', p.id)[0]!.deleted_at).toBeNull();
  });
});
