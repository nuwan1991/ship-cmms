/** The sync engine: provisioning, the hub endpoints, the replica client, bundles and conflict handling (SYNC_RULES §1-§9). */
import { z } from 'zod';
import type { AppContext } from '../../platform/app-context.js';
import { canonicalJson, payloadHash } from '../../platform/canonical.js';
import type { Freshness, SyncChange } from '../../platform/contracts.js';
import { schemaVersions } from '../../platform/db/migrate.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity, setLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { createRecord, updateRecord, type WriteContext } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { applyChange, type Outcome, type Source } from './apply.js';
import { signEnvelope, verifyEnvelope, type Envelope } from './envelope.js';
import { ensureLocalKey, newSecret, secretHash, secretMatches, signText, verifyText } from './keys.js';

export const MAX_BATCH = 500;
export const MAX_BATCH_BYTES = 5_000_000;
export const SKEW_WARN_MS = 5 * 60_000;
export const APPLIED_EVENT = 'sys.sync.applied';

export interface Peer {
  installation_id: string; role: 'hub' | 'replica'; kind: string; code: string; name: string; status: 'pending' | 'active' | 'decommissioned';
  public_key_pem: string | null; enrol_secret_hash: string | null; enrol_secret: string | null; sub_epoch: number; url: string | null; push_cursor: number; pull_cursor: number;
  accepted_origin_seq: number; audience_seq: number; include_unscoped_hub: number; last_sync_at: string | null; last_skew_ms: number | null; created_at: string;
}
export interface Scope { kind: 'command' | 'ship' | 'workshop' | 'department'; id: string }
export interface Tally { accepted: number; duplicates: number; rejected: number; quarantined: number }
export interface ChangeResult { changeId: string; status: Outcome['status']; code?: string; message?: string }
type Row = Record<string, unknown>;

const identityOf = (ctx: AppContext) => {
  const i = ctx.identity ?? getLocalIdentity(ctx.db);
  if (!i) throw new AppError('WORKFLOW_BLOCKED', 'This installation is not initialized');
  return i;
};
const requireHub = (ctx: AppContext) => { const i = identityOf(ctx); if (i.kind !== 'hub') throw new AppError('WORKFLOW_BLOCKED', 'Only the hub does this'); return i; };
const requireReplica = (ctx: AppContext) => { const i = identityOf(ctx); if (i.kind === 'hub') throw new AppError('WORKFLOW_BLOCKED', 'The hub does not sync upwards'); return i; };

export const getPeer = (db: Db, id: string): Peer | undefined => db.prepare('SELECT * FROM syn_peer WHERE installation_id = ?').get(id) as Peer | undefined;
export const hubPeer = (db: Db): Peer | undefined => db.prepare("SELECT * FROM syn_peer WHERE role = 'hub'").get() as Peer | undefined;
export const listPeers = (db: Db): Peer[] => db.prepare('SELECT * FROM syn_peer ORDER BY code').all() as Peer[];
export const scopesOf = (db: Db, peerId: string): Scope[] =>
  (db.prepare('SELECT scope_kind, scope_id FROM syn_subscription WHERE peer_installation_id = ? ORDER BY scope_id').all(peerId) as Array<{ scope_kind: Scope['kind']; scope_id: string }>).map((r) => ({ kind: r.scope_kind, id: r.scope_id }));
const maxLocalSeq = (db: Db): number => (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM sys_change_log').get() as { m: number }).m;

// ---------------------------------------------------------------- provisioning

export interface ProvisioningPackage {
  format: 1;
  hub: { installationId: string; code: string; name: string; publicKeyPem: string; url: string | null };
  installation: { installationId: string; kind: 'command' | 'ship' | 'workshop'; code: string; name: string };
  enrolmentSecret: string;
  scopes: Scope[];
}

export const ProvisionInput = z.strictObject({
  kind: z.enum(['command', 'ship', 'workshop']),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/, 'Code is 2-20 capitals, digits, - or _'),
  name: z.string().trim().min(1).max(160),
  scopes: z.array(z.strictObject({ kind: z.enum(['command', 'ship', 'workshop', 'department']), id: z.uuid() })).max(200).default([]),
  includeUnscopedHub: z.boolean().default(true),
  hubUrl: z.string().url().max(300).nullish(),
});

