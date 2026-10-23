/**
 * M14 public surface (MODULE_MAP). M14 imports no module: it works on the database file, the entity registry and the published views.
 * Restore and the installer are command-line actions on the stopped application (src/ops-cli.ts).
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../platform/app-context.js';
import { nowUtc } from '../../platform/time.js';
import { OPS_PERMISSIONS } from './permissions.js';
import { mountOpsRoutes } from './routes.js';

export function register(ctx: AppContext, app: FastifyInstance): void {
  ctx.events.publish({ type: 'sys.permissions.declared', occurredAt: nowUtc(), payload: { codes: [...OPS_PERMISSIONS] } });
  mountOpsRoutes(ctx, app);
}

export { OPS_PERMISSIONS, perm as opsPermission } from './permissions.js';
export type { Actor as OpsActor } from './actor.js';
export { OPS_API_PREFIX } from './routes.js';
export { createBackup, verifyBackupFile, verifyBackupById, restoreBackup, upgradeWithBackup, pruneScheduled, listBackups, backupDirOf, writeBackupFile, filesOnDisk } from './backup.js';
export { runIntegrity, listChecks } from './integrity.js';
export { opsStatus } from './status.js';
export { startBackupScheduler } from './scheduler.js';
