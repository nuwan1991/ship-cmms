import { join } from 'node:path';
import type { Config } from './app-context.js';
import { DEFAULT_DISPLAY_TZ } from './time.js';

/**
 * All configuration is environment-driven with offline-safe defaults.
 * The server binds to loopback unless CMMS_HOST is set (e.g. 0.0.0.0 for the ship LAN).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = env.CMMS_DATA_DIR ?? join(process.cwd(), 'data');
  return {
    dataDir,
    dbFile: env.CMMS_DB_FILE ?? join(dataDir, 'cmms.sqlite'),
    host: env.CMMS_HOST ?? '127.0.0.1',
    port: Number(env.CMMS_PORT ?? 8080),
    displayTimeZone: env.CMMS_DISPLAY_TZ ?? DEFAULT_DISPLAY_TZ,
    devAuth: env.CMMS_DEV_AUTH === '1',
  };
}
