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
import {
  createCorrespondence, createMatter, getCorrespondence, listCorrespondence, markNoReplyNeeded, matterThread, setCorrespondenceStatus, updateCorrespondence, updateMatter,
} from './correspondence.js';
import { addItemAction, bulkItems, createItem, createPacket, getPacket, handoverReport, listItems, listPackets, updateItem, updatePacket } from './handover.js';
import { mustGet } from './common.js';

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

  // ---- matters and correspondence
  const cmdQuery = (q: unknown) => parse(z.object({ commandId: z.uuid() }).passthrough(), q).commandId;
  app.get(`${base}/matters`, async (req) => {
    const commandId = cmdQuery(req.query);
    authorize(actorFromRequest(ctx, req), perm('correspondence', 'view'), commandScope(commandId));
    const rows = ctx.db.prepare(
      `SELECT m.*, COUNT(c.id) AS letter_count, MAX(COALESCE(c.letter_date, c.received_date, c.sent_date)) AS latest_date,
              SUM(CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END) AS pending_count
         FROM ofc_matter m LEFT JOIN ofc_correspondence c ON c.matter_id = m.id AND c.deleted_at IS NULL
         LEFT JOIN ofc_v_correspondence_pending p ON p.id = c.id
        WHERE m.command_id = ? AND m.deleted_at IS NULL GROUP BY m.id ORDER BY m.status, latest_date DESC, m.ref_no DESC`,
    ).all(commandId);
    return { items: (rows as Array<Record<string, unknown>>).map(toApi) };
  });
  app.post(`${base}/matters`, async (req, reply) => reply.status(201).send(toApi(createMatter(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/matters/:id`, async (req) => { const r = matterThread(actorFromRequest(ctx, req), idParam(req)); return { matter: toApi(r.matter), letters: r.letters.map(toApi) }; });
  app.patch(`${base}/matters/:id`, async (req) => toApi(updateMatter(actorFromRequest(ctx, req), idParam(req), req.body)));

  app.get(`${base}/correspondence`, async (req) => { const r = listCorrespondence(actorFromRequest(ctx, req), req.query); return { total: r.total, items: r.items.map(toApi) }; });
  app.post(`${base}/correspondence`, async (req, reply) => reply.status(201).send(toApi(createCorrespondence(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/correspondence/:id`, async (req) => {
    const r = getCorrespondence(actorFromRequest(ctx, req), idParam(req));
    return { ...toApi(r), replies: (r.replies as Array<Record<string, unknown>>).map(toApi) };
  });
  app.patch(`${base}/correspondence/:id`, async (req) => toApi(updateCorrespondence(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/correspondence/:id/status`, async (req) => toApi(setCorrespondenceStatus(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/correspondence/:id/no-reply`, async (req) => toApi(markNoReplyNeeded(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- handover
  app.get(`${base}/handovers`, async (req) => ({ items: listPackets(actorFromRequest(ctx, req), cmdQuery(req.query)).map(toApi) }));
  app.post(`${base}/handovers`, async (req, reply) => reply.status(201).send(toApi(createPacket(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/handovers/:id`, async (req) => toApi(getPacket(actorFromRequest(ctx, req), idParam(req))));
  app.patch(`${base}/handovers/:id`, async (req) => toApi(updatePacket(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.get(`${base}/handovers/:id/items`, async (req) => { const r = listItems(actorFromRequest(ctx, req), idParam(req), req.query); return { total: r.total, items: r.items.map(toApi) }; });
  app.post(`${base}/handovers/:id/items`, async (req, reply) => reply.status(201).send(toApi(createItem(actorFromRequest(ctx, req), idParam(req), req.body))));
  app.post(`${base}/handovers/:id/items/bulk`, { bodyLimit: 8_000_000 }, async (req) => bulkItems(actorFromRequest(ctx, req), idParam(req), req.body));
  app.get(`${base}/handovers/:id/report`, async (req) => {
    const r = handoverReport(actorFromRequest(ctx, req), idParam(req));
    return { ...r, packet: toApi(r.packet), attention: r.attention.map(toApi), byStatus: r.byStatus.map(toApi), byCategory: r.byCategory.map(toApi) };
  });
  app.get(`${base}/handover-items/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const r = mustGet(ctx.db, 'ofc_handover_item', idParam(req), 'Handover item');
    authorize(a, perm('handover', 'view'), commandScope(r.command_id as string));
    return toApi(r);
  });
  app.patch(`${base}/handover-items/:id`, async (req) => toApi(updateItem(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/handover-items/:id/actions`, async (req) => toApi(addItemAction(actorFromRequest(ctx, req), idParam(req), req.body)));
}
