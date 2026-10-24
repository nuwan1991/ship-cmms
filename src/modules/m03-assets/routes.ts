import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { rangeRemaining } from '../../platform/ranges.js';
import { isUtcIso, nowUtc } from '../../platform/time.js';
import { getLocation, resolveParty } from '../m01-organization/index.js';
import { actorFromRequest, authorize } from './actor.js';
import { applyRemap, loadStandardCatalogue, remapPlan, retireLegacy } from './classification-merge.js';
import { listMovements, moveAsset } from './movements.js';
import { perm, type AstNoun } from './permissions.js';
import { assetAtPosition, currentInstallation, getAssetState, getLive, getPosition, resolveTag, TABLES, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import { createAsset, createEntity, EQUIPMENT_TAG_SEQUENCE, reassignResponsibility, responsibilityAt, tombstoneEntity, updateEntity } from './service.js';

export const AST_API_PREFIX = '/api/v1/assets';

type Crud = Exclude<AstNoun, 'asset_movement'>;
const COLLECTIONS: Record<Crud, string> = {
  classification: 'classifications',
  classification_map: 'classification-maps',
  position: 'positions',
  position_responsibility: 'position-responsibilities',
  asset: 'assets',
};

/** Equality filters per list endpoint (query param -> column). */
const FILTERS: Record<Exclude<Crud, 'asset'>, Record<string, string>> = {
  classification: { kind: 'kind', status: 'status', parentId: 'parent_id' },
  classification_map: { legacySystem: 'legacy_system', relation: 'relation', status: 'status', targetClassificationId: 'target_classification_id' },
  position: { shipId: 'home_scope_id', parentId: 'parent_id', level: 'level', status: 'status', classificationId: 'classification_id' },
  position_responsibility: { positionId: 'position_id', departmentId: 'department_id' },
};
const SEARCH: Record<Exclude<Crud, 'asset'>, string[]> = {
  classification: ['code', 'name'],
  classification_map: ['legacy_code', 'legacy_name'],
  position: ['position_tag', 'name'],
  position_responsibility: ['reason'],
};
const ASSET_FILTERS: Record<string, string> = {
  homeShipId: 'home_ship_id', shipId: 'ship_id', status: 'asset_status', positionId: 'position_id', classificationCode: 'classification_code',
};

/** Placeholder until M10 supplies real sync state: hub data is authoritative; anything else has never synchronized. */
const freshnessFor = (ctx: AppContext, scope: ScopeRef): Freshness => ({ scope, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 });

const like = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

function pageQuery(extra: Record<string, unknown>) {
  return z.strictObject({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(60).optional(),
    ...extra,
  });
}
const optStr = z.string().min(1).max(64).optional();

function listGeneric(ctx: AppContext, noun: Exclude<Crud, 'asset'>, raw: unknown, scope: ScopeRef) {
  const filters = FILTERS[noun];
  const q = parse(pageQuery(Object.fromEntries(Object.keys(filters).map((k) => [k, optStr]))), raw) as Record<string, string | number | undefined> & { limit: number };
  const where = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(filters)) {
    const v = q[param];
    if (v === undefined) continue;
    if (v === 'root' && col === 'parent_id') where.push('parent_id IS NULL');
    else { where.push(`${col} = ?`); params.push(v); }
  }
  if (q.q) {
    where.push(`(${SEARCH[noun].map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (let i = 0; i < SEARCH[noun].length; i++) params.push(like(String(q.q)));
  }
  if (q.cursor) { where.push('id > ?'); params.push(q.cursor); }
  const rows = ctx.db.prepare(`SELECT * FROM ${TABLES[noun]} WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  return { items: page.map(toApi), nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id as string) : null, freshness: [freshnessFor(ctx, scope)] };
}

function listAssets(ctx: AppContext, raw: unknown) {
  const q = parse(pageQuery(Object.fromEntries(Object.keys(ASSET_FILTERS).map((k) => [k, optStr]))), raw) as Record<string, string | number | undefined> & { limit: number };
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(ASSET_FILTERS)) if (q[param] !== undefined) { where.push(`${col} = ?`); params.push(q[param]); }
  if (q.q) {
    const cols = ['asset_tag', 'name', 'serial_number', 'position_tag', 'manufacturer'];
    where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) params.push(like(String(q.q)));
  }
  if (q.cursor) { where.push('asset_id > ?'); params.push(q.cursor); }
  const rows = ctx.db.prepare(`SELECT * FROM ast_v_asset_overview ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY asset_id LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  const scope: ScopeRef = typeof q.shipId === 'string' ? { kind: 'ship', id: q.shipId } : { kind: 'fleet' };
  return { items: page.map(toApi), nextCursor: rows.length > q.limit ? (page[page.length - 1]?.asset_id as string) : null, freshness: [freshnessFor(ctx, scope)] };
}

function assetDetail(ctx: AppContext, row: Row) {
  const state = getAssetState(ctx.db, row.id as string);
  const inst = currentInstallation(ctx.db, row.id as string);
  return {
    ...toApi(row),
    state,
    installation: inst ? { ...inst, position: getPosition(ctx.db, inst.positionId) } : null,
    location: state?.locationId ? getLocation(ctx.db, state.locationId) : null,
    custodyParty: state?.custody ? resolveParty(ctx.db, state.custody as Parameters<typeof resolveParty>[1]) : null,
  };
}

export function mountAssetRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = AST_API_PREFIX;

  // ---- classifications, positions, responsibilities (generic CRUD)
  for (const noun of ['classification', 'classification_map', 'position', 'position_responsibility'] as const) {
    const path = `${base}/${COLLECTIONS[noun]}`;
    app.get(path, async (req) => {
      const a = actorFromRequest(ctx, req);
      authorize(a, perm(noun, 'view'), { kind: 'fleet' });
      const shipId = (req.query as Record<string, string | undefined>).shipId;
      return listGeneric(ctx, noun, req.query, noun === 'position' && shipId ? { kind: 'ship', id: shipId } : { kind: 'fleet' });
    });
    app.post(path, async (req, reply) => reply.status(201).send(createEntity(actorFromRequest(ctx, req), noun, req.body)));
    app.patch(`${path}/:id`, async (req) => updateEntity(actorFromRequest(ctx, req), noun, idParam(req), req.body));
    app.post(`${path}/:id/tombstone`, async (req) => tombstoneEntity(actorFromRequest(ctx, req), noun, idParam(req), req.body));
  }

  app.get(`${base}/classifications/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('classification', 'view'), { kind: 'fleet' });
    const row = getLive(ctx.db, 'classification', idParam(req));
    if (!row) throw new AppError('NOT_FOUND', 'classification not found');
    return toApi(row);
  });

  // ---- standard catalogue and legacy merge (DECISIONS D62)
  const dryRun = (body: unknown): boolean => parse(z.strictObject({ dryRun: z.boolean().default(true) }), body ?? {}).dryRun;
  app.post(`${base}/classifications/load-standard`, async (req) => loadStandardCatalogue(actorFromRequest(ctx, req)));
  app.get(`${base}/classification-merge/plan`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('classification_map', 'view'), { kind: 'fleet' });
    return remapPlan(ctx.db, a.wctx.installation.installationId);
  });
  app.post(`${base}/classification-merge/remap`, async (req) => applyRemap(actorFromRequest(ctx, req), { dryRun: dryRun(req.body) }));
  app.post(`${base}/classification-merge/retire`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('classification', 'update'), { kind: 'fleet' });
    return retireLegacy(a, { dryRun: dryRun(req.body) });
  });

  app.get(`${base}/positions/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const id = idParam(req);
    const row = getLive(ctx.db, 'position', id);
    if (!row) throw new AppError('NOT_FOUND', `position ${id} not found`);
    authorize(a, perm('position', 'view'), { kind: 'ship', id: row.home_scope_id as string });
    const info = getPosition(ctx.db, id);
    return { ...toApi(row), path: info?.path ?? [], pathText: info?.pathText ?? '', asset: assetAtPosition(ctx.db, id), responsibility: responsibilityAt(ctx.db, id, nowUtc()) };
  });

  app.get(`${base}/position-responsibilities/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const row = getLive(ctx.db, 'position_responsibility', idParam(req));
    if (!row) throw new AppError('NOT_FOUND', 'position responsibility not found');
    authorize(a, perm('position_responsibility', 'view'), { kind: 'ship', id: row.home_scope_id as string });
    return toApi(row);
  });
  app.post(`${base}/position-responsibilities/reassign`, async (req) => reassignResponsibility(actorFromRequest(ctx, req), req.body));

  // ---- assets
  app.get(`${base}/assets`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('asset', 'view'), { kind: 'fleet' });
    return listAssets(ctx, req.query);
  });
  app.get(`${base}/assets/resolve`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('asset', 'view'), { kind: 'fleet' });
    const { tag } = parse(z.strictObject({ tag: z.string().trim().min(1).max(40) }), req.query);
    const found = resolveTag(ctx.db, tag);
    if (!found) throw new AppError('NOT_FOUND', `No asset has the tag ${tag.toUpperCase()}`);
    return assetDetail(ctx, getLive(ctx.db, 'asset', found.id)!);
  });
  app.get(`${base}/assets/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const row = getLive(ctx.db, 'asset', idParam(req));
    if (!row) throw new AppError('NOT_FOUND', 'asset not found');
    authorize(a, perm('asset', 'view'), row.home_scope_id ? { kind: 'ship', id: row.home_scope_id as string } : { kind: 'fleet' });
    return assetDetail(ctx, row);
  });
  app.post(`${base}/assets`, async (req, reply) => {
    const out = createAsset(actorFromRequest(ctx, req), req.body);
    return reply.status(201).send({ ...out.asset, state: out.current });
  });
  app.patch(`${base}/assets/:id`, async (req) => updateEntity(actorFromRequest(ctx, req), 'asset', idParam(req), req.body));
  app.post(`${base}/assets/:id/tombstone`, async (req) => tombstoneEntity(actorFromRequest(ctx, req), 'asset', idParam(req), req.body));

  // ---- movements (events): history and appending
  app.get(`${base}/assets/:id/movements`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const id = idParam(req);
    const row = getLive(ctx.db, 'asset', id);
    if (!row) throw new AppError('NOT_FOUND', 'asset not found');
    authorize(a, perm('asset_movement', 'view'), row.home_scope_id ? { kind: 'ship', id: row.home_scope_id as string } : { kind: 'fleet' });
    const q = parse(z.strictObject({ limit: z.coerce.number().int().min(1).max(500).default(100), cursor: optStr }), req.query);
    return { ...listMovements(ctx.db, id, { limit: q.limit, ...(q.cursor ? { cursor: q.cursor } : {}) }), freshness: [freshnessFor(ctx, { kind: 'fleet' })] };
  });
  app.post(`${base}/assets/:id/movements`, async (req, reply) => reply.status(201).send(moveAsset(actorFromRequest(ctx, req), ctx.events, idParam(req), req.body)));

  // ---- equipment tag numbers still available to this installation (low-water warning in the UI)
  app.get(`${base}/tag-ranges/remaining`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('asset', 'create'), { kind: 'fleet' });
    if (!ctx.identity) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized');
    return { sequence: EQUIPMENT_TAG_SEQUENCE, remaining: rangeRemaining(ctx.db, ctx.identity, EQUIPMENT_TAG_SEQUENCE) };
  });

  void isUtcIso; // reserved for date filters on movement history
}
