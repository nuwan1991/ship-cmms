import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { synNav } from './index';
import { synLabelsEn } from './labels.en';

describe('labels', () => {
  it('has a label for every nav item, with permissions in the syn namespace', () => {
    for (const n of synNav) { expect(synLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^syn\./); }
  });
  it('defines every literal syn.* label key used by the screens, and the dynamic families', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](syn\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const isPermission = (k: string): boolean => /^syn\.(status|peer|subscription|session|conflict|bundle)\.(view|provision|decommission|update|run|resolve|export|import)$/.test(k);
    expect([...used].filter((k) => !(k in synLabelsEn) && !isPermission(k))).toEqual([]);
    const families: Record<string, string[]> = {
      kind: ['ship', 'workshop', 'command', 'hub'], status: ['pending', 'active', 'decommissioned'], cstate: ['open', 'resolved', 'dismissed'], dir: ['http', 'bundle_in', 'bundle_out'],
      code: ['FORK', 'INTEGRITY', 'SCHEMA_NEWER', 'UNKNOWN_ENTITY', 'APPLY_FAILED', 'DEPENDENCY_MISSING', 'HUB_OVERWRITE'], resolve: ['accept_incoming', 'keep_local', 'dismiss'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(synLabelsEn[`syn.${f}.${v}`], `syn.${f}.${v}`).toBeTruthy();
  });
});
