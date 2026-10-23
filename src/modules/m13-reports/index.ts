/**
 * M13 public surface (MODULE_MAP). M13 imports no module: it reads only the published views (`<prefix>_v_*`) of the others, through SQL.
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { RPT_PERMISSIONS } from './permissions.js';
import { mountReportRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...RPT_PERMISSIONS] } });
  mountReportRoutes(ctx, app);
}

export { RPT_PERMISSIONS, perm as rptPermission } from './permissions.js';
export type { Actor as RptActor } from './actor.js';
export { RPT_API_PREFIX } from './routes.js';
export { REPORTS, runReport, dashboard, toCsv } from './reports.js';
export { refreshNotifications, listNotifications } from './notifications.js';
export { localFreshness } from './freshness.js';
