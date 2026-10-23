/**
 * Work-numbering setup (hub) and DEMO data. Demo data goes through the normal services, so ownership, audit, number ranges and
 * events are exercised. Never run the demo seed on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';
import { findPartyByCode } from '../m01-organization/index.js';
import { findAssetByName } from '../m03-assets/index.js';
import type { Actor } from './actor.js';
import {
  addFinding, addLabour, addTestRecord, changeProgress, convertDefect, createAdvisory, createJobCard, createWorkOrder, DEFECT_SEQUENCE,
  offerHandover, REPAIR_CASE_SEQUENCE, reportDefect, WORK_ORDER_SEQUENCE,
} from './service.js';

export const SEQUENCES = [
  { code: WORK_ORDER_SEQUENCE, prefix: 'SLN-WO', description: 'Work order number' },
  { code: REPAIR_CASE_SEQUENCE, prefix: 'SLN-RC', description: 'Repair case number' },
  { code: DEFECT_SEQUENCE, prefix: 'SLN-DF', description: 'Defect number' },
] as const;
export const DEFAULT_WIDTH = 8;

const allowAll: Authorizer = { name: 'seed-allow', check: () => ({ allowed: true }) };

/** Hub only: define the three number sequences once (prefix and width are data). Safe to repeat. */
export function ensureWorkSequences(w: WriteContext, opts: { width?: number } = {}): void {
  for (const s of SEQUENCES) {
    if (!w.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(s.code)) {
      defineSequence(w, { code: s.code, prefix: s.prefix, width: opts.width ?? DEFAULT_WIDTH, description: s.description });
    }
  }
}

/** Hub only: grant the next free block of each work number to an installation (until M10 automates range requests). */
export function grantWorkRanges(w: WriteContext, installationId: string, size: number): void {
  ensureWorkSequences(w);
  for (const s of SEQUENCES) grantRange(w, { sequenceCode: s.code, installationId, size });
}

export interface DemoWorkResult { defects: number; repairCases: number; workOrders: number; advisories: number }

/** Needs the demo organization and demo assets. Leaves one defect awaiting triage and one work order part-way through, offered to the electrical workshop. */
export function seedDemoWork(actor: Actor): DemoWorkResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const ship = findPartyByCode(db, 'ship', 'DEMO-101');
  const workshop = findPartyByCode(db, 'workshop', 'DEMO-WS-ELEC');
  const alt = findAssetByName(db, 'Main alternator');
  if (!ship || !workshop || !alt) throw new AppError('DEPENDENCY_MISSING', 'Load the demo organization and demo assets first: npm run seed:demo-org && npm run seed:demo-assets');

  ensureWorkSequences(a.wctx);
  if (!db.prepare('SELECT 1 FROM sys_number_range WHERE sequence_code = ? AND allocated_to_installation_id = ? AND deleted_at IS NULL').get(WORK_ORDER_SEQUENCE, a.wctx.installation.installationId)) {
    grantWorkRanges(a.wctx, a.wctx.installation.installationId, 1000);
  }
  const id = (r: Record<string, unknown>) => r.id as string;

  if (alt.classificationId) {
    createAdvisory(a, { code: 'ADV-ALT-001', title: 'Check drive-end bearing grease after rewinding', body: 'After an alternator rewind, re-grease the drive-end bearing and record the vibration reading.', severity: 'caution', classificationId: alt.classificationId });
  }
  reportDefect(a, { title: 'Hot smell from generator room', description: 'Noticed during rounds, no alarm.', severity: 'minor', shipId: ship.id });
  const d = reportDefect(a, { title: 'Alternator vibration high at 1500 rpm', description: 'Vibration above normal; bearing noise.', severity: 'major', assetId: alt.id });
  const { repairCase } = convertDefect(a, id(d), { expectedVersion: 1 });
  const wo = createWorkOrder(a, { title: 'Replace alternator drive-end bearing', repairCaseId: id(repairCase), workType: 'corrective', priority: 'high', operatingParty: { kind: 'ship', id: ship.id }, executingParty: { kind: 'ship', id: ship.id } });
  createJobCard(a, { workOrderId: id(wo), title: 'Bearing replacement', instructions: 'Isolate, lock out, remove end shield, replace bearing, re-grease.', checklist: ['Isolated and tagged out', 'Old bearing removed', 'New bearing fitted', 'Grease applied'] });
  changeProgress(a, id(wo), { to: 'in_progress', note: 'Started' });
  addLabour(a, id(wo), { workerName: 'Demo Technician', trade: 'Electrical', minutes: 180 });
  addFinding(a, id(wo), { kind: 'cause', text: 'Bearing worn; grease contaminated.' });
  addTestRecord(a, id(wo), { testName: 'Vibration at 1500 rpm', result: 'pass', measuredValue: '2.1 mm/s' });
  
  offerHandover(a, id(wo), { toParty: { kind: 'workshop', id: workshop.id }, note: 'Rewinding needs the specialist workshop' });
  return { defects: 2, repairCases: 1, workOrders: 1, advisories: alt.classificationId ? 1 : 0 };
}
