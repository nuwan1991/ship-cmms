import { boot } from './boot.js';
import { loadConfig } from './platform/config.js';

const config = loadConfig();
const { ctx, app } = boot(config);

await app.listen({ host: config.host, port: config.port });
console.log(`CMMS listening on ${config.host}:${config.port} (${ctx.identity ? ctx.identity.code : 'uninitialized'})`);
