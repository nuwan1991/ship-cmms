import { describe, expect, it } from 'vitest';
import { applyRemap, loadStandardCatalogue } from '../../src/modules/m03-assets/classification-merge.js';
import { getAsset } from '../../src/modules/m03-assets/index.js';
import { createAsset, createEntity as createAstEntity } from '../../src/modules/m03-assets/service.js';
import { changeProgress, closeWorkOrder } from '../../src/modules/m05-work/service.js';
import { getBalance, onHandAtSite, partsForAsset, partsIssuedTo, STK_PERMISSIONS } from '../../src/modules/m07-stores/index.js';
import {
  addCompatibility, adjustStock, cancelTransfer, createLocation, createPart, dispatchTransfer, issueStock, receiveStock, receiveTransfer, releaseReservation,
  reserveStock, returnStock, setStockLevel, tombstoneLocation, tombstonePart, updatePart,
} from '../../src/modules/m07-stores/service.js';
import { PERMISSION_RE } from '../../src/platform/authz.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, sql } from './ast-helpers.js';
import { denyOnly } from './org-helpers.js';
import { makeStkEnv } from './stk-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;

describe('registration', () => {
  it('registers cleanly with well-formed, unique permission codes', () => {
    const env = makeStkEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    expect(env.ctx.entities.get('stk.transaction').recordClass).toBe('event');
    expect(env.ctx.entities.get('stk.part').recordClass).toBe('hub_reference');
    expect(env.ctx.entities.get('stk.location').recordClass).toBe('owner_mutable');
    for (const p of STK_PERMISSIONS) expect(p).toMatch(PERMISSION_RE);
    expect(new Set(STK_PERMISSIONS).size).toBe(STK_PERMISSIONS.length);
  });
});

