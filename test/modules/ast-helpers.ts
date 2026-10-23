import { register } from '../../src/modules/m03-assets/index.js';
import { ensureTagSequence, grantTagRange } from '../../src/modules/m03-assets/seed.js';
import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import { makeOrgEnv, type OrgEnv } from './org-helpers.js';

export interface AstEnv extends OrgEnv {
  fleetId: string;
  shipId: string;
  ship2Id: string;
  meId: string;
  eeId: string;
  /** Give an installation (hub or ship) a block of equipment-tag numbers, as the hub does. */
  grant(installationId: string, size: number): void;
}

/** Org graph (fleet, two ships, ME and EE departments) with M03 registered and the equipment-tag sequence defined. */
export function makeAstEnv(opts: { devAuth?: boolean; hubRange?: number } = {}): AstEnv {
  const env = makeOrgEnv(opts);
  register(env.ctx, env.app);
  const a = env.hubActor();
  const fleet = createOrg(a, 'fleet', { code: 'F1', name: 'Fleet' });
  const ship = createOrg(a, 'ship', { code: 'SH1', name: 'Ship One', pennantNo: 'P1' });
  const ship2 = createOrg(a, 'ship', { code: 'SH2', name: 'Ship Two', pennantNo: 'P2' });
  const me = createOrg(a, 'department', { code: 'ME', name: 'Marine Engineering' });
  const ee = createOrg(a, 'department', { code: 'EE', name: 'Electrical Engineering' });
  ensureTagSequence(a.wctx);
  const grant = (installationId: string, size: number) => void grantTagRange(env.hubActor().wctx, installationId, size);
  if (opts.hubRange !== 0) grant(env.hub.installationId, opts.hubRange ?? 50);
  return { ...env, fleetId: fleet.id as string, shipId: ship.id as string, ship2Id: ship2.id as string, meId: me.id as string, eeId: ee.id as string, grant };
}

export const iso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const sql = (env: OrgEnv, q: string, ...params: unknown[]): Array<Record<string, any>> => env.ctx.db.prepare(q).all(...params) as Array<Record<string, any>>;

export function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? `non-AppError: ${(e as Error).message}`;
  }
  return 'NO_ERROR';
}
