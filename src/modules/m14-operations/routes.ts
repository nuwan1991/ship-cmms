import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { toCamel } from '../../platform/canonical.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../../platform/records.js';
import { actorFromRequest, authorize } from './actor.js';
import { createBackup, listBackups, verifyBackupById } from './backup.js';
import { listChecks, runIntegrity } from './integrity.js';
import { perm } from './permissions.js';
import { opsStatus } from './status.js';

export const OPS_API_PREFIX = '/api/v1/ops';
const camel = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export function mountOpsRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = OPS_API_PREFIX;
  const idParam = (req: { params: unknown }): string => {
    const r = z.object({ id: z.uuid() }).safeParse(req.params);
    if (!r.success) throw new AppError('VALIDATION_FAILED', 'id must be a UUID');
    return r.data.id;
  };

  app.get(`${base}/status`, async (req) => { authorize(actorFromRequest(ctx, req), perm('status', 'view')); return opsStatus(ctx); });

  app.get(`${base}/backups`, async (req) => { authorize(actorFromRequest(ctx, req), perm('backup', 'view')); return { items: listBackups(ctx.db).map(camel), nextCursor: null, freshness: [] }; });
  app.post(`${base}/backups`, async (req, reply) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('backup', 'create'));
    const m = createBackup(ctx, 'manual', a.principal.userId);
    writeAudit(a.wctx, { action: 'ops.backup.create', entityType: 'sys.installation', entityId: ctx.identity?.installationId ?? null });
    return reply.status(201).send(m);
  });
  app.post(`${base}/backups/:id/verify`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('backup', 'verify'));
    return verifyBackupById(ctx, idParam(req));
  });

  app.get(`${base}/integrity`, async (req) => { authorize(actorFromRequest(ctx, req), perm('integrity', 'view')); return { items: listChecks(ctx).map(camel), nextCursor: null, freshness: [] }; });
  app.post(`${base}/integrity`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('integrity', 'run'));
    return runIntegrity(ctx, a.principal.userId);
  });
}
