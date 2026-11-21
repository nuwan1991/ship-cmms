import { describe, expect, it } from 'vitest';
import { nextRef } from '../../src/modules/m15-office/numbering.js';
import { OFFICE_ROLES, OFC_PERMISSIONS } from '../../src/modules/m15-office/index.js';
import { unitAndDescendants, unitTree } from '../../src/modules/m15-office/queries.js';
import { createLink, createUnit, readAttachment, updateUnit, uploadAttachment } from '../../src/modules/m15-office/service.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { makeOfcEnv } from './ofc-helpers.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('M15 office foundation', () => {
  it('builds the dockyard tree and enforces the allowed levels (A1)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const C = env.commandId;
    const elec = createUnit(a, { commandId: C, level: 'department', code: 'ELEC', name: 'Electronic' });
    const sec = createUnit(a, { commandId: C, level: 'section', parentId: elec.id, code: 'ELEC-N', name: 'North section' });
    const ws = createUnit(a, { commandId: C, level: 'workshop', parentId: sec.id, code: 'RADAR', name: 'Radar workshop' });
    createUnit(a, { commandId: C, level: 'subsection', parentId: ws.id, code: 'RADAR-ANT', name: 'Antenna' });
    // a small department without sections: workshop straight under the department
    const util = createUnit(a, { commandId: C, level: 'department', code: 'UTIL', name: 'Utility' });
    createUnit(a, { commandId: C, level: 'workshop', parentId: util.id, code: 'PUMPS', name: 'Pump workshop' });

    expect(codeOf(() => createUnit(a, { commandId: C, level: 'subsection', parentId: sec.id, code: 'X', name: 'x' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createUnit(a, { commandId: C, level: 'workshop', code: 'Y', name: 'y' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => createUnit(a, { commandId: C, level: 'department', code: 'ELEC', name: 'dup' }))).toBe('DUPLICATE');
    expect(codeOf(() => updateUnit(a, elec.id as string, { expectedVersion: 1, parentId: ws.id }))).toBe('VALIDATION_FAILED');

    const tree = unitTree(env.ctx.db, C);
    expect(tree.map((u) => u.path)).toEqual(['ELEC', 'ELEC / ELEC-N', 'ELEC / ELEC-N / RADAR', 'ELEC / ELEC-N / RADAR / RADAR-ANT', 'UTIL', 'UTIL / PUMPS']);
    expect(unitAndDescendants(env.ctx.db, elec.id as string)).toHaveLength(4);
    expect(codeOf(() => updateUnit(a, ws.id as string, { expectedVersion: 1, status: 'inactive' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('links records both ways, keeps attachments once per content, and guards restricted files (AT-15)', () => {
    const env = makeOfcEnv();
    const a = env.hubActor();
    const u1 = createUnit(a, { commandId: env.commandId, level: 'department', code: 'D1', name: 'One' });
    const u2 = createUnit(a, { commandId: env.commandId, level: 'department', code: 'D2', name: 'Two' });
    const from = { type: 'ofc.org_unit', id: u1.id as string }, to = { type: 'ofc.org_unit', id: u2.id as string };
    createLink(a, { from, to });
    expect(codeOf(() => createLink(a, { from, to }))).toBe('DUPLICATE');
    expect(sql(env, "SELECT record_id FROM ofc_record_event WHERE kind = 'link'").map((r) => r.record_id).sort()).toEqual([u1.id, u2.id].sort());

    const f1 = uploadAttachment(a, { fileName: 'letter.pdf', mimeType: 'application/pdf', contentBase64: b64('%PDF-1 hello'), record: from, classification: 'restricted' });
    uploadAttachment(a, { fileName: 'copy.pdf', mimeType: 'application/pdf', contentBase64: b64('%PDF-1 hello'), record: to });
    expect(sql(env, 'SELECT COUNT(*) AS n FROM ofc_attachment_content')[0]!.n).toBe(1);
    expect(readAttachment(a, f1.id as string).bytes.toString()).toBe('%PDF-1 hello');
    const noRestricted = env.hubActor(denyOnly('ofc.attachment.view_restricted'));
    expect(codeOf(() => readAttachment(noRestricted, f1.id as string))).toBe('FORBIDDEN');
    expect(sql(env, "SELECT COUNT(*) AS n FROM sys_audit_event WHERE action = 'denied:ofc.attachment.view_restricted'")[0]!.n).toBe(1);
  });

  it('issues office reference numbers and defines roles only from declared permissions', () => {
    const env = makeOfcEnv();
    const w = env.hubActor().wctx;
    expect(nextRef(w, 'ofc_task')).toBe('TSK-00001');
    expect(nextRef(w, 'ofc_task')).toBe('TSK-00002');
    expect(nextRef(w, 'ofc_corr_in')).toBe('COR-IN-00001');
    const known = (p: string) => OFC_PERMISSIONS.includes(p) || ['ofc.*', 'idn.*', 'ops.*', 'wrk.*'].includes(p);
    for (const r of OFFICE_ROLES) for (const p of r.permissions) expect(known(p), `${r.code}: ${p}`).toBe(true);
    // technical staff cannot verify or cancel (spec §3)
    const tech = OFFICE_ROLES.find((r) => r.code === 'OFC_TECH')!;
    expect(tech.permissions).not.toContain('ofc.task.verify');
  });
});
