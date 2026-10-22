/**
 * Placeholder until M02 exposes the signed-in user's effective permissions.
 * The server enforces every permission regardless (Authorizer port); this only decides what the UI hides.
 * TODO(M02): replace with a call to the identity API and cache per session.
 */
export const can = (_permission: string): boolean => true;
