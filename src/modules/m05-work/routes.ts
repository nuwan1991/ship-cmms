import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { rangeRemaining } from '../../platform/ranges.js';
import { actorFromRequest, authorize, approvalsOf } from './actor.js';
import { GATE_ACCEPT, GATE_APPROVE, perm, type WrkNoun } from './permissions.js';
import { currentAxes, getLive, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import * as V from './service.js';

export const WRK_API_PREFIX = '/api/v1/work';

/** Placeholder until M10 supplies real sync state: hub data is authoritative; anything else has never synchronized. */
const freshnessFor = (ctx: AppContext, scope: ScopeRef): Freshness => ({ scope, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 });
const like = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const optStr = z.string().min(1).max(64).optional();

interface ListSpec { table: string; filters: Record<string, string>; search: string[]; idCol: string; live: boolean; order?: string }
function list(ctx: AppContext, spec: ListSpec, raw: unknown, scope: ScopeRef) {
  const q = parse(
    z.strictObject({
      limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().min(1).max(64).optional(), q: z.string().trim().min(1).max(60).optional(),
      ...Object.fromEntries(Object.keys(spec.filters).map((k) => [k, optStr])),
    }),
    raw,
  ) as Record<string, string | number | undefined> & { limit: number };
  const where: string[] = spec.live ? ['deleted_at IS NULL'] : [];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(spec.filters)) if (q[param] !== undefined) { where.push(`${col} = ?`); params.push(q[param]); }
  if (q.q) { where.push(`(${spec.search.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`); for (const _ of spec.search) params.push(like(String(q.q))); }
  if (q.cursor) { where.push(`${spec.idCol} > ?`); params.push(q.cursor); }
  const rows = ctx.db.prepare(`SELECT * FROM ${spec.table} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${spec.idCol} LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  return { items: page.map(toApi), nextCursor: rows.length > q.limit ? (page[page.length - 1]?.[spec.idCol] as string) : null, freshness: [freshnessFor(ctx, scope)] };
}

export function mountWorkRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = WRK_API_PREFIX;
  const actor = (req: Parameters<typeof actorFromRequest>[1]) => actorFromRequest(ctx, req);
  const scopeOfRow = (r: Row): ScopeRef => (r.home_scope_id ? { kind: 'ship', id: r.home_scope_id as string } : { kind: 'fleet' });
  const get = (noun: WrkNoun, id: string, label: string): Row => {
    const row = getLive(ctx.db, noun, id);
    if (!row) throw new AppError('NOT_FOUND', `${label} ${id} not found`);
    return row;
  };
  /** Standard collection: list (filtered), create, get, patch, tombstone. */
  const collection = (noun: WrkNoun, path: string, spec: Omit<ListSpec, 'live'>, create: (a: ReturnType<typeof actor>, body: unknown) => Row, update: (a: ReturnType<typeof actor>, id: string, body: unknown) => Row, remove: (a: ReturnType<typeof actor>, id: string, body: unknown) => Row, label: string) => {
    app.get(`${base}/${path}`, async (req) => {
      authorize(actor(req), perm(noun, 'view'), { kind: 'fleet' });
      const shipId = (req.query as Record<string, string | undefined>).shipId;
      return list(ctx, { ...spec, live: true }, req.query, shipId ? { kind: 'ship', id: shipId } : { kind: 'fleet' });
    });
    app.post(`${base}/${path}`, async (req, reply) => reply.status(201).send(create(actor(req), req.body)));
    app.get(`${base}/${path}/:id`, async (req) => {
      const row = get(noun, idParam(req), label);
      authorize(actor(req), perm(noun, 'view'), scopeOfRow(row));
      return toApi(row);
    });
    app.patch(`${base}/${path}/:id`, async (req) => update(actor(req), idParam(req), req.body));
    app.post(`${base}/${path}/:id/tombstone`, async (req) => remove(actor(req), idParam(req), req.body));
  };

  // ---- defects
  collection('defect', 'defects', { table: 'wrk_defect', filters: { shipId: 'home_scope_id', status: 'status', assetId: 'asset_id', severity: 'severity', repairCaseId: 'repair_case_id' }, search: ['defect_no', 'title'], idCol: 'id' }, V.reportDefect, V.updateDefect, V.tombstoneDefect, 'defect');
  app.post(`${base}/defects/:id/convert`, async (req) => V.convertDefect(actor(req), idParam(req), req.body));
  app.post(`${base}/defects/:id/dismiss`, async (req) => V.dismissDefect(actor(req), idParam(req), req.body));

  // ---- repair cases
  collection('repair_case', 'repair-cases', { table: 'wrk_repair_case', filters: { shipId: 'home_scope_id', assetId: 'asset_id', priority: 'priority' }, search: ['case_no', 'title'], idCol: 'id' }, V.createCase, V.updateCase, V.tombstoneCase, 'repair case');
  app.get(`${base}/repair-cases/:id/summary`, async (req) => {
    const row = get('repair_case', idParam(req), 'repair case');
    authorize(actor(req), perm('repair_case', 'view'), scopeOfRow(row));
    const workOrders = ctx.db.prepare('SELECT * FROM wrk_v_work_order_overview WHERE repair_case_id = ? ORDER BY wo_no').all(row.id) as Row[];
    const defects = ctx.db.prepare('SELECT * FROM wrk_defect WHERE repair_case_id = ? AND deleted_at IS NULL ORDER BY id').all(row.id) as Row[];
    return { ...toApi(row), axes: currentAxes(ctx.db, 'repair_case', row.id as string), workOrders: workOrders.map(toApi), defects: defects.map(toApi) };
  });
  app.post(`${base}/repair-cases/:id/progress`, async (req) => V.caseProgress(actor(req), idParam(req), req.body));
  app.post(`${base}/repair-cases/:id/close`, async (req) => V.closeCase(actor(req), idParam(req), req.body));
  app.post(`${base}/repair-cases/:id/reopen`, async (req) => V.reopenCase(actor(req), idParam(req), req.body));

  // ---- work orders (list/read come from the overview view so every axis is derived in one place)
  app.get(`${base}/work-orders`, async (req) => {
    authorize(actor(req), perm('work_order', 'view'), { kind: 'fleet' });
    const shipId = (req.query as Record<string, string | undefined>).shipId;
    return list(ctx, {
      table: 'wrk_v_work_order_overview', idCol: 'work_order_id', live: false, search: ['wo_no', 'title'],
      filters: { shipId: 'ship_id', assetId: 'asset_id', repairCaseId: 'repair_case_id', workType: 'work_type', priority: 'priority', progress: 'progress', approval: 'approval', returnToService: 'return_to_service', closure: 'closure', executingKind: 'executing_party_kind', executingId: 'executing_party_id' },
    }, req.query, shipId ? { kind: 'ship', id: shipId } : { kind: 'fleet' });
  });
  app.post(`${base}/work-orders`, async (req, reply) => reply.status(201).send(V.createWorkOrder(actor(req), req.body)));
  app.get(`${base}/work-orders/:id`, async (req) => {
    const w = get('work_order', idParam(req), 'work order');
    authorize(actor(req), perm('work_order', 'view'), scopeOfRow(w));
    const id = w.id as string;
    const all = (sql: string) => (ctx.db.prepare(sql).all(id) as Row[]).map(toApi);
    const overview = ctx.db.prepare('SELECT * FROM wrk_v_work_order_overview WHERE work_order_id = ?').get(id) as Row;
    const a = actor(req);
    const gates = Object.fromEntries([GATE_APPROVE, GATE_ACCEPT].map((g) => [g, approvalsOf(a).evaluateGate(g, { type: 'wrk.work_order', id }, a.principal)]));
    return {
      ...toApi(w), axes: currentAxes(ctx.db, 'work_order', id), effectiveExecutingParty: overview.executing_party_id ? { kind: overview.executing_party_kind, id: overview.executing_party_id } : null,
      handoverPending: Boolean(overview.handover_pending), labourMinutes: overview.labour_minutes, gates,
      jobCards: all('SELECT * FROM wrk_job_card WHERE work_order_id = ? AND deleted_at IS NULL ORDER BY seq'),
      handovers: all('SELECT * FROM wrk_v_handover_state WHERE work_order_id = ? ORDER BY occurred_at, offer_id'),
      acceptances: all('SELECT * FROM wrk_acceptance WHERE work_order_id = ? ORDER BY occurred_at, id'),
    };
  });
  app.patch(`${base}/work-orders/:id`, async (req) => V.updateWorkOrder(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/tombstone`, async (req) => V.tombstoneWorkOrder(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/progress`, async (req) => V.changeProgress(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/request-review`, async (req) => V.requestReview(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/decide`, async (req) => V.decideApproval(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/accept`, async (req) => V.acceptRepair(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/close`, async (req) => V.closeWorkOrder(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/reopen`, async (req) => V.reopenWorkOrder(actor(req), idParam(req), req.body));
  app.post(`${base}/work-orders/:id/handover/offer`, async (req, reply) => reply.status(201).send(V.offerHandover(actor(req), idParam(req), req.body)));
  app.post(`${base}/work-orders/:id/handover/respond`, async (req) => V.respondHandover(actor(req), idParam(req), req.body));

  // ---- event streams of a work order or repair case
  app.get(`${base}/status-events`, async (req) => {
    authorize(actor(req), perm('status_event', 'view'), { kind: 'fleet' });
    const q = parse(z.strictObject({ subjectId: z.uuid(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
    const rows = ctx.db.prepare('SELECT * FROM wrk_status_event WHERE subject_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?').all(q.subjectId, q.limit) as Row[];
    return { items: rows.map(toApi), nextCursor: null, freshness: [freshnessFor(ctx, { kind: 'fleet' })] };
  });
  const stream = (noun: 'labour_entry' | 'finding' | 'test_record', path: string, table: string, add: (a: ReturnType<typeof actor>, id: string, body: unknown) => Row) => {
    app.get(`${base}/work-orders/:id/${path}`, async (req) => {
      const w = get('work_order', idParam(req), 'work order');
      authorize(actor(req), perm(noun, 'view'), scopeOfRow(w));
      const rows = ctx.db.prepare(`SELECT * FROM ${table} WHERE work_order_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 500`).all(w.id) as Row[];
      return { items: rows.map(toApi), nextCursor: null, freshness: [freshnessFor(ctx, scopeOfRow(w))] };
    });
    app.post(`${base}/work-orders/:id/${path}`, async (req, reply) => reply.status(201).send(add(actor(req), idParam(req), req.body)));
  };
  stream('labour_entry', 'labour', 'wrk_labour_entry', V.addLabour);
  stream('finding', 'findings', 'wrk_finding', V.addFinding);
  stream('test_record', 'tests', 'wrk_test_record', V.addTestRecord);

  // ---- job cards
  collection('job_card', 'job-cards', { table: 'wrk_job_card', filters: { workOrderId: 'work_order_id', status: 'status' }, search: ['title'], idCol: 'id' }, V.createJobCard, V.updateJobCard, V.tombstoneJobCard, 'job card');

  // ---- advisories (hub reference) and per-asset lookup
  collection('advisory', 'advisories', { table: 'wrk_advisory', filters: { severity: 'severity', status: 'status', classificationId: 'classification_id' }, search: ['code', 'title'], idCol: 'id' }, V.createAdvisory, V.updateAdvisory, V.tombstoneAdvisory, 'advisory');
  app.get(`${base}/assets/:id/advisories`, async (req) => {
    authorize(actor(req), perm('advisory', 'view'), { kind: 'fleet' });
    return { items: V.advisoriesForAsset(ctx.db, idParam(req)), nextCursor: null, freshness: [freshnessFor(ctx, { kind: 'fleet' })] };
  });

  // ---- recurring faults and numbering
  app.get(`${base}/recurring-faults`, async (req) => {
    authorize(actor(req), perm('defect', 'view'), { kind: 'fleet' });
    const q = parse(z.strictObject({ days: z.coerce.number().int().min(1).max(730).default(90), min: z.coerce.number().int().min(2).max(50).default(3), shipId: optStr }), req.query);
    const rows = ctx.db.prepare(
      `SELECT asset_id, home_scope_id AS ship_id, COUNT(*) AS occurrences, MIN(at) AS first_at, MAX(at) AS last_at FROM (
         SELECT asset_id, home_scope_id, reported_at AS at FROM wrk_defect WHERE deleted_at IS NULL AND asset_id IS NOT NULL AND status <> 'dismissed'
         UNION ALL SELECT asset_id, home_scope_id, created_at FROM wrk_work_order WHERE deleted_at IS NULL AND asset_id IS NOT NULL AND work_type = 'corrective' AND repair_case_id IS NULL
       ) WHERE at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) ${q.shipId ? 'AND home_scope_id = ?' : ''}
       GROUP BY asset_id, home_scope_id HAVING COUNT(*) >= ? ORDER BY occurrences DESC, asset_id`,
    ).all(`-${q.days} days`, ...(q.shipId ? [q.shipId] : []), q.min) as Row[];
    return { items: rows.map(toApi), nextCursor: null, freshness: [freshnessFor(ctx, { kind: 'fleet' })] };
  });
  app.get(`${base}/numbers/remaining`, async (req) => {
    authorize(actor(req), perm('defect', 'create'), { kind: 'fleet' });
    if (!ctx.identity) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized');
    const id = ctx.identity;
    return { defect: rangeRemaining(ctx.db, id, V.DEFECT_SEQUENCE), repairCase: rangeRemaining(ctx.db, id, V.REPAIR_CASE_SEQUENCE), workOrder: rangeRemaining(ctx.db, id, V.WORK_ORDER_SEQUENCE) };
  });
}
