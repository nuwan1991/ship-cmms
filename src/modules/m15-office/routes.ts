import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { actorFromRequest, authorize } from './actor.js';
import { perm } from './permissions.js';
import { attachmentsOf, getUnit, linksOf, timelineOf, toApi, unitTree } from './queries.js';
import { MAX_ATTACHMENT_BYTES, parse, RecordRef } from './schemas.js';
import {
  addComment, attachExisting, commandScope, createLink, createUnit, detachAttachment, readAttachment, removeLink, scopeOfRecord, updateUnit, uploadAttachment,
} from './service.js';

export const OFC_API_PREFIX = '/api/v1/office';

export function mountOfficeRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = OFC_API_PREFIX;
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const recordQuery = (q: unknown) => parse(RecordRef, q);

  // ---- office unit tree
  app.get(`${base}/units`, async (req) => {
    const q = parse(z.strictObject({ commandId: z.uuid(), includeInactive: z.enum(['true', 'false']).optional() }), req.query);
    authorize(actorFromRequest(ctx, req), perm('org_unit', 'view'), commandScope(q.commandId));
    return { items: unitTree(ctx.db, q.commandId, q.includeInactive === 'true').map(toApi) };
  });
  app.get(`${base}/units/:id`, async (req) => {
    const u = getUnit(ctx.db, idParam(req));
    if (!u) throw new AppError('NOT_FOUND', 'Unit not found');
    authorize(actorFromRequest(ctx, req), perm('org_unit', 'view'), commandScope(u.command_id as string));
    return toApi(u);
  });
  app.post(`${base}/units`, async (req, reply) => reply.status(201).send(toApi(createUnit(actorFromRequest(ctx, req), req.body))));
  app.patch(`${base}/units/:id`, async (req) => toApi(updateUnit(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- what hangs off any record: links, attachments, timeline (one call for the detail screens)
  app.get(`${base}/record`, async (req) => {
    const ref = recordQuery(req.query);
    const a = actorFromRequest(ctx, req);
    const scope = scopeOfRecord(a, ref);
    authorize(a, perm('link', 'view'), scope);
    authorize(a, perm('timeline', 'view'), scope);
    return {
      links: linksOf(ctx.db, ref.type, ref.id).map(toApi),
      attachments: attachmentsOf(ctx.db, ref.type, ref.id).map(toApi),
      timeline: timelineOf(ctx.db, ref.type, ref.id).map(toApi),
    };
  });

  app.post(`${base}/links`, async (req, reply) => reply.status(201).send(toApi(createLink(actorFromRequest(ctx, req), req.body))));
  app.post(`${base}/links/:id/remove`, async (req) => toApi(removeLink(actorFromRequest(ctx, req), idParam(req), req.body)));

  app.post(`${base}/attachments`, { bodyLimit: Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8192 }, async (req, reply) =>
    reply.status(201).send(toApi(uploadAttachment(actorFromRequest(ctx, req), req.body))));
  app.post(`${base}/attachments/:id/attach`, async (req, reply) => reply.status(201).send(toApi(attachExisting(actorFromRequest(ctx, req), idParam(req), req.body))));
  app.post(`${base}/attachment-links/:id/remove`, async (req) => toApi(detachAttachment(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.get(`${base}/attachments/:id/content`, async (req, reply) => {
    const { meta, bytes } = readAttachment(actorFromRequest(ctx, req), idParam(req));
    const safeName = String(meta.file_name).replace(/[^\w.\- ]/g, '_');
    return reply.header('content-type', meta.mime_type as string).header('content-disposition', `inline; filename="${safeName}"`).header('x-content-type-options', 'nosniff').send(bytes);
  });

  app.post(`${base}/comments`, async (req, reply) => reply.status(201).send(toApi(addComment(actorFromRequest(ctx, req), req.body))));
}
