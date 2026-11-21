/**
 * Release 1 acceptance (OFFICE_R1_SPEC.md §7, requirement §11) run through the HTTP API with real sign-ins, the real
 * authorizer and the five office roles from OFFICE_ROLES, scoped to the dockyard command.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { register as m03 } from '../../src/modules/m03-assets/index.js';
import { register as m05 } from '../../src/modules/m05-work/index.js';
import { register as m11 } from '../../src/modules/m11-excel/index.js';
import { register as m15, OFFICE_ROLES } from '../../src/modules/m15-office/index.js';
import { grantOfficeRanges } from '../../src/modules/m15-office/numbering.js';
import { addDays, todayLocal } from '../../src/modules/m15-office/common.js';
import { restoreBackup, verifyBackupFile } from '../../src/modules/m14-operations/index.js';
import { writeBackupFile } from '../../src/modules/m14-operations/backup.js';
import { openDatabase } from '../../src/platform/db/open.js';
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import { makeIdnEnv } from './idn-helpers.js';
import { allowAll } from './org-helpers.js';

const today = todayLocal();
const O = '/api/v1/office';

async function office() {
  const env = await makeIdnEnv();
  for (const r of [m03, m05, m11, m15]) r(env.ctx, env.app);
  const admin = { ...env.actor(env.adminId), authz: allowAll };
  const cmd = createOrg(admin as never, 'command', { code: 'DY-N', name: 'Dockyard North' }).id as string;
  grantOfficeRanges(admin.wctx, env.hub.installationId, 500);
  const users: Record<string, { userId: string; token: string }> = {};
  const roleOf: Record<string, string> = { oic: 'OFC_OIC', po: 'OFC_SUPERVISOR', util: 'OFC_SUPERVISOR', tech: 'OFC_TECH', viewer: 'OFC_READONLY', sysadmin: 'OFC_ADMIN' };
  for (const [name, code] of Object.entries(roleOf)) {
    const role = OFFICE_ROLES.find((r) => r.code === code)!;
    const u = await env.addUser({ username: `u-${name}`, displayName: name.toUpperCase(), permissions: [...role.permissions], scopeKind: 'command', scopeId: cmd, roleCode: `${code}-${name}`.toUpperCase() });
    users[name] = { userId: u.userId, token: await env.login(`u-${name}`) };
  }
  const as = (who: string) => async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown) => env.call(users[who]!.token, method, url, body);
  const oic = as('oic');
  // structure and people
  const radar = (await oic('POST', `${O}/units`, { commandId: cmd, level: 'department', code: 'RADAR', name: 'Radar', headUserId: users.po!.userId })).json.id as string;
  const pumps = (await oic('POST', `${O}/units`, { commandId: cmd, level: 'department', code: 'PUMPS', name: 'Pumps', headUserId: users.util!.userId })).json.id as string;
  const person = async (name: string, unitId: string, userId?: string) => (await oic('POST', `${O}/persons`, { commandId: cmd, name, unitId, serviceNo: name.toUpperCase(), ...(userId ? { userId } : {}) })).json.id as string;
  const people = { oic: await person('Oic', radar, users.oic!.userId), po: await person('Po', radar, users.po!.userId), tech: await person('Tech', radar, users.tech!.userId), util: await person('Util', pumps, users.util!.userId) };
  return { env, cmd, users, as, oic, radar, pumps, people };
}

describe('Release 1 acceptance (§11)', () => {
  it('criteria 1, 2, 7, 10: letter → linked task → assign, track, delay reason, complete, verify, close; changes traceable', async () => {
    const o = await office();
    const clerk = o.as('po');
    const letter = await clerk('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'incoming', subject: 'Radar fault SLNS X', officialRef: 'SLNS-X/ENG/9', letterDate: addDays(today, -6), receivedDate: addDays(today, -5), replyRequired: true, replyDue: addDays(today, -1), unitId: o.radar });
    expect(letter.status).toBe(201);
    const task = await clerk('POST', `${O}/tasks`, { source: { type: 'ofc.correspondence', id: letter.json.id }, assigneePersonId: o.people.tech, targetDate: addDays(today, -1) });
    expect(task.status).toBe(201);
    const id = task.json.id as string;
    const bundle = await o.oic('GET', `${O}/record?type=ofc.task&id=${id}`);
    expect(bundle.json.links[0]).toMatchObject({ linkType: 'originated_from', toId: letter.json.id });
    // criterion 7: overdue identified everywhere
    expect((await o.oic('GET', `${O}/tasks?commandId=${o.cmd}&view=overdue`)).json.total).toBe(1);
    const dash = (await o.oic('GET', `${O}/dashboard?commandId=${o.cmd}`)).json;
    expect(dash.tiles.find((t: { key: string }) => t.key === 'overdue_tasks').n).toBe(1);
    expect(dash.tiles.find((t: { key: string }) => t.key === 'overdue_corr').n).toBe(1);
    const tech = o.as('tech');
    let v = (await tech('GET', `${O}/tasks/${id}`)).json.version;
    expect((await tech('POST', `${O}/tasks/${id}/status`, { expectedVersion: v, status: 'in_progress' })).status).toBe(400);
    v = (await tech('POST', `${O}/tasks/${id}/status`, { expectedVersion: v, status: 'in_progress', delayReason: 'Waiting for test set' })).json.version;
    v = (await tech('POST', `${O}/tasks/${id}/complete`, { expectedVersion: v, note: 'Display replaced' })).json.version;
    expect((await tech('POST', `${O}/tasks/${id}/close`, { expectedVersion: v })).status).toBe(403);
    const closed = await clerk('POST', `${O}/tasks/${id}/close`, { expectedVersion: v, note: 'Checked' });
    expect(closed.json).toMatchObject({ status: 'closed', closedBy: o.users.po!.userId });
    // criterion 10: who did what is recorded
    const hist = (await o.oic('GET', `${O}/record?type=ofc.task&id=${id}`)).json.timeline as Array<{ kind: string; toValue: string; recordedBy: string }>;
    expect(hist.filter((e) => e.kind === 'status').map((e) => [e.toValue, e.recordedBy])).toEqual([
      ['in_progress', o.users.tech!.userId], ['completed', o.users.tech!.userId], ['closed', o.users.po!.userId],
    ]);
    // reply clears the pending letter
    const reply = await clerk('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'outgoing', subject: 'Re: Radar fault', replyToId: letter.json.id, status: 'dispatched' });
    expect(reply.status).toBe(201);
    expect((await o.oic('GET', `${O}/correspondence?commandId=${o.cmd}&pending=true`)).json.total).toBe(0);
  });

  it('criteria 3, 4, 5, 6, 8: handover import, equipment, work orders, dashboard = lists, reports print/Excel', async () => {
    const o = await office();
    const p = await o.oic('POST', `${O}/handovers`, { commandId: o.cmd, appointment: 'SLE (E&T) II North', fromName: 'A', toName: 'B' });
    const rows = [{ annexRef: 'A/1', category: 'project', subject: 'Generator project', targetDate: addDays(today, -1) }, { annexRef: 'A/2', category: 'equipment', subject: 'Scope on loan' }];
    expect((await o.oic('POST', `${O}/handovers/${p.json.id}/items/bulk`, { rows })).json.committed).toBe(false);
    expect((await o.oic('POST', `${O}/handovers/${p.json.id}/items/bulk`, { rows, commit: true })).json.created).toHaveLength(2);
    expect((await o.oic('GET', `${O}/handovers/${p.json.id}/report`)).json).toMatchObject({ total: 2, done: 0 });
    // equipment and work order
    const e = await o.oic('POST', `${O}/equipment`, { commandId: o.cmd, name: 'Radar display', serialNo: 'S1', receivedForRepair: true, ownerUnitId: o.radar });
    const wo = await o.oic('POST', `${O}/work-orders`, { commandId: o.cmd, title: 'Repair radar display', equipmentId: e.json.id, unitId: o.radar });
    const W = `${O}/work-orders/${wo.json.id}`;
    const ver = async () => (await o.oic('GET', W)).json.version as number;
    expect((await o.as('po')('POST', `${W}/approve`, { expectedVersion: await ver() })).status).toBe(403); // supervisor cannot approve
    await o.oic('POST', `${W}/approve`, { expectedVersion: await ver(), approvalRef: 'Minute 3' });
    await o.as('po')('POST', `${W}/assign`, { expectedVersion: await ver(), supervisorPersonId: o.people.po, crew: [o.people.tech] });
    await o.as('tech')('POST', `${W}/status`, { expectedVersion: await ver(), status: 'in_progress' });
    await o.as('tech')('POST', `${W}/complete`, { expectedVersion: await ver(), completionDetails: 'Board replaced' });
    expect((await o.as('po')('POST', `${W}/verify`, { expectedVersion: await ver() })).status).toBe(403); // supervised it himself
    expect((await o.oic('POST', `${W}/verify`, { expectedVersion: await ver(), note: 'OK' })).json.status).toBe('verified');
    expect((await o.oic('POST', `${W}/close`, { expectedVersion: await ver() })).json.status).toBe('closed');
    const ev = (await o.oic('GET', `${O}/equipment/${e.json.id}`)).json;
    await o.oic('POST', `${O}/equipment/${e.json.id}/movements`, { expectedVersion: ev.version, kind: 'repair_completed', condition: 'serviceable' });
    // criterion 6: dashboard equals lists
    const d = (await o.oic('GET', `${O}/dashboard?commandId=${o.cmd}`)).json;
    const tile = (k: string) => d.tiles.find((t: { key: string }) => t.key === k).n;
    expect(tile('equip_collection')).toBe((await o.oic('GET', `${O}/equipment?commandId=${o.cmd}&view=pending_collection`)).json.total);
    expect(tile('outstanding_wo')).toBe((await o.oic('GET', `${O}/work-orders?commandId=${o.cmd}&view=outstanding`)).json.total);
    expect(tile('handover_overdue')).toBe(1);
    // criterion 8: every report renders and exports
    for (const code of (await o.oic('GET', `${O}/reports`)).json.reports as string[]) {
      expect((await o.oic('GET', `${O}/reports/${code}?commandId=${o.cmd}`)).status, code).toBe(200);
      const x = await o.env.app.inject({ method: 'GET', url: `${O}/reports/${code}/xlsx?commandId=${o.cmd}`, headers: { authorization: `Bearer ${o.users.oic!.token}` } });
      expect(x.statusCode, code).toBe(200);
    }
  });

  it('criterion 9 (AT-14, AT-15): users cannot see or change records outside their authority', async () => {
    const o = await office();
    const pumpTask = (await o.oic('POST', `${O}/tasks`, { commandId: o.cmd, title: 'Pump job', unitId: o.pumps, assigneePersonId: o.people.util })).json.id;
    const restricted = (await o.oic('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'incoming', subject: 'Vetting list', classification: 'restricted', unitId: o.radar })).json.id;
    const att = (await o.oic('POST', `${O}/attachments`, { fileName: 'x.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('secret').toString('base64'), classification: 'restricted', record: { type: 'ofc.correspondence', id: restricted } })).json.id;
    const po = o.as('po');
    expect((await po('GET', `${O}/tasks/${pumpTask}`)).status).toBe(403);
    expect((await po('PATCH', `${O}/tasks/${pumpTask}`, { expectedVersion: 2, remarks: 'x' })).status).toBe(403);
    expect((await po('GET', `${O}/tasks?commandId=${o.cmd}&view=all`)).json.total).toBe(0);
    expect((await po('GET', `${O}/correspondence/${restricted}`)).json).toMatchObject({ subject: '[Restricted]', masked: true });
    expect((await po('GET', `${O}/attachments/${att}/content`)).status).toBe(403);
    expect((await o.as('sysadmin')('GET', `${O}/attachments/${att}/content`)).status).toBe(403); // admin manages, does not read content
    const file = await o.env.app.inject({ method: 'GET', url: `${O}/attachments/${att}/content`, headers: { authorization: `Bearer ${o.users.oic!.token}` } });
    expect([file.statusCode, file.body]).toEqual([200, 'secret']);
    const viewer = o.as('viewer');
    expect((await viewer('GET', `${O}/tasks/${pumpTask}`)).status).toBe(200);
    expect((await viewer('POST', `${O}/tasks`, { commandId: o.cmd, title: 'x' })).status).toBe(403);
    expect((await viewer('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'incoming', subject: 'x' })).status).toBe(403);
    const tech = o.as('tech');
    expect((await tech('POST', `${O}/tasks`, { commandId: o.cmd, title: 'self-made' })).status).toBe(403);
    expect((await tech('POST', `${O}/work-orders`, { commandId: o.cmd, title: 'x' })).status).toBe(403);
    expect((await o.env.call(null, 'GET', `${O}/tasks?commandId=${o.cmd}`)).status).toBe(401);
    // denials are audited
    expect((o.env.ctx.db.prepare("SELECT COUNT(*) AS n FROM sys_audit_event WHERE outcome = 'denied' AND action LIKE 'denied:ofc.%'").get() as { n: number }).n).toBeGreaterThan(0);
  });

  it('criteria 11, 12: backup and restoration return exactly the backed-up office records', async () => {
    const o = await office();
    await o.oic('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'incoming', subject: 'Before backup' });
    await o.oic('POST', `${O}/tasks`, { commandId: o.cmd, title: 'Before backup', assigneePersonId: o.people.tech });
    const count = (db: { prepare(s: string): { get(): unknown } }, t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const tables = ['ofc_correspondence', 'ofc_task', 'ofc_person', 'ofc_org_unit', 'ofc_record_event', 'idn_user'];
    const before = Object.fromEntries(tables.map((t) => [t, count(o.env.ctx.db, t)]));
    const dir = mkdtempSync(join(tmpdir(), 'ofc-bk-'));
    const m = writeBackupFile(o.env.ctx.db, join(dir, 'backups'), 'manual', 'oic');
    const file = join(dir, 'backups', m.fileName);
    expect(verifyBackupFile(file).ok).toBe(true);
    await o.oic('POST', `${O}/correspondence`, { commandId: o.cmd, kind: 'incoming', subject: 'After backup' });
    expect(count(o.env.ctx.db, 'ofc_correspondence')).toBe(before.ofc_correspondence! + 1);
    const dbFile = join(dir, 'restored.sqlite');
    restoreBackup({ dbFile, dataDir: dir, backupFile: file });
    expect(existsSync(dbFile)).toBe(true);
    const restored = openDatabase(dbFile);
    expect(Object.fromEntries(tables.map((t) => [t, count(restored, t)]))).toEqual(before);
    expect((restored.prepare("SELECT COUNT(*) AS n FROM ofc_correspondence WHERE subject = 'After backup'").get() as { n: number }).n).toBe(0);
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
    restored.close();
  });
});
