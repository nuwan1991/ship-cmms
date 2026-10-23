import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { availableActions, normalizeTag, PROGRESS_TARGET, type Axes } from './actions';
import { wrkLabelsEn } from './labels.en';
import { wrkNav } from './index';

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

describe('labels', () => {
  it('has a label for every nav item, every permission prefix is wrk', () => {
    for (const n of wrkNav) { expect(wrkLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^wrk\./); }
  });
  it('defines every literal wrk.* label key used by the screens', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](wrk\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in wrkLabelsEn) && !/^wrk\.(work_order|repair_case|defect|job_card|labour_entry|finding|test_record|acceptance|advisory)\./.test(k));
    expect(missing).toEqual([]);
  });
  it('covers every value of the dynamic label families', () => {
    const families: Record<string, string[]> = {
      progress: ['planned', 'in_progress', 'on_hold', 'work_complete'], approval: ['not_required', 'pending_review', 'approved', 'rejected'],
      rts: ['not_assessed', 'restricted', 'cleared', 'withheld'], closure: ['open', 'closed', 'reopened'], jstatus: ['draft', 'issued', 'completed', 'void'],
      severity: ['minor', 'major', 'critical', 'info', 'caution', 'warning'], priority: ['low', 'normal', 'high', 'urgent'], wtype: ['corrective', 'preventive', 'inspection', 'modification'],
      dstatus: ['open', 'converted', 'dismissed'], fkind: ['observation', 'cause', 'recommendation', 'additional_defect'], result: ['pass', 'fail', 'not_applicable'],
      party: ['command', 'ship', 'department', 'workshop', 'external_provider'], axis: ['progress', 'approval', 'returnToService', 'closure'], decision: ['accepted', 'rejected'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(wrkLabelsEn[`wrk.${f}.${v}`], `wrk.${f}.${v}`).toBeTruthy();
  });
});
