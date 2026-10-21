import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './platform/app-context.js';
import { schemaVersions } from './platform/db/migrate.js';
import { AppError, toEnvelope } from './platform/errors.js';
import { uuidv7 } from './platform/ids.js';
import { MODULES } from './platform/modules.js';
import { nowUtc } from './platform/time.js';

/** HTTP shell: correlation ids, the shared error envelope, and /api/v1/system. Modules mount their own routes under their apiPrefix. */
export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: (req) => {
      const h = req.headers['x-correlation-id'];
      return typeof h === 'string' && /^[\w.-]{8,64}$/.test(h) ? h : uuidv7();
    },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send(toEnvelope(err, req.id));
    const e = err as { validation?: unknown; statusCode?: number; message?: string };
    if (e.validation || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)) {
      return reply.status(e.statusCode ?? 400).send(toEnvelope(new AppError('VALIDATION_FAILED', e.message ?? 'Invalid request'), req.id));
    }
    req.log.error(err);
    return reply.status(500).send(toEnvelope(err, req.id));
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send(toEnvelope(new AppError('NOT_FOUND', `No route ${req.method} ${req.url}`), req.id)),
  );

  app.get('/api/v1/system/health', async () => ({
    status: ctx.identity ? 'ok' : 'uninitialized',
    installation: ctx.identity,
    schemaVersions: schemaVersions(ctx.db),
    serverTime: nowUtc(),
    displayTimeZone: ctx.config.displayTimeZone,
    authorizer: ctx.authz.current().name,
  }));

  app.get('/api/v1/system/modules', async () => ({ modules: MODULES }));
  app.get('/api/v1/system/entities', async () => ({
    entities: ctx.entities.all().map((d) => ({ type: d.type, module: d.module, recordClass: d.recordClass, distribution: d.distribution })),
  }));

  return app;
}
