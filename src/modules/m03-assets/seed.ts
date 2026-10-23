/**
 * Equipment-tag numbering setup (hub) and DEMO data. Demo data goes through the normal services, so ownership, audit, number
 * ranges and movement events are exercised. Never run the demo seed on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';
import { EventBus } from '../../platform/events.js';
import { findPartyByCode } from '../m01-organization/index.js';
import type { Actor } from './actor.js';
import { moveAsset } from './movements.js';
import { createAsset, createEntity, EQUIPMENT_TAG_SEQUENCE } from './service.js';

export const DEFAULT_TAG_PREFIX = 'SLN-EQ';
export const DEFAULT_TAG_WIDTH = 8;

const allowAll: Authorizer = { name: 'seed-allow', check: () => ({ allowed: true }) };

/** Hub only: define the equipment-tag sequence once (prefix and width are data). Safe to repeat. */
export function ensureTagSequence(w: WriteContext, opts: { prefix?: string; width?: number } = {}): void {
  const have = w.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(EQUIPMENT_TAG_SEQUENCE);
  if (!have) defineSequence(w, { code: EQUIPMENT_TAG_SEQUENCE, prefix: opts.prefix ?? DEFAULT_TAG_PREFIX, width: opts.width ?? DEFAULT_TAG_WIDTH, description: 'Permanent equipment tag' });
}

/** Hub only: grant the next free block of tag numbers to an installation (until M10 automates range requests). */
export function grantTagRange(w: WriteContext, installationId: string, size: number) {
  ensureTagSequence(w);
  return grantRange(w, { sequenceCode: EQUIPMENT_TAG_SEQUENCE, installationId, size });
}

export interface DemoAssetsResult { classifications: number; positions: number; assets: number }

export function seedDemoAssets(actor: Actor): DemoAssetsResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const ship = findPartyByCode(db, 'ship', 'DEMO-101');
  const me = findPartyByCode(db, 'department', 'ME');
  const ee = findPartyByCode(db, 'department', 'EE');
  const elecShop = findPartyByCode(db, 'workshop', 'DEMO-WS-ELEC');
  if (!ship || !me || !ee || !elecShop) throw new AppError('DEPENDENCY_MISSING', 'Load the demo organization first: npm run seed:demo-org');

  ensureTagSequence(a.wctx);
  if (!db.prepare('SELECT 1 FROM sys_number_range WHERE sequence_code = ? AND allocated_to_installation_id = ? AND deleted_at IS NULL').get(EQUIPMENT_TAG_SEQUENCE, a.wctx.installation.installationId)) {
    grantTagRange(a.wctx, a.wctx.installation.installationId, 1000);
  }

  const id = (r: Record<string, unknown>) => r.id as string;
  const cls = (code: string, name: string, kind: 'equipment' | 'component') => id(createEntity(a, 'classification', { code, name, kind }));
  const genSet = cls('DIESEL-GEN-ENGINE', 'Diesel generator engine', 'equipment');
  const alt = cls('ALTERNATOR', 'Alternator', 'equipment');
  const bearing = cls('BEARING', 'Bearing', 'component');

  const pos = (positionTag: string, name: string, parentId?: string, classificationId?: string) =>
    id(createEntity(a, 'position', { shipId: ship.id, positionTag, name, ...(parentId ? { parentId } : {}), ...(classificationId ? { classificationId } : {}) }));
  const sys = pos('2', 'Electrical power generation');
  const group = pos('2.1', 'Main generating set No. 1', sys);
  const enginePos = pos('2.1.1', 'Generator engine', group, genSet);
  const altPos = pos('2.1.2', 'Alternator and control', group, alt);
  pos('2.1.2.1', 'Alternator drive-end bearing', altPos, bearing);

  // Marine Engineering maintains the engine; Electrical Engineering maintains the alternator and its control: separate responsibilities.
  const from = '2025-01-01T00:00:00.000Z';
  createEntity(a, 'position_responsibility', { positionId: enginePos, departmentId: me.id, effectiveFrom: from, reason: 'Initial assignment' });
  createEntity(a, 'position_responsibility', { positionId: altPos, departmentId: ee.id, effectiveFrom: from, reason: 'Initial assignment' });

  createAsset(a, { name: 'Diesel generator engine', manufacturer: 'Demo Marine Diesel', model: 'DG-450', serialNumber: 'DG450-0001', classificationId: genSet, homeShipId: ship.id, positionId: enginePos });
  createAsset(a, { name: 'Main alternator', manufacturer: 'Demo Electric', model: 'AL-300', serialNumber: 'AL300-0001', classificationId: alt, homeShipId: ship.id, positionId: altPos });
  const spare = createAsset(a, { name: 'Spare alternator', manufacturer: 'Demo Electric', model: 'AL-300', serialNumber: 'AL300-0002', classificationId: alt, homeShipId: ship.id, assetStatus: 'in_store' });
  // The spare goes to a specialist workshop for rewinding: custody changes, identity and tag do not.
  moveAsset(a, new EventBus(), id(spare.asset), { kind: 'custody_transfer', custody: { kind: 'workshop', id: elecShop.id }, note: 'Sent for rewinding' });
  moveAsset(a, new EventBus(), id(spare.asset), { kind: 'status_change', assetStatus: 'under_repair' });

  return { classifications: 3, positions: 5, assets: 3 };
}
