import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rptNav } from './index';
import { rptLabelsEn } from './labels.en';

describe('labels', () => {
  it('has a label for every nav item, with permissions in the rpt namespace', () => {
    for (const n of rptNav) { expect(rptLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^rpt\./); }
  });
  it('defines every literal rpt.* label key used by the screens, and the dynamic families', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](rpt\.[a-z_]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const isPermission = (k: string): boolean => /^rpt\.(report|dashboard|notification)\.(view|export|acknowledge|refresh)$/.test(k);
    expect([...used].filter((k) => !(k in rptLabelsEn) && !isPermission(k))).toEqual([]);
    const families: Record<string, string[]> = {
      count: ['openWorkOrders', 'overdueWorkOrders', 'urgentWorkOrders', 'pendingReviews', 'maintenanceOverdue', 'maintenanceDueSoon', 'stockBelowMinimum', 'recurringFaults', 'openConflicts', 'staleInstallations'],
      report: ['backlog', 'pending_reviews', 'maintenance_due', 'stock_below_minimum', 'recurring_faults', 'sync_health'], severity: ['info', 'warning', 'critical'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(rptLabelsEn[`rpt.${f}.${v}`], `rpt.${f}.${v}`).toBeTruthy();
    for (const s of ['open', 'acknowledged', 'resolved']) expect(rptLabelsEn[`rpt.n.status.${s}`]).toBeTruthy();
    for (const f of ['ship', 'olderThanDays', 'workType', 'priority', 'source']) expect(rptLabelsEn[`rpt.filter.${f}`], f).toBeTruthy();
  });
});
