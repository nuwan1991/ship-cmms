/** HTTP routes for ship operational status and sea deployments (D66). Mounted under /api/v1/org by M01's register(). */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { toCamel } from '../../platform/canonical.js';
import { actorFromRequest, authorize } from './actor.js';
import {
  createDeployment, currentShipStatuses, getDeployment, recordShipStatus, shipStatusHistory, tombstoneDeployment, updateDeployment, voidShipStatus, type Row,
} from './operations.js';
import { getLive } from './queries.js';
import { parse } from './schemas.js';

const optId = z.uuid().optional();
const camel = (r: Row): Row => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));
/** Deployment list rows carry `id` (the record id) like every other collection, so generic screens can edit them. */
const deploymentOut = (r: Row): Row => {
  const c = camel(r);
  return { ...c, id: c.deploymentId };
};

export function mountOperationsRoutes(ctx: AppContext, app: FastifyInstance, base: string): void {
  const actor = (req: Parameters<typeof actorFromRequest>[1]) => actorFromRequest(ctx, req);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const freshness = (): Freshness[] => [{ scope: { kind: 'fleet' }, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 }];

  // ---- operational status
  app.get(`${base}/ship-status`, async (req) => {
    authorize(actor(req), 'org.ship_status.view', { kind: 'fleet' });
    // One row per ship, never paged; limit/cursor are accepted (list screens send them) and ignored.
    const { commandId, shipId } = parse(z.strictObject({ commandId: optId, shipId: optId, limit: z.coerce.number().int().min(1).max(500).optional(), cursor: z.string().max(64).optional() }), req.query);
    return { items: currentShipStatuses(ctx.db, { commandId, shipId }).map((r) => ({ ...r, id: r.shipId })), nextCursor: null, freshness: freshness() };
  });
  app.get(`${base}/ships/:id/status-history`, async (req) => {
    const id = idParam(req);
    if (!getLive(ctx.db, 'ship', id)) throw new AppError('NOT_FOUND', `ship ${id} not found`);
    authorize(actor(req), 'org.ship_status.view', { kind: 'ship', id });
    return shipStatusHistory(ctx.db, id);
  });
  app.post(`${base}/ships/:id/status`, async (req, reply) => reply.status(201).send(recordShipStatus(actor(req), idParam(req), req.body)));
  app.post(`${base}/ship-status-events/:id/void`, async (req) => voidShipStatus(actor(req), idParam(req), req.body));

  // ---- sea deployments
  app.get(`${base}/deployments`, async (req) => {
    authorize(actor(req), 'org.deployment.view', { kind: 'fleet' });
    const q = parse(
      z.strictObject({
        shipId: optId, commandId: optId, active: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().min(1).max(64).optional(),
      }),
      req.query,
    );
    const where: string[] = [];
    const p: unknown[] = [];
    if (q.shipId) { where.push('ship_id = ?'); p.push(q.shipId); }
    if (q.commandId) { where.push('command_id = ?'); p.push(q.commandId); }
    const now = new Date().toISOString();
    if (q.active === 'true') { where.push('sailed_at <= ? AND (returned_at IS NULL OR returned_at > ?)'); p.push(now, now); }
    // Newest first; the cursor is "sailed_at|id" of the last row.
    if (q.cursor) {
      const [s, i] = q.cursor.split('|');
      where.push('(sailed_at < ? OR (sailed_at = ? AND deployment_id < ?))');
      p.push(s, s, i);
    }
    const rows = ctx.db.prepare(`SELECT * FROM org_v_deployment ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sailed_at DESC, deployment_id DESC LIMIT ?`).all(...p, q.limit + 1) as Row[];
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return { items: page.map(deploymentOut), nextCursor: rows.length > q.limit && last ? `${String(last.sailed_at)}|${String(last.deployment_id)}` : null, freshness: freshness() };
  });
  app.post(`${base}/deployments`, async (req, reply) => reply.status(201).send(createDeployment(actor(req), req.body)));
  app.get(`${base}/deployments/:id`, async (req) => {
    const id = idParam(req);
    const d = getDeployment(ctx.db, id);
    if (!d) throw new AppError('NOT_FOUND', `deployment ${id} not found`);
    authorize(actor(req), 'org.deployment.view', { kind: 'ship', id: d.shipId as string });
    return { ...d, id };
  });
  app.patch(`${base}/deployments/:id`, async (req) => updateDeployment(actor(req), idParam(req), req.body));
  app.post(`${base}/deployments/:id/tombstone`, async (req) => tombstoneDeployment(actor(req), idParam(req), req.body));
}
