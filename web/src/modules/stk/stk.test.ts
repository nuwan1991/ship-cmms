import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stkLabelsEn } from './labels.en';
import { stkNav } from './index';

describe('labels', () => {
  it('has a label for every nav item and every permission prefix is stk', () => {
    for (const n of stkNav) { expect(stkLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^stk\./); }
  });
  it('defines every literal stk.* label key used by the screens', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](stk\.[a-z_0-9]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const missing = [...used].filter((k) => !(k in stkLabelsEn) && !/^stk\.(transaction|transfer|part|location)\./.test(k));
    expect(missing).toEqual([]);
  });
  it('covers every value of the dynamic label families', () => {
    const families: Record<string, string[]> = {
      lkind: ['store', 'locker', 'workshop', 'other'], tstate: ['in_transit', 'received', 'cancelled'],
      act: ['receipts', 'issues', 'returns', 'adjustments'], act1: ['receipts', 'issues', 'adjustments'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(stkLabelsEn[`stk.${f}.${v}`], `stk.${f}.${v}`).toBeTruthy();
    for (const k of ['quantity', 'delta', 'unitCost']) expect(stkLabelsEn[`stk.field.${k}`]).toBeTruthy();
  });
});
