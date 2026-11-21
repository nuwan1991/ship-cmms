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
import { addDutyPeriod, addResponsibility, createPerson, dutyToday, endResponsibility, listPersons, personDetail, reassignAll, updatePerson } from './persons.js';
import { assignTask, cancelTask, closeTask, completeTask, createTask, getTask, listTasks, reopenTask, setTaskStatus, updateTask } from './tasks.js';
import { personOfUser } from './scope.js';
import { createEquipment, equipmentDetail, listEquipment, recordMovement, updateEquipment } from './equipment.js';
import {
  approveWorkOrder, assignWorkOrder, cancelWorkOrder, closeWorkOrder, completeWorkOrder, createWorkOrder, getWorkOrderDetail, listWorkOrders, reopenWorkOrder, setWorkOrderStatus,
  updateWorkOrder, verifyWorkOrder,
} from './workorders.js';
import { bulkDemands, createDemand, listDemands, setStage, setSupplyStages, supplyStages, updateDemand } from './supply.js';

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

  // ---- personnel
  app.get(`${base}/persons`, async (req) => {
    const q = parse(z.strictObject({ commandId: z.uuid(), includeInactive: z.enum(['true', 'false']).optional(), unitId: z.uuid().optional() }), req.query);
    const a = actorFromRequest(ctx, req);
    return { items: listPersons(a, q.commandId, { includeInactive: q.includeInactive === 'true', ...(q.unitId ? { unitId: q.unitId } : {}) }).map((p) => toApi({ ...p, duty_today: dutyToday(a, p) })) };
  });
  app.get(`${base}/persons/me`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const p = personOfUser(a, cmdQuery(req.query));
    return p ? toApi(p) : null;
  });
  app.post(`${base}/persons`, async (req, reply) => reply.status(201).send(toApi(createPerson(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/persons/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const d = personDetail(a, idParam(req));
    const m = (rs: Array<Record<string, unknown>>) => rs.map(toApi);
    return { person: toApi({ ...d.person, duty_today: dutyToday(a, d.person) }), responsibilities: m(d.responsibilities), duty: m(d.duty), tasks: m(d.tasks), formerly: m(d.formerly), handoverItems: m(d.handoverItems), correspondence: m(d.correspondence) };
  });
  app.patch(`${base}/persons/:id`, async (req) => toApi(updatePerson(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/persons/:id/responsibilities`, async (req, reply) => reply.status(201).send(toApi(addResponsibility(actorFromRequest(ctx, req), idParam(req), req.body))));
  app.post(`${base}/responsibilities/:id/end`, async (req) => toApi(endResponsibility(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/persons/:id/duty`, async (req, reply) => reply.status(201).send(toApi(addDutyPeriod(actorFromRequest(ctx, req), idParam(req), req.body))));
  app.post(`${base}/persons/:id/reassign`, async (req) => reassignAll(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- tasks
  app.get(`${base}/tasks`, async (req) => { const r = listTasks(actorFromRequest(ctx, req), req.query); return { total: r.total, items: r.items.map(toApi) }; });
  app.post(`${base}/tasks`, async (req, reply) => reply.status(201).send(toApi(createTask(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/tasks/:id`, async (req) => {
    const t = getTask(actorFromRequest(ctx, req), idParam(req));
    return { ...toApi(t), subtasks: (t.subtasks as Array<Record<string, unknown>>).map(toApi), source: t.source ? toApi(t.source as Record<string, unknown>) : null, parent: t.parent ? toApi(t.parent as Record<string, unknown>) : null };
  });
  app.patch(`${base}/tasks/:id`, async (req) => toApi(updateTask(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/assign`, async (req) => toApi(assignTask(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/status`, async (req) => toApi(setTaskStatus(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/complete`, async (req) => toApi(completeTask(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/close`, async (req) => toApi(closeTask(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/reopen`, async (req) => toApi(reopenTask(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/tasks/:id/cancel`, async (req) => toApi(cancelTask(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- equipment
  app.get(`${base}/equipment`, async (req) => { const r = listEquipment(actorFromRequest(ctx, req), req.query); return { total: r.total, items: r.items.map(toApi) }; });
  app.post(`${base}/equipment`, async (req, reply) => reply.status(201).send(toApi(createEquipment(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/equipment/:id`, async (req) => {
    const d = equipmentDetail(actorFromRequest(ctx, req), idParam(req));
    return { ...toApi(d.equipment), movements: d.movements.map(toApi), workOrders: d.workOrders.map(toApi), asset: d.asset };
  });
  app.patch(`${base}/equipment/:id`, async (req) => toApi(updateEquipment(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/equipment/:id/movements`, async (req) => toApi(recordMovement(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- office work orders
  app.get(`${base}/work-orders`, async (req) => { const r = listWorkOrders(actorFromRequest(ctx, req), req.query); return { total: r.total, items: r.items.map(toApi) }; });
  app.post(`${base}/work-orders`, async (req, reply) => reply.status(201).send(toApi(createWorkOrder(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/work-orders/:id`, async (req) => {
    const r = getWorkOrderDetail(actorFromRequest(ctx, req), idParam(req));
    return { ...toApi(r), equipment: r.equipment ? toApi(r.equipment as Record<string, unknown>) : null };
  });
  app.patch(`${base}/work-orders/:id`, async (req) => toApi(updateWorkOrder(actorFromRequest(ctx, req), idParam(req), req.body)));
  const woAct: Record<string, (a: ReturnType<typeof actorFromRequest>, id: string, body: unknown) => Record<string, unknown>> = {
    approve: approveWorkOrder, assign: assignWorkOrder, status: setWorkOrderStatus, complete: completeWorkOrder, verify: verifyWorkOrder, close: closeWorkOrder, reopen: reopenWorkOrder, cancel: cancelWorkOrder,
  };
  for (const [name, fn] of Object.entries(woAct)) app.post(`${base}/work-orders/:id/${name}`, async (req) => toApi(fn(actorFromRequest(ctx, req), idParam(req), req.body)));

  // ---- supply demands
  app.get(`${base}/supply`, async (req) => { const r = listDemands(actorFromRequest(ctx, req), req.query); return { total: r.total, stages: r.stages, items: r.items.map(toApi) }; });
  app.post(`${base}/supply`, async (req, reply) => reply.status(201).send(toApi(createDemand(actorFromRequest(ctx, req), req.body))));
  app.get(`${base}/supply/:id`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const r = mustGet(ctx.db, 'ofc_supply_demand', idParam(req), 'Supply demand');
    authorize(a, perm('supply', 'view'), commandScope(r.command_id as string));
    return toApi(r);
  });
  app.patch(`${base}/supply/:id`, async (req) => toApi(updateDemand(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/supply/:id/stage`, async (req) => toApi(setStage(actorFromRequest(ctx, req), idParam(req), req.body)));
  app.post(`${base}/supply/bulk`, { bodyLimit: 16_000_000 }, async (req) => bulkDemands(actorFromRequest(ctx, req), req.body));
  app.get(`${base}/settings/supply-stages`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const commandId = cmdQuery(req.query);
    authorize(a, perm('supply', 'view'), commandScope(commandId));
    return { stages: supplyStages(a, commandId) };
  });
  app.put(`${base}/settings/supply-stages`, async (req) => ({ stages: setSupplyStages(actorFromRequest(ctx, req), cmdQuery(req.query), req.body) }));
}
