import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import type { Freshness, ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { makeActor, snapshotFor, type Actor } from './actor.js';
import { effectivePermissions, clockState, leaseInfo, resetClock } from './authority.js';
import { authorize } from './guard.js';
import { authenticate, changeOwnPassword, login, logout, resetLocalPassword, setCredential } from './auth.js';
import { evaluateGate, ratifyApproval, recordApproval } from './approvals.js';
import { perm, type PermissionCatalogue } from './permissions.js';
import * as S from './schemas.js';
import { RESOURCES, TABLES, createResource, createRevocation, setRolePermissions, tombstoneResource, toApi, updateResource, type Resource, type Row } from './service.js';

export const IDN_API_PREFIX = '/api/v1/identity';

const COLLECTIONS: Record<Resource, string> = {
  user: 'users', role: 'roles', role_permission: 'role-permissions', role_assignment: 'role-assignments',
  user_installation: 'user-installations', offline_grant: 'offline-grants', gate_policy: 'gate-policies',
};
const FILTERS: Record<Resource, Record<string, string>> = {
  user: { status: 'status' }, role: { status: 'status' }, role_permission: { roleId: 'role_id' },
  role_assignment: { userId: 'user_id', roleId: 'role_id', scopeKind: 'scope_kind', scopeId: 'scope_id' },
  user_installation: { userId: 'user_id', installationId: 'installation_id' },
  offline_grant: { installationId: 'installation_id', roleId: 'role_id' }, gate_policy: {},
};
const SEARCH: Partial<Record<Resource, string[]>> = { user: ['display_name', 'service_number'], role: ['code', 'name'], gate_policy: ['gate_code'] };

const freshnessFor = (ctx: AppContext): Freshness => ({ scope: { kind: 'fleet' } as ScopeRef, asOf: null, stale: ctx.identity?.kind !== 'hub', pendingOutbound: 0 });

/** Principal from the session hook; with CMMS_DEV_AUTH=1 and no session, a development user (the dev authorizer allows everything). */
export function actorFromRequest(ctx: AppContext, req: FastifyRequest): Actor {
  let principal = req.principal ?? null;
  if (!principal && ctx.config.devAuth) {
    const inst = ctx.identity ?? getLocalIdentity(ctx.db);
    if (inst) principal = { userId: 'dev-user', installationId: inst.installationId, displayName: 'Dev user' };
  }
  if (!principal) throw new AppError('UNAUTHENTICATED', 'Authentication required');
  return makeActor(ctx, principal, req.id);
}

const bearer = (req: FastifyRequest): string | null => {
  const h = req.headers.authorization;
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

function listRows(ctx: AppContext, r: Resource | 'approval' | 'revocation', rawQuery: unknown, extra: { filters?: Record<string, string>; search?: string[]; order?: string; where?: string[] } = {}) {
  const filters = extra.filters ?? (r === 'approval' || r === 'revocation' ? {} : FILTERS[r]);
  const schema = z.strictObject({
    limit: z.coerce.number().int().min(1).max(500).default(100), cursor: z.string().min(1).max(64).optional(), q: z.string().trim().min(1).max(60).optional(),
    ...Object.fromEntries(Object.keys(filters).map((k) => [k, z.string().min(1).max(80).optional()])),
  });
  const q = S.parse(schema, rawQuery) as Record<string, string | number | undefined> & { limit: number };
  const live = r === 'approval' || r === 'revocation' ? [] : ['deleted_at IS NULL'];
  const where = [...live, ...(extra.where ?? [])];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(filters)) if (q[param] !== undefined) { where.push(`${col} = ?`); params.push(q[param]); }
  const cols = extra.search ?? (r === 'approval' || r === 'revocation' ? [] : SEARCH[r] ?? []);
  if (q.q && cols.length) {
    where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) params.push(`%${String(q.q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  }
  const idCol = extra.order ?? 'id';
  if (q.cursor) { where.push(`${idCol} > ?`); params.push(q.cursor); }
  const table = r === 'approval' && extra.order ? 'idn_v_approval_status' : TABLES[r];
  const rows = ctx.db.prepare(`SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${idCol} LIMIT ?`).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  return { items: page.map(toApi), nextCursor: rows.length > q.limit ? String(page[page.length - 1]?.[idCol]) : null, freshness: [freshnessFor(ctx)] };
}

export function mountIdentityRoutes(ctx: AppContext, app: FastifyInstance, catalogue: PermissionCatalogue): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const base = IDN_API_PREFIX;
  const idParam = (req: { params: unknown }): string => S.parse(z.object({ id: z.uuid() }), req.params).id;

  // Authentication: a bearer token, when present, must be valid. Without one the request stays anonymous
  // (modules answer UNAUTHENTICATED; with CMMS_DEV_AUTH=1 a development user is used instead).
  app.addHook('onRequest', async (req) => {
    const token = bearer(req);
    if (token === null) return;
    const p = authenticate(ctx, token);
    if (!p) throw new AppError('UNAUTHENTICATED', 'Session expired or invalid; sign in again');
    req.principal = p;
  });

  // ---- sessions and self-service
  app.post(`${base}/login`, async (req) => login(ctx, req.body, req.id));
  app.post(`${base}/logout`, async (req) => { const t = bearer(req); if (t) logout(ctx, t); return { ok: true }; });

  app.get(`${base}/me`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const userId = a.principal.userId;
    const u = ctx.db.prepare('SELECT id, display_name, rank, service_number FROM idn_user WHERE id = ?').get(userId) as Row | undefined;
    const eff = effectivePermissions(ctx.db, userId, catalogue);
    const lease = leaseInfo(ctx.db, null, userId);
    const clock = clockState(ctx.db);
    return {
      user: u ? toApi(u) : { id: userId, displayName: a.principal.displayName },
      installation: ctx.identity ?? getLocalIdentity(ctx.db),
      snapshot: snapshotFor(ctx, userId),
      permissions: ctx.config.devAuth && !u ? catalogue.list() : eff.permissions,
      restrictedWhenOffline: eff.restricted,
      authority: { hub: !lease.applies, lastHubSyncAt: lease.lastHubSyncAt, leaseDays: lease.leaseDays, leaseExpiresAt: lease.leaseExpiresAt, expired: lease.expired },
      clock: { highWater: clock.highWater, suspect: clock.suspect },
    };
  });
  app.post(`${base}/me/password`, async (req) => changeOwnPassword(actorFromRequest(ctx, req), ctx, req.body));
  app.get(`${base}/permissions`, async (req) => { authorize(actorFromRequest(ctx, req), perm('role_permission', 'view')); return { permissions: catalogue.list() }; });

  // ---- reference data (hub-written)
  for (const r of RESOURCES) {
    const path = `${base}/${COLLECTIONS[r]}`;
    app.get(path, async (req) => { authorize(actorFromRequest(ctx, req), perm(r, 'view')); return listRows(ctx, r, req.query); });
    app.get(`${path}/:id`, async (req) => {
      authorize(actorFromRequest(ctx, req), perm(r, 'view'));
      const row = ctx.db.prepare(`SELECT * FROM ${TABLES[r]} WHERE id = ? AND deleted_at IS NULL`).get(idParam(req)) as Row | undefined;
      if (!row) throw new AppError('NOT_FOUND', `${r} not found`);
      return toApi(row);
    });
    app.post(path, async (req, reply) => reply.status(201).send(createResource(actorFromRequest(ctx, req), r, req.body)));
    app.patch(`${path}/:id`, async (req) => updateResource(actorFromRequest(ctx, req), ctx, r, idParam(req), req.body));
    app.post(`${path}/:id/tombstone`, async (req) => tombstoneResource(actorFromRequest(ctx, req), r, idParam(req), req.body));
  }
  app.put(`${base}/roles/:id/permissions`, async (req) => setRolePermissions(actorFromRequest(ctx, req), idParam(req), req.body));

  // ---- credentials
  app.get(`${base}/users/:id/credential`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('credential', 'view'));
    const c = ctx.db.prepare('SELECT * FROM idn_credential WHERE user_id = ? AND deleted_at IS NULL').get(idParam(req)) as Row | undefined;
    if (!c) throw new AppError('NOT_FOUND', 'No credential for this user');
    return toApi(c);
  });
  app.put(`${base}/users/:id/credential`, async (req) => setCredential(actorFromRequest(ctx, req), ctx, idParam(req), req.body));
  app.post(`${base}/users/:id/credential/reset-local`, async (req) => { await resetLocalPassword(actorFromRequest(ctx, req), ctx, idParam(req), req.body); return { ok: true }; });

  // ---- revocations
  app.post(`${base}/revocations`, async (req, reply) => reply.status(201).send(createRevocation(actorFromRequest(ctx, req), ctx, req.body)));
  app.get(`${base}/revocations`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('revocation', 'view'));
    return listRows(ctx, 'revocation', req.query, { filters: { userId: 'user_id' } });
  });

  // ---- approvals and gates
  app.post(`${base}/approvals`, async (req, reply) => {
    const a = actorFromRequest(ctx, req);
    const b = S.parse(S.ApprovalCreate, req.body);
    const out = recordApproval(ctx, { gateCode: b.gateCode, subject: b.subject, decision: b.decision, principal: a.principal, decidedAt: b.decidedAt ?? nowUtc(), ...(b.comment ? { comment: b.comment } : {}) }, req.id);
    return reply.status(201).send(out);
  });
  app.get(`${base}/approvals`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('approval', 'view'));
    return listRows(ctx, 'approval', req.query, { filters: { gateCode: 'gate_code', subjectType: 'subject_type', subjectId: 'subject_id', actorUserId: 'actor_user_id' }, order: 'approval_id' });
  });
  app.get(`${base}/approvals/review-queue`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('approval', 'view'));
    return listRows(ctx, 'approval', req.query, { filters: { gateCode: 'gate_code' }, order: 'approval_id', where: ['needs_review = 1'] });
  });
  app.post(`${base}/approvals/:id/ratify`, async (req, reply) => {
    const body = S.parse(S.Ratify, req.body ?? {});
    return reply.status(201).send(toApi(ratifyApproval(actorFromRequest(ctx, req), ctx, idParam(req), body.comment)));
  });
  app.get(`${base}/gates/evaluate`, async (req) => {
    authorize(actorFromRequest(ctx, req), perm('approval', 'view'));
    const q = S.parse(z.strictObject({ gateCode: z.string(), subjectType: z.string(), subjectId: z.uuid() }), req.query);
    return evaluateGate(ctx, q.gateCode, { type: q.subjectType, id: q.subjectId });
  });

  // ---- clock safety
  app.post(`${base}/clock/reset`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const { reason } = S.parse(S.ClockReset, req.body);
    authorize(a, 'idn.clock.reset');
    const before = clockState(ctx.db);
    resetClock(ctx.db, nowUtc());
    writeAudit({ ...a.wctx, reason }, { action: 'clock.reset', entityType: 'idn.clock', changes: { highWater: [before.highWater, nowUtc()] } });
    return { highWater: nowUtc(), wasSuspect: before.suspect };
  });
}
