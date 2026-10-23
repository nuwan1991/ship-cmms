/**
 * Effective permissions of the signed-in user, as returned by the identity API (/me). The server enforces every
 * permission regardless (Authorizer port); this only decides what the UI shows. Roles may hold `*` or `<prefix>.*`.
 */
let granted: readonly string[] = [];

export function setPermissions(list: readonly string[] | null): void {
  granted = list ?? [];
}

export function permissionMatches(grant: string, wanted: string): boolean {
  if (grant === '*' || grant === wanted) return true;
  return grant.endsWith('.*') && wanted.startsWith(grant.slice(0, -1));
}

export const can = (permission: string): boolean => granted.some((g) => permissionMatches(g, permission));