/** Hub: register a new installation and produce the package that provisions it. The package holds a one-time secret: hand it over securely. */
export function provisionPeer(ctx: AppContext, w: WriteContext, input: z.infer<typeof ProvisionInput>): ProvisioningPackage {
  const hub = requireHub(ctx);
  if (getPeer(ctx.db, hub.installationId)) throw new AppError('VALIDATION_FAILED', 'Unexpected peer row for the hub');
  if (ctx.db.prepare('SELECT 1 FROM syn_peer WHERE code = ?').get(input.code) || ctx.db.prepare('SELECT 1 FROM sys_installation WHERE code = ?').get(input.code)) {
    throw new AppError('DUPLICATE', `Installation code ${input.code} is already used`);
  }
  const hubKey = ensureLocalKey(ctx.db);
  const secret = newSecret();
  return ctx.db.transaction(() => {
    const first = input.scopes.find((s) => s.kind === input.kind);
    const inst = createRecord(w, 'sys.installation', { kind: input.kind, code: input.code, name: input.name, status: 'active', org_unit_kind: first?.kind ?? null, org_unit_id: first?.id ?? null });
    const id = inst.id as string;
    ctx.db.prepare(
      `INSERT INTO syn_peer (installation_id, role, kind, code, name, status, enrol_secret_hash, url, include_unscoped_hub, created_at) VALUES (?, 'replica', ?, ?, ?, 'pending', ?, NULL, ?, ?)`,
    ).run(id, input.kind, input.code, input.name, secretHash(secret), input.includeUnscopedHub ? 1 : 0, nowUtc());
    for (const s of input.scopes) ctx.db.prepare('INSERT OR IGNORE INTO syn_subscription (peer_installation_id, scope_kind, scope_id) VALUES (?, ?, ?)').run(id, s.kind, s.id);
    return {
      format: 1 as const,
      hub: { installationId: hub.installationId, code: hub.code, name: hub.name, publicKeyPem: hubKey.publicPem, url: input.hubUrl ?? null },
      installation: { installationId: id, kind: input.kind, code: input.code, name: input.name },
      enrolmentSecret: secret,
      scopes: input.scopes,
    };
  })();
}

/** Replica: become the installation described by the package (run once on a freshly migrated, uninitialized database). */
export function joinHub(ctx: AppContext, pkg: ProvisioningPackage, url?: string): { installationId: string } {
  if (pkg.format !== 1) throw new AppError('VALIDATION_FAILED', 'Unknown package format');
  if (getLocalIdentity(ctx.db)) throw new AppError('WORKFLOW_BLOCKED', 'This installation is already initialized. Never re-provision one that has unsent changes');
  ctx.db.transaction(() => {
    const id = setLocalIdentity(ctx.db, { kind: pkg.installation.kind, code: pkg.installation.code, name: pkg.installation.name, installationId: pkg.installation.installationId });
    ctx.identity = id;
    ensureLocalKey(ctx.db);
    ctx.db.prepare(
      `INSERT INTO syn_peer (installation_id, role, kind, code, name, status, public_key_pem, enrol_secret, url, created_at) VALUES (?, 'hub', 'hub', ?, ?, 'active', ?, ?, ?, ?)`,
    ).run(pkg.hub.installationId, pkg.hub.code, pkg.hub.name, pkg.hub.publicKeyPem, pkg.enrolmentSecret, url ?? pkg.hub.url ?? null, nowUtc());
  })();
  return { installationId: pkg.installation.installationId };
}

export function setSubscription(ctx: AppContext, peerId: string, scopes: Scope[], includeUnscopedHub: boolean): void {
  requireHub(ctx);
  const peer = getPeer(ctx.db, peerId);
  if (!peer || peer.role !== 'replica') throw new AppError('NOT_FOUND', 'No such installation');
  ctx.db.transaction(() => {
    const before = new Set(scopesOf(ctx.db, peerId).map((s) => s.id));
    const grew = scopes.some((s) => !before.has(s.id)) || (includeUnscopedHub && !peer.include_unscoped_hub);
    ctx.db.prepare('DELETE FROM syn_subscription WHERE peer_installation_id = ?').run(peerId);
    for (const s of scopes) ctx.db.prepare('INSERT OR IGNORE INTO syn_subscription (peer_installation_id, scope_kind, scope_id) VALUES (?, ?, ?)').run(peerId, s.kind, s.id);
    ctx.db.prepare('UPDATE syn_peer SET include_unscoped_hub = ?, sub_epoch = sub_epoch + ? WHERE installation_id = ?').run(includeUnscopedHub ? 1 : 0, grew ? 1 : 0, peerId);
  })();
}

export function decommissionPeer(ctx: AppContext, w: WriteContext, peerId: string): void {
  requireHub(ctx);
  const peer = getPeer(ctx.db, peerId);
  if (!peer || peer.role !== 'replica') throw new AppError('NOT_FOUND', 'No such installation');
  ctx.db.transaction(() => {
    ctx.db.prepare("UPDATE syn_peer SET status = 'decommissioned' WHERE installation_id = ?").run(peerId);
    const inst = ctx.db.prepare('SELECT version FROM sys_installation WHERE id = ?').get(peerId) as { version: number } | undefined;
    if (inst) updateRecord(w, 'sys.installation', peerId, inst.version, { status: 'decommissioned' });
  })();
}

// ---------------------------------------------------------------- selecting what a replica should receive

function toChange(r: Row): SyncChange {
  return {
    changeId: r.change_id as string, originInstallationId: r.origin_installation_id as string, entityType: r.entity_type as string, entityId: r.entity_id as string,
    op: r.op as SyncChange['op'], version: r.version as number, ownerInstallationId: r.owner_installation_id as string, homeScopeId: (r.home_scope_id as string | null) ?? null,
    occurredAt: r.occurred_at as string, schemaVersion: r.schema_version as number, payload: JSON.parse(r.payload as string) as Record<string, unknown>, payloadHash: r.payload_hash as string,
  };
}

function audienceIncludes(ctx: AppContext, a: NonNullable<ReturnType<AppContext['entities']['get']>['audience']>, payload: Row, peerId: string): boolean {
  if ('installationColumn' in a) return payload[a.installationColumn] === peerId;
  const via = ctx.entities.get(a.viaType);
  const key = payload[a.column];
  if (typeof key !== 'string') return false;
  return !!ctx.db.prepare(`SELECT 1 FROM ${via.table} WHERE ${a.viaColumn} = ? AND ${a.viaInstallationColumn} = ? AND deleted_at IS NULL LIMIT 1`).get(key, peerId);
}

