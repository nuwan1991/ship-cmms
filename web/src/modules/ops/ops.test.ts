import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { opsNav } from './index';
import { opsLabelsEn } from './labels.en';

describe('labels', () => {
  it('has a label for every nav item, with permissions in the ops namespace', () => {
    for (const n of opsNav) { expect(opsLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^ops\./); }
  });
  it('defines every literal ops.* label key used by the screens, and the dynamic families', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](ops\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const isPermission = (k: string): boolean => /^ops\.(status|backup|integrity)\.(view|create|verify|run)$/.test(k);
    expect([...used].filter((k) => !(k in opsLabelsEn) && !isPermission(k))).toEqual([]);
    const families: Record<string, string[]> = {
      warn: ['no_backup', 'backup_old', 'backup_unverified', 'backup_bad', 'integrity', 'disk_low', 'migrations_pending'], reason: ['manual', 'scheduled', 'pre_upgrade', 'pre_restore'], sev: ['error', 'warning'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(opsLabelsEn[`ops.${f}.${v}`], `ops.${f}.${v}`).toBeTruthy();
  });
});
