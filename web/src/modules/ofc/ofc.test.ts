import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ofcLabelsEn } from './labels.en';
import { ofcNav } from './index';
import { parseHandoverPaste, splitRows, toIsoDate } from './paste';

describe('labels', () => {
  it('has a label for every nav item and every literal ofc.* key used by the screens', () => {
    for (const n of ofcNav) { expect(ofcLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^ofc\./); }
    const dir = fileURLToPath(new URL('.', import.meta.url));
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => /\.(tsx|ts)$/.test(x) && !x.endsWith('.test.ts') && x !== 'labels.en.ts')) {
      for (const m of readFileSync(dir + f, 'utf8').matchAll(/['"`](ofc\.[a-z_0-9]+(?:\.[a-zA-Z_]+)+)['"`]/g)) used.add(m[1]!);
    }
    const perms = /^ofc\.(org_unit|correspondence|handover|attachment|timeline|link|task|person|equipment|work_order|supply|settings|report|import)\.(run|view|create|update|remove|cancel|comment|assign|reassign|record)$/;
    expect([...used].filter((k) => !(k in ofcLabelsEn) && !perms.test(k) && k !== 'ofc.commandId')).toEqual([]);
  });
  it('covers every value of the dynamic label families', () => {
    const families: Record<string, string[]> = {
      kind: ['incoming', 'outgoing', 'minute', 'signal', 'other'], level: ['department', 'section', 'workshop', 'subsection'], priority: ['immediate', 'high', 'normal', 'low'],
      cstatus: ['received', 'under_action', 'replied', 'filed', 'draft', 'signed', 'dispatched', 'acknowledged', 'open', 'cancelled'],
      to: ['received', 'under_action', 'replied', 'filed', 'draft', 'signed', 'dispatched', 'acknowledged', 'open'],
      istatus: ['open', 'in_progress', 'completed', 'not_applicable'], pstatus: ['draft', 'signed', 'in_progress', 'completed'],
      cat: ['responsibility', 'project', 'pending_work', 'unresolved', 'correspondence', 'equipment', 'other'],
      tstatus: ['not_started', 'assigned', 'in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold', 'completed', 'closed', 'cancelled'], tview: ['active', 'overdue', 'due_soon', 'attention', 'awaiting_verification', 'done', 'all'],
      duty: ['available', 'on_leave', 'temporary_duty', 'course', 'sick', 'transferred'], tto: ['in_progress', 'awaiting_info', 'awaiting_approval', 'on_hold'],
      wstatus: ['requested', 'under_review', 'approved', 'assigned', 'in_progress', 'awaiting_spares', 'awaiting_external', 'completed', 'verified', 'closed', 'cancelled'],
      wto: ['under_review', 'requested', 'in_progress', 'awaiting_spares', 'awaiting_external'], estate: ['in_store', 'in_workshop', 'at_external', 'awaiting_collection', 'returned', 'on_issue'],
      cond: ['serviceable', 'unserviceable', 'repairable', 'ber', 'unknown'], move: ['registered', 'received_for_repair', 'sent_out', 'returned_from_external', 'repair_completed', 'ready_for_collection', 'collected', 'issued', 'returned_from_issue', 'condition', 'correction'],
      tile: ['active_tasks', 'overdue_tasks', 'attention', 'due_soon', 'awaiting_decision', 'completed_period', 'pending_corr', 'overdue_corr', 'outstanding_wo', 'overdue_wo', 'equip_repair', 'equip_collection', 'equip_overdue', 'supply_open', 'supply_overdue', 'handover_open', 'handover_overdue'],
      report: ['daily_outstanding', 'weekly_progress', 'monthly_summary', 'overdue_tasks', 'pending_correspondence', 'handover_completion', 'equipment_pending', 'workshop_progress', 'personnel_allocation', 'supply_status'],
      import: ['persons', 'correspondence', 'equipment', 'help_persons', 'help_correspondence', 'help_equipment'],
      ev: ['comment', 'progress', 'status', 'assign', 'target_date', 'correction', 'attachment', 'link', 'cancel', 'reopen'],
      link: ['originated_from', 'reply_to', 'relates_to', 'supersedes'], new: ['incoming', 'outgoing', 'minute', 'signal', 'other'],
      field: ['supplyRef', 'demandDate', 'item', 'partNo', 'quantity', 'unitOfIssue', 'demandingUnit', 'stage', 'stageDate', 'expectedDate', 'remarks', 'annexRef', 'category', 'subject', 'description', 'previousStatus', 'priority', 'urgent', 'targetDate', 'remarks', 'originalRef'],
    };
    for (const [f, vals] of Object.entries(families)) for (const v of vals) expect(ofcLabelsEn[`ofc.${f}.${v}`], `ofc.${f}.${v}`).toBeTruthy();
  });
});

describe('paste import', () => {
  it('reads Excel (tab) and CSV paste, maps headings and normalises values', () => {
    const text = 'Annex\tSubject\tStatus\tTarget Date\tUrgent\tCategory\tUnknown col\nA/1\tRadar spares\tWith NHQ\t20/11/2026\tYes\tProjects\tzz\nA/2\tGenerator\t\t2026-12-01\t\t\t\n';
    const r = parseHandoverPaste(text);
    expect(r.headings.map((h) => h.field)).toEqual(['annexRef', 'subject', 'previousStatus', 'targetDate', 'urgent', 'category', null]);
    expect(r.rows).toEqual([
      { annexRef: 'A/1', subject: 'Radar spares', previousStatus: 'With NHQ', targetDate: '2026-11-20', urgent: true, category: 'project' },
      { annexRef: 'A/2', subject: 'Generator', targetDate: '2026-12-01', category: 'pending_work' },
    ]);
    expect(splitRows('a,"b, c",d\n1,"say ""hi""",3')).toEqual([['a', 'b, c', 'd'], ['1', 'say "hi"', '3']]);
    expect(toIsoDate('5.1.2026')).toBe('2026-01-05');
    expect(toIsoDate('Jan 5')).toBe('Jan 5');
  });
});
