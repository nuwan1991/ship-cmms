/** Authentication only: it establishes *who* is calling. What they may do is decided by the Authorizer (authority.ts). */
import { createHash, randomBytes } from 'node:crypto';
import type { AppContext } from '../../platform/app-context.js';
import type { Principal } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { uuidv7 } from '../../platform/ids.js';
import { createRecord, updateRecord, writeAudit } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { makeActor, snapshotFor, type Actor } from './actor.js';
import { touchClock } from './authority.js';
import { authorize } from './guard.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './passwords.js';
import { perm } from './permissions.js';
import * as S from './schemas.js';

type Row = Record<string, unknown>;

export const SESSION_HOURS = 12;
export const LOCKOUT = { failures: 5, windowMinutes: 10 };
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const plusHours = (iso: string, h: number): string => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

let dummyHash: Promise<string> | null = null; // verified when the username is unknown, so timing does not reveal which usernames exist

const anonymousPrincipal = (ctx: AppContext): Principal => ({ userId: 'anonymous', installationId: (ctx.identity ?? getLocalIdentity(ctx.db))?.installationId ?? uuidv7(), displayName: 'Anonymous' });

function principalFor(ctx: AppContext, userId: string): Principal | null {
  const u = ctx.db.prepare("SELECT display_name, status FROM idn_user WHERE id = ? AND deleted_at IS NULL").get(userId) as { display_name: string; status: string } | undefined;
  const inst = ctx.identity ?? getLocalIdentity(ctx.db);
  if (!u || u.status !== 'active' || !inst) return null;
  return { userId, installationId: inst.installationId, displayName: u.display_name, snapshot: snapshotFor(ctx, userId) };
}

/** Hub: every credential. Elsewhere: only users provisioned to this installation. */
function isProvisionedHere(ctx: AppContext, userId: string): boolean {
  const inst = ctx.identity ?? getLocalIdentity(ctx.db);
  if (!inst || inst.kind === 'hub') return true;
  return ctx.db.prepare('SELECT 1 FROM idn_user_installation WHERE user_id = ? AND installation_id = ? AND deleted_at IS NULL').get(userId, inst.installationId) !== undefined;
}

/** A local administrator reset applies until a newer hub credential supersedes it (SYNC_RULES §6). */
function effectiveHash(ctx: AppContext, cred: { user_id: string; password_hash: string; updated_at: string }): string {
  const o = ctx.db.prepare('SELECT password_hash, set_at FROM idn_local_password WHERE user_id = ?').get(cred.user_id) as { password_hash: string; set_at: string } | undefined;
  return o && o.set_at > cred.updated_at ? o.password_hash : cred.password_hash;
}

function recentFailures(ctx: AppContext, username: string, now: string): number {
  const since = new Date(Date.parse(now) - LOCKOUT.windowMinutes * 60_000).toISOString();
  const r = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM sys_audit_event WHERE action = 'login.failed' AND recorded_at >= ? AND json_extract(changes, '$.username[1]') = ?")
    .get(since, username) as { n: number };
  return r.n;
}

export interface LoginResult { token: string; expiresAt: string; userId: string; displayName: string }

export async function login(ctx: AppContext, input: unknown, correlationId?: string): Promise<LoginResult> {
  const { username, password } = S.parse(S.Login, input);
  const anon = makeActor(ctx, anonymousPrincipal(ctx), correlationId);
  const now = nowUtc();
  const fail = (message: string, why: string): never => {
    writeAudit(anon.wctx, { action: 'login.failed', entityType: 'idn.credential', outcome: 'denied', changes: { username: [null, username], reason: [null, why] } });
    throw new AppError('UNAUTHENTICATED', message);
  };
  if (recentFailures(ctx, username, now) >= LOCKOUT.failures) {
    writeAudit(anon.wctx, { action: 'login.locked', entityType: 'idn.credential', outcome: 'denied', changes: { username: [null, username] } });
    throw new AppError('FORBIDDEN', `Too many failed sign-in attempts. Try again in ${LOCKOUT.windowMinutes} minutes.`);
  }
  const cred = ctx.db.prepare('SELECT user_id, password_hash, updated_at FROM idn_credential WHERE username = ? AND deleted_at IS NULL').get(username) as { user_id: string; password_hash: string; updated_at: string } | undefined;
  if (!cred) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return fail('Incorrect username or password', 'unknown_user');
  }
  const ok = await verifyPassword(password, effectiveHash(ctx, cred));
  if (!ok) return fail('Incorrect username or password', 'bad_password');
  const principal = principalFor(ctx, cred.user_id);
  if (!principal) return fail('This account is not active', 'inactive');
  if (!isProvisionedHere(ctx, cred.user_id)) return fail('This account is not provisioned at this installation', 'not_provisioned');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = plusHours(now, SESSION_HOURS);
  ctx.db.prepare('INSERT INTO idn_session (id, token_hash, user_id, created_at, last_seen_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(uuidv7(), sha256(token), cred.user_id, now, now, expiresAt);
  const who = makeActor(ctx, principal, correlationId);
  writeAudit(who.wctx, { action: 'login', entityType: 'idn.user', entityId: cred.user_id });
  touchClock(ctx.db, now);
  return { token, expiresAt, userId: cred.user_id, displayName: principal.displayName };
}

