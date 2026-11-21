/**
 * M15 Office management (SLE (E&T) II – North, OFFICE_R1_SPEC.md). Public surface: other modules import ONLY from here.
 * Day 1: office unit tree, record links, attachments, timeline, numbering, roles. Tasks, correspondence, handover,
 * personnel, equipment movements, supply demands, dashboard and reports follow (spec §6).
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { OFC_ENTITIES } from './entities.js';
import { OFC_PERMISSIONS } from './permissions.js';
import { mountOfficeRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  for (const d of OFC_ENTITIES) ctx.entities.register(d);
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...OFC_PERMISSIONS] } });
  mountOfficeRoutes(ctx, app);
}

export { OFC_PERMISSIONS, OFFICE_ROLES, perm as ofcPermission } from './permissions.js';
export { OFC_ENTITIES } from './entities.js';
export { OFC_API_PREFIX } from './routes.js';
export { OFFICE_SEQUENCES, ensureOfficeSequences, grantOfficeRanges } from './numbering.js';
export { getUnit, unitTree, unitAndDescendants, linksOf, attachmentsOf, timelineOf } from './queries.js';
export type { Actor as OfcActor } from './actor.js';