describe('catalogue and locations', () => {
  it('rejects duplicate part numbers, normalises case, and blocks removal once stock has moved', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = createPart(a, { partNo: 'brg-6312', name: 'Bearing' });
    expect(p.partNo).toBe('BRG-6312');
    expect(codeOf(() => createPart(a, { partNo: 'BRG-6312', name: 'Again' }))).toBe('DUPLICATE');
    const l = env.loc('MAIN');
    receiveStock(a, { partId: id(p), locationId: l, quantity: 1 });
    expect(codeOf(() => tombstonePart(a, id(p), { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => tombstoneLocation(a, l, { expectedVersion: 1, reason: 'x' }))).toBe('WORKFLOW_BLOCKED');
    expect(updatePart(a, id(p), { expectedVersion: 1, status: 'inactive' }).status).toBe('inactive');
    expect(codeOf(() => receiveStock(a, { partId: id(p), locationId: l, quantity: 1 }))).toBe('WORKFLOW_BLOCKED');
    const unused = createPart(a, { partNo: 'X1', name: 'Unused' });
    expect(tombstonePart(a, id(unused), { expectedVersion: 1, reason: 'typo' }).deletedAt).toBeTruthy();
  });

  it('keeps location codes unique per site but allows the same code on different ships', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    createLocation(a, { code: 'MAIN', name: 'Main', siteId: env.shipId });
    createLocation(a, { code: 'MAIN', name: 'Main', siteId: env.ship2Id });
    expect(codeOf(() => createLocation(a, { code: 'MAIN', name: 'Dup', siteId: env.shipId }))).toBe('DUPLICATE');
    expect(codeOf(() => createLocation(a, { code: 'Z', name: 'Z', siteId: '019aaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa' }))).toBe('DEPENDENCY_MISSING');
  });

  it('lists parts compatible with an asset by classification or directly', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const cls = createAstEntity(a, 'classification', { code: 'PUMP', name: 'Pump', kind: 'equipment' });
    const asset = createAsset(a, { name: 'Pump A', homeShipId: env.shipId, classificationId: id(cls) }).asset;
    const other = createAsset(a, { name: 'Pump B', homeShipId: env.shipId }).asset;
    const seal = env.part('SEAL'), filter = env.part('FILT'), none = env.part('NONE');
    addCompatibility(a, { partId: seal, classificationId: id(cls) });
    addCompatibility(a, { partId: filter, assetId: id(asset) });
    expect(partsForAsset(env.ctx.db, id(asset)).map((p) => p.partNo)).toEqual(['FILT', 'SEAL']);
    expect(partsForAsset(env.ctx.db, id(other))).toEqual([]);
    expect(codeOf(() => addCompatibility(a, { partId: seal, classificationId: id(cls) }))).toBe('DUPLICATE');
    expect(codeOf(() => addCompatibility(a, { partId: none }))).toBe('VALIDATION_FAILED');
  });

  it('keeps parts linked to a legacy classification fitting an asset re-pointed to its standard class (D64)', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    loadStandardCatalogue(a);
    const std = (code: string) => sql(env, 'SELECT id FROM ast_classification WHERE code = ?', code)[0]!.id as string;
    const alt = id(createAstEntity(a, 'classification', { code: 'ALTERNATOR', name: 'Alternator', kind: 'equipment' }));
    const swbd = id(createAstEntity(a, 'classification', { code: 'SWITCHBOARD', name: 'Switchboard', kind: 'equipment' }));
    createAstEntity(a, 'classification_map', { legacySystem: 'CMMS', legacyCode: 'ALTERNATOR', targetClassificationId: std('SWBS-311-ALT'), relation: 'exact' });
    createAstEntity(a, 'classification_map', { legacySystem: 'CMMS', legacyCode: 'SWITCHBOARD', targetClassificationId: std('SWBS-324-MSB'), relation: 'narrower' });
    const asset = id(createAsset(a, { name: 'No. 1 alternator', homeShipId: env.shipId, classificationId: alt }).asset);
    const msb = id(createAsset(a, { name: 'Main switchboard', homeShipId: env.shipId, classificationId: std('SWBS-324-MSB') }).asset);
    addCompatibility(a, { partId: env.part('AVR'), classificationId: alt });
    addCompatibility(a, { partId: env.part('BRUSH'), classificationId: std('SWBS-311-ALT') });
    addCompatibility(a, { partId: env.part('BUSBAR'), classificationId: swbd });
    expect(partsForAsset(env.ctx.db, asset).map((p) => p.partNo)).toEqual(['AVR']);

    expect(applyRemap(a).updated.map((u) => u.id)).toContain(asset);
    expect(getAsset(env.ctx.db, asset)!.classificationId).toBe(std('SWBS-311-ALT'));
    expect(partsForAsset(env.ctx.db, asset).map((p) => p.partNo)).toEqual(['AVR', 'BRUSH']);
    // A split legacy class has no single standard equivalent, so its parts are not offered for either candidate.
    expect(partsForAsset(env.ctx.db, msb)).toEqual([]);
  });
});

