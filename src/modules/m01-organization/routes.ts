import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { Freshness, PartyRef, type ScopeRef } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { isUtcIso } from '../../platform/time.js';
import { actorFromRequest, authorize, type Actor } from './actor.js';
import { perm, type OrgNoun } from './permissions.js';
import { getLive, getLocation, getShipCommandAt, resolveParty, TABLES, toApi, type Row } from './queries.js';
import { parse } from './schemas.js';
import { createEntity, reassignShip, tombstoneEntity, updateEntity } from './service.js';

export const ORG_API_PREFIX = '/api/v1/org';

/** REST collection name (kebab-case plural) per resource. */
const COLLECTIONS: Record<OrgNoun, string> = {
  fleet: 'fleets',
  command: 'commands',
  ship: 'ships',
  ship_command_assignment: 'ship-command-assignments',
  department: 'departments',
  workshop: 'workshops',
  external_provider: 'external-providers',
  location: 'locations',
};

/** Extra equality filters accepted by each list endpoint (query param -> column). */
const FILTERS: Record<OrgNoun, Record<string, string>> = {
  fleet: {},
  command: { status: 'status' },
  ship: { status: 'status', fleetId: 'fleet_id', commandId: 'v.command_id' }, // v.* = org_v_ship_current_command
  ship_command_assignment: { shipId: 'ship_id', commandId: 'command_id' },
  department: { status: 'status' },
  workshop: { status: 'status', kind: 'kind', commandId: 'command_id', shipId: 'ship_id' },
  external_provider: { status: 'status' },
  location: { status: 'status', kind: 'kind', siteId: 'home_scope_id', parentId: 'parent_id' },
};
const SEARCH_COLUMNS: Partial<Record<OrgNoun, string[]>> = {
  command: ['code', 'name'], ship: ['code', 'name', 'pennant_no'], department: ['code', 'name'],
  workshop: ['code', 'name'], external_provider: ['code', 'name'], location: ['code', 'name'], fleet: ['code', 'name'],
};

/** Placeholder until M10 supplies real sync state: hub data is authoritative; anything else has never synchronized. */
function freshnessFor(ctx: AppContext, scope: ScopeRef): Freshness {
  const hub = ctx.identity?.kind === 'hub';
  return { scope, asOf: null, stale: !hub, pendingOutbound: 0 };
}

function listQuerySchema(noun: OrgNoun) {
  const filters = Object.fromEntries(Object.keys(FILTERS[noun]).map((k) => [k, z.string().min(1).max(64).optional()]));
  return z.strictObject({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(60).optional(),
    ...filters,
  });
}

