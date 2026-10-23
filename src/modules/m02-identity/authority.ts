/**
 * Who holds which authority, right now and offline (SYNC_RULES §6).
 * Pure reads over idn_* tables plus two local settings that M10 maintains/consumes:
 *   authority.last_hub_sync_at  - last confirmed hub sync (UTC); M10 writes it after each successful session
 *   authority.lease_days        - this installation's default lease (optional)
 *   clock.high_water            - highest time this installation has seen (clock-safety)
 */
import type { Authorizer, AuthDecision } from '../../platform/authz.js';
import type { Principal, ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { getLocalIdentity } from '../../platform/identity.js';
import { nowUtc } from '../../platform/time.js';
import { getShipCommandAt } from '../m01-organization/index.js';
import { defaultOfflinePolicy, permissionMatches, type OfflinePolicy, type PermissionCatalogue } from './permissions.js';

export const DEFAULT_LEASE_DAYS = 30;
export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const DAY_MS = 86_400_000;
const FAR_FUTURE = '9999-12-31T23:59:59.999Z';

export const SETTING = { lastHubSync: 'authority.last_hub_sync_at', leaseDays: 'authority.lease_days', clock: 'clock.high_water' } as const;

export function getSetting(db: Db, key: string): string | null {
  const r = db.prepare('SELECT value FROM sys_setting WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function setSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO sys_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(key, value, nowUtc());
}

// ------------------------------------------------------------------ clock safety

export interface ClockState { highWater: string | null; suspect: boolean }

/** The clock is suspect when it is more than 5 minutes behind the highest time this installation has already seen. */
export function clockState(db: Db, now: string = nowUtc()): ClockState {
  const hw = getSetting(db, SETTING.clock);
  return { highWater: hw, suspect: hw !== null && Date.parse(now) < Date.parse(hw) - CLOCK_TOLERANCE_MS };
}

/** Advance the high-water mark (never backwards). Cheap: writes at most once a minute. */
export function touchClock(db: Db, now: string = nowUtc()): void {
  const hw = getSetting(db, SETTING.clock);
  if (hw === null || Date.parse(now) > Date.parse(hw) + 60_000) setSetting(db, SETTING.clock, now);
}

/** Administrator re-establishes the time after a clock fault (audited by the caller). */
export function resetClock(db: Db, now: string = nowUtc()): void {
  setSetting(db, SETTING.clock, now);
}

// ------------------------------------------------------------------ lease

export interface LeaseInfo {
  /** false at the hub: it is the authority and has no lease. */
  applies: boolean;
  lastHubSyncAt: string | null;
  leaseDays: number | null;
  offlineGrantId: string | null;
  leaseExpiresAt: string | null;
  expired: boolean;
}

/** Most specific grant wins: (installation, role) > (installation) > (role) > default row > setting > 30 days. */
export function leaseDaysFor(db: Db, installationId: string, roleId: string | null): { days: number; grantId: string | null } {
  const row = db
    .prepare(
      `SELECT id, lease_days FROM idn_offline_grant
       WHERE deleted_at IS NULL AND (installation_id IS NULL OR installation_id = ?) AND (role_id IS NULL OR role_id = ?)
       ORDER BY (installation_id IS NOT NULL) * 2 + (role_id IS NOT NULL) DESC LIMIT 1`,
    )
    .get(installationId, roleId) as { id: string; lease_days: number } | undefined;
  if (row) return { days: row.lease_days, grantId: row.id };
  const s = Number(getSetting(db, SETTING.leaseDays));
  return { days: Number.isInteger(s) && s >= 1 ? s : DEFAULT_LEASE_DAYS, grantId: null };
}

export function leaseInfo(db: Db, roleId: string | null, userId: string | null, now: string = nowUtc()): LeaseInfo {
  const me = getLocalIdentity(db);
  if (!me || me.kind === 'hub') return { applies: false, lastHubSyncAt: null, leaseDays: null, offlineGrantId: null, leaseExpiresAt: null, expired: false };
  const init = db.prepare('SELECT initialized_at FROM sys_local_identity WHERE singleton = 1').get() as { initialized_at: string } | undefined;
  const last = getSetting(db, SETTING.lastHubSync) ?? init?.initialized_at ?? null; // provisioning counts as hub contact
  const { days, grantId } = leaseDaysFor(db, me.installationId, roleId);
  let expires = last ? new Date(Date.parse(last) + days * DAY_MS).toISOString() : null;
  if (userId) {
    const u = db.prepare('SELECT lease_expires_at FROM idn_user_installation WHERE user_id = ? AND installation_id = ? AND deleted_at IS NULL').get(userId, me.installationId) as { lease_expires_at: string | null } | undefined;
    if (u?.lease_expires_at && (!expires || u.lease_expires_at < expires)) expires = u.lease_expires_at;
  }
  return { applies: true, lastHubSyncAt: last, leaseDays: days, offlineGrantId: grantId, leaseExpiresAt: expires, expired: expires !== null && expires <= now };
}

// ------------------------------------------------------------------ revocation

/** Latest revoke/reinstate event at or before `at` decides (events can arrive late, so this is evaluated by effective time). */
export function isRevokedAt(db: Db, userId: string, assignmentId: string | null, at: string): boolean {
  const latest = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { kind: string } | undefined)?.kind;
  if (latest('SELECT kind FROM idn_authority_revocation WHERE user_id = ? AND role_assignment_id IS NULL AND effective_at <= ? ORDER BY effective_at DESC, id DESC LIMIT 1', userId, at) === 'revoke') return true;
  if (assignmentId && latest('SELECT kind FROM idn_authority_revocation WHERE role_assignment_id = ? AND effective_at <= ? ORDER BY effective_at DESC, id DESC LIMIT 1', assignmentId, at) === 'revoke') return true;
  return false;
}

// ------------------------------------------------------------------ grants

export interface Grant { assignmentId: string; roleId: string; roleCode: string; scopeKind: string; scopeId: string | null; permissions: string[] }

export function userIsActive(db: Db, userId: string): boolean {
  const u = db.prepare("SELECT status FROM idn_user WHERE id = ? AND deleted_at IS NULL").get(userId) as { status: string } | undefined;
  return u?.status === 'active';
}

/** Assignments in force at `at`: live, dated, role active, not revoked. Empty for inactive/unknown users. */
export function activeGrants(db: Db, userId: string, at: string = nowUtc()): Grant[] {
  if (!userIsActive(db, userId)) return [];
  const rows = db
    .prepare(
      `SELECT a.id AS assignment_id, a.role_id, a.scope_kind, a.scope_id, r.code AS role_code
       FROM idn_role_assignment a JOIN idn_role r ON r.id = a.role_id AND r.deleted_at IS NULL AND r.status = 'active'
       WHERE a.user_id = ? AND a.deleted_at IS NULL AND a.valid_from <= ? AND COALESCE(a.valid_until, '${FAR_FUTURE}') > ?`,
    )
    .all(userId, at, at) as Array<{ assignment_id: string; role_id: string; scope_kind: string; scope_id: string | null; role_code: string }>;
  const perms = db.prepare('SELECT permission FROM idn_role_permission WHERE role_id = ? AND deleted_at IS NULL');
  return rows
    .filter((r) => !isRevokedAt(db, userId, r.assignment_id, at))
    .map((r) => ({
      assignmentId: r.assignment_id, roleId: r.role_id, roleCode: r.role_code, scopeKind: r.scope_kind, scopeId: r.scope_id,
      permissions: (perms.all(r.role_id) as Array<{ permission: string }>).map((p) => p.permission),
    }));
}

/** Command-scoped grants reach that command's ships (as attached now); other scope kinds match by identity. */
export function scopeCovers(db: Db, g: Grant, scope: ScopeRef | undefined, at: string): boolean {
  if (g.scopeKind === 'fleet') return true;
  if (!scope?.id || scope.kind === 'fleet') return false;
  if (scope.kind === g.scopeKind && scope.id === g.scopeId) return true;
  if (g.scopeKind === 'command' && scope.kind === 'ship') return getShipCommandAt(db, scope.id, at)?.commandId === g.scopeId;
  return false;
}

export const isApprovalClass = (permission: string): boolean => defaultOfflinePolicy(permission) === 'provisional';

export function offlinePolicyFor(db: Db, permission: string): OfflinePolicy {
  const o = db.prepare('SELECT offline_policy FROM idn_gate_policy WHERE gate_code = ? AND deleted_at IS NULL').get(permission) as { offline_policy: OfflinePolicy } | undefined;
  return o?.offline_policy ?? defaultOfflinePolicy(permission);
}

/**
 * Core decision. `scope === 'any'` asks "does this user hold the permission anywhere?" - used by the ApprovalPort,
 * whose callers have already made the scoped check with the Authorizer.
 */
export function checkAuthority(db: Db, principal: Principal, permission: string, scope: ScopeRef | undefined | 'any'): AuthDecision {
  const now = nowUtc();
  if (!userIsActive(db, principal.userId)) return { allowed: false, reason: 'Unknown or inactive user' };
  const action = permission.split('.')[2];
  const sc: ScopeRef | undefined = scope === 'any' ? undefined : scope;
  const anyScope = scope === 'any' || (action === 'view' && (!sc || sc.kind === 'fleet' || !sc.id));
  const grant = activeGrants(db, principal.userId, now).find(
    (g) => g.permissions.some((p) => permissionMatches(p, permission)) && (anyScope || scopeCovers(db, g, sc, now)),
  );
  if (!grant) return { allowed: false, reason: `No role grants ${permission} here` };

  if (isApprovalClass(permission) && clockState(db, now).suspect) {
    return { allowed: false, reason: 'CLOCK_SUSPECT: the system clock is behind its last known time; an administrator must re-establish the time before approvals' };
  }
  const lease = leaseInfo(db, grant.roleId, principal.userId, now);
  const basis: NonNullable<AuthDecision['basis']> = { roleAssignmentId: grant.assignmentId, ...(lease.offlineGrantId ? { offlineGrantId: lease.offlineGrantId } : {}) };
  if (!lease.expired) return { allowed: true, basis };
  const policy = offlinePolicyFor(db, permission);
  if (policy === 'deny') return { allowed: false, reason: `AUTHORITY_EXPIRED: offline authority lapsed ${lease.leaseExpiresAt}; synchronize with headquarters` };
  return policy === 'provisional' ? { allowed: true, provisional: true, basis } : { allowed: true, basis };
}

export function createIdentityAuthorizer(db: Db): Authorizer {
  return { name: 'idn-authorizer', check: (principal, permission, scope) => checkAuthority(db, principal, permission, scope) };
}

/** Permission codes this user holds at any scope, expanded against the catalogue. For the UI only; the server checks every call. */
export function effectivePermissions(db: Db, userId: string, catalogue: PermissionCatalogue, now: string = nowUtc()): { permissions: string[]; restricted: Record<string, OfflinePolicy> } {
  const patterns = activeGrants(db, userId, now).flatMap((g) => g.permissions);
  const codes = new Set(catalogue.list().filter((c) => patterns.some((p) => permissionMatches(p, c))));
  for (const p of patterns) if (!p.includes('*')) codes.add(p);
  const expired = leaseInfo(db, null, userId, now).expired;
  const restricted: Record<string, OfflinePolicy> = {};
  if (expired) for (const c of codes) { const pol = offlinePolicyFor(db, c); if (pol !== 'allow') restricted[c] = pol; }
  return { permissions: [...codes].sort(), restricted };
}
