import { describe, expect, it } from 'vitest';
import { importCorrespondence, importEquipment, importPersons } from '../../src/modules/m15-office/imports.js';
import { listEquipment } from '../../src/modules/m15-office/equipment.js';
import { listCorrespondence } from '../../src/modules/m15-office/correspondence.js';
import { createUnit } from '../../src/modules/m15-office/service.js';
import { sql } from './ast-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

describe('M15 bulk import from existing registers', () => {
  it('imports personnel with units and supervisors, correspondence and equipment, keeping original refs and dates', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    createUnit(a, { commandId: C, level: 'department', code: 'RADAR', name: 'Radar workshop' });
    const people = [
      { serviceNo: 'P1', rank: 'PO', name: 'Perera', unit: 'RADAR' },
      { serviceNo: 'C2', rank: 'Civ', name: 'Fernando', unit: 'radar workshop', supervisor: 'P1' },
      { serviceNo: 'X3', name: 'Nobody', unit: 'NOPE' },
    ];
    expect(importPersons(a, { commandId: C, rows: people })).toMatchObject({ committed: false, summary: { rows: 3, errors: 1 } });
    expect(importPersons(a, { commandId: C, rows: people.slice(0, 2), commit: true }).committed).toBe(true);
    expect(sql(env, "SELECT s.service_no FROM ofc_person p JOIN ofc_person s ON s.id = p.supervisor_person_id WHERE p.service_no = 'C2'")[0]!.service_no).toBe('P1');
    expect(importPersons(a, { commandId: C, rows: [people[0]] }).summary.errors).toBe(1); // already registered

    const letters = [
      { kind: 'incoming', officialRef: 'NHQ/1', letterDate: '2026-10-01', receivedDate: '2026-10-03', originator: 'NHQ', subject: 'Old letter', replyRequired: true, replyDue: '2026-10-20', actionOfficer: 'P1', originalRef: 'IN-REG 45' },
      { kind: 'outgoing', officialRef: 'SLE/2', sentDate: '2026-10-05', subject: 'Old reply' },
      { kind: 'incoming', subject: 'Bad', replyRequired: true },
    ];
    expect(importCorrespondence(a, { commandId: C, rows: letters }).summary.errors).toBe(1);
    const done = importCorrespondence(a, { commandId: C, rows: letters.slice(0, 2), commit: true });
    expect(done.created).toEqual(['COR-IN-00001', 'COR-OUT-00001']);
    const imported = listCorrespondence(a, { commandId: C, kind: 'incoming' }).items[0]!;
    expect(imported).toMatchObject({ official_ref: 'NHQ/1', letter_date: '2026-10-01', received_date: '2026-10-03', original_ref: 'IN-REG 45', status: 'received', pending: true, overdue: true });
    expect(importCorrespondence(a, { commandId: C, rows: [letters[0]] }).summary.warnings).toBe(1); // duplicate warning

    const eq = [
      { equipNo: 'TE-1', name: 'Oscilloscope', state: 'on_issue', locationText: 'Pump WS', expectedReturn: '2026-11-01', sinceDate: '2026-10-15', responsible: 'Fernando' },
      { name: 'Radar display', serialNo: 'S9', state: 'in_workshop', condition: 'unserviceable', owningUnit: 'SLNS X' },
      { name: 'Lost one', state: 'at_external' },
    ];
    expect(importEquipment(a, { commandId: C, rows: eq }).summary.errors).toBe(1);
    expect(importEquipment(a, { commandId: C, rows: eq.slice(0, 2), commit: true }).committed).toBe(true);
    expect(listEquipment(a, { commandId: C, view: 'overdue_return' }).items[0]).toMatchObject({ equip_no: 'TE-1', last_movement_at: '2026-10-15' });
    expect(sql(env, 'SELECT COUNT(DISTINCT import_batch_id) AS n FROM ofc_correspondence')[0]!.n).toBe(1);
  });
});