function listRows(a: Actor, ctx: AppContext, noun: OrgNoun, rawQuery: unknown) {
  const q = parse(listQuerySchema(noun), rawQuery) as Record<string, string | number | undefined> & { limit: number };
  const t = 't';
  const where = [`${t}.deleted_at IS NULL`];
  const params: unknown[] = [];
  for (const [param, col] of Object.entries(FILTERS[noun])) {
    const v = q[param];
    if (v === undefined) continue;
    if (v === 'root' && col === 'parent_id') where.push(`${t}.parent_id IS NULL`);
    else {
      where.push(`${col.includes('.') ? col : `${t}.${col}`} = ?`);
      params.push(v);
    }
  }
  if (q.q) {
    const cols = SEARCH_COLUMNS[noun] ?? ['code'];
    where.push(`(${cols.map((c) => `${t}.${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const like = `%${String(q.q).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    for (let i = 0; i < cols.length; i++) params.push(like);
  }
  if (q.cursor) {
    where.push(`${t}.id > ?`);
    params.push(q.cursor);
  }
  const ship = noun === 'ship';
  const sql = ship
    ? `SELECT t.*, v.command_id AS cur_command_id, v.command_code AS cur_command_code, v.command_name AS cur_command_name, v.assigned_since AS cur_assigned_since
       FROM org_ship t LEFT JOIN org_v_ship_current_command v ON v.ship_id = t.id WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ?`
    : `SELECT t.* FROM ${TABLES[noun]} t WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ?`;
  const rows = a.wctx.db.prepare(sql).all(...params, q.limit + 1) as Row[];
  const page = rows.slice(0, q.limit);
  const items = page.map((r) => {
    if (!ship) return toApi(r);
    const { cur_command_id, cur_command_code, cur_command_name, cur_assigned_since, ...rest } = r;
    return {
      ...toApi(rest),
      currentCommand: cur_command_id ? { commandId: cur_command_id, code: cur_command_code, name: cur_command_name, assignedSince: cur_assigned_since } : null,
    };
  });
  const scope: ScopeRef = noun === 'location' && typeof q.siteId === 'string' ? { kind: 'ship', id: q.siteId } : { kind: 'fleet' };
  return {
    items,
    nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id as string) : null,
    freshness: [freshnessFor(ctx, scope)],
  };
}

export function mountOrgRoutes(ctx: AppContext, app: FastifyInstance): void {
  if (!app.hasRequestDecorator('principal')) app.decorateRequest('principal', null);
  const idParam = (req: { params: unknown }): string => parse(z.object({ id: z.uuid() }), req.params).id;
  const base = ORG_API_PREFIX;

  for (const noun of Object.keys(COLLECTIONS) as OrgNoun[]) {
    const path = `${base}/${COLLECTIONS[noun]}`;

    app.get(path, async (req) => {
      const a = actorFromRequest(ctx, req);
      authorize(a, perm(noun, 'view'), noun === 'location' ? undefined : { kind: 'fleet' });
      return listRows(a, ctx, noun, req.query);
    });

    app.get(`${path}/:id`, async (req) => {
      const a = actorFromRequest(ctx, req);
      const id = idParam(req);
      const row = getLive(ctx.db, noun, id);
      if (!row) throw new AppError('NOT_FOUND', `${noun} ${id} not found`);
      authorize(a, perm(noun, 'view'), noun === 'location' ? { kind: row.site_kind === 'workshop' ? 'workshop' : 'ship', id: row.home_scope_id as string } : undefined);
      const out = toApi(row);
      return noun === 'location' ? { ...out, path: getLocation(ctx.db, id)?.path ?? [] } : out;
    });

    app.post(path, async (req, reply) => reply.status(201).send(createEntity(actorFromRequest(ctx, req), noun, req.body)));
    app.patch(`${path}/:id`, async (req) => updateEntity(actorFromRequest(ctx, req), noun, idParam(req), req.body));
    app.post(`${path}/:id/tombstone`, async (req) => tombstoneEntity(actorFromRequest(ctx, req), noun, idParam(req), req.body));
  }

  // Ship ↔ command attachment helpers.
  app.post(`${base}/ships/:id/reassign`, async (req) => {
    const id = idParam(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    return reassignShip(actorFromRequest(ctx, req), { ...body, shipId: id });
  });

  app.get(`${base}/ships/:id/command`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const id = idParam(req);
    const { at } = parse(z.strictObject({ at: z.string().optional() }), req.query);
    if (at !== undefined && !isUtcIso(at)) throw new AppError('VALIDATION_FAILED', 'at must be a UTC instant like 2026-10-21T17:59:00.000Z');
    if (!getLive(ctx.db, 'ship', id)) throw new AppError('NOT_FOUND', `ship ${id} not found`);
    authorize(a, perm('ship_command_assignment', 'view'), { kind: 'ship', id });
    const found = getShipCommandAt(ctx.db, id, at);
    const command = found ? getLive(ctx.db, 'command', found.commandId) : undefined;
    return { shipId: id, at: at ?? null, assignment: found, command: command ? toApi(command) : null };
  });

  // PartyRef resolution (ownership / operating / executing party display).
  app.get(`${base}/parties/resolve`, async (req) => {
    const a = actorFromRequest(ctx, req);
    const ref = parse(PartyRef, req.query);
    const noun = ref.kind === 'external_provider' ? 'external_provider' : (ref.kind as OrgNoun);
    authorize(a, perm(noun, 'view'), { kind: 'fleet' });
    const r = resolveParty(ctx.db, ref);
    if (!r) throw new AppError('NOT_FOUND', `${ref.kind} ${ref.id} not found`);
    return r;
  });

}
