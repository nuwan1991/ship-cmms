import { createEntity as createOrg } from '../../src/modules/m01-organization/service.js';
import { register } from '../../src/modules/m15-office/index.js';
import { grantOfficeRanges } from '../../src/modules/m15-office/numbering.js';
import { makeWrkEnv, type WrkEnv } from './wrk-helpers.js';

export interface OfcEnv extends WrkEnv {
  /** The M01 command the office belongs to (the dockyard). */
  commandId: string;
}

/** M05 environment plus M15 registered, a dockyard command, and the hub holding office numbers. */
export function makeOfcEnv(opts: { devAuth?: boolean } = {}): OfcEnv {
  const env = makeWrkEnv(opts);
  register(env.ctx, env.app);
  const cmd = createOrg(env.hubActor(), 'command', { code: 'DY-N', name: 'Dockyard North' });
  grantOfficeRanges(env.hubActor().wctx, env.hub.installationId, 100);
  return { ...env, commandId: cmd.id as string };
}
