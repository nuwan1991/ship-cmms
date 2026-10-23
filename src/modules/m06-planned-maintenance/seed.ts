/**
 * DEMO data for planned maintenance. It goes through the normal services, so ownership, audit and events are exercised.
 * Needs the demo organization, demo assets and work numbers (npm run work-numbers -- setup). Never run on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { findAssetByName } from '../m03-assets/index.js';
import type { Actor } from './actor.js';
import { createMeter, createPlan, createTemplate, generateDue, recordCalibration, recordReading } from './service.js';

const allowAll: Authorizer = { name: 'seed-allow', check: () => ({ allowed: true }) };
export interface DemoPmResult { templates: number; meters: number; plans: number; workOrders: number }

export function seedDemoPm(actor: Actor): DemoPmResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const alt = findAssetByName(db, 'Main alternator');
  if (!alt) throw new AppError('DEPENDENCY_MISSING', 'Load the demo organization and demo assets first: npm run seed:demo-org && npm run seed:demo-assets');
  const id = (r: Record<string, unknown>) => r.id as string;
  const tpl = createTemplate(a, { code: 'PM-ALT-QUARTERLY', name: 'Alternator quarterly inspection', description: 'Routine electrical and mechanical check.', checklist: ['Check winding insulation resistance', 'Inspect and re-grease bearings', 'Check cooling air path', 'Record vibration reading'], estimatedMinutes: 240, classificationId: alt.classificationId });
  const meter = createMeter(a, { assetId: alt.id, name: 'Running hours' });
  recordReading(a, { meterId: id(meter), reading: 1180, occurredAt: new Date(Date.now() - 20 * 86_400_000).toISOString() });
  recordReading(a, { meterId: id(meter), reading: 1460 });
  createPlan(a, { code: 'PM-ALT-90D', title: 'Alternator quarterly inspection', templateId: id(tpl), assetId: alt.id, triggerKind: 'calendar', intervalDays: 90, startAt: new Date(Date.now() - 85 * 86_400_000).toISOString() });
  createPlan(a, { code: 'PM-ALT-500H', title: 'Alternator 500-hour service', templateId: id(tpl), assetId: alt.id, triggerKind: 'running_hours', intervalHours: 500, meterId: id(meter), leadHours: 100 });
  recordCalibration(a, { assetId: alt.id, result: 'pass', nextDueOn: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10), certificateNo: 'CAL-DEMO-1', calibratedBy: 'Demo Lab', calibratedAt: new Date(Date.now() - 345 * 86_400_000).toISOString() });
  const g = generateDue(a, {});
  const problem = g.skipped.find((s) => /number|range|sequence/i.test(s.reason));
  if (problem) throw new AppError('DEPENDENCY_MISSING', `${problem.reason} (run: npm run work-numbers -- setup)`);
  return { templates: 1, meters: 1, plans: 2, workOrders: g.generated.length };
}