/** Principal for a bearer token, or null when the session is unknown, revoked, expired, or its user is no longer active. */
export function authenticate(ctx: AppContext, token: string): Principal | null {
  const now = nowUtc();
  const s = ctx.db.prepare('SELECT id, user_id, last_seen_at FROM idn_session WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?').get(sha256(token), now) as { id: string; user_id: string; last_seen_at: string } | undefined;
  if (!s) return null;
  const principal = principalFor(ctx, s.user_id);
  if (!principal) return null;
  if (Date.parse(now) - Date.parse(s.last_seen_at) > 60_000) {
    ctx.db.prepare('UPDATE idn_session SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, plusHours(now, SESSION_HOURS), s.id);
    touchClock(ctx.db, now);
  }
  return principal;
}

export function logout(ctx: AppContext, token: string): void {
  ctx.db.prepare('UPDATE idn_session SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(nowUtc(), sha256(token));
}

export function revokeUserSessions(ctx: AppContext, userId: string): number {
  return ctx.db.prepare('UPDATE idn_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowUtc(), userId).changes;
}

// ------------------------------------------------------------------ credential administration

const liveCredential = (ctx: AppContext, userId: string): Row | undefined => ctx.db.prepare('SELECT * FROM idn_credential WHERE user_id = ? AND deleted_at IS NULL').get(userId) as Row | undefined;

/** Hub: create or replace a user's username/password. A new credential version affects future sign-ins only; approvals are untouched. */
export async function setCredential(a: Actor, ctx: AppContext, userId: string, input: unknown): Promise<Row> {
  const body = S.parse(S.CredentialSet, input);
  const cur = liveCredential(ctx, userId);
  authorize(a, perm('credential', cur ? 'update' : 'create'));
  if (!ctx.db.prepare('SELECT 1 FROM idn_user WHERE id = ? AND deleted_at IS NULL').get(userId)) throw new AppError('DEPENDENCY_MISSING', `user ${userId} does not exist on this installation`);
  assertPasswordPolicy(body.password, body.username);
  const taken = ctx.db.prepare('SELECT user_id FROM idn_credential WHERE username = ? AND deleted_at IS NULL AND user_id <> ?').get(body.username, userId);
  if (taken) throw new AppError('DUPLICATE', 'That username is already in use', { fields: ['username'] });
  const hash = await hashPassword(body.password);
  const strip = (r: Row): Row => { const { password_hash: _h, ...rest } = r; return rest; };
  return ctx.db.transaction(() => {
    if (!cur) return strip(createRecord(a.wctx, 'idn.credential', { user_id: userId, username: body.username, password_hash: hash, credential_version: 1 }));
    if (body.expectedVersion === undefined) throw new AppError('VALIDATION_FAILED', 'expectedVersion is required to change an existing credential');
    const next = updateRecord(a.wctx, 'idn.credential', cur.id as string, body.expectedVersion, { username: body.username, password_hash: hash, credential_version: (cur.credential_version as number) + 1 });
    revokeUserSessions(ctx, userId);
    return strip(next);
  })();
}

/** Own password change. At the hub it writes a new credential version; elsewhere it is an installation-scoped reset superseded by the hub's next version. */
export async function changeOwnPassword(a: Actor, ctx: AppContext, input: unknown): Promise<{ scope: 'fleet' | 'installation' }> {
  const { currentPassword, newPassword } = S.parse(S.ChangePassword, input);
  const cred = liveCredential(ctx, a.principal.userId) as { id: string; version: number; username: string; password_hash: string; user_id: string; updated_at: string; credential_version: number } | undefined;
  if (!cred) throw new AppError('NOT_FOUND', 'No credential exists for this user');
  if (!(await verifyPassword(currentPassword, effectiveHash(ctx, cred)))) {
    writeAudit(a.wctx, { action: 'password.change.failed', entityType: 'idn.credential', entityId: cred.id, outcome: 'denied' });
    throw new AppError('FORBIDDEN', 'Current password is incorrect');
  }
  assertPasswordPolicy(newPassword, cred.username);
  const hash = await hashPassword(newPassword);
  if (a.wctx.installation.kind === 'hub') {
    updateRecord(a.wctx, 'idn.credential', cred.id, cred.version, { password_hash: hash, credential_version: cred.credential_version + 1 });
    return { scope: 'fleet' };
  }
  ctx.db.prepare('INSERT INTO idn_local_password (user_id, password_hash, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, set_by = excluded.set_by, set_at = excluded.set_at').run(cred.user_id, hash, a.principal.userId, nowUtc());
  writeAudit(a.wctx, { action: 'password.change.local', entityType: 'idn.credential', entityId: cred.id });
  return { scope: 'installation' };
}

/** Local administrator reset (SYNC_RULES §6): this installation only, audited, superseded by the next hub credential version. */
export async function resetLocalPassword(a: Actor, ctx: AppContext, userId: string, input: unknown): Promise<void> {
  const { password } = S.parse(S.ResetLocal, input);
  authorize(a, 'idn.credential.reset_local');
  const cred = liveCredential(ctx, userId) as { id: string; username: string } | undefined;
  if (!cred) throw new AppError('NOT_FOUND', 'No credential exists for this user');
  assertPasswordPolicy(password, cred.username);
  const hash = await hashPassword(password);
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO idn_local_password (user_id, password_hash, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, set_by = excluded.set_by, set_at = excluded.set_at').run(userId, hash, a.principal.userId, nowUtc());
    writeAudit(a.wctx, { action: 'credential.reset_local', entityType: 'idn.credential', entityId: cred.id });
    revokeUserSessions(ctx, userId);
  })();
}
