import type { Authorizer } from '../../platform/authz.js';

/** Seed-only authorizer: the demo seed is an operator action at the hub, not a user request. Not exported from index.ts. */
export const allowAllAuthorizer: Authorizer = { name: 'seed-allow-all', check: () => ({ allowed: true, reason: 'seed' }) };
