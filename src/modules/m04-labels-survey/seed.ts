/**
 * Label-numbering setup (hub) and DEMO data. Demo data goes through the normal services, so ownership, audit, number ranges and
 * events are exercised. Never run the demo seed on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';
import { findLocationByCode, findPartyByCode } from '../m01-organization/index.js';
import { findAssetByName } from '../m03-assets/index.js';
import type { Actor } from './actor.js';
import { addSurveyItem, createTemplate, issueLabels, assignLabel, LABEL_SEQUENCE, startSurvey } from './service.js';

export const DEFAULT_LABEL_PREFIX = 'SLN-LB';
export const DEFAULT_LABEL_WIDTH = 8;

const allowAll: Authorizer = { name: 'seed-allow', check: () => ({ allowed: true }) };

/** Hub only: define the label-number sequence once (prefix and width are data). Safe to repeat. */
export function ensureLabelSequence(w: WriteContext, opts: { prefix?: string; width?: number } = {}): void {
  const have = w.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(LABEL_SEQUENCE);
  if (!have) defineSequence(w, { code: LABEL_SEQUENCE, prefix: opts.prefix ?? DEFAULT_LABEL_PREFIX, width: opts.width ?? DEFAULT_LABEL_WIDTH, description: 'QR label number' });
}

/** Hub only: grant the next free block of label numbers to an installation (until M10 automates range requests). */
export function grantLabelRange(w: WriteContext, installationId: string, size: number) {
  ensureLabelSequence(w);
  return grantRange(w, { sequenceCode: LABEL_SEQUENCE, installationId, size });
}

export interface DemoSurveyResult { templates: number; labels: number; surveys: number; items: number }

/** Needs the demo organization and demo assets. Leaves one open survey with a scanned and a pending item, and 5 spare labels. */
export function seedDemoSurvey(actor: Actor): DemoSurveyResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const ship = findPartyByCode(db, 'ship', 'DEMO-101');
  const room = ship ? findLocationByCode(db, ship.id, 'GEN') : null;
  if (!ship || !room) throw new AppError('DEPENDENCY_MISSING', 'Load the demo organization first: npm run seed:demo-org');

  ensureLabelSequence(a.wctx);
  if (!db.prepare('SELECT 1 FROM sys_number_range WHERE sequence_code = ? AND allocated_to_installation_id = ? AND deleted_at IS NULL').get(LABEL_SEQUENCE, a.wctx.installation.installationId)) {
    grantLabelRange(a.wctx, a.wctx.installation.installationId, 1000);
  }
  const tpl = createTemplate(a, {
    code: 'COMPARTMENT-BASIC', name: 'Basic compartment survey', description: 'Condition of each item found in a compartment',
    items: [{ key: 'condition_ok', label: 'Condition acceptable?', kind: 'yesno' }, { key: 'remarks', label: 'Remarks', kind: 'text' }],
  });
  const labels = issueLabels(a, { count: 5, shipId: ship.id });
  const survey = startSurvey(a, { locationId: room.id, templateId: tpl.id, note: 'Demo walk-through' });
  const found = findAssetByName(db, 'Main alternator');
  let items = 0;
  if (found) {
    assignLabel(a, labels[0]!.id as string, { expectedVersion: 1, assetTag: found.assetTag });
    addSurveyItem(a, survey.id as string, { kind: 'scanned', labelNo: labels[0]!.labelNo as string, answers: { condition_ok: true } });
    items += 1;
  }
  addSurveyItem(a, survey.id as string, { kind: 'pending', description: 'Bilge pump (unregistered)', manufacturer: 'Demo Pumps', model: 'BP-20', answers: { condition_ok: false, remarks: 'Corroded housing' } });
  items += 1;
  return { templates: 1, labels: labels.length, surveys: 1, items };
}
