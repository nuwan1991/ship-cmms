import { describe, expect, it } from 'vitest';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import {
  createCorrespondence, createMatter, getCorrespondence, listCorrespondence, markNoReplyNeeded, matterThread, setCorrespondenceStatus, updateCorrespondence,
} from '../../src/modules/m15-office/correspondence.js';
import { addItemAction, bulkItems, createItem, createPacket, handoverReport, listItems, updateItem, updatePacket } from '../../src/modules/m15-office/handover.js';
import { timelineOf } from '../../src/modules/m15-office/queries.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const today = todayLocal();

describe('M15 correspondence', () => {
  it('registers a letter, threads the reply and drops it off the pending list once dispatched (AT-05)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    const m = createMatter(a, { commandId: C, title: 'Radar spares for SLNS X', fileRef: 'E&T/N/12' });
    const inc = createCorrespondence(a, {
      commandId: C, kind: 'incoming', officialRef: 'NHQ/ENG/45', letterDate: addDays(today, -5), receivedDate: addDays(today, -3), originator: 'NHQ', subject: 'Radar spares',
      replyRequired: true, replyDue: addDays(today, -1), matterId: m.id, actionUserId: 'u-officer',
    });
    expect(inc.ref_no).toBe('COR-IN-00001');
    expect(inc.status).toBe('received');
    let pending = listCorrespondence(a, { commandId: C, pending: 'true' });
    expect(pending.items.map((r) => r.id)).toEqual([inc.id]);
    expect(pending.items[0]!.overdue).toBe(true);
    expect(listCorrespondence(a, { commandId: C, overdue: 'true' }).total).toBe(1);

    const out = createCorrespondence(a, { commandId: C, kind: 'outgoing', subject: 'Re: Radar spares', recipients: 'NHQ', replyToId: inc.id });
    expect(out.ref_no).toBe('COR-OUT-00001');
    expect(out.matter_id).toBe(m.id); // inherits the matter of the letter it answers
    expect(listCorrespondence(a, { commandId: C, pending: 'true' }).total).toBe(1); // a draft reply does not clear it
    setCorrespondenceStatus(a, out.id as string, { expectedVersion: 1, status: 'signed' });
    const disp = setCorrespondenceStatus(a, out.id as string, { expectedVersion: 2, status: 'dispatched' });
    expect(disp.sent_date).toBe(today);
    pending = listCorrespondence(a, { commandId: C, pending: 'true' });
    expect(pending.total).toBe(0);
    expect((getCorrespondence(a, inc.id as string).replies as unknown[]).length).toBe(1);
    expect(matterThread(a, m.id as string).letters.map((l) => l.ref_no)).toEqual(['COR-IN-00001', 'COR-OUT-00001']);
    expect(timelineOf(env.ctx.db, 'ofc.correspondence', out.id as string).filter((e) => e.kind === 'status').map((e) => e.to_value)).toEqual(['signed', 'dispatched']);
    expect(codeOf(() => setCorrespondenceStatus(a, out.id as string, { expectedVersion: 3, status: 'received' }))).toBe('VALIDATION_FAILED');
  });

  it('warns on duplicates (AT-19), needs reasons for corrections and cancellation, keeps history (AT-06, AT-16)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    const base = { commandId: C, kind: 'incoming', officialRef: 'DY/ADM/7', letterDate: '2026-11-01', subject: 'Leave plan' } as const;
    const l = createCorrespondence(a, base);
    expect(codeOf(() => createCorrespondence(a, { ...base, officialRef: ' dy/adm/7 ' }))).toBe('DUPLICATE');
    const second = createCorrespondence(a, { ...base, allowDuplicate: true });

    expect(codeOf(() => updateCorrespondence(a, l.id as string, { expectedVersion: 1, officialRef: 'DY/ADM/8' }))).toBe('VALIDATION_FAILED');
    const fixed = updateCorrespondence(a, l.id as string, { expectedVersion: 1, officialRef: 'DY/ADM/8', reason: 'Typing error' });
    expect(fixed.version).toBe(2);
    const corr = timelineOf(env.ctx.db, 'ofc.correspondence', l.id as string).find((e) => e.kind === 'correction')!;
    expect(corr).toMatchObject({ field: 'official_ref', from_value: 'DY/ADM/7', to_value: 'DY/ADM/8', note: 'Typing error' });
    expect(updateCorrespondence(a, l.id as string, { expectedVersion: 2, remarks: 'filed in folder 3' }).version).toBe(3); // ordinary field: no reason needed

    expect(codeOf(() => setCorrespondenceStatus(a, l.id as string, { expectedVersion: 3, status: 'cancelled' }))).toBe('VALIDATION_FAILED');
    setCorrespondenceStatus(a, l.id as string, { expectedVersion: 3, status: 'cancelled', reason: 'Registered twice' });
    expect(sql(env, 'SELECT status, deleted_at FROM ofc_correspondence WHERE id = ?', l.id)[0]).toEqual({ status: 'cancelled', deleted_at: null });
    expect(codeOf(() => updateCorrespondence(a, l.id as string, { expectedVersion: 4, remarks: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => setCorrespondenceStatus(env.hubActor(denyOnly('ofc.correspondence.cancel')), second.id as string, { expectedVersion: 1, status: 'cancelled', reason: 'x' }))).toBe('FORBIDDEN');
  });

  it('releases a letter with "no reply needed" and hides restricted content from users without the right (A3)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    const r = createCorrespondence(a, { commandId: C, kind: 'incoming', subject: 'Security vetting list', originator: 'DNI', classification: 'restricted', replyRequired: true, replyDue: addDays(today, 3) });
    expect(codeOf(() => createCorrespondence(a, { commandId: C, kind: 'incoming', subject: 'x', replyRequired: true }))).toBe('VALIDATION_FAILED');
    const clerk = env.hubActor(denyOnly('ofc.correspondence.view_restricted'));
    const seen = listCorrespondence(clerk, { commandId: C });
    expect(seen.items[0]).toMatchObject({ subject: '[Restricted]', originator: null, masked: true });
    expect(listCorrespondence(clerk, { commandId: C, q: 'vetting' }).total).toBe(0);
    expect(listCorrespondence(a, { commandId: C, q: 'vetting' }).total).toBe(1);
    expect(codeOf(() => updateCorrespondence(clerk, r.id as string, { expectedVersion: 1, remarks: 'x' }))).toBe('FORBIDDEN');

    expect(listCorrespondence(a, { commandId: C, pending: 'true' }).total).toBe(1);
    markNoReplyNeeded(a, r.id as string, { expectedVersion: 1, reason: 'Information only per OIC' });
    expect(listCorrespondence(a, { commandId: C, pending: 'true' }).total).toBe(0);
  });
});

