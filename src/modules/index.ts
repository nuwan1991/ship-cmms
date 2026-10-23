import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../platform/app-context.js';
import type { ModuleId } from '../platform/modules.js';
import { register as m01 } from './m01-organization/index.js';
import { register as m02 } from './m02-identity/index.js';
import { register as m03 } from './m03-assets/index.js';
import { register as m04 } from './m04-labels-survey/index.js';
import { register as m05 } from './m05-work/index.js';
import { register as m07 } from './m07-stores/index.js';
import { register as m11 } from './m11-excel/index.js';

/**
 * Composition root for modules. Each built module adds ONE line here:
 *   import { register as m01 } from './m01-organization/index.js';
 * and exposes `register(ctx, app)` which (a) registers its entities in ctx.entities,
 * (b) mounts routes under its apiPrefix, (c) registers ports it implements.
 * This file is the only place that imports from more than one module.
 */
export interface ModuleRegistration {
  id: ModuleId;
  register(ctx: AppContext, app: FastifyInstance): void;
}

export const moduleRegistrations: readonly ModuleRegistration[] = [
  // Add in dependency order (see MODULE_MAP.md).
  { id: 'M01', register: m01 },
  { id: 'M02', register: m02 },
  { id: 'M03', register: m03 },
  { id: 'M04', register: m04 },
  { id: 'M05', register: m05 },
  { id: 'M07', register: m07 },
  { id: 'M11', register: m11 },
];
