import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { availableActions, departmentsFor, normalizeTag, PROGRESS_TARGET, UI_PARTY_KINDS, uiPartyKind, wirePartyKind, workOrderDefaults, type Axes } from './actions';
import { wrkLabelsEn } from './labels.en';
import { wrkNav } from './index';
import { PARTY_PATH } from './WorkOrderDetail';

const ax = (o: Partial<Axes> = {}): Axes => ({ progress: 'planned', approval: 'not_required', returnToService: 'not_assessed', closure: 'open', ...o });
const list = (a: Axes) => [...availableActions(a)].sort();

describe('work order actions follow the axes', () => {
  it('offers only moves the server accepts', () => {
    expect(list(ax())).toEqual(['request_review', 'start']);
    expect(list(ax({ progress: 'in_progress' }))).toEqual(['complete', 'hold', 'request_review']);
    expect(list(ax({ progress: 'on_hold' }))).toEqual(['request_review', 'resume']);
    expect(list(ax({ progress: 'work_complete', returnToService: 'cleared' }))).toEqual(['accept', 'close', 'request_review', 'rework']);
    expect(list(ax({ progress: 'in_progress', approval: 'pending_review' }))).toEqual(['complete', 'decide', 'hold']);
  });
  it('a closed order can only be reopened; a reopened one cannot be closed until work is complete again', () => {
    expect(list(ax({ progress: 'work_complete', closure: 'closed' }))).toEqual(['reopen']);
    expect(list(ax({ progress: 'in_progress', closure: 'reopened' }))).not.toContain('close');
    expect(list(ax({ progress: 'work_complete', closure: 'reopened' }))).toContain('close');
  });
  it('maps progress actions to their target value', () => {
    expect(PROGRESS_TARGET).toEqual({ start: 'in_progress', resume: 'in_progress', rework: 'in_progress', hold: 'on_hold', complete: 'work_complete' });
  });
  it('tidies a typed equipment tag', () => expect(normalizeTag('  sln-eq-00000001 ')).toBe('SLN-EQ-00000001'));
});

describe('new work order defaults come from the signed-in user', () => {
  const home = (o: Partial<Parameters<typeof workOrderDefaults>[0] & object> = {}) => ({ sectionId: null, sectionOwnerKind: null, shipId: null, commandId: null, ...o });
  it('a ship section member gets their ship and their section', () => {
    expect(workOrderDefaults(home({ sectionId: 'sec-1', sectionOwnerKind: 'ship', shipId: 'ship-1' }))).toEqual({ shipId: 'ship-1', executingKind: 'ship_section', executingId: 'sec-1' });
  });
  it('without a section the ship itself is the party', () => {
    expect(workOrderDefaults(home({ shipId: 'ship-1' }))).toEqual({ shipId: 'ship-1', executingKind: 'ship', executingId: 'ship-1' });
  });
  it('command staff get their command department, then their command', () => {
    expect(workOrderDefaults(home({ sectionId: 'd-1', sectionOwnerKind: 'command', commandId: 'c-1' }))).toEqual({ shipId: '', executingKind: 'command_department', executingId: 'd-1' });
    expect(workOrderDefaults(home({ commandId: 'c-1' }))).toEqual({ shipId: '', executingKind: 'command', executingId: 'c-1' });
  });
  it('nothing known: nothing pre-filled', () => {
    expect(workOrderDefaults(null)).toEqual({ shipId: '', executingKind: '', executingId: '' });
  });
});

describe('ship sections and command departments', () => {
  const rows = [
    { id: 'a', ownerKind: 'ship', ownerId: 'ship-1' }, { id: 'b', ownerKind: 'ship', ownerId: 'ship-2' },
    { id: 'c', ownerKind: 'command', ownerId: 'cmd-1' }, { id: 'd', ownerKind: null, ownerId: null },
  ];
  it('lists only the chosen ship\'s sections', () => {
    expect(departmentsFor(rows, 'ship_section', 'ship-1').map((r) => r.id)).toEqual(['a']);
    expect(departmentsFor(rows, 'ship_section').map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('command departments include ones not yet attached', () => {
    expect(departmentsFor(rows, 'command_department').map((r) => r.id)).toEqual(['c', 'd']);
  });
  it('both are a department on the wire, and read back by their owner', () => {
    expect(wirePartyKind('ship_section')).toBe('department');
    expect(wirePartyKind('command_department')).toBe('department');
    expect(wirePartyKind('workshop')).toBe('workshop');
    expect(uiPartyKind('department', 'ship')).toBe('ship_section');
    expect(uiPartyKind('department', 'command')).toBe('command_department');
    expect(uiPartyKind('ship')).toBe('ship');
  });
});

describe('labels', () => {
  it('has a label for every nav item, every permission prefix is wrk', () => {
    for (const n of wrkNav) { expect(wrkLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^wrk\./); }
  });
  it('defines every literal wrk.* label key used by the screens', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](wrk\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in wrkLabelsEn) && !/^wrk\.(work_order|repair_case|defect|job_card|labour_entry|finding|test_record|acceptance|advisory|defect_category)\./.test(k));
    expect(missing).toEqual([]);
  });
  it('covers every value of the dynamic label families', () => {
    const families: Record<string, string[]> = {
      progress: ['planned', 'in_progress', 'on_hold', 'work_complete'], approval: ['not_required', 'pending_review', 'approved', 'rejected'],
      rts: ['not_assessed', 'restricted', 'cleared', 'withheld'], closure: ['open', 'closed', 'reopened'], jstatus: ['draft', 'issued', 'completed', 'void'],
      severity: ['minor', 'major', 'critical', 'info', 'caution', 'warning'], priority: ['low', 'normal', 'high', 'urgent'], wtype: ['corrective', 'preventive', 'inspection', 'modification'],
      dstatus: ['open', 'converted', 'dismissed'], fkind: ['observation', 'cause', 'recommendation', 'additional_defect'], result: ['pass', 'fail', 'not_applicable'],
      party: ['command', 'ship', 'department', 'workshop', 'external_provider', ...UI_PARTY_KINDS], axis: ['progress', 'approval', 'returnToService', 'closure'], decision: ['accepted', 'rejected'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(wrkLabelsEn[`wrk.${f}.${v}`], `wrk.${f}.${v}`).toBeTruthy();
  });
});

describe('party lists', () => {
  it('loads external providers from the M01 collection (external-providers)', () => {
    expect(PARTY_PATH).toEqual({ command: 'commands', ship: 'ships', department: 'departments', workshop: 'workshops', external_provider: 'external-providers' });
  });
});
