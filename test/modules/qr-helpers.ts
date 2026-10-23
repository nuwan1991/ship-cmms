import { register } from '../../src/modules/m04-labels-survey/index.js';
import { ensureLabelSequence, grantLabelRange } from '../../src/modules/m04-labels-survey/seed.js';
import { makeAstEnv, type AstEnv } from './ast-helpers.js';

export interface QrEnv extends AstEnv {
  /** Give an installation a block of label numbers, as the hub does. */
  grantLabels(installationId: string, size: number): void;
}

/** M03 environment plus M04 registered, the label sequence defined and the hub holding `hubLabels` numbers. */
export function makeQrEnv(opts: { devAuth?: boolean; hubLabels?: number; hubRange?: number } = {}): QrEnv {
  const env = makeAstEnv(opts);
  register(env.ctx, env.app);
  ensureLabelSequence(env.hubActor().wctx);
  const grantLabels = (installationId: string, size: number) => void grantLabelRange(env.hubActor().wctx, installationId, size);
  if (opts.hubLabels !== 0) grantLabels(env.hub.installationId, opts.hubLabels ?? 50);
  return { ...env, grantLabels };
}
