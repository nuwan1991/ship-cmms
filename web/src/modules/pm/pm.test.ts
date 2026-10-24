import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pmLabelsEn } from './labels.en';
import { pmNav } from './index';

describe('labels', () => {
  it('has a label for every nav item and permission prefix pm', () => {
    for (const n of pmNav) { expect(pmLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^pm\./); }
  });
  it('defines every literal pm.* label key used by the screens, and the dynamic families', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](pm\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in pmLabelsEn) && !/^pm\.(task_template|plan|meter|meter_reading|calibration|due)\./.test(k));
    expect(missing).toEqual([]);
    const families: Record<string, string[]> = {
      priority: ['low', 'normal', 'high', 'urgent'], basis: ['calendar', 'running_hours'], pstatus: ['active', 'suspended'], mkind: ['running_hours', 'counter'], rkind: ['reading', 'replacement'],
      cresult: ['pass', 'adjusted', 'fail'], source: ['plan', 'calibration'], dstatus: ['overdue', 'soon', 'ok'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(pmLabelsEn[`pm.${f}.${v}`], `pm.${f}.${v}`).toBeTruthy();
  });
});
