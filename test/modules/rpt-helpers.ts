import { register as m10 } from '../../src/modules/m10-sync/index.js';
import { register as m13 } from '../../src/modules/m13-reports/index.js';
import { makePmEnv, type PmEnv } from './pm-helpers.js';

/** M06 environment (M01-M07) plus M10 (its published views) and M13 registered. */
export function makeRptEnv(opts: { devAuth?: boolean } = {}): PmEnv {
  const env = makePmEnv(opts);
  m10(env.ctx, env.app);
  m13(env.ctx, env.app);
  return env;
}
