import { register } from '../../src/modules/m06-planned-maintenance/index.js';
import { createMeter } from '../../src/modules/m06-planned-maintenance/service.js';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { makeStkEnv, type StkEnv } from './stk-helpers.js';

export interface PmEnv extends StkEnv {
  /** An asset on the default ship. */
  pmAsset(name?: string, shipId?: string): string;
  /** A running-hours meter on an asset. */
  meter(assetId: string, name?: string): string;
}

/** M07 environment (M05 work numbers included) plus M06 registered. */
export function makePmEnv(opts: { devAuth?: boolean } = {}): PmEnv {
  const env = makeStkEnv(opts);
  register(env.ctx, env.app);
  let n = 0;
  return {
    ...env,
    pmAsset: (name = `Machine ${++n}`, shipId = env.shipId) => createAsset(env.hubActor(), { name, homeShipId: shipId }).asset.id as string,
    meter: (assetId, name = `Hours ${++n}`) => createMeter(env.hubActor(), { assetId, name }).id as string,
  };
}
export const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();
export const hoursAgo = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
