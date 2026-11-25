import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONDITIONS, DOCK_KINDS, DOCKING_STATUSES, DOCKING_TYPES, DUE_STATES, ITEM_CATEGORIES, ITEM_STATUSES, SURVEY_AREAS } from './binding';
import { dckNav } from './index';
import { dckLabelsEn } from './labels.en';

describe('labels', () => {
  it('has a label for every nav item and permission prefix dck', () => {
    for (const n of dckNav) { expect(dckLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^dck\./); }
  });
  it('defines every literal dck.* label key used by the screens, and the dynamic families', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](dck\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in dckLabelsEn) && !/^dck\.(dock|docking|work_item|survey|due)\.[a-z_]+$/.test(k));
    expect(missing).toEqual([]);
    const families: Record<string, string[]> = {
      status: DOCKING_STATUSES, type: DOCKING_TYPES, kind: DOCK_KINDS, due: DUE_STATES, cat: ITEM_CATEGORIES, istatus: ITEM_STATUSES, area: SURVEY_AREAS, cond: CONDITIONS,
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(dckLabelsEn[`dck.${f}.${v}`], `dck.${f}.${v}`).toBeTruthy();
  });
});
