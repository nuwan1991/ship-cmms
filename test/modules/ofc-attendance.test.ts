import { describe, expect, it } from 'vitest';
import { makeActor } from '../../src/modules/m15-office/actor.js';
import { attendanceSheet, attendanceSummary, markAttendance } from '../../src/modules/m15-office/attendance.js';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { addDutyPeriod, createPerson, updatePerson } from '../../src/modules/m15-office/persons.js';
import { createUnit } from '../../src/modules/m15-office/service.js';
import { codeOf } from './ast-helpers.js';
import { allowAll, denyOnly } from './org-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();
const yesterday = addDays(today, -1);

/** CLD (department) > CEW (section) > PABX and RADAR workshops; FW section beside CEW. PABX S/S in-charge is u-pabx. */
function office() {
  const env = makeOfcEnv();
  const C = env.commandId;
  const oic = env.hubActor();
  const as = (userId: string, ...denied: string[]) => ({ ...makeActor(env.ctx, { userId, installationId: env.hub.installationId, displayName: userId }), authz: denied.length ? denyOnly(...denied) : allowAll });
  const U = (level: string, code: string, parentId?: string, headUserId?: string) => createUnit(oic, { commandId: C, level, code, name: code, ...(parentId ? { parentId } : {}), ...(headUserId ? { headUserId } : {}) }).id as string;
  const cld = U('department', 'CLD');
  const cew = U('section', 'CEW', cld);
  const fw = U('section', 'FW', cld);
  const pabx = U('workshop', 'PABX', cew, 'u-pabx');
  const radar = U('workshop', 'RADAR', cew);
  const P = (name: string, unitId: string, userId: string | null = null) => createPerson(oic, { commandId: C, name, unitId, userId }).id as string;
  const people = { ss: P('SS PABX', pabx, 'u-pabx'), p1: P('PABX ONE', pabx), p2: P('PABX TWO', pabx), r1: P('RADAR ONE', radar), r2: P('RADAR TWO', radar), f1: P('FW ONE', fw), off: P('OFFICER', cew) };
  const ss = as('u-pabx', 'ofc.scope.all');
  return { env, C, oic, as, ss, units: { cld, cew, fw, pabx, radar }, people };
}

describe('M15 daily attendance', () => {
  it('the S/S in-charge marks own workshop; leave from the register is suggested; other workshops and future dates are refused', () => {
    const o = office();
    addDutyPeriod(o.oic, o.people.p2, { dutyStatus: 'on_leave', dateFrom: addDays(today, -2), dateTo: addDays(today, 2) });
    const sheet = attendanceSheet(o.ss, { commandId: o.C, unitId: o.units.pabx, date: today });
    expect(sheet.canRecord).toBe(true);
    expect(sheet.rows.map((r) => [r.name, r.status, r.suggested])).toEqual([['PABX ONE', null, 'present'], ['PABX TWO', null, 'leave'], ['SS PABX', null, 'present']]);
    expect(codeOf(() => attendanceSheet(o.ss, { commandId: o.C, unitId: o.units.radar, date: today }))).toBe('FORBIDDEN');

    const r = markAttendance(o.ss, { commandId: o.C, date: today, entries: sheet.rows.map((x) => ({ personId: x.personId, status: x.suggested })) });
    expect(r).toMatchObject({ created: 3, changed: 0 });
    // correcting a mark updates it; saving the same again changes nothing
    expect(markAttendance(o.ss, { commandId: o.C, date: today, entries: [{ personId: o.people.p1, status: 'late', remarks: 'Bus breakdown' }] })).toMatchObject({ created: 0, changed: 1 });
    expect(markAttendance(o.ss, { commandId: o.C, date: today, entries: [{ personId: o.people.p1, status: 'late', remarks: 'Bus breakdown' }] })).toMatchObject({ unchanged: 1 });
    const again = attendanceSheet(o.ss, { commandId: o.C, unitId: o.units.pabx, date: today });
    expect(again.rows.find((x) => x.personId === o.people.p1)).toMatchObject({ status: 'late', remarks: 'Bus breakdown', markedBy: 'u-pabx' });

    expect(codeOf(() => markAttendance(o.ss, { commandId: o.C, date: today, entries: [{ personId: o.people.r1, status: 'present' }] }))).toBe('FORBIDDEN');
    expect(codeOf(() => markAttendance(o.ss, { commandId: o.C, date: addDays(today, 1), entries: [{ personId: o.people.p1, status: 'present' }] }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => markAttendance(o.as('u-tech', 'ofc.attendance.record'), { commandId: o.C, date: today, entries: [{ personId: o.people.p1, status: 'present' }] }))).toBe('FORBIDDEN');
  });

  it('rolls workshops up into the section and the department, counting people not yet marked', () => {
    const o = office();
    markAttendance(o.oic, { commandId: o.C, date: today, entries: [
      { personId: o.people.ss, status: 'present' }, { personId: o.people.p1, status: 'present' }, { personId: o.people.p2, status: 'sick' },
      { personId: o.people.r1, status: 'present' }, { personId: o.people.f1, status: 'absent' }, { personId: o.people.off, status: 'duty' },
    ] });
    const s = attendanceSummary(o.oic, { commandId: o.C, date: today });
    const row = (id: string) => s.units.find((u) => u.id === id)!;
    expect(row(o.units.pabx).total).toMatchObject({ strength: 3, present: 2, sick: 1, notMarked: 0, atWork: 2 });
    expect(row(o.units.radar).total).toMatchObject({ strength: 2, present: 1, notMarked: 1 });
    // the section: its own officer plus both workshops
    expect(row(o.units.cew).own).toMatchObject({ strength: 1, duty: 1 });
    expect(row(o.units.cew).total).toMatchObject({ strength: 6, present: 3, sick: 1, duty: 1, notMarked: 1, marked: 5 });
    expect(row(o.units.cld).total).toMatchObject({ strength: 7, present: 3, absent: 1, notMarked: 1 });
    expect(s.office).toMatchObject({ strength: 7, marked: 6 });

    // a period counts man-days; yesterday nobody was marked
    const two = attendanceSummary(o.oic, { commandId: o.C, from: yesterday, to: today });
    expect(two.days).toBe(2);
    expect(two.units.find((u) => u.id === o.units.cld)!.total).toMatchObject({ marked: 6, notMarked: 8 });

    // the in-charge of PABX sees only PABX in the summary
    expect(attendanceSummary(o.ss, { commandId: o.C, date: today }).units.map((u) => u.code)).toEqual(['PABX']);
  });

  it('keeps past days with the unit the person was in, and leaves out transferred people', () => {
    const o = office();
    markAttendance(o.oic, { commandId: o.C, date: yesterday, entries: [{ personId: o.people.r2, status: 'present' }] });
    updatePerson(o.oic, o.people.r2, { expectedVersion: 1, unitId: o.units.pabx });
    const y = attendanceSummary(o.oic, { commandId: o.C, date: yesterday });
    expect(y.units.find((u) => u.id === o.units.radar)!.total.present).toBe(1);
    expect(attendanceSheet(o.oic, { commandId: o.C, unitId: o.units.pabx, date: today }).rows.map((r) => r.name)).toContain('RADAR TWO');
    updatePerson(o.oic, o.people.f1, { expectedVersion: 1, dutyStatus: 'transferred' });
    expect(attendanceSummary(o.oic, { commandId: o.C, date: today }).units.find((u) => u.id === o.units.fw)!.total.strength).toBe(0);
  });
});
