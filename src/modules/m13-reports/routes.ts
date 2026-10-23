import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { toCamel } from '../../platform/canonical.js';
import { AppError } from '../../platform/errors.js';
import { actorFromRequest, authorize } from './actor.js';
import { localFreshness } from './freshness.js';
import { acknowledge, listNotifications, refreshNotifications } from './notifications.js';
import { perm } from './permissions.js';
import { dashboard, FilterSchema, REPORTS, runReport, toCsv, reportByCode } from './reports.js';

export const RPT_API_PREFIX = '/api/v1/reports';

const parse = <T extends z.ZodType>(schema: T, v: unknown): z.infer<T> => {
  const r = schema.safeParse(v);
  if (!r.success) throw new AppError('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
  return r.data;
};
const camel = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export function mountReportRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = RPT_API_PREFIX;
  const codeParam = (req: { params: unknown }): string => parse(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/) }), req.params).code;

  app.get(`${base}/reports`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('report', 'view'));
    return { items: REPORTS.map((r) => ({ code: r.code, title: r.title, description: r.description })), nextCursor: null, freshness: [localFreshness(ctx)] };
  });
  app.get(`${base}/reports/:code`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('report', 'view'));
    const { format: _f, ...f } = parse(FilterSchema, req.query);
    void _f;
    const r = runReport(ctx, codeParam(req), f);
    return { ...r, items: r.rows, nextCursor: null, freshness: [r.freshness] };
  });
  app.get(`${base}/reports/:code/file`, async (req, reply) => {
    authorize(actorFromRequest(ctx, req), perm('report', 'export'));
    const { format: _f, ...f } = parse(FilterSchema, req.query);
    void _f;
    const code = codeParam(req);
    const r = runReport(ctx, code, f);
    const csv = toCsv(r.report.columns, r.rows, { title: r.report.title, generatedAt: r.generatedAt, asOf: r.freshness.asOf, stale: r.freshness.stale });
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${reportByCode(code).code}-${r.generatedAt.slice(0, 10)}.csv"`).header('cache-control', 'no-store').send(csv);
  });

  app.get(`${base}/dashboard`, async (req) => { authorize(actorFromRequest(ctx, req), perm('dashboard', 'view')); return dashboard(ctx); });

  app.get(`${base}/notifications`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('notification', 'view'));
    const q = parse(z.strictObject({ status: z.enum(['open', 'acknowledged', 'resolved']).optional(), shipId: z.uuid().optional() }), req.query);
    return { items: listNotifications(ctx, q).map(camel), nextCursor: null, freshness: [localFreshness(ctx)] };
  });
  app.post(`${base}/notifications/refresh`, async (req) => { authorize(actorFromRequest(ctx, req), perm('notification', 'refresh')); return refreshNotifications(ctx); });
  app.post(`${base}/notifications/:id/acknowledge`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('notification', 'acknowledge'));
    return camel(acknowledge(ctx, parse(z.object({ id: z.uuid() }), req.params).id, a.principal.userId));
  });
}
