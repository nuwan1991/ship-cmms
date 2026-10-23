import type { AppContext } from '../../platform/app-context.js';
import { createBackup, pruneScheduled } from './backup.js';

/**
 * Automatic backups while the application runs. Interval and number kept come from CMMS_BACKUP_EVERY_HOURS (default 24, 0 = off) and CMMS_BACKUP_KEEP (default 14).
 * A backup is only taken when the newest one is older than the interval, so restarting the application does not make extra copies.
 */
export function startBackupScheduler(ctx: AppContext, env: NodeJS.ProcessEnv = process.env, onError: (e: unknown) => void = (e) => console.error('Scheduled backup failed:', e)): () => void {
  const everyH = Number(env.CMMS_BACKUP_EVERY_HOURS ?? 24);
  const keep = Number(env.CMMS_BACKUP_KEEP ?? 14);
  if (!(everyH > 0) || ctx.config.dbFile === ':memory:') return () => undefined;
  const tick = (): void => {
    try {
      const last = ctx.db.prepare('SELECT created_at FROM ops_backup_log WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 1').get() as { created_at: string } | undefined;
      if (!last || Date.now() - Date.parse(last.created_at) >= everyH * 3_600_000) {
        createBackup(ctx, 'scheduled', 'system');
        pruneScheduled(ctx, keep);
      }
    } catch (e) { onError(e); }
  };
  const first = setTimeout(tick, 30_000);
  const timer = setInterval(tick, Math.min(everyH * 3_600_000, 3_600_000));
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
