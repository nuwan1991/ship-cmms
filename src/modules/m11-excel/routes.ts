import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { actorFromRequest } from './actor.js';
import { MAX_FILE_BYTES, parse } from './schemas.js';
import { commitImport, errorReport, exportFile, getJob, jobRows, listJobs, listTemplates, previewImport, type NamedFile, type Row } from './service.js';
import { toCamel } from '../../platform/canonical.js';

export const XLS_API_PREFIX = '/api/v1/excel';

const camel = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));
const send = (reply: FastifyReply, f: NamedFile) =>
  reply.header('content-type', f.contentType).header('content-disposition', `attachment; filename="${f.fileName.replace(/[^\w.\-]/g, '_')}"`).header('x-row-count', String(f.rowCount)).header('cache-control', 'no-store').send(Buffer.from(f.bytes));

export function mountExcelRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = XLS_API_PREFIX;
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const codeParam = (req: { params: unknown }): string => parse(z.object({ code: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/) }), req.params).code;

  app.get(`${base}/templates`, async (req) => ({ items: listTemplates(actorFromRequest(ctx, req), ctx.importExport) }));
  app.get(`${base}/templates/:code/file`, async (req, reply) => send(reply, exportFile(actorFromRequest(ctx, req), ctx.importExport, codeParam(req), req.query)));

  app.post(`${base}/imports`, { bodyLimit: Math.ceil((MAX_FILE_BYTES * 4) / 3) + 4096 }, async (req, reply) => reply.status(201).send(camel(previewImport(actorFromRequest(ctx, req), ctx.importExport, req.body))));
  app.get(`${base}/imports`, async (req) => ({ items: listJobs(actorFromRequest(ctx, req)).map(camel), nextCursor: null, freshness: [] }));
  app.get(`${base}/imports/:id`, async (req) => camel(getJob(actorFromRequest(ctx, req), idParam(req))));
  app.get(`${base}/imports/:id/rows`, async (req) => {
    const q = parse(z.strictObject({ status: z.enum(['ok', 'error']).optional(), cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const r = jobRows(actorFromRequest(ctx, req), idParam(req), { limit: q.limit, ...(q.status ? { status: q.status } : {}), ...(q.cursor !== undefined ? { after: q.cursor } : {}) });
    return { items: r.items, nextCursor: r.next === null ? null : String(r.next), freshness: [] };
  });
  app.post(`${base}/imports/:id/commit`, async (req) => camel(commitImport(actorFromRequest(ctx, req), ctx.importExport, idParam(req), req.body)));
  app.get(`${base}/imports/:id/report`, async (req, reply) => send(reply, errorReport(actorFromRequest(ctx, req), ctx.importExport, idParam(req))));

  void AppError;
}
