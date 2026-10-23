import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { rangeRemaining } from '../../platform/ranges.js';
import { findAssetByName, getAsset } from '../m03-assets/index.js';
import { actorFromRequest, authorize } from './actor.js';
import { perm, type StkNoun } from './permissions.js';
import { getBalance, getLive, partsForAsset, partsIssuedTo, TABLES, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import {
  addCompatibility, adjustStock, cancelTransfer, createLocation, createPart, dispatchTransfer, issueStock, receiveStock, receiveTransfer, releaseReservation,
  removeCompatibility, reserveStock, returnStock, setStockLevel, tombstoneLocation, tombstonePart, tombstoneStockLevel, TRANSFER_SEQUENCE, updateLocation,
  updatePart, updateStockLevel,
} from './service.js';

export const STK_API_PREFIX = '/api/v1/stores';

/** Placeholder until M10 supplies real sync state: hub data is authoritative; anything else has never synchronized. */
const freshnessFor = (ctx: AppContext, scope: ScopeRef): Freshness => ({ scope, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 });
const like = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const optStr = z.string().min(1).max(64).optional();

interface ListSpec { table: string; filters: Record<string, string>; search: string[]; idCol: string; live: boolean; order?: string }
function list(ctx: AppContext, spec: ListSpec, raw: unknown, scope: ScopeRef, extraWhere: string[] = []) {
  const q = parse(
    z.strictObject({
      limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().min(1).max(160).optional(), q: z.string().trim().min(1).max(60).optional(),
      ...Object.fromEntries(Object.keys(spec.filters).map((k) => [k, optStr])),
    }),
    raw,
  ) as Record<string, string | number | undefined> & { limit: number };
  const where: string[] = [...(spec.live ? ['deleted_at IS NULL'] : []), ...extraWhere];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(spec.filters)) if (q[param] !== undefined) { where.push(`${col} = ?`); params.push(q[param]); }
  if (q.q) { where.push(`(${spec.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`); for (const _ of spec.search) params.push(like(String(q.q))); }
  if (q.cursor) { where.push(`${spec.idCol} > ?`); params.push(q.cursor); }
  const rows = ctx.db.prepare(`SELECT * FROM ${spec.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${spec.order ?? spec.idCol} LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  return { rows: page, nextCursor: rows.length > q.limit ? (page[page.length - 1]?.[spec.idCol] as string) : null, freshness: [freshnessFor(ctx, scope)] };
}

export function mountStoreRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = STK_API_PREFIX;
  const fleet: ScopeRef = { kind: 'fleet' };
  const scopeOfRow = (r: Row): ScopeRef => (r.home_scope_id ? { kind: 'ship', id: r.home_scope_id as string } : fleet);
  const get = (noun: StkNoun, id: string, label: string): Row => {
    const row = getLive(ctx.db, noun, id);
    if (!row) throw new AppError('NOT_FOUND', `${label} ${id} not found`);
    return row;
  };
  const page = (r: ReturnType<typeof list>, map: (x: Row) => Row = toApi) => ({ items: r.rows.map(map), nextCursor: r.nextCursor, freshness: r.freshness });

  // ---- parts
  app.get(`${base}/parts`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('part', 'view'), fleet);
    return page(list(ctx, { table: 'stk_part', filters: { status: 'status', category: 'category' }, search: ['part_no', 'name', 'manufacturer_part_no'], idCol: 'id', live: true, order: 'part_no, id' }, req.query, fleet));
  });
  app.get(`${base}/parts/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('part', 'view'), fleet);
    const part = get('part', idParam(req), 'part');
    const compat = ctx.db.prepare('SELECT * FROM stk_part_compatibility WHERE part_id = ? AND deleted_at IS NULL ORDER BY id').all(part.id) as Row[];
    return { ...toApi(part), compatibility: compat.map(toApi), balance: getBalance(ctx.db, part.id as string) };
  });
  app.post(`${base}/parts`, async (req, reply) => reply.status(201).send(createPart(actorFromRequest(ctx, req), req.body)));
  app.patch(`${base}/parts/:id`, async (req) => updatePart(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/parts/:id/tombstone`, async (req) => tombstonePart(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- compatibility
  app.get(`${base}/compatibility`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('compatibility', 'view'), fleet);
    return page(list(ctx, { table: 'stk_part_compatibility', filters: { partId: 'part_id', classificationId: 'classification_id', assetId: 'asset_id' }, search: ['note'], idCol: 'id', live: true }, req.query, fleet));
  });
  app.post(`${base}/compatibility`, async (req, reply) => reply.status(201).send(addCompatibility(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/compatibility/:id/tombstone`, async (req) => removeCompatibility(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${base}/assets/:id/parts`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('part', 'view'), fleet);
    const id = idParam(req);
    if (!getAsset(ctx.db, id)) throw new AppError('NOT_FOUND', `Asset ${id} not found`);
    return { items: partsForAsset(ctx.db, id).map((p) => ({ ...p, balance: getBalance(ctx.db, p.id) })), nextCursor: null, freshness: [freshnessFor(ctx, fleet)] };
  });

  // ---- locations
  app.get(`${base}/locations`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('location', 'view'), fleet);
    return page(list(ctx, { table: 'stk_location', filters: { siteId: 'home_scope_id', status: 'status', kind: 'kind' }, search: ['code', 'name'], idCol: 'id', live: true, order: 'code, id' }, req.query, fleet));
  });
  app.get(`${base}/locations/:id`, async (req) => {
    const row = get('location', idParam(req), 'stock location');
    authorize(actorFromRequest(ctx, req), perm('location', 'view'), scopeOfRow(row));
    return toApi(row);
  });
  app.post(`${base}/locations`, async (req, reply) => reply.status(201).send(createLocation(actorFromRequest(ctx, req), req.body)));
  app.patch(`${base}/locations/:id`, async (req) => updateLocation(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/locations/:id/tombstone`, async (req) => tombstoneLocation(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- stock levels
  app.get(`${base}/stock-levels`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('stock_level', 'view'), fleet);
    return page(list(ctx, { table: 'stk_stock_level', filters: { partId: 'part_id', locationId: 'location_id' }, search: ['part_id'], idCol: 'id', live: true }, req.query, fleet));
  });
  app.post(`${base}/stock-levels`, async (req, reply) => reply.status(201).send(setStockLevel(actorFromRequest(ctx, req), req.body)));
  app.patch(`${base}/stock-levels/:id`, async (req) => updateStockLevel(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/stock-levels/:id/tombstone`, async (req) => tombstoneStockLevel(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- balances (view)
  app.get(`${base}/stock`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transaction', 'view'), fleet);
    const below = (req.query as Record<string, unknown>).belowMinimum === 'true';
    const { belowMinimum: _drop, ...rest } = req.query as Record<string, unknown>;
    return page(list(ctx, { table: 'stk_v_stock', filters: { partId: 'part_id', locationId: 'location_id', siteId: 'site_id' }, search: ['part_no', 'part_name', 'location_code'], idCol: 'part_no', live: false, order: 'part_no, location_code' }, rest, fleet, below ? ['below_minimum = 1'] : []));
  });

  // ---- transactions
  app.get(`${base}/transactions`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transaction', 'view'), fleet);
    return page(list(ctx, { table: 'stk_transaction', filters: { partId: 'part_id', locationId: 'location_id', kind: 'kind', refId: 'ref_id', transferId: 'transfer_id' }, search: ['reference', 'note'], idCol: 'id', live: false, order: 'id DESC' }, req.query, fleet));
  });
  const created = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, body: unknown) => reply.status(201).send(body);
  app.post(`${base}/receipts`, async (req, reply) => created(reply, receiveStock(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/issues`, async (req, reply) => created(reply, issueStock(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/returns`, async (req, reply) => created(reply, returnStock(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/adjustments`, async (req, reply) => created(reply, adjustStock(actorFromRequest(ctx, req), req.body)));

  // ---- reservations
  app.get(`${base}/reservations`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('reservation', 'view'), fleet);
    return page(list(ctx, { table: 'stk_v_reserved_by_ref', filters: { refId: 'ref_id', partId: 'part_id', locationId: 'location_id' }, search: ['ref_id'], idCol: 'ref_id', live: false, order: 'ref_id, part_id' }, req.query, fleet, ['outstanding > 0']));
  });
  app.post(`${base}/reservations`, async (req, reply) => created(reply, reserveStock(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/reservations/release`, async (req) => releaseReservation(actorFromRequest(ctx, req), req.body));

  // ---- transfers
  app.get(`${base}/transfers`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transfer', 'view'), fleet);
    return page(list(ctx, { table: 'stk_v_transfer_state', filters: { state: 'state', fromLocationId: 'from_location_id', toLocationId: 'to_location_id' }, search: ['transfer_no'], idCol: 'transfer_id', live: false, order: 'dispatched_at DESC, transfer_id' }, req.query, fleet));
  });
  app.get(`${base}/transfers/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transfer', 'view'), fleet);
    const r = ctx.db.prepare('SELECT * FROM stk_v_transfer_state WHERE transfer_id = ?').get(idParam(req)) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', 'Transfer not found');
    return toApi(r);
  });
  app.post(`${base}/transfers`, async (req, reply) => created(reply, dispatchTransfer(actorFromRequest(ctx, req), req.body)));
  app.post(`${base}/transfers/:id/receive`, async (req) => receiveTransfer(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/transfers/:id/cancel`, async (req) => cancelTransfer(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${base}/numbers/remaining`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transfer', 'dispatch'), fleet);
    if (!ctx.identity) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized');
    return { sequence: TRANSFER_SEQUENCE, remaining: rangeRemaining(ctx.db, ctx.identity, TRANSFER_SEQUENCE) };
  });

  // ---- parts consumed by a work order
  app.get(`${base}/work-orders/:id/parts`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('transaction', 'view'), fleet);
    return { items: partsIssuedTo(ctx.db, idParam(req)), nextCursor: null, freshness: [freshnessFor(ctx, fleet)] };
  });

  void TABLES; void findAssetByName;
}
