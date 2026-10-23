import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { rangeRemaining } from '../../platform/ranges.js';
import { getAsset } from '../m03-assets/index.js';
import { actorFromRequest, authorize } from './actor.js';
import { perm, type QrNoun } from './permissions.js';
import { getLive, resolveLabel, TABLES, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import {
  addSurveyItem, assignLabel, closeSurvey, convertSurveyItem, createTemplate, issueLabels, LABEL_SEQUENCE, printLabels, removeSurveyItem,
  startSurvey, tombstoneSurvey, tombstoneTemplate, updateSurvey, updateSurveyItem, updateTemplate, voidLabel,
} from './service.js';

export const QR_API_PREFIX = '/api/v1/labels';

/** Placeholder until M10 supplies real sync state: hub data is authoritative; anything else has never synchronized. */
const freshnessFor = (ctx: AppContext, scope: ScopeRef): Freshness => ({ scope, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 });
const like = (q: string): string => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const optStr = z.string().min(1).max(64).optional();

interface ListSpec { table: string; filters: Record<string, string>; search: string[]; idCol: string; live: boolean }
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
  return { rows: page, nextCursor: rows.length > q.limit ? (page[page.length - 1]?.[spec.idCol] as string) : null, freshness: [freshnessFor(ctx, scope)] };
}

const withAsset = (ctx: AppContext, r: Row): Row => {
  const aid = (r.asset_id ?? r.converted_asset_id) as string | null | undefined;
  const asset = aid ? getAsset(ctx.db, aid) : null;
  return { ...toApi(r), assetTag: asset?.assetTag ?? null, assetName: asset?.name ?? null };
};

export function mountLabelRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = QR_API_PREFIX;
  const scopeOfRow = (r: Row): ScopeRef => (r.home_scope_id ? { kind: 'ship', id: r.home_scope_id as string } : { kind: 'fleet' });
  const get = (noun: QrNoun, id: string, label: string): Row => {
    const row = getLive(ctx.db, noun, id);
    if (!row) throw new AppError('NOT_FOUND', `${label} ${id} not found`);
    return row;
  };

  // ---- labels
  app.get(`${base}/labels`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('label', 'view'), { kind: 'fleet' });
    const r = list(ctx, { table: 'qr_label', filters: { state: 'state', assetId: 'asset_id', shipId: 'home_scope_id' }, search: ['label_no'], idCol: 'id', live: true }, req.query, { kind: 'fleet' });
    return { items: r.rows.map((x) => withAsset(ctx, x)), nextCursor: r.nextCursor, freshness: r.freshness };
  });
  app.get(`${base}/labels/resolve`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('label', 'view'), { kind: 'fleet' });
    const { no } = parse(z.strictObject({ no: z.string().trim().min(1).max(40) }), req.query);
    const found = resolveLabel(ctx.db, no);
    if (!found) throw new AppError('NOT_FOUND', `No label ${no.toUpperCase()} is known on this installation`);
    return { ...withAsset(ctx, get('label', found.id, 'label')) };
  });
  app.get(`${base}/labels/remaining`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('label', 'create'), { kind: 'fleet' });
    if (!ctx.identity) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized');
    return { sequence: LABEL_SEQUENCE, remaining: rangeRemaining(ctx.db, ctx.identity, LABEL_SEQUENCE) };
  });
  app.post(`${base}/labels/issue`, async (req, reply) => reply.status(201).send({ items: issueLabels(actorFromRequest(ctx, req), req.body) }));
  app.post(`${base}/labels/print`, async (req, reply) => reply.status(201).send(printLabels(actorFromRequest(ctx, req), req.body)));
  app.get(`${base}/labels/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const row = get('label', idParam(req), 'label');
    authorize(a, perm('label', 'view'), scopeOfRow(row));
    return withAsset(ctx, row);
  });
  app.post(`${base}/labels/:id/assign`, async (req) => assignLabel(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/labels/:id/void`, async (req) => voidLabel(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${base}/labels/:id/prints`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const row = get('label', idParam(req), 'label');
    authorize(a, perm('label_print', 'view'), scopeOfRow(row));
    const items = ctx.db.prepare('SELECT * FROM qr_label_print WHERE label_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200').all(row.id) as Row[];
    return { items: items.map(toApi), freshness: [freshnessFor(ctx, scopeOfRow(row))] };
  });

  // ---- survey templates
  const T = `${base}/survey-templates`;
  app.get(T, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('survey_template', 'view'), { kind: 'fleet' });
    const r = list(ctx, { table: 'qr_survey_template', filters: { status: 'status' }, search: ['code', 'name'], idCol: 'id', live: true }, req.query, { kind: 'fleet' });
    return { items: r.rows.map(toApi), nextCursor: r.nextCursor, freshness: r.freshness };
  });
  app.get(`${T}/:id`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('survey_template', 'view'), { kind: 'fleet' });
    return toApi(get('survey_template', idParam(req), 'survey template'));
  });
  app.post(T, async (req, reply) => reply.status(201).send(createTemplate(actorFromRequest(ctx, req), req.body)));
  app.patch(`${T}/:id`, async (req) => updateTemplate(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${T}/:id/tombstone`, async (req) => tombstoneTemplate(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- surveys
  const SV = `${base}/surveys`;
  app.get(SV, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('survey', 'view'), { kind: 'fleet' });
    const r = list(ctx, { table: 'qr_v_survey_summary', filters: { shipId: 'ship_id', status: 'status', locationId: 'location_id' }, search: ['status'], idCol: 'survey_id', live: false }, req.query, { kind: 'fleet' });
    return { items: r.rows.map(toApi), nextCursor: r.nextCursor, freshness: r.freshness };
  });
  app.post(SV, async (req, reply) => reply.status(201).send(startSurvey(actorFromRequest(ctx, req), req.body)));
  app.get(`${SV}/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const row = get('survey', idParam(req), 'survey');
    authorize(a, perm('survey', 'view'), scopeOfRow(row));
    const summary = ctx.db.prepare('SELECT * FROM qr_v_survey_summary WHERE survey_id = ?').get(row.id) as Row;
    return { ...toApi(row), summary: toApi(summary) };
  });
  app.patch(`${SV}/:id`, async (req) => updateSurvey(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${SV}/:id/close`, async (req) => closeSurvey(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${SV}/:id/tombstone`, async (req) => tombstoneSurvey(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${SV}/:id/items`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const survey = get('survey', idParam(req), 'survey');
    authorize(a, perm('survey_item', 'view'), scopeOfRow(survey));
    const rows = ctx.db.prepare('SELECT * FROM qr_survey_item WHERE survey_id = ? AND deleted_at IS NULL ORDER BY id').all(survey.id) as Row[];
    return { items: rows.map((r) => withAsset(ctx, r)), nextCursor: null, freshness: [freshnessFor(ctx, scopeOfRow(survey))] };
  });
  app.post(`${SV}/:id/items`, async (req, reply) => reply.status(201).send(withAsset(ctx, get('survey_item', addSurveyItem(actorFromRequest(ctx, req), idParam(req), req.body).id as string, 'survey item'))));
  app.patch(`${base}/survey-items/:id`, async (req) => updateSurveyItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/survey-items/:id/tombstone`, async (req) => removeSurveyItem(actorFromRequest(ctx, req), idParam(req), req.body));
  app.post(`${base}/survey-items/:id/convert`, async (req) => convertSurveyItem(actorFromRequest(ctx, req), idParam(req), req.body));

  void TABLES;
}
