import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { toCamel } from '../../platform/canonical.js';
import { AppError } from '../../platform/errors.js';
import { writeAudit } from '../../platform/records.js';
import { actorFromRequest, authorize } from './actor.js';
import type { Envelope } from './envelope.js';
import {
  decommissionPeer, exportBundle, freshness, getPeer, handleHello, handlePull, handlePush, hubPeer, httpTransport, importBundle, listConflicts, listPeers, listSessions, ProvisionInput,
  provisionPeer, resolveConflict, ResolveInput, retryQuarantined, scopesOf, setSubscription, status, syncOnce, type Transport,
} from './engine.js';
import { perm } from './permissions.js';

export const SYN_API_PREFIX = '/api/v1/sync';

const Env = z.object({ from: z.uuid(), sentAt: z.string().min(20).max(30), path: z.string().max(40), body: z.unknown(), signature: z.string().min(40).max(200) });
const camel = (r: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));
const parse = <T extends z.ZodType>(schema: T, v: unknown): z.infer<T> => {
  const r = schema.safeParse(v);
  if (!r.success) throw new AppError('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};

/** Tests replace how the replica reaches the hub (a direct call instead of HTTP). */
let transportOverride: ((ctx: AppContext) => Transport) | null = null;
export const setTransportOverride = (f: ((ctx: AppContext) => Transport) | null): void => { transportOverride = f; };

export function mountSyncRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = SYN_API_PREFIX;
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;

  // Peer endpoints: authenticated by installation signature, not by user session.
  app.post(`${base}/peer/hello`, async (req) => handleHello(ctx, parse(Env, req.body) as Envelope));
  app.post(`${base}/peer/push`, { bodyLimit: 16_000_000 }, async (req) => handlePush(ctx, parse(Env, req.body) as Envelope));
  app.post(`${base}/peer/pull`, async (req) => handlePull(ctx, parse(Env, req.body) as Envelope));

  app.get(`${base}/status`, async (req) => { authorize(actorFromRequest(ctx, req), perm('status', 'view')); return status(ctx); });
  app.get(`${base}/freshness`, async (req) => { authorize(actorFromRequest(ctx, req), perm('status', 'view')); return freshness(ctx); });

  app.get(`${base}/peers`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('peer', 'view'));
    return { items: (status(ctx).peers as unknown[]), nextCursor: null, freshness: [freshness(ctx)] };
  });
  app.post(`${base}/peers`, async (req, reply) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('peer', 'provision'));
    const pkg = provisionPeer(ctx, a.wctx, parse(ProvisionInput, req.body));
    writeAudit(a.wctx, { action: 'sync.provision', entityType: 'sys.installation', entityId: pkg.installation.installationId });
    return reply.status(201).header('cache-control', 'no-store').send(pkg);
  });
  app.post(`${base}/peers/:id/decommission`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('peer', 'decommission'));
    decommissionPeer(ctx, a.wctx, idParam(req));
    writeAudit(a.wctx, { action: 'sync.decommission', entityType: 'sys.installation', entityId: idParam(req) });
    return { ok: true };
  });
  app.put(`${base}/peers/:id/subscription`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('subscription', 'update'));
    const b = parse(z.strictObject({ scopes: z.array(z.strictObject({ kind: z.enum(['command', 'ship', 'workshop', 'department']), id: z.uuid() })).max(200), includeUnscopedHub: z.boolean() }), req.body);
    setSubscription(ctx, idParam(req), b.scopes, b.includeUnscopedHub);
    writeAudit(a.wctx, { action: 'sync.subscription', entityType: 'sys.installation', entityId: idParam(req) });
    return { scopes: scopesOf(ctx.db, idParam(req)), includeUnscopedHub: b.includeUnscopedHub };
  });

  app.post(`${base}/run`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('session', 'run'));
    const hub = hubPeer(ctx.db);
    if (!hub) throw new AppError('WORKFLOW_BLOCKED', 'This installation has not joined a hub');
    const b = parse(z.strictObject({ url: z.string().url().max(300).optional() }).default({}), req.body ?? {});
    if (b.url) ctx.db.prepare('UPDATE syn_peer SET url = ? WHERE installation_id = ?').run(b.url, hub.installation_id);
    const url = b.url ?? hub.url;
    const transport = transportOverride ? transportOverride(ctx) : url ? httpTransport(url) : null;
    if (!transport) throw new AppError('WORKFLOW_BLOCKED', 'No hub address is set. Give the hub URL, or exchange bundles instead');
    return syncOnce(ctx, transport);
  });
  app.get(`${base}/sessions`, async (req) => { authorize(actorFromRequest(ctx, req), perm('session', 'view')); return { items: listSessions(ctx.db).map(camel), nextCursor: null, freshness: [freshness(ctx)] }; });

  app.get(`${base}/conflicts`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('conflict', 'view'));
    const q = parse(z.strictObject({ status: z.enum(['open', 'resolved', 'dismissed']).optional() }), req.query);
    return { items: listConflicts(ctx.db, q.status).map((c) => camel(c)), nextCursor: null, freshness: [freshness(ctx)] };
  });
  app.post(`${base}/conflicts/:id/resolve`, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('conflict', 'resolve'));
    const r = resolveConflict(ctx, idParam(req), parse(ResolveInput, req.body), a.principal.userId);
    writeAudit({ ...a.wctx, reason: String(r.resolution) }, { action: 'sync.conflict.resolve', entityType: String(r.entity_type), entityId: String(r.entity_id) });
    return camel(r);
  });
  app.post(`${base}/conflicts/retry`, async (req) => { authorize(actorFromRequest(ctx, req), perm('conflict', 'resolve')); return retryQuarantined(ctx); });

  app.post(`${base}/bundles/export`, async (req, reply) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('bundle', 'export'));
    const b = parse(z.strictObject({ peerId: z.uuid().optional(), all: z.boolean().optional() }).default({}), req.body ?? {});
    const bundle = exportBundle(ctx, { ...(b.peerId ? { peerId: b.peerId } : {}), ...(b.all ? { all: true } : {}) });
    writeAudit(a.wctx, { action: 'sync.bundle.export', entityType: 'sys.installation', entityId: bundle.manifest.to });
    return reply.header('content-disposition', `attachment; filename="sync-${bundle.manifest.kind}-${bundle.manifest.createdAt.slice(0, 10)}.json"`).header('cache-control', 'no-store').send(bundle);
  });
  app.post(`${base}/bundles/import`, { bodyLimit: 128_000_000 }, async (req) => {
    const a = actorFromRequest(ctx, req);
    authorize(a, perm('bundle', 'import'));
    const r = importBundle(ctx, req.body);
    writeAudit(a.wctx, { action: 'sync.bundle.import', entityType: 'sys.installation', entityId: null });
    return r;
  });

  void getPeer; void listPeers;
}
