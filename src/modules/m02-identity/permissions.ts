import { PERMISSION_RE } from '../../platform/authz.js';
import { ORG_PERMISSIONS } from '../m01-organization/index.js';

/** Permission codes `idn.<noun>.<action>` (CONTRACTS §7). */
export const IDN_NOUNS = [
  'user', 'credential', 'user_installation', 'role', 'role_permission', 'role_assignment',
  'offline_grant', 'gate_policy', 'approval', 'revocation',
] as const;
export type IdnNoun = (typeof IDN_NOUNS)[number];
export const IDN_ACTIONS = ['view', 'create', 'update', 'remove'] as const;
export type IdnAction = (typeof IDN_ACTIONS)[number];
export const perm = (noun: IdnNoun, action: IdnAction | string): string => `idn.${noun}.${action}`;

export const IDN_PERMISSIONS: readonly string[] = [
  ...IDN_NOUNS.flatMap((n) => IDN_ACTIONS.map((a) => perm(n, a))),
  'idn.credential.reset_local',
  'idn.clock.reset',
];

/** Wildcards a role may hold: `*` (everything) or `<prefix>.*`. Everything else must be a well-formed exact code. */
const WILDCARD_RE = /^[a-z]{2,4}\.\*$/;
export const isValidRolePermission = (p: string): boolean => p === '*' || WILDCARD_RE.test(p) || PERMISSION_RE.test(p);

export function permissionMatches(granted: string, wanted: string): boolean {
  if (granted === '*' || granted === wanted) return true;
  return granted.endsWith('.*') && wanted.startsWith(granted.slice(0, -1));
}

export type OfflinePolicy = 'allow' | 'provisional' | 'deny';

const APPROVAL_ACTIONS = new Set(['approve', 'reject', 'ratify', 'review', 'clear', 'close', 'confirm', 'accept', 'authorize']);

/**
 * Default handling once the offline authority lease has expired (SYNC_RULES §6):
 * routine work and data entry stay `allow`; approvals/return-to-service/closure are `provisional`
 * (done, stamped pending confirmation); identity administration is `deny`. Revoking authority is always allowed.
 * A row in idn_gate_policy overrides this per code.
 */
export function defaultOfflinePolicy(permission: string): OfflinePolicy {
  if (permission === 'idn.revocation.create') return 'allow';
  if (permission.startsWith('idn.')) return 'deny';
  const action = permission.split('.')[2] ?? '';
  return APPROVAL_ACTIONS.has(action) ? 'provisional' : 'allow';
}

/** Known permission codes: this module's, M01's, and whatever other modules announce on the event bus (D25). */
export class PermissionCatalogue {
  private codes = new Set<string>([...IDN_PERMISSIONS, ...ORG_PERMISSIONS]);
  add(codes: readonly string[]): void {
    for (const c of codes) if (PERMISSION_RE.test(c)) this.codes.add(c);
  }
  list(): string[] {
    return [...this.codes].sort();
  }
}
