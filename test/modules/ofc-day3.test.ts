import { describe, expect, it } from 'vitest';
import { makeActor } from '../../src/modules/m15-office/actor.js';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { createCorrespondence, getCorrespondence, listCorrespondence } from '../../src/modules/m15-office/correspondence.js';
import { addDutyPeriod, addResponsibility, createPerson, dutyToday, endResponsibility, personDetail, reassignAll, updatePerson } from '../../src/modules/m15-office/persons.js';
import { createUnit } from '../../src/modules/m15-office/service.js';
import {
  assignTask, cancelTask, closeTask, completeTask, createTask, getTask, listTasks, reopenTask, setTaskStatus, updateTask,
} from '../../src/modules/m15-office/tasks.js';
import { timelineOf } from '../../src/modules/m15-office/queries.js';
import { codeOf, sql } from './ast-helpers.js';
import { allowAll, denyOnly } from './org-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();

/** Office with Electronic dept > Radar workshop (in-charge PO, officer Lt), Utility dept; people linked to users. */
function office(rule: 'in_charge' | 'officer_required' = 'in_charge') {
  const env = makeOfcEnv();
  const C = env.commandId;
  const oic = env.hubActor();
  const as = (userId: string, ...denied: string[]) => ({ ...makeActor(env.ctx, { userId, installationId: env.hub.installationId, displayName: userId }), authz: denied.length ? denyOnly(...denied) : allowAll });
  const elec = createUnit(oic, { commandId: C, level: 'department', code: 'ELEC', name: 'Electronic', headUserId: 'u-cdr' });
  const radar = createUnit(oic, { commandId: C, level: 'workshop', parentId: elec.id, code: 'RADAR', name: 'Radar workshop', headUserId: 'u-po', deputyUserId: 'u-lt', verifyRule: rule });
  const util = createUnit(oic, { commandId: C, level: 'department', code: 'UTIL', name: 'Utility', headUserId: 'u-util' });
  const P = (name: string, userId: string | null, unitId: string) => createPerson(oic, { commandId: C, name, userId, unitId, serviceNo: name.toUpperCase() }).id as string;
  const people = {
    po: P('po', 'u-po', radar.id as string), lt: P('lt', 'u-lt', radar.id as string), tech: P('tech', 'u-tech', radar.id as string),
    tech2: P('tech2', null, radar.id as string), utilTech: P('utiltech', 'u-ut', util.id as string), oicP: P('oic', 'tester', elec.id as string),
  };
  // Not OIC: no ofc.scope.all.
  const staff = (u: string) => as(u, 'ofc.scope.all', 'ofc.task.assign', 'ofc.task.verify', 'ofc.task.cancel', 'ofc.task.reopen');
  const sup = (u: string) => as(u, 'ofc.scope.all');
  return { env, C, oic, as, staff, sup, units: { elec: elec.id as string, radar: radar.id as string, util: util.id as string }, people };
}

