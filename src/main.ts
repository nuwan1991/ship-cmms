import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { boot } from './boot.js';
import { startBackupScheduler } from './modules/m14-operations/index.js';
import { loadConfig } from './platform/config.js';
import { mountStatic } from './static.js';

const config = loadConfig();
const { ctx, app } = boot(config);

// The built web app (npm run web:build) is served by the same process unless CMMS_WEB_DIR points elsewhere or is set to "off".
const webDir = process.env.CMMS_WEB_DIR ?? join(process.cwd(), 'web', 'dist');
const serving = webDir !== 'off' && existsSync(webDir) && mountStatic(app, webDir);
const stopBackups = startBackupScheduler(ctx);

await app.listen({ host: config.host, port: config.port });
console.log(`CMMS listening on ${config.host}:${config.port} (${ctx.identity ? ctx.identity.code : 'uninitialized'})${serving ? ', web app served' : ', API only'}`);

const shutdown = (signal: string): void => {
  console.log(`${signal}: shutting down`);
  stopBackups();
  void app.close().then(() => { ctx.db.close(); process.exit(0); });
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
