import { register } from '../../src/modules/m11-excel/index.js';
import { writeXlsx } from '../../src/modules/m11-excel/xlsx.js';
import type { Principal } from '../../src/platform/contracts.js';
import { makeStkEnv, type StkEnv } from './stk-helpers.js';

export interface XlsEnv extends StkEnv {
  principal(): Principal;
}

/** M07 environment (so M01, M03 and M07 templates exist) plus M11 registered. */
export function makeXlsEnv(opts: { devAuth?: boolean } = {}): XlsEnv {
  const env = makeStkEnv(opts);
  register(env.ctx, env.app);
  return { ...env, principal: () => env.hubActor().principal };
}

type Cell = string | number | boolean | null;
/** A workbook with a Data sheet: header row then data rows. */
export const xlsxBase64 = (header: string[], rows: Cell[][], sheet = 'Data'): string =>
  Buffer.from(writeXlsx([{ name: sheet, rows: [header, ...rows] }])).toString('base64');
export const csvBase64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
