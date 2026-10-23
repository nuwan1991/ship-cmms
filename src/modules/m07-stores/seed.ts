/**
 * Store numbering setup (hub) and DEMO data. Demo data goes through the normal services, so ownership, audit, number ranges and
 * events are exercised. Never run the demo seed on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';
import { findPartyByCode } from '../m01-organization/index.js';
import { findAssetByName } from '../m03-assets/index.js';
import type { Actor } from './actor.js';
import { addCompatibility, createLocation, createPart, dispatchTransfer, receiveStock, setStockLevel, TRANSFER_SEQUENCE } from './service.js';

export const DEFAULT_TRANSFER_PREFIX = 'SLN-TR';
export const DEFAULT_TRANSFER_WIDTH = 8;
const allowAll: Authorizer = { name: 'seed-allow', check: () => ({ allowed: true }) };

/** Hub only: define the transfer-number sequence once (prefix and width are data). Safe to repeat. */
export function ensureStoreSequence(w: WriteContext, opts: { prefix?: string; width?: number } = {}): void {
  const have = w.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(TRANSFER_SEQUENCE);
  if (!have) defineSequence(w, { code: TRANSFER_SEQUENCE, prefix: opts.prefix ?? DEFAULT_TRANSFER_PREFIX, width: opts.width ?? DEFAULT_TRANSFER_WIDTH, description: 'Stock transfer number' });
}
/** Hub only: grant the next free block of transfer numbers to an installation (until M10 automates range requests). */
export function grantStoreRange(w: WriteContext, installationId: string, size: number) {
  ensureStoreSequence(w);
  return grantRange(w, { sequenceCode: TRANSFER_SEQUENCE, installationId, size });
}

export interface DemoStoresResult { parts: number; locations: number; transactions: number; transfers: number }

/** Needs the demo organization and demo assets. Leaves a central store, a ship store, three parts (one below its minimum) and a transfer in transit. */
export function seedDemoStores(actor: Actor): DemoStoresResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new Error('Demo data is seeded at the hub only');
  const ship = findPartyByCode(db, 'ship', 'DEMO-101');
  const alt = findAssetByName(db, 'Main alternator');
  if (!ship || !alt) throw new AppError('DEPENDENCY_MISSING', 'Load the demo organization and demo assets first: npm run seed:demo-org && npm run seed:demo-assets');
  ensureStoreSequence(a.wctx);
  if (!db.prepare('SELECT 1 FROM sys_number_range WHERE sequence_code = ? AND allocated_to_installation_id = ? AND deleted_at IS NULL').get(TRANSFER_SEQUENCE, a.wctx.installation.installationId)) {
    grantStoreRange(a.wctx, a.wctx.installation.installationId, 1000);
  }
  const id = (r: Record<string, unknown>) => r.id as string;
  const bearing = createPart(a, { partNo: 'BRG-6312', name: 'Ball bearing 6312', unit: 'each', category: 'Bearings', manufacturer: 'SKF', manufacturerPartNo: '6312-2Z' });
  const grease = createPart(a, { partNo: 'GRS-EP2', name: 'EP2 bearing grease', unit: 'kg', category: 'Consumables' });
  const filter = createPart(a, { partNo: 'FLT-LO-01', name: 'Lube oil filter element', unit: 'each', category: 'Filters' });
  if (alt.classificationId) addCompatibility(a, { partId: id(bearing), classificationId: alt.classificationId });
  addCompatibility(a, { partId: id(filter), assetId: alt.id });
  const central = createLocation(a, { code: 'CENTRAL', name: 'Central store', kind: 'store' });
  const shipStore = createLocation(a, { code: 'MAIN-STORE', name: 'Ship main store', kind: 'store', siteId: ship.id });
  receiveStock(a, { partId: id(bearing), locationId: id(central), quantity: 12, unitCost: 18500, currency: 'LKR', reference: 'PO-DEMO-1' });
  receiveStock(a, { partId: id(grease), locationId: id(central), quantity: 40, unitCost: 2400, currency: 'LKR' });
  receiveStock(a, { partId: id(bearing), locationId: id(shipStore), quantity: 2, unitCost: 18500, currency: 'LKR' });
  receiveStock(a, { partId: id(filter), locationId: id(shipStore), quantity: 1, unitCost: 6200, currency: 'LKR' });
  setStockLevel(a, { partId: id(bearing), locationId: id(shipStore), minLevel: 4, reorderQty: 4 });
  setStockLevel(a, { partId: id(filter), locationId: id(shipStore), minLevel: 2, reorderQty: 2 });
  dispatchTransfer(a, { fromLocationId: id(central), toLocationId: id(shipStore), lines: [{ partId: id(bearing), quantity: 4 }, { partId: id(grease), quantity: 5 }], note: 'Replenish ship store' });
  return { parts: 3, locations: 2, transactions: 6, transfers: 1 };
}
