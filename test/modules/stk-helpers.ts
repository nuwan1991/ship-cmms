import { register } from '../../src/modules/m07-stores/index.js';
import { ensureStoreSequence, grantStoreRange } from '../../src/modules/m07-stores/seed.js';
import { createWorkOrder } from '../../src/modules/m05-work/index.js';
import { createLocation, createPart } from '../../src/modules/m07-stores/service.js';
import { makeWrkEnv, type WrkEnv } from './wrk-helpers.js';

export interface StkEnv extends WrkEnv {
  grantStore(installationId: string, size: number): void;
  /** Create a part (hub) and return its id. */
  part(partNo?: string, over?: Record<string, unknown>): string;
  /** Create a stock location; `siteId` null = fleet store. */
  loc(code?: string, siteId?: string | null): string;
  /** A work order on the default ship, returning its id. */
  workOrder(title?: string, shipId?: string): string;
}

/** M05 environment plus M07 registered, the transfer sequence defined and the hub holding `hubTransfers` numbers. */
export function makeStkEnv(opts: { devAuth?: boolean; hubTransfers?: number } = {}): StkEnv {
  const env = makeWrkEnv(opts);
  register(env.ctx, env.app);
  ensureStoreSequence(env.hubActor().wctx);
  const grantStore = (installationId: string, size: number) => void grantStoreRange(env.hubActor().wctx, installationId, size);
  if (opts.hubTransfers !== 0) grantStore(env.hub.installationId, opts.hubTransfers ?? 50);
  let n = 0;
  return {
    ...env,
    grantStore,
    part: (partNo = `P-${++n}`, over = {}) => createPart(env.hubActor(), { partNo, name: `Part ${partNo}`, ...over }).id as string,
    loc: (code = `L-${++n}`, siteId = null) => createLocation(env.hubActor(), { code, name: `Location ${code}`, siteId }).id as string,
    workOrder: (title = 'Replace seal', shipId = env.shipId) => createWorkOrder(env.asHub(), { title, shipId }).id as string,
  };
}