/**
 * Users provisioned to an installation arrive after the rest. When a new link to this installation appears in the log, everything is sent again from the
 * start (the receiver ignores what it already has), so credentials written before the link still reach it. Returns true when the peer's epoch moved.
 */
function refreshAudience(ctx: AppContext, peer: Peer): boolean {
  const linkTypes = ctx.entities.all().filter((d) => d.audience && 'installationColumn' in d.audience);
  let latest = 0;
  for (const d of linkTypes) {
    const col = (d.audience as { installationColumn: string }).installationColumn;
    const r = ctx.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM sys_change_log WHERE entity_type = ? AND json_extract(payload, '$.' || ?) = ?`).get(d.type, col, peer.installation_id) as { m: number };
    latest = Math.max(latest, r.m);
  }
  if (latest > peer.audience_seq) {
    ctx.db.prepare('UPDATE syn_peer SET audience_seq = ?, sub_epoch = sub_epoch + 1 WHERE installation_id = ?').run(latest, peer.installation_id);
    return true;
  }
  return false;
}

/**
 * A change reaches a replica when it is fleet reference data, belongs to a subscribed scope, or is hub-authored mutable data with no scope (shared central data).
 * What the replica itself sent is never sent back.
 */
export function selectForPeer(ctx: AppContext, peer: Peer, cursor: number, limit = MAX_BATCH, maxBytes = MAX_BATCH_BYTES): { changes: SyncChange[]; nextCursor: number; more: boolean; hubMax: number } {
  const hub = identityOf(ctx);
  const scopes = new Set(scopesOf(ctx.db, peer.installation_id).map((s) => s.id));
  const out: SyncChange[] = [];
  let bytes = 0, next = cursor, full = false;
  const hubMax = maxLocalSeq(ctx.db);
  while (!full) {
    const rows = ctx.db.prepare('SELECT * FROM sys_change_log WHERE seq > ? ORDER BY seq LIMIT 2000').all(next) as Row[];
    if (rows.length === 0) break;
    for (const r of rows) {
      next = r.seq as number;
      if (r.origin_installation_id === peer.installation_id || r.received_from_installation_id === peer.installation_id) continue;
      if (!ctx.entities.has(r.entity_type as string)) continue;
      const def = ctx.entities.get(r.entity_type as string);
      const scope = (r.home_scope_id as string | null) ?? null;
      if (def.audience) {
        if (audienceIncludes(ctx, def.audience, JSON.parse(r.payload as string) as Row, peer.installation_id)) out.push(toChange(r));
        else continue;
        bytes += (r.payload as string).length + 300;
        if (out.length >= limit || bytes >= maxBytes) { full = true; break; }
        continue;
      }
      const deliver = def.distribution === 'fleet' || (scope !== null && scopes.has(scope))
        || (peer.include_unscoped_hub === 1 && scope === null && def.recordClass === 'owner_mutable' && r.owner_installation_id === hub.installationId);
      if (!deliver) continue;
      out.push(toChange(r));
      bytes += (r.payload as string).length + 300;
      if (out.length >= limit || bytes >= maxBytes) { full = true; break; }
    }
  }
  return { changes: out, nextCursor: next, more: next < hubMax, hubMax };
}

// ---------------------------------------------------------------- hub endpoints (signature-authenticated)

export const HelloBody = z.object({
  installationId: z.uuid(), maxSeq: z.number().int().min(0), schemaVersions: z.record(z.string(), z.number()).default({}),
  appliedHubSeq: z.number().int().min(0).optional(), enrol: z.object({ secret: z.string().min(8).max(100), publicKeyPem: z.string().min(50).max(2000) }).optional(),
});
export const PushBody = z.object({ changes: z.array(z.unknown()).max(MAX_BATCH), maxSeq: z.number().int().min(0) });
export const PullBody = z.object({ cursor: z.number().int().min(0), limit: z.number().int().min(1).max(MAX_BATCH).default(MAX_BATCH) });

function parseBody<T extends z.ZodType>(schema: T, v: unknown): z.infer<T> {
  const r = schema.safeParse(v);
  if (!r.success) throw new AppError('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
}

function reply<T>(ctx: AppContext, path: string, body: T): Envelope<T> {
  return signEnvelope(ctx.db, identityOf(ctx).installationId, `response:${path}`, body);
}

/** Verify an envelope from a replica. Enrols a pending replica when it proves knowledge of the one-time secret. */
function authenticate(ctx: AppContext, env: Envelope, path: string, enrol?: z.infer<typeof HelloBody>['enrol']): Peer {
  requireHub(ctx);
  if (env.path !== path) throw new AppError('FORBIDDEN', 'Envelope path mismatch');
  const peer = getPeer(ctx.db, env.from);
  if (!peer || peer.role !== 'replica') throw new AppError('FORBIDDEN', 'Unknown installation');
  if (peer.status === 'decommissioned') throw new AppError('FORBIDDEN', 'This installation has been decommissioned');
  if (peer.status === 'pending') {
    if (!enrol || !peer.enrol_secret_hash || !secretMatches(enrol.secret, peer.enrol_secret_hash)) throw new AppError('FORBIDDEN', 'Enrolment secret is wrong or missing');
    if (!verifyEnvelope(enrol.publicKeyPem, env)) throw new AppError('FORBIDDEN', 'Bad signature');
    ctx.db.prepare("UPDATE syn_peer SET status = 'active', public_key_pem = ?, enrol_secret_hash = NULL WHERE installation_id = ?").run(enrol.publicKeyPem, peer.installation_id);
    return getPeer(ctx.db, peer.installation_id)!;
  }
  if (!peer.public_key_pem || !verifyEnvelope(peer.public_key_pem, env)) throw new AppError('FORBIDDEN', 'Bad signature');
  return peer;
}

export function handleHello(ctx: AppContext, env: Envelope): Envelope {
  const body = parseBody(HelloBody, env.body);
  let peer = authenticate(ctx, env, 'hello', body.enrol);
  if (refreshAudience(ctx, peer)) peer = getPeer(ctx.db, peer.installation_id)!;
  const skew = Date.now() - Date.parse(env.sentAt);
  ctx.db.prepare('UPDATE syn_peer SET last_skew_ms = ? WHERE installation_id = ?').run(skew, peer.installation_id);
  if (body.appliedHubSeq !== undefined) ctx.db.prepare('UPDATE syn_peer SET pull_cursor = ? WHERE installation_id = ?').run(body.appliedHubSeq, peer.installation_id);
  const hub = identityOf(ctx);
  return reply(ctx, 'hello', {
    hubInstallationId: hub.installationId, acceptedOriginSeq: peer.accepted_origin_seq, hubMaxSeq: maxLocalSeq(ctx.db), serverTime: nowUtc(),
    subEpoch: peer.sub_epoch, scopes: scopesOf(ctx.db, peer.installation_id), schemaVersions: schemaVersions(ctx.db),
  });
}

export function processPush(ctx: AppContext, peer: Peer, changes: unknown[], maxSeq: number): { results: ChangeResult[]; tally: Tally } {
  const tally: Tally = { accepted: 0, duplicates: 0, rejected: 0, quarantined: 0 };
  const results: ChangeResult[] = [];
  const types = new Set<string>();
  const source: Source = { installationId: peer.installation_id, isHub: peer.role === 'hub' };
  for (const raw of changes) {
    const o = applyChange(ctx, raw, source);
    const id = (raw as { changeId?: string })?.changeId ?? '';
    results.push({ changeId: id, status: o.status, ...('code' in o ? { code: o.code, message: o.message } : {}) });
    if (o.status === 'applied') { tally.accepted++; types.add((raw as SyncChange).entityType); }
    else if (o.status === 'duplicate') tally.duplicates++;
    else if (o.status === 'rejected') tally.rejected++;
    else tally.quarantined++;
  }
  if (types.size) ctx.events.publish({ type: APPLIED_EVENT, occurredAt: nowUtc(), payload: { entityTypes: [...types] } });
  return { results, tally: { ...tally } };
}

export function handlePush(ctx: AppContext, env: Envelope): Envelope {
  const peer = authenticate(ctx, env, 'push');
  const body = parseBody(PushBody, env.body);
  const { results, tally } = processPush(ctx, peer, body.changes, body.maxSeq);
  ctx.db.prepare('UPDATE syn_peer SET accepted_origin_seq = MAX(accepted_origin_seq, ?), last_sync_at = ? WHERE installation_id = ?').run(body.maxSeq, nowUtc(), peer.installation_id);
  return reply(ctx, 'push', { results, ...tally, acceptedOriginSeq: Math.max(peer.accepted_origin_seq, body.maxSeq) });
}

export function handlePull(ctx: AppContext, env: Envelope): Envelope {
  const peer = authenticate(ctx, env, 'pull');
  const body = parseBody(PullBody, env.body);
  const sel = selectForPeer(ctx, peer, body.cursor, body.limit);
  ctx.db.prepare('UPDATE syn_peer SET pull_cursor = ?, last_sync_at = ? WHERE installation_id = ?').run(sel.nextCursor, nowUtc(), peer.installation_id);
  return reply(ctx, 'pull', { changes: sel.changes, nextCursor: sel.nextCursor, more: sel.more, hubMaxSeq: sel.hubMax, acceptedOriginSeq: peer.accepted_origin_seq });
}

// ---------------------------------------------------------------- replica client

/** Carries a signed envelope to the hub and returns the hub's signed reply (HTTP in production, a direct call in tests). */
export type Transport = (path: 'hello' | 'push' | 'pull', env: Envelope) => Promise<Envelope>;

export function httpTransport(baseUrl: string): Transport {
  return async (path, env) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/sync/peer/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(env), signal: AbortSignal.timeout(120_000) });
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string } }).error;
      throw new AppError((e?.code as 'FORBIDDEN') ?? 'SYNC_REJECTED', e?.message ?? `Hub answered ${res.status}`);
    }
    return json as Envelope;
  };
}

export interface SyncReport { sessionId: string; pushed: number; accepted: number; duplicates: number; rejected: number; quarantined: number; pulled: number; applied: number; skewMs: number; skewWarning: boolean }

async function call<B, R>(ctx: AppContext, hub: Peer, transport: Transport, path: 'hello' | 'push' | 'pull', body: B): Promise<R> {
  const me = identityOf(ctx);
  const res = await transport(path, signEnvelope(ctx.db, me.installationId, path, body));
  if (res.from !== hub.installation_id || res.path !== `response:${path}` || !hub.public_key_pem || !verifyEnvelope(hub.public_key_pem, res)) {
    throw new AppError('SYNC_REJECTED', 'The reply did not come from the hub (bad signature)');
  }
  return res.body as R;
}

export async function syncOnce(ctx: AppContext, transport: Transport): Promise<SyncReport> {
  const me = requireReplica(ctx);
  const db = ctx.db;
  const hub = hubPeer(db);
  if (!hub) throw new AppError('WORKFLOW_BLOCKED', 'This installation has not joined a hub');
  const sessionId = uuidv7();
  db.prepare("INSERT INTO syn_session (id, peer_installation_id, direction, started_at) VALUES (?, ?, 'http', ?)").run(sessionId, hub.installation_id, nowUtc());
  const rep: SyncReport = { sessionId, pushed: 0, accepted: 0, duplicates: 0, rejected: 0, quarantined: 0, pulled: 0, applied: 0, skewMs: 0, skewWarning: false };
  const finish = (error: string | null) => db.prepare('UPDATE syn_session SET finished_at = ?, pushed = ?, accepted = ?, duplicates = ?, rejected = ?, quarantined = ?, pulled = ?, error = ? WHERE id = ?')
    .run(nowUtc(), rep.pushed, rep.accepted, rep.duplicates, rep.rejected, rep.quarantined, rep.pulled, error, sessionId);
  const types = new Set<string>();
  try {
    let cur = getPeer(db, hub.installation_id)!;
    const enrol = cur.enrol_secret ? { secret: cur.enrol_secret, publicKeyPem: ensureLocalKey(db).publicPem } : undefined;
    const hello = await call<unknown, { hubInstallationId: string; acceptedOriginSeq: number; serverTime: string; subEpoch: number }>(ctx, cur, transport, 'hello',
      { installationId: me.installationId, maxSeq: maxLocalSeq(db), schemaVersions: schemaVersions(db), appliedHubSeq: cur.pull_cursor, ...(enrol ? { enrol } : {}) });
    if (hello.hubInstallationId !== hub.installation_id) throw new AppError('SYNC_REJECTED', 'Connected to a different hub than the one this installation joined');
    rep.skewMs = Date.now() - Date.parse(hello.serverTime);
    rep.skewWarning = Math.abs(rep.skewMs) > SKEW_WARN_MS;
    // A hub restored from an older backup reports less than we already sent: send the difference again.
    const push0 = Math.min(cur.push_cursor, hello.acceptedOriginSeq);
    // A grown subscription means the hub must backfill, so start the pull again from the beginning.
    const pull0 = hello.subEpoch !== cur.sub_epoch ? 0 : cur.pull_cursor;
    db.prepare('UPDATE syn_peer SET push_cursor = ?, pull_cursor = ?, sub_epoch = ?, enrol_secret = NULL, last_skew_ms = ? WHERE installation_id = ?').run(push0, pull0, hello.subEpoch, rep.skewMs, hub.installation_id);

    for (;;) {
      cur = getPeer(db, hub.installation_id)!;
      const rows = db.prepare('SELECT * FROM sys_change_log WHERE seq > ? AND received_from_installation_id IS NULL ORDER BY seq LIMIT ?').all(cur.push_cursor, MAX_BATCH) as Row[];
      if (rows.length === 0) break;
      const batch: Row[] = [];
      let bytes = 0;
      for (const r of rows) { batch.push(r); bytes += (r.payload as string).length + 300; if (bytes >= MAX_BATCH_BYTES) break; }
      const maxSeq = batch[batch.length - 1]!.seq as number;
      const res = await call<unknown, Tally & { results: ChangeResult[] }>(ctx, cur, transport, 'push', { changes: batch.map(toChange), maxSeq });
      rep.pushed += batch.length; rep.accepted += res.accepted; rep.duplicates += res.duplicates; rep.rejected += res.rejected; rep.quarantined += res.quarantined;
      db.prepare('UPDATE syn_peer SET push_cursor = ? WHERE installation_id = ?').run(maxSeq, hub.installation_id);
    }

    for (;;) {
      cur = getPeer(db, hub.installation_id)!;
      const res = await call<unknown, { changes: unknown[]; nextCursor: number; more: boolean }>(ctx, cur, transport, 'pull', { cursor: cur.pull_cursor });
      db.transaction(() => {
        for (const raw of res.changes) {
          const o = applyChange(ctx, raw, { installationId: hub.installation_id, isHub: true });
          if (o.status === 'applied') { rep.applied++; types.add((raw as SyncChange).entityType); } else if (o.status === 'duplicate') rep.duplicates++; else if (o.status === 'rejected') rep.rejected++; else rep.quarantined++;
        }
        db.prepare('UPDATE syn_peer SET pull_cursor = ? WHERE installation_id = ?').run(res.nextCursor, hub.installation_id);
      })();
      rep.pulled += res.changes.length;
      if (!res.more || res.nextCursor <= cur.pull_cursor) break;
    }
    db.prepare('UPDATE syn_peer SET last_sync_at = ? WHERE installation_id = ?').run(nowUtc(), hub.installation_id);
    finish(null);
  } catch (e) {
    finish(e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    if (types.size) ctx.events.publish({ type: APPLIED_EVENT, occurredAt: nowUtc(), payload: { entityTypes: [...types] } });
  }
  return rep;
}

// ---------------------------------------------------------------- bundles (signed file transport, identical envelope)

export interface Bundle {
  manifest: {
    format: 1; kind: 'push' | 'pull'; from: string; to: string; createdAt: string; schemaVersions: Record<string, number>; count: number; fromSeq: number; toSeq: number;
    acceptedOriginSeq?: number; appliedHubSeq?: number; enrol?: { secret: string; publicKeyPem: string }; subEpoch?: number;
  };
  changes: SyncChange[];
  signature: string;
}
const bundleText = (m: Bundle['manifest'], changes: SyncChange[]): string => canonicalJson({ manifest: m, changesHash: payloadHash(changes) });
const MAX_BUNDLE_CHANGES = 50_000;

/** Replica: the changes the hub has not acknowledged (`all` = everything ever written here, the emergency export). Hub: what `peerId` should receive. */
export function exportBundle(ctx: AppContext, opts: { peerId?: string; all?: boolean }): Bundle {
  const me = identityOf(ctx);
  const db = ctx.db;
  let manifest: Bundle['manifest'];
  let changes: SyncChange[] = [];
  if (me.kind === 'hub') {
    let peer = opts.peerId ? getPeer(db, opts.peerId) : undefined;
    if (!peer || peer.role !== 'replica') throw new AppError('NOT_FOUND', 'Say which installation the bundle is for');
    if (peer.status === 'decommissioned') throw new AppError('WORKFLOW_BLOCKED', 'That installation is decommissioned');
    const regrant = refreshAudience(ctx, peer);
    if (regrant) peer = getPeer(db, peer.installation_id)!;
    const cursor = opts.all || regrant ? 0 : peer.pull_cursor;
    let next = cursor;
    for (;;) {
      const sel = selectForPeer(ctx, peer, next, MAX_BATCH, MAX_BATCH_BYTES);
      changes.push(...sel.changes);
      next = sel.nextCursor;
      if (!sel.more || changes.length >= MAX_BUNDLE_CHANGES) break;
    }
    manifest = { format: 1, kind: 'pull', from: me.installationId, to: peer.installation_id, createdAt: nowUtc(), schemaVersions: schemaVersions(db), count: changes.length, fromSeq: cursor, toSeq: next, acceptedOriginSeq: peer.accepted_origin_seq, subEpoch: peer.sub_epoch };
  } else {
    const hub = hubPeer(db);
    if (!hub) throw new AppError('WORKFLOW_BLOCKED', 'This installation has not joined a hub');
    const from = opts.all ? 0 : hub.push_cursor;
    const rows = db.prepare('SELECT * FROM sys_change_log WHERE seq > ? AND received_from_installation_id IS NULL ORDER BY seq LIMIT ?').all(from, MAX_BUNDLE_CHANGES) as Row[];
    changes = rows.map(toChange);
    const toSeq = rows.length ? (rows[rows.length - 1]!.seq as number) : from;
    manifest = {
      format: 1, kind: 'push', from: me.installationId, to: hub.installation_id, createdAt: nowUtc(), schemaVersions: schemaVersions(db), count: changes.length, fromSeq: from, toSeq, appliedHubSeq: hub.pull_cursor,
      ...(hub.enrol_secret ? { enrol: { secret: hub.enrol_secret, publicKeyPem: ensureLocalKey(db).publicPem } } : {}),
    };
  }
  db.prepare("INSERT INTO syn_session (id, peer_installation_id, direction, started_at, finished_at, pushed) VALUES (?, ?, 'bundle_out', ?, ?, ?)").run(uuidv7(), manifest.to, nowUtc(), nowUtc(), changes.length);
  return { manifest, changes, signature: signText(db, bundleText(manifest, changes)) };
}

export interface BundleImportResult { kind: 'push' | 'pull'; count: number; accepted: number; duplicates: number; rejected: number; quarantined: number }

export function importBundle(ctx: AppContext, raw: unknown): BundleImportResult {
  const me = identityOf(ctx);
  const db = ctx.db;
  const b = raw as Bundle;
  if (!b || typeof b !== 'object' || !b.manifest || !Array.isArray(b.changes) || typeof b.signature !== 'string' || b.manifest.format !== 1) throw new AppError('VALIDATION_FAILED', 'This is not a sync bundle');
  const m = b.manifest;
  if (m.to !== me.installationId) throw new AppError('WORKFLOW_BLOCKED', 'This bundle is addressed to a different installation');
  if (m.count !== b.changes.length) throw new AppError('VALIDATION_FAILED', 'Bundle is incomplete (count mismatch)');
  const peer = getPeer(db, m.from);
  if (!peer) throw new AppError('FORBIDDEN', 'Unknown installation');
  if (peer.status === 'decommissioned') throw new AppError('FORBIDDEN', 'This installation has been decommissioned');
  const sessionId = uuidv7();
  const started = nowUtc();
  const res: BundleImportResult = { kind: m.kind, count: b.changes.length, accepted: 0, duplicates: 0, rejected: 0, quarantined: 0 };
  if (m.kind === 'push') {
    if (me.kind !== 'hub' || peer.role !== 'replica') throw new AppError('WORKFLOW_BLOCKED', 'A push bundle goes to the hub');
    let key = peer.public_key_pem;
    if (peer.status === 'pending') {
      if (!m.enrol || !peer.enrol_secret_hash || !secretMatches(m.enrol.secret, peer.enrol_secret_hash)) throw new AppError('FORBIDDEN', 'Enrolment secret is wrong or missing');
      key = m.enrol.publicKeyPem;
    }
    if (!key || !verifyText(key, bundleText(m, b.changes), b.signature)) throw new AppError('FORBIDDEN', 'Bad bundle signature');
    if (peer.status === 'pending') db.prepare("UPDATE syn_peer SET status = 'active', public_key_pem = ?, enrol_secret_hash = NULL WHERE installation_id = ?").run(key, peer.installation_id);
    const out = processPush(ctx, peer, b.changes, m.toSeq);
    Object.assign(res, out.tally);
    db.prepare('UPDATE syn_peer SET accepted_origin_seq = MAX(accepted_origin_seq, ?), last_sync_at = ?, pull_cursor = COALESCE(?, pull_cursor) WHERE installation_id = ?').run(m.toSeq, nowUtc(), m.appliedHubSeq ?? null, peer.installation_id);
  } else {
    if (me.kind === 'hub' || peer.role !== 'hub') throw new AppError('WORKFLOW_BLOCKED', 'A pull bundle comes from the hub');
    if (!peer.public_key_pem || !verifyText(peer.public_key_pem, bundleText(m, b.changes), b.signature)) throw new AppError('FORBIDDEN', 'Bad bundle signature');
    if (m.fromSeq > peer.pull_cursor && m.fromSeq !== 0) throw new AppError('WORKFLOW_BLOCKED', `This bundle starts after change ${m.fromSeq} but this installation is at ${peer.pull_cursor}: an earlier bundle is missing`);
    const types = new Set<string>();
    db.transaction(() => {
      for (const c of b.changes) {
        const o = applyChange(ctx, c, { installationId: peer.installation_id, isHub: true });
        if (o.status === 'applied') { res.accepted++; types.add(c.entityType); } else if (o.status === 'duplicate') res.duplicates++; else if (o.status === 'rejected') res.rejected++; else res.quarantined++;
      }
      db.prepare('UPDATE syn_peer SET pull_cursor = MAX(pull_cursor, ?), push_cursor = MAX(push_cursor, ?), sub_epoch = COALESCE(?, sub_epoch), last_sync_at = ? WHERE installation_id = ?')
        .run(m.toSeq, m.acceptedOriginSeq ?? 0, m.subEpoch ?? null, nowUtc(), peer.installation_id);
    })();
    if (types.size) ctx.events.publish({ type: APPLIED_EVENT, occurredAt: nowUtc(), payload: { entityTypes: [...types] } });
  }
  db.prepare("INSERT INTO syn_session (id, peer_installation_id, direction, started_at, finished_at, pushed, accepted, duplicates, rejected, quarantined, pulled) VALUES (?, ?, 'bundle_in', ?, ?, 0, ?, ?, ?, ?, ?)")
    .run(sessionId, peer.installation_id, started, nowUtc(), res.accepted, res.duplicates, res.rejected, res.quarantined, m.kind === 'pull' ? res.count : 0);
  return res;
}

// ---------------------------------------------------------------- conflicts

export function listConflicts(db: Db, status?: string): Row[] {
  return (status ? db.prepare('SELECT * FROM syn_conflict WHERE status = ? ORDER BY detected_at DESC LIMIT 500').all(status) : db.prepare('SELECT * FROM syn_conflict ORDER BY detected_at DESC LIMIT 500').all()) as Row[];
}
export const getConflict = (db: Db, id: string): Row => {
  const r = db.prepare('SELECT * FROM syn_conflict WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new AppError('NOT_FOUND', 'No such conflict');
  return r;
};

export const ResolveInput = z.strictObject({ action: z.enum(['accept_incoming', 'keep_local', 'dismiss']), note: z.string().trim().min(1).max(500) });

/**
 * accept_incoming: the quarantined version becomes the stored one (the owner's version stands). keep_local: the local copy stands, the incoming one is set aside.
 * Either way the decision is recorded; nothing is deleted.
 */
export function resolveConflict(ctx: AppContext, id: string, input: z.infer<typeof ResolveInput>, userId: string): Row {
  const c = getConflict(ctx.db, id);
  if (c.status !== 'open') throw new AppError('WORKFLOW_BLOCKED', 'This conflict is already resolved');
  return ctx.db.transaction(() => {
    if (input.action === 'accept_incoming') {
      const change = JSON.parse(c.change_json as string) as SyncChange;
      if (!ctx.entities.has(change.entityType)) throw new AppError('WORKFLOW_BLOCKED', 'This installation does not know that record type');
      const def = ctx.entities.get(change.entityType);
      if (def.recordClass === 'event') throw new AppError('WORKFLOW_BLOCKED', 'Events are never replaced; corrections are new events');
      const local = ctx.db.prepare(`SELECT 1 FROM ${def.table} WHERE id = ?`).get(change.entityId);
      const known = new Set((ctx.db.prepare(`PRAGMA table_info(${def.table})`).all() as Array<{ name: string }>).map((r) => r.name));
      const cols = Object.keys(change.payload).filter((k) => known.has(k));
      const val = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v ?? null);
      if (local) { const set = cols.filter((k) => k !== 'id'); ctx.db.prepare(`UPDATE ${def.table} SET ${set.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...set.map((k) => val(change.payload[k])), change.entityId); }
      else ctx.db.prepare(`INSERT INTO ${def.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((k) => val(change.payload[k])));
      if (!ctx.db.prepare('SELECT 1 FROM sys_change_log WHERE change_id = ?').get(change.changeId)) {
        ctx.db.prepare(`INSERT INTO sys_change_log (change_id, origin_installation_id, entity_type, entity_id, op, version, owner_installation_id, home_scope_id, occurred_at, schema_version, payload, payload_hash, logged_at, received_from_installation_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(change.changeId, change.originInstallationId, change.entityType, change.entityId, change.op, change.version, change.ownerInstallationId, change.homeScopeId, change.occurredAt, change.schemaVersion, JSON.stringify(change.payload), change.payloadHash, nowUtc(), c.received_from_installation_id);
      }
      ctx.events.publish({ type: APPLIED_EVENT, occurredAt: nowUtc(), payload: { entityTypes: [change.entityType] } });
    }
    ctx.db.prepare("UPDATE syn_conflict SET status = ?, resolved_at = ?, resolved_by = ?, resolution = ? WHERE id = ?")
      .run(input.action === 'dismiss' ? 'dismissed' : 'resolved', nowUtc(), userId, `${input.action}: ${input.note}`, id);
    return getConflict(ctx.db, id);
  })();
}