describe('stock movements', () => {
  it('derives the balance from receipts, issues, returns and adjustments', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part('B1'), l = env.loc('MAIN', env.shipId);
    const wo = env.workOrder();
    receiveStock(a, { partId: p, locationId: l, quantity: 10, unitCost: 100, currency: 'LKR' });
    const i = issueStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: wo });
    expect(i).toMatchObject({ kind: 'issue', qtyDelta: -3, unitCost: 100, refType: 'wrk.work_order', refId: wo });
    returnStock(a, { partId: p, locationId: l, quantity: 1, workOrderId: wo });
    adjustStock(a, { partId: p, locationId: l, delta: -2, reason: 'Stock take: two damaged' });
    expect(getBalance(env.ctx.db, p, l)).toEqual({ onHand: 6, reserved: 0, available: 6 });
    expect(partsIssuedTo(env.ctx.db, wo)).toMatchObject([{ partNo: 'B1', netQuantity: 2, netCost: 200 }]);
    expect(onHandAtSite(env.ctx.db, p, env.shipId).onHand).toBe(6);
  });

  it('refuses to overdraw, to return more than was issued, and to adjust below zero', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), l = env.loc();
    const wo = env.workOrder();
    receiveStock(a, { partId: p, locationId: l, quantity: 2 });
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 3, reference: 'drill' }))).toBe('WORKFLOW_BLOCKED');
    issueStock(a, { partId: p, locationId: l, quantity: 1, workOrderId: wo });
    expect(codeOf(() => returnStock(a, { partId: p, locationId: l, quantity: 2, workOrderId: wo }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => adjustStock(a, { partId: p, locationId: l, delta: -5, reason: 'oops' }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 1 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => receiveStock(a, { partId: p, locationId: l, quantity: 0 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => receiveStock(a, { partId: p, locationId: l, quantity: 1.0005 }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => adjustStock(a, { partId: p, locationId: l, delta: 1, reason: '' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => receiveStock(a, { partId: p, locationId: l, quantity: 1, occurredAt: new Date(Date.now() + 3_600_000).toISOString() }))).toBe('VALIDATION_FAILED');
    expect(getBalance(env.ctx.db, p, l).onHand).toBe(1);
  });

  it('supports fractional quantities', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part('GRS', { unit: 'kg' }), l = env.loc();
    receiveStock(a, { partId: p, locationId: l, quantity: 2.5 });
    issueStock(a, { partId: p, locationId: l, quantity: 0.75, reference: 'greasing round' });
    expect(getBalance(env.ctx.db, p, l).onHand).toBe(1.75);
  });

  it('will not issue against a closed or other-ship work order', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), l = env.loc('MAIN', env.shipId);
    receiveStock(a, { partId: p, locationId: l, quantity: 5 });
    const other = env.workOrder('Other ship job', env.ship2Id);
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 1, workOrderId: other }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 1, workOrderId: '019aaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa' }))).toBe('DEPENDENCY_MISSING');
    const w = env.workOrder();
    changeProgress(env.asHub(), w, { to: 'in_progress' });
    changeProgress(env.asHub(), w, { to: 'work_complete' });
    // preventive/inspection orders need no return-to-service decision; corrective ones do, so close via the order type used by env.workOrder (corrective)
    env.ctx.db.prepare("INSERT INTO wrk_status_event (id, owner_installation_id, home_scope_id, occurred_at, recorded_at, recorded_by, subject_type, subject_id, axis, value) VALUES ('019aaaaa-0000-7000-8000-000000000001', ?, NULL, ?, ?, 'x', 'work_order', ?, 'closure', 'closed')")
      .run(env.hub.installationId, new Date().toISOString(), new Date().toISOString(), w);
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 1, workOrderId: w }))).toBe('WORKFLOW_BLOCKED');
    void closeWorkOrder;
  });
});

describe('reservations', () => {
  it('holds stock for a work order, protects it from other issues, and is consumed by the order\'s own issue', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), l = env.loc();
    const w1 = env.workOrder('A'), w2 = env.workOrder('B');
    receiveStock(a, { partId: p, locationId: l, quantity: 5 });
    reserveStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: w1 });
    expect(getBalance(env.ctx.db, p, l)).toEqual({ onHand: 5, reserved: 3, available: 2 });
    expect(codeOf(() => issueStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: w2 }))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => reserveStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: w2 }))).toBe('WORKFLOW_BLOCKED');
    issueStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: w1 });
    expect(getBalance(env.ctx.db, p, l)).toEqual({ onHand: 2, reserved: 0, available: 2 });
    expect(codeOf(() => releaseReservation(a, { partId: p, locationId: l, workOrderId: w1 }))).toBe('WORKFLOW_BLOCKED');
  });

  it('releases part or all of a reservation, and refuses to release more than is held', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), l = env.loc();
    const w = env.workOrder();
    receiveStock(a, { partId: p, locationId: l, quantity: 4 });
    reserveStock(a, { partId: p, locationId: l, quantity: 4, workOrderId: w });
    expect(codeOf(() => releaseReservation(a, { partId: p, locationId: l, workOrderId: w, quantity: 5 }))).toBe('WORKFLOW_BLOCKED');
    releaseReservation(a, { partId: p, locationId: l, workOrderId: w, quantity: 1 });
    releaseReservation(a, { partId: p, locationId: l, workOrderId: w });
    expect(getBalance(env.ctx.db, p, l).reserved).toBe(0);
  });
});

