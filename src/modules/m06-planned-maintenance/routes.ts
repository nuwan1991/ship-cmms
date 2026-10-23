import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { actorFromRequest, authorize } from './actor.js';
import { perm } from './permissions.js';
import { currentMeterValue, getLive, TABLES, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import {
  createMeter, createPlan, createTemplate, generateDue, recordCalibration, recordCompletion, recordReading, replaceMeter, tombstoneMeter, tombstonePlan,
  tombstoneTemplate, updateMeter, updatePlan, updateTemplate,
} from './service.js';

export const PM_API_PREFIX = '/api/v1/pm';

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

export function mountPmRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = PM_API_PREFIX;
  const fleet: ScopeRef = { kind: 'fleet' };
  const scopeOfRow = (r: Row): ScopeRef => (r.home_scope_id ? { kind: 'ship', id: r.home_scope_id as string } : fleet);
  const page = (r: ReturnType<typeof list>, map: (x: Row) => Row = toApi) => ({ items: r.rows.map(map), nextCursor: r.nextCursor, freshness: r.freshness });
  const created = (reply: { status: (n: number) => { send: (b: unknown) => unknown } }, body: unknown) => reply.status(201).send(body);

  // ---- task templates
  const T = `${base}/task-templates`;
  app.get(T, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('task_template', 'view'), fleet);
    return page(list(ctx, { table: 'pm_task_template', filters: { status: 'status', classificationId: 'classification_id' }, search: ['code', 'name'], idCol: 'id', live: true, order: 'code, id' }, req.query, fleet));
  });
  app.get(`${T}/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('task_template', 'view'), fleet);
    const r = getLive(ctx.db, 'task_template', idParam(req));
    if (!r) throw new AppError('NOT_FOUND', 'Task template not found');
    return toApi(r);
  });
  app.post(T, async (req, reply) => created(reply, createTemplate(actorFromRequest(ctx, req), req.body)));
  app.patch(`${T}/:id`, async (req) => updateTemplate(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${T}/:id/tombstone`, async (req) => tombstoneTemplate(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- plans
  const P = `${base}/plans`;
  app.get(P, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('plan', 'view'), fleet);
    return page(list(ctx, { table: 'pm_v_plan_due', filters: { shipId: 'ship_id', assetId: 'asset_id', status: 'status', triggerKind: 'trigger_kind' }, search: ['code', 'title'], idCol: 'plan_id', live: false, order: 'code, plan_id' }, req.query, fleet));
  });
  app.get(`${P}/:id`, async (req) => {
    const r = getLive(ctx.db, 'plan', idParam(req));
    if (!r) throw new AppError('NOT_FOUND', 'Plan not found');
    authorize(actorFromRequest(ctx, req), perm('plan', 'view'), scopeOfRow(r));
    const due = ctx.db.prepare('SELECT * FROM pm_v_plan_due WHERE plan_id = ?').get(r.id) as Row;
    return { ...toApi(r), due: toApi(due) };
  });
  app.post(P, async (req, reply) => created(reply, createPlan(actorFromRequest(ctx, req), req.body)));
  app.patch(`${P}/:id`, async (req) => updatePlan(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${P}/:id/complete`, async (req) => recordCompletion(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${P}/:id/tombstone`, async (req) => tombstonePlan(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/generate`, async (req) => generateDue(actorFromRequest(ctx, req), req.body));

  // ---- meters and readings
  const M = `${base}/meters`;
  app.get(M, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('meter', 'view'), fleet);
    const r = list(ctx, { table: 'pm_meter', filters: { assetId: 'asset_id', status: 'status' }, search: ['name'], idCol: 'id', live: true }, req.query, fleet);
    return page(r, (x) => ({ ...toApi(x), current: currentMeterValue(ctx.db, x.id as string) }));
  });
  app.post(M, async (req, reply) => created(reply, createMeter(actorFromRequest(ctx, req), req.body)));
  app.patch(`${M}/:id`, async (req) => updateMeter(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${M}/:id/tombstone`, async (req) => tombstoneMeter(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${M}/:id/readings`, async (req) => {
    const m = getLive(ctx.db, 'meter', idParam(req));
    if (!m) throw new AppError('NOT_FOUND', 'Meter not found');
    authorize(actorFromRequest(ctx, req), perm('meter_reading', 'view'), scopeOfRow(m));
    const rows = ctx.db.prepare('SELECT * FROM pm_meter_reading WHERE meter_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200').all(m.id) as Row[];
    return { items: rows.map(toApi), nextCursor: null, freshness: [freshnessFor(ctx, scopeOfRow(m))] };
  });
  app.post(`${M}/:id/readings`, async (req, reply) => created(reply, recordReading(actorFromRequest(ctx, req), { ...(req.body as object), meterId: idParam(req) })));
  app.post(`${M}/:id/replace`, async (req, reply) => created(reply, replaceMeter(actorFromRequest(ctx, req), { ...(req.body as object), meterId: idParam(req) })));

  // ---- calibration and the due list
  app.get(`${base}/calibrations`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('calibration', 'view'), fleet);
    return page(list(ctx, { table: 'pm_calibration_record', filters: { assetId: 'asset_id', result: 'result' }, search: ['certificate_no', 'calibrated_by'], idCol: 'id', live: false, order: 'id DESC' }, req.query, fleet));
  });
  app.post(`${base}/calibrations`, async (req, reply) => created(reply, recordCalibration(actorFromRequest(ctx, req), req.body)));
  app.get(`${base}/due`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('due', 'view'), fleet);
    const { onlyDue, ...rest } = req.query as Record<string, unknown>;
    return page(list(ctx, { table: 'pm_v_due', filters: { shipId: 'ship_id', assetId: 'asset_id', source: 'source' }, search: ['title', 'ref_code'], idCol: 'ref_id', live: false, order: 'overdue DESC, due_on IS NULL, due_on, ref_id' }, rest, fleet, onlyDue === 'true' ? ['(overdue = 1 OR due_soon = 1)'] : []));
  });

  void TABLES;
}