/** After an upgrade: try again the changes that waited for it. Returns how many were applied. */
export function retryQuarantined(ctx: AppContext): { retried: number; applied: number } {
  const open = ctx.db.prepare("SELECT * FROM syn_conflict WHERE status = 'open' AND code IN ('SCHEMA_NEWER','UNKNOWN_ENTITY','APPLY_FAILED','DEPENDENCY_MISSING') ORDER BY detected_at").all() as Row[];
  let applied = 0;
  for (const c of open) {
    const peer = getPeer(ctx.db, c.received_from_installation_id as string);
    ctx.db.transaction(() => {
      ctx.db.prepare('DELETE FROM syn_conflict WHERE id = ?').run(c.id);
      const o = applyChange(ctx, JSON.parse(c.change_json as string), { installationId: c.received_from_installation_id as string, isHub: peer?.role === 'hub' });
      if (o.status === 'applied') applied++;
    })();
  }
  if (applied) ctx.events.publish({ type: APPLIED_EVENT, occurredAt: nowUtc(), payload: { entityTypes: [] } });
  return { retried: open.length, applied };
}

// ---------------------------------------------------------------- status and freshness

const STALE_DAYS: Record<string, number> = { ship: 7, workshop: 2, command: 2 };

export function pendingOutbound(db: Db): number {
  const hub = hubPeer(db);
  if (!hub) return 0;
  return (db.prepare('SELECT COUNT(*) AS n FROM sys_change_log WHERE seq > ? AND received_from_installation_id IS NULL').get(hub.push_cursor) as { n: number }).n;
}