describe('M15 tasks', () => {
  it('letter → task → assign → progress → complete → verify and close by the in-charge (AT-01, AT-02, AT-03)', () => {
    const o = office();
    const letter = createCorrespondence(o.oic, { commandId: o.C, kind: 'incoming', subject: 'Radar display defect', officialRef: 'NHQ/1', replyRequired: true, replyDue: addDays(today, 5), unitId: o.units.radar, priority: 'high' });
    const t = createTask(o.oic, { source: { type: 'ofc.correspondence', id: letter.id } });
    expect(t).toMatchObject({ title: 'Radar display defect', priority: 'high', target_date: addDays(today, 5), unit_id: o.units.radar, status: 'not_started', ref_no: 'TSK-00001' });
    expect(getCorrespondence(o.oic, letter.id as string).status).toBe('under_action');
    expect(sql(o.env, "SELECT link_type FROM ofc_link WHERE from_id = ?", t.id)[0]!.link_type).toBe('originated_from');

    const po = o.sup('u-po');
    let cur = assignTask(po, t.id as string, { expectedVersion: 1, assigneePersonId: o.people.tech });
    expect(cur.status).toBe('assigned');
    const tech = o.staff('u-tech');
    cur = setTaskStatus(tech, t.id as string, { expectedVersion: cur.version as number, status: 'in_progress' });
    cur = setTaskStatus(tech, t.id as string, { expectedVersion: cur.version as number, status: 'awaiting_info', note: 'Need circuit diagram' });
    cur = setTaskStatus(tech, t.id as string, { expectedVersion: cur.version as number, status: 'in_progress' });
    expect(codeOf(() => closeTask(tech, t.id as string, { expectedVersion: cur.version as number }))).toBe('FORBIDDEN');
    cur = completeTask(tech, t.id as string, { expectedVersion: cur.version as number, note: 'Display board replaced, tested OK' });
    expect(cur.status).toBe('completed');
    // assignee cannot verify their own work even with the permission
    expect(codeOf(() => closeTask(o.sup('u-tech'), t.id as string, { expectedVersion: cur.version as number }))).toBe('FORBIDDEN');
    // someone outside the unit chain cannot verify
    expect(codeOf(() => closeTask(o.sup('u-util'), t.id as string, { expectedVersion: cur.version as number }))).toBe('FORBIDDEN');
    cur = closeTask(po, t.id as string, { expectedVersion: cur.version as number, note: 'Checked' });
    expect(cur).toMatchObject({ status: 'closed', closed_by: 'u-po', closed_at: today });
    const kinds = timelineOf(o.env.ctx.db, 'ofc.task', t.id as string).map((e) => `${e.kind}:${e.to_value ?? ''}`);
    expect(kinds).toEqual(expect.arrayContaining(['assign:' + o.people.tech, 'status:in_progress', 'status:awaiting_info', 'status:completed', 'status:closed']));
    const reopened = reopenTask(o.oic, t.id as string, { expectedVersion: cur.version as number, reason: 'Fault recurred' });
    expect(reopened.status).toBe('in_progress');
  });

  it('applies the unit verify rule "officer required" and lets the OIC self-close only with a note', () => {
    const o = office('officer_required');
    const t = createTask(o.oic, { commandId: o.C, title: 'Calibrate scope', unitId: o.units.radar, assigneePersonId: o.people.tech2 });
    const done = completeTask(o.oic, t.id as string, { expectedVersion: 1, note: 'done' });
    expect(codeOf(() => closeTask(o.sup('u-po'), t.id as string, { expectedVersion: done.version as number }))).toBe('FORBIDDEN');
    expect(closeTask(o.sup('u-lt'), t.id as string, { expectedVersion: done.version as number }).status).toBe('closed');
    // the department head above the workshop may verify too
    const t2 = createTask(o.oic, { commandId: o.C, title: 'x', unitId: o.units.radar, assigneePersonId: o.people.tech2 });
    const d2 = completeTask(o.oic, t2.id as string, { expectedVersion: 1, note: 'done' });
    expect(closeTask(o.sup('u-cdr'), t2.id as string, { expectedVersion: d2.version as number }).status).toBe('closed');
    // OIC's own task: needs a self-closure note
    const t3 = createTask(o.oic, { commandId: o.C, title: 'Brief NHQ', assigneePersonId: o.people.oicP });
    const d3 = completeTask(o.oic, t3.id as string, { expectedVersion: 1, note: 'done' });
    expect(codeOf(() => closeTask(o.oic, t3.id as string, { expectedVersion: d3.version as number }))).toBe('FORBIDDEN');
    expect(closeTask(o.oic, t3.id as string, { expectedVersion: d3.version as number, note: 'No superior available locally' }).verify_note).toMatch(/^Self-closure/);
  });

  it('handles subtasks, delay reasons, overdue lists, reassignment and cancellation (FR-T2..T6, AT-07)', () => {
    const o = office();
    const t = createTask(o.oic, { commandId: o.C, title: 'Overhaul generator', unitId: o.units.radar, assigneePersonId: o.people.po, targetDate: addDays(today, -2) });
    expect(listTasks(o.oic, { commandId: o.C, view: 'overdue' }).items.map((r) => r.id)).toEqual([t.id]);
    expect(listTasks(o.oic, { commandId: o.C, view: 'overdue' }).items[0]!.daysOverdue).toBe(2);
    // overdue: moving on needs a delay reason
    expect(codeOf(() => setTaskStatus(o.oic, t.id as string, { expectedVersion: 1, status: 'in_progress' }))).toBe('VALIDATION_FAILED');
    let cur = setTaskStatus(o.oic, t.id as string, { expectedVersion: 1, status: 'in_progress', delayReason: 'Spares not received' });
    expect(cur.delay_reason).toBe('Spares not received');
    expect(codeOf(() => updateTask(o.oic, t.id as string, { expectedVersion: cur.version as number, targetDate: addDays(today, 10) }))).toBe('VALIDATION_FAILED');
    cur = updateTask(o.oic, t.id as string, { expectedVersion: cur.version as number, targetDate: addDays(today, 10), reason: 'Supply ETA 25th' });
    expect(timelineOf(o.env.ctx.db, 'ofc.task', t.id as string).some((e) => e.kind === 'target_date' && e.note === 'Supply ETA 25th')).toBe(true);
    expect(listTasks(o.oic, { commandId: o.C, view: 'due_soon' }).total).toBe(0);

    // tech adds a subtask to their own task only
    const mine = createTask(o.oic, { commandId: o.C, title: 'Survey cables', unitId: o.units.radar, assigneePersonId: o.people.tech });
    const tech = o.staff('u-tech');
    const sub = createTask(tech, { parentId: mine.id, title: 'Megger test' });
    expect(sub).toMatchObject({ assignee_person_id: o.people.tech, parent_id: mine.id });
    expect(codeOf(() => createTask(tech, { parentId: t.id, title: 'x' }))).toBe('FORBIDDEN');
    expect(codeOf(() => createTask(tech, { commandId: o.C, title: 'own idea' }))).toBe('FORBIDDEN');
    expect(codeOf(() => createTask(o.oic, { parentId: sub.id, title: 'deep' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => completeTask(o.oic, mine.id as string, { expectedVersion: 1, note: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(getTask(o.oic, mine.id as string).subtasks).toHaveLength(1);

    expect(codeOf(() => assignTask(o.oic, t.id as string, { expectedVersion: cur.version as number, assigneePersonId: o.people.tech2 }))).toBe('VALIDATION_FAILED');
    cur = assignTask(o.oic, t.id as string, { expectedVersion: cur.version as number, assigneePersonId: o.people.tech2, reason: 'PO on leave' });
    expect(codeOf(() => cancelTask(o.oic, t.id as string, { expectedVersion: cur.version as number, reason: '' }))).toBe('VALIDATION_FAILED');
    expect(cancelTask(o.oic, t.id as string, { expectedVersion: cur.version as number, reason: 'Superseded' }).status).toBe('cancelled');
    expect(sql(o.env, 'SELECT COUNT(*) AS n FROM ofc_task WHERE deleted_at IS NOT NULL')[0]!.n).toBe(0);
  });

  it('limits supervisors and staff to their own unit and own work (AT-14)', () => {
    const o = office();
    const radarTask = createTask(o.oic, { commandId: o.C, title: 'Radar job', unitId: o.units.radar, assigneePersonId: o.people.tech });
    const utilTask = createTask(o.oic, { commandId: o.C, title: 'Pump job', unitId: o.units.util, assigneePersonId: o.people.utilTech });
    createCorrespondence(o.oic, { commandId: o.C, kind: 'incoming', subject: 'Utility letter', unitId: o.units.util });
    createCorrespondence(o.oic, { commandId: o.C, kind: 'incoming', subject: 'Radar letter', unitId: o.units.radar });
    const po = o.sup('u-po');
    expect(listTasks(po, { commandId: o.C }).items.map((t) => t.title)).toEqual(['Radar job']);
    expect(codeOf(() => getTask(po, utilTask.id as string))).toBe('FORBIDDEN');
    expect(codeOf(() => updateTask(po, utilTask.id as string, { expectedVersion: 1, remarks: 'x' }))).toBe('FORBIDDEN');
    expect(listCorrespondence(po, { commandId: o.C }).items.map((c) => c.subject)).toEqual(['Radar letter']);
    // department head sees everything below the department
    expect(listTasks(o.sup('u-cdr'), { commandId: o.C }).total).toBe(1);
    expect(listTasks(o.sup('u-util'), { commandId: o.C }).items.map((t) => t.title)).toEqual(['Pump job']);
    // the utility technician can update their own task but not the radar one
    const ut = o.staff('u-ut');
    expect(setTaskStatus(ut, utilTask.id as string, { expectedVersion: 2 > 1 ? 1 : 1, status: 'in_progress' }).status).toBe('in_progress');
    expect(codeOf(() => setTaskStatus(ut, radarTask.id as string, { expectedVersion: 1, status: 'in_progress' }))).toBe('FORBIDDEN');
    // unknown user with no person record sees nothing
    expect(listTasks(o.sup('nobody'), { commandId: o.C }).total).toBe(0);
    expect(listTasks(o.oic, { commandId: o.C }).total).toBe(2);
  });
});

describe('M15 personnel', () => {
  it('registers people, responsibilities, duty, workload, and reassigns a transferred person keeping history (AT-08, FR-P1..P5)', () => {
    const o = office();
    expect(codeOf(() => createPerson(o.oic, { commandId: o.C, name: 'Dup', serviceNo: 'PO' }))).toBe('DUPLICATE');
    const t1 = createTask(o.oic, { commandId: o.C, title: 'Job A', unitId: o.units.radar, assigneePersonId: o.people.po, targetDate: addDays(today, -1) });
    createTask(o.oic, { commandId: o.C, title: 'Job B', unitId: o.units.radar, assigneePersonId: o.people.po });
    const letter = createCorrespondence(o.oic, { commandId: o.C, kind: 'incoming', subject: 'L', replyRequired: true, replyDue: addDays(today, 3), actionUserId: o.people.po });
    const r = addResponsibility(o.oic, o.people.po, { title: 'Radar workshop inventory' });
    addDutyPeriod(o.oic, o.people.po, { dutyStatus: 'on_leave', dateFrom: addDays(today, -1), dateTo: addDays(today, 2), actingPersonId: o.people.lt });
    const po = sql(o.env, 'SELECT * FROM ofc_person WHERE id = ?', o.people.po)[0]!;
    expect(dutyToday(o.oic, po)).toBe('on_leave');
    let d = personDetail(o.oic, o.people.po);
    expect(d.tasks.filter((t) => t.overdue)).toHaveLength(1);
    expect(d.correspondence).toHaveLength(1);

    const moved = reassignAll(o.oic, o.people.po, { toPersonId: o.people.lt, reason: 'PO transferred to SLNS Y' });
    expect(moved).toEqual({ tasks: 2, handoverItems: 0, correspondence: 1 });
    updatePerson(o.oic, o.people.po, { expectedVersion: 1, dutyStatus: 'transferred', status: 'inactive', reason: 'Drafted' });
    endResponsibility(o.oic, r.id as string, { expectedVersion: 1, reason: 'Transferred' });
    d = personDetail(o.oic, o.people.po);
    expect(d.tasks).toHaveLength(0);
    expect(d.formerly.map((t) => t.title).sort()).toEqual(['Job A', 'Job B']);
    expect(d.responsibilities[0]!.valid_to).toBe(today);
    expect(getCorrespondence(o.oic, letter.id as string).action_user_id).toBe(o.people.lt);
    expect(timelineOf(o.env.ctx.db, 'ofc.task', t1.id as string).find((e) => e.kind === 'assign' && e.from_value === o.people.po)!.note).toBe('PO transferred to SLNS Y');
    expect(codeOf(() => assignTask(o.oic, t1.id as string, { expectedVersion: 3, assigneePersonId: o.people.po, reason: 'x' }))).toBe('VALIDATION_FAILED');
  });
});
