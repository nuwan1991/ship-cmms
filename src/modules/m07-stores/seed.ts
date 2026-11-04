/**
 * Store numbering setup (hub) and DEMO data. Demo data goes through the normal services, so ownership, audit, number ranges and
 * events are exercised. Never run the demo seed on production data.
 */
import type { Authorizer } from '../../platform/authz.js';
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';
import { findLocationByCode, findPartyByCode } from '../m01-organization/index.js';
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

export interface SiteStoreInput {
  /** Ship (or workshop) code, e.g. SAGARA, or its exact name, e.g. "SLNS Sagara". */
  site: string;
  code: string;
  name: string;
  kind?: 'store' | 'locker' | 'workshop' | 'other';
  /** Code of the compartment in Organization > Locations that the store sits in. */
  compartment?: string;
}
export interface SiteStoreResult { created: boolean; store: Record<string, unknown>; site: { kind: string; code: string; name: string } }

/** Find a ship or workshop by code first, then by exact name (case-insensitive). */
function findSite(a: Actor, ref: string) {
  const db = a.wctx.db;
  const byCode = findPartyByCode(db, 'ship', ref) ?? findPartyByCode(db, 'workshop', ref);
  if (byCode) return byCode;
  for (const kind of ['ship', 'workshop'] as const) {
    const r = db.prepare(`SELECT code FROM org_${kind} WHERE lower(name) = lower(?) AND deleted_at IS NULL`).all(ref.trim()) as { code: string }[];
    if (r.length > 1) throw new AppError('VALIDATION_FAILED', `More than one ${kind} is named "${ref}"; give its code instead`);
    if (r[0]) return findPartyByCode(db, kind, r[0].code);
  }
  return null;
}

/**
 * Create a stock location for a ship or workshop through the normal service (ownership and audit apply).
 * Safe to repeat: a live store with the same code at that site is returned unchanged.
 */
export function createSiteStore(actor: Actor, input: SiteStoreInput): SiteStoreResult {
  const a: Actor = { ...actor, authz: allowAll };
  const db = a.wctx.db;
  const site = findSite(a, input.site);
  if (!site) throw new AppError('DEPENDENCY_MISSING', `No ship or workshop "${input.site}" on this installation. Add it under Organization > Ships at the hub first (and synchronize if this is a ship installation).`);
  const code = input.code.trim().toUpperCase();
  const existing = db.prepare('SELECT * FROM stk_location WHERE home_scope_id = ? AND code = ? AND deleted_at IS NULL').get(site.id, code) as Record<string, unknown> | undefined;
  const siteOut = { kind: site.kind, code: site.code, name: site.name };
  if (existing) return { created: false, store: existing, site: siteOut };
  let orgLocationId: string | null = null;
  if (input.compartment) {
    const c = findLocationByCode(db, site.id, input.compartment.trim());
    if (!c) throw new AppError('DEPENDENCY_MISSING', `No location "${input.compartment}" for ${site.name} under Organization > Locations`);
    orgLocationId = c.id;
  }
  const store = createLocation(a, { code, name: input.name, kind: input.kind ?? 'store', siteId: site.id, orgLocationId });
  return { created: true, store, site: siteOut };
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