/** The Freshness block every list over synchronized data should carry (CONTRACTS). The hub is authoritative and never stale. */
export function freshness(ctx: AppContext): Freshness {
  const me = identityOf(ctx);
  if (me.kind === 'hub') return { scope: { kind: 'fleet' }, asOf: nowUtc(), stale: false, pendingOutbound: 0 };
  const hub = hubPeer(ctx.db);
  const asOf = hub?.last_sync_at ?? null;
  const limit = (STALE_DAYS[me.kind] ?? 2) * 86_400_000;
  return { scope: { kind: 'fleet' }, asOf, stale: !asOf || Date.now() - Date.parse(asOf) > limit, pendingOutbound: pendingOutbound(ctx.db) };
}

export function status(ctx: AppContext): Record<string, unknown> {
  const me = identityOf(ctx);
  const db = ctx.db;
  const f = freshness(ctx);
  const peers = listPeers(db).map((p) => ({
    installationId: p.installation_id, role: p.role, kind: p.kind, code: p.code, name: p.name, status: p.status, url: p.url, lastSyncAt: p.last_sync_at, skewMs: p.last_skew_ms,
    skewWarning: p.last_skew_ms !== null && Math.abs(p.last_skew_ms) > SKEW_WARN_MS, pushCursor: p.push_cursor, pullCursor: p.pull_cursor, acceptedOriginSeq: p.accepted_origin_seq,
    includeUnscopedHub: !!p.include_unscoped_hub, scopes: scopesOf(db, p.installation_id),
    stale: p.role === 'replica' && p.status === 'active' ? !p.last_sync_at || Date.now() - Date.parse(p.last_sync_at) > (STALE_DAYS[p.kind] ?? 2) * 86_400_000 : false,
  }));
  const open = (db.prepare("SELECT COUNT(*) AS n FROM syn_conflict WHERE status = 'open'").get() as { n: number }).n;
  return { installation: me, freshness: f, pendingOutbound: me.kind === 'hub' ? 0 : pendingOutbound(db), openConflicts: open, changeLogSize: maxLocalSeq(db), schemaVersions: schemaVersions(db), peers };
}

export const listSessions = (db: Db): Row[] => db.prepare('SELECT * FROM syn_session ORDER BY started_at DESC LIMIT 200').all() as Row[];
