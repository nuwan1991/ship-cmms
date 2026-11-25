import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { actorFromRequest, authorize } from './actor.js';
import { perm } from './permissions.js';
import { dockingView, getLive, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import {
  addWorkItem, cancelDocking, completeDocking, createDock, createDocking, dockIn, raiseWorkOrder, recordSurvey, tombstoneDock, tombstoneDocking, tombstoneWorkItem,
  undock, updateDock, updateDocking, updateWorkItem,
} from './service.js';
import {
  addRequirement, addShipReqItem, addTemplateItem, checklistOf, createReqTemplate, refreshChecklist, tombstoneReqTemplate, tombstoneRequirement, tombstoneShipReqItem,
  tombstoneTemplateItem, updateReqTemplate, updateRequirement, updateShipReqItem, updateTemplateItem,
} from './requirements.js';

export const DCK_API_PREFIX = '/api/v1/docking';

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

export function mountDckRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = DCK_API_PREFIX;
  const fleet: ScopeRef = { kind: 'fleet' };
  const page = (r: ReturnType<typeof list>) => ({ items: r.rows.map(toApi), nextCursor: r.nextCursor, freshness: r.freshness });
  const created = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, body: unknown) => reply.status(201).send(body);
  const dockingOr404 = (id: string): Row => {
    const d = dockingView(ctx.db, id);
    if (!d) throw new AppError('NOT_FOUND', 'Docking not found');
    return d;
  };

  // ---- docks
  const K = `${base}/docks`;
  app.get(K, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('dock', 'view'), fleet);
    return page(list(ctx, { table: 'dck_dock', filters: { status: 'status', kind: 'kind' }, search: ['code', 'name', 'operator'], idCol: 'id', live: true, order: 'code, id' }, req.query, fleet));
  });
  app.get(`${K}/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('dock', 'view'), fleet);
    const r = getLive(ctx.db, 'dock', idParam(req));
    if (!r) throw new AppError('NOT_FOUND', 'Dock not found');
    return toApi(r);
  });
  app.post(K, async (req, reply) => created(reply, createDock(actorFromRequest(ctx, req), req.body)));
  app.patch(`${K}/:id`, async (req) => updateDock(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${K}/:id/tombstone`, async (req) => tombstoneDock(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- dockings (the schedule)
  const D = `${base}/dockings`;
  app.get(D, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('docking', 'view'), fleet);
    const { open, ...rest } = req.query as Record<string, unknown>;
    return page(list(ctx, {
      table: 'dck_v_docking', filters: { shipId: 'ship_id', dockId: 'dock_id', status: 'status', dockingType: 'docking_type' },
      search: ['reference', 'ship_name', 'ship_code', 'dock_name', 'purpose'], idCol: 'docking_id', live: false, order: 'planned_dock_in DESC, docking_id',
    }, rest, fleet, open === 'true' ? ["status IN ('planned','in_dock','undocked')"] : []));
  });
  app.get(`${D}/:id`, async (req) => {
    const id = idParam(req);
    const d = dockingOr404(id);
    authorize(actorFromRequest(ctx, req), perm('docking', 'view'), { kind: 'ship', id: d.shipId as string });
    const items = (ctx.db.prepare('SELECT * FROM dck_work_item WHERE docking_id = ? AND deleted_at IS NULL ORDER BY item_no').all(id) as Row[]).map(toApi);
    const surveys = (ctx.db.prepare('SELECT * FROM dck_survey_record WHERE docking_id = ? ORDER BY occurred_at, id').all(id) as Row[]).map(toApi);
    const conflicts = (ctx.db.prepare('SELECT * FROM dck_v_dock_conflict WHERE docking_id = ?').all(id) as Row[]).map(toApi);
    return { ...d, id, items, surveys, conflicts, requirements: checklistOf(ctx.db, id) };
  });
  app.post(D, async (req, reply) => created(reply, createDocking(actorFromRequest(ctx, req), req.body)));
  app.patch(`${D}/:id`, async (req) => updateDocking(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/dock-in`, async (req) => dockIn(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/undock`, async (req) => undock(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/complete`, async (req) => completeDocking(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/cancel`, async (req) => cancelDocking(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/tombstone`, async (req) => tombstoneDocking(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- work list and survey of one docking
  app.post(`${D}/:id/work-items`, async (req, reply) => created(reply, addWorkItem(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.patch(`${base}/work-items/:id`, async (req) => updateWorkItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/work-items/:id/work-order`, async (req, reply) => created(reply, raiseWorkOrder(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/work-items/:id/tombstone`, async (req) => tombstoneWorkItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${D}/:id/surveys`, async (req, reply) => created(reply, recordSurvey(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- pre-docking requirements: class templates, ship items, the checklist of a docking (D76)
  const RT = `${base}/req-templates`;
  app.get(RT, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('req_template', 'view'), fleet);
    return page(list(ctx, { table: 'dck_req_template', filters: { status: 'status', shipClass: 'ship_class' }, search: ['code', 'name', 'ship_class'], idCol: 'id', live: true, order: 'ship_class IS NULL, ship_class, code, id' }, req.query, fleet));
  });
  app.get(`${RT}/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('req_template', 'view'), fleet);
    const r = getLive(ctx.db, 'req_template', idParam(req));
    if (!r) throw new AppError('NOT_FOUND', 'Checklist template not found');
    const items = (ctx.db.prepare('SELECT * FROM dck_req_template_item WHERE template_id = ? AND deleted_at IS NULL ORDER BY seq, id').all(r.id) as Row[]).map(toApi);
    return { ...toApi(r), items };
  });
  app.post(RT, async (req, reply) => created(reply, createReqTemplate(actorFromRequest(ctx, req), req.body)));
  app.patch(`${RT}/:id`, async (req) => updateReqTemplate(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${RT}/:id/tombstone`, async (req) => tombstoneReqTemplate(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${RT}/:id/items`, async (req, reply) => created(reply, addTemplateItem(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.patch(`${base}/req-template-items/:id`, async (req) => updateTemplateItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/req-template-items/:id/tombstone`, async (req) => tombstoneTemplateItem(actorFromRequest(ctx, req), idParam(req), req.body));

  const SR = `${base}/ship-req-items`;
  app.get(SR, async (req) => {
    const q = req.query as Record<string, unknown>;
    const scope: ScopeRef = typeof q.shipId === 'string' ? { kind: 'ship', id: q.shipId } : fleet;
    authorize(actorFromRequest(ctx, req), perm('ship_req', 'view'), scope);
    return page(list(ctx, { table: 'dck_ship_req_item', filters: { shipId: 'ship_id', status: 'status' }, search: ['title', 'responsible'], idCol: 'id', live: true, order: 'ship_id, seq, id' }, req.query, scope));
  });
  app.post(SR, async (req, reply) => created(reply, addShipReqItem(actorFromRequest(ctx, req), req.body)));
  app.patch(`${SR}/:id`, async (req) => updateShipReqItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${SR}/:id/tombstone`, async (req) => tombstoneShipReqItem(actorFromRequest(ctx, req), idParam(req), req.body));

  app.post(`${D}/:id/requirements/refresh`, async (req) => refreshChecklist(actorFromRequest(ctx, req), idParam(req)));
  app.post(`${D}/:id/requirements`, async (req, reply) => created(reply, addRequirement(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.patch(`${base}/requirements/:id`, async (req) => updateRequirement(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/requirements/:id/tombstone`, async (req) => tombstoneRequirement(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- docking due per ship, and planning clashes
  app.get(`${base}/due`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('due', 'view'), fleet);
    const { onlyDue, ...rest } = req.query as Record<string, unknown>;
    return page(list(ctx, {
      table: 'dck_v_ship_due', filters: { dueState: 'due_state', shipId: 'ship_id' }, search: ['ship_code', 'ship_name', 'pennant_no'], idCol: 'ship_id', live: false,
      order: "CASE due_state WHEN 'overdue' THEN 0 WHEN 'due_soon' THEN 1 WHEN 'in_dock' THEN 2 WHEN 'undocked' THEN 3 WHEN 'never' THEN 4 ELSE 5 END, next_due_on IS NULL, next_due_on, ship_code, ship_id",
    }, rest, fleet, onlyDue === 'true' ? ["due_state IN ('overdue','due_soon','never')"] : []));
  });
  app.get(`${base}/conflicts`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('docking', 'view'), fleet);
    const rows = ctx.db.prepare('SELECT * FROM dck_v_dock_conflict WHERE docking_id < other_docking_id ORDER BY overlap_from, dock_id').all() as Row[];
    return { items: rows.map(toApi), nextCursor: null, freshness: [freshnessFor(ctx, fleet)] };
  });
}