describe('transfers', () => {
  it('dispatches, shows in transit, is received once, and updates both balances', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), q = env.part();
    const central = env.loc('CENTRAL'), ship = env.loc('SHIP', env.shipId);
    receiveStock(a, { partId: p, locationId: central, quantity: 10 });
    receiveStock(a, { partId: q, locationId: central, quantity: 4 });
    const t = dispatchTransfer(a, { fromLocationId: central, toLocationId: ship, lines: [{ partId: p, quantity: 6 }, { partId: q, quantity: 4 }] });
    expect(t.transferNo).toBe('SLN-TR-00000001');
    expect(getBalance(env.ctx.db, p, central).onHand).toBe(4);
    expect(getBalance(env.ctx.db, p, ship).onHand).toBe(0);
    expect(sql(env, 'SELECT state FROM stk_v_transfer_state WHERE transfer_id = ?', id(t))[0]?.state).toBe('in_transit');
    // the ship installation records the arrival of a document owned by the hub
    const r = receiveTransfer(env.shipActor(env.shipId), id(t), {});
    expect(r.state).toBe('received');
    expect(getBalance(env.ctx.db, p, ship).onHand).toBe(6);
    expect(codeOf(() => receiveTransfer(a, id(t), {}))).toBe('WORKFLOW_BLOCKED');
    expect(codeOf(() => cancelTransfer(a, id(t), { expectedVersion: 1, reason: 'late' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('rejects a transfer with any short line, atomically', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), q = env.part();
    const from = env.loc('A'), to = env.loc('B');
    receiveStock(a, { partId: p, locationId: from, quantity: 5 });
    receiveStock(a, { partId: q, locationId: from, quantity: 1 });
    expect(codeOf(() => dispatchTransfer(a, { fromLocationId: from, toLocationId: to, lines: [{ partId: p, quantity: 5 }, { partId: q, quantity: 2 }] }))).toBe('WORKFLOW_BLOCKED');
    expect(getBalance(env.ctx.db, p, from).onHand).toBe(5);
    expect(sql(env, 'SELECT COUNT(*) AS n FROM stk_transfer')[0]?.n).toBe(0);
    expect(codeOf(() => dispatchTransfer(a, { fromLocationId: from, toLocationId: from, lines: [{ partId: p, quantity: 1 }] }))).toBe('VALIDATION_FAILED');
  });

  it('cancels a transfer in transit and puts stock back; only the dispatching installation may cancel', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part();
    const from = env.loc('A'), to = env.loc('B', env.shipId);
    receiveStock(a, { partId: p, locationId: from, quantity: 5 });
    const t = dispatchTransfer(a, { fromLocationId: from, toLocationId: to, lines: [{ partId: p, quantity: 5 }] });
    expect(codeOf(() => cancelTransfer(env.shipActor(env.shipId), id(t), { expectedVersion: 1, reason: 'no' }))).toBe('NOT_OWNER');
    const c = cancelTransfer(a, id(t), { expectedVersion: 1, reason: 'Wrong ship' });
    expect(c.state).toBe('cancelled');
    expect(getBalance(env.ctx.db, p, from).onHand).toBe(5);
    expect(codeOf(() => receiveTransfer(env.shipActor(env.shipId), id(t), {}))).toBe('WORKFLOW_BLOCKED');
  });

  it('uses the installation\'s own number range and reports RANGE_EXHAUSTED when none is left', () => {
    const env = makeStkEnv({ hubTransfers: 1 });
    const a = env.hubActor();
    const p = env.part();
    const from = env.loc('A'), to = env.loc('B');
    receiveStock(a, { partId: p, locationId: from, quantity: 5 });
    dispatchTransfer(a, { fromLocationId: from, toLocationId: to, lines: [{ partId: p, quantity: 1 }] });
    expect(codeOf(() => dispatchTransfer(a, { fromLocationId: from, toLocationId: to, lines: [{ partId: p, quantity: 1 }] }))).toBe('RANGE_EXHAUSTED');
    expect(getBalance(env.ctx.db, p, from).onHand).toBe(4);
  });
});

describe('minimum levels and view', () => {
  it('flags stock below its minimum, counting reservations', () => {
    const env = makeStkEnv();
    const a = env.hubActor();
    const p = env.part(), l = env.loc('MAIN', env.shipId);
    const w = env.workOrder();
    setStockLevel(a, { partId: p, locationId: l, minLevel: 3, reorderQty: 5 });
    expect(codeOf(() => setStockLevel(a, { partId: p, locationId: l, minLevel: 1 }))).toBe('DUPLICATE');
    expect(sql(env, 'SELECT below_minimum FROM stk_v_stock WHERE part_id = ?', p)[0]?.below_minimum).toBe(1);
    receiveStock(a, { partId: p, locationId: l, quantity: 5 });
    expect(sql(env, 'SELECT below_minimum FROM stk_v_stock WHERE part_id = ?', p)[0]?.below_minimum).toBe(0);
    reserveStock(a, { partId: p, locationId: l, quantity: 3, workOrderId: w });
    expect(sql(env, 'SELECT below_minimum, available FROM stk_v_stock WHERE part_id = ?', p)[0]).toMatchObject({ below_minimum: 1, available: 2 });
  });
});

describe('authorization and ownership', () => {
  it('denies without permission, and a ship installation cannot post stock for another ship', () => {
    const env = makeStkEnv();
    const p = env.part(), l = env.loc('MAIN', env.shipId), l2 = env.loc('MAIN', env.ship2Id);
    expect(codeOf(() => receiveStock(env.hubActor(denyOnly('stk.transaction.receive')), { partId: p, locationId: l, quantity: 1 }))).toBe('FORBIDDEN');
    expect(codeOf(() => issueStock(env.hubActor(denyOnly('stk.transaction.issue')), { partId: p, locationId: l, quantity: 1, reference: 'x' }))).toBe('FORBIDDEN');
    expect(codeOf(() => createPart(env.hubActor(denyOnly('stk.part.create')), { partNo: 'Q', name: 'Q' }))).toBe('FORBIDDEN');
    const ship = env.shipActor(env.shipId);
    expect(receiveStock(ship, { partId: p, locationId: l, quantity: 2 }).qtyDelta).toBe(2);
    expect(codeOf(() => receiveStock(ship, { partId: p, locationId: l2, quantity: 2 }))).toBe('NOT_OWNER');
    // the catalogue is hub reference data: a ship cannot write it
    expect(codeOf(() => createPart(ship, { partNo: 'SHIPPART', name: 'Nope' }))).toBe('NOT_OWNER');
  });

  it('keeps an append-only history: transactions cannot be updated or deleted', () => {
    const env = makeStkEnv();
    const p = env.part(), l = env.loc();
    const t = receiveStock(env.hubActor(), { partId: p, locationId: l, quantity: 2 });
    expect(() => env.ctx.db.prepare('UPDATE stk_transaction SET quantity = 9 WHERE id = ?').run(t.id)).toThrow();
    expect(() => env.ctx.db.prepare('DELETE FROM stk_transaction WHERE id = ?').run(t.id)).toThrow();
  });
});