describe('M15 handover', () => {
  it('imports items with a preview (AT-04), tracks actions and reports progress (FR-H5)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const p = createPacket(a, { commandId: env.commandId, appointment: 'SLE (E&T) II - North', fromName: 'Lt Cdr A', toName: 'Lt Cdr B', handoverDate: '2026-11-01', documentRef: 'HO/2026/01' });
    expect(p.ref_no).toBe('HOV-0001');
    const rows = Array.from({ length: 50 }, (_, i) => ({ annexRef: `Annex A/${i + 1}`, category: 'pending_work', subject: `Item ${i + 1}`, previousStatus: 'Pending with NHQ', targetDate: i < 3 ? addDays(today, -2) : addDays(today, 30) }));
    rows[10] = { annexRef: 'Annex A/11', category: 'nonsense', subject: 'Bad category' } as never;
    rows[20] = { annexRef: 'Annex A/21', category: 'project', subject: '' } as never;
    rows[30] = { ...rows[29]! };
    const preview = bulkItems(a, p.id as string, { rows });
    expect(preview).toMatchObject({ committed: false, summary: { rows: 50, errors: 2, warnings: 1 } });
    expect(sql(env, 'SELECT COUNT(*) AS n FROM ofc_handover_item')[0]!.n).toBe(0);
    expect(bulkItems(a, p.id as string, { rows, commit: true }).committed).toBe(false); // errors block commit
    const good = rows.filter((_, i) => i !== 10 && i !== 20);
    const done = bulkItems(a, p.id as string, { rows: good, commit: true });
    expect(done).toMatchObject({ committed: true, summary: { rows: 48, errors: 0, warnings: 1 } });
    expect(sql(env, 'SELECT COUNT(DISTINCT import_batch_id) AS b, COUNT(*) AS n FROM ofc_handover_item')[0]).toEqual({ b: 1, n: 48 });
    expect(sql(env, "SELECT previous_status FROM ofc_handover_item WHERE annex_ref = 'Annex A/1'")[0]!.previous_status).toBe('Pending with NHQ');

    expect(listItems(a, p.id as string, { overdue: 'true' }).total).toBe(3);
    const item = listItems(a, p.id as string, { q: 'Item 1', sort: 'refNo', dir: 'asc' }).items[0]!;
    const acted = addItemAction(a, item.id as string, { expectedVersion: 1, note: 'Reminder sent to NHQ' });
    expect(acted).toMatchObject({ status: 'in_progress', latest_action: 'Reminder sent to NHQ', latest_action_at: today });
    expect(codeOf(() => updateItem(a, item.id as string, { expectedVersion: 2, previousStatus: 'changed' }))).toBe('VALIDATION_FAILED');
    updateItem(a, item.id as string, { expectedVersion: 2, status: 'completed', responsibleUserId: 'u-po' });
    const extra = createItem(a, p.id as string, { category: 'equipment', subject: 'Spare oscilloscope with LAN', urgent: true });
    expect(extra.ref_no).toMatch(/^HOI-/);

    const rep = handoverReport(a, p.id as string);
    expect(rep).toMatchObject({ total: 49, done: 1, percentComplete: 2 });
    expect(rep.attention.length).toBe(3); // 2 remaining overdue + 1 urgent
    expect(codeOf(() => updatePacket(a, p.id as string, { expectedVersion: 1, status: 'completed' }))).toBe('WORKFLOW_BLOCKED');
  });
});
