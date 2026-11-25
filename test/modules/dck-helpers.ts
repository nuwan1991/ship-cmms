import { register } from '../../src/modules/m16-docking/index.js';
import { createDock, createDocking } from '../../src/modules/m16-docking/service.js';
import { createAsset } from '../../src/modules/m03-assets/service.js';
import { makeWrkEnv, type WrkEnv } from './wrk-helpers.js';

export interface DckEnv extends WrkEnv {
  /** A dock (hub reference data); returns its id. */
  dock(code?: string, over?: Record<string, unknown>): string;
  /** A planned docking of a ship; returns its id. */
  docking(over?: Record<string, unknown>): string;
  /** An asset on a ship. */
  asset(name?: string, shipId?: string): string;
}

/** M05 environment (work numbers included) plus M16 registered. */
export function makeDckEnv(opts: { devAuth?: boolean } = {}): DckEnv {
  const env = makeWrkEnv(opts);
  register(env.ctx, env.app);
  let n = 0;
  return {
    ...env,
    dock: (code = `DK-${++n}`, over = {}) => createDock(env.hubActor(), { code, name: `Dock ${code}`, kind: 'graving_dock', ...over }).id as string,
    docking: (over = {}) => createDocking(env.hubActor(), { shipId: env.shipId, plannedDockIn: day(-2), plannedUndock: day(20), ...over }).dockingId as string,
    asset: (name = `Machine ${++n}`, shipId = env.shipId) => createAsset(env.hubActor(), { name, classificationId: env.eqClassId, homeShipId: shipId }).asset.id as string,
  };
}
/** Today plus `d` days as YYYY-MM-DD (UTC). */
export const day = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
export const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();
