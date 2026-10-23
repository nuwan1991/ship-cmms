/**
 * Single source of truth for module boundaries. MODULE_MAP.md explains it;
 * tools/check-boundaries.ts enforces it (imports, table prefixes, acyclic deps).
 *
 * Rule: a module may import only (a) src/platform and (b) the public `index.ts`
 * of modules listed in its `dependsOn`. Everything else goes through ports
 * registered at runtime (src/platform/ports.ts, entity-registry.ts).
 */
export const MODULE_IDS = [
  'M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07',
  'M08', 'M09', 'M10', 'M11', 'M12', 'M13', 'M14',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
export type OwnerModule = ModuleId | 'platform';

export interface ModuleManifest {
  id: ModuleId;
  /** directory under src/modules */
  dir: string;
  /** every table/view this module creates must start with `<tablePrefix>_` */
  tablePrefix: string;
  /** HTTP routes owned by this module */
  apiPrefix: string;
  /** direct import dependencies (public index.ts only) */
  dependsOn: readonly ModuleId[];
}

export const PLATFORM_TABLE_PREFIX = 'sys';

export const MODULES: readonly ModuleManifest[] = [
  { id: 'M01', dir: 'm01-organization', tablePrefix: 'org', apiPrefix: '/api/v1/org', dependsOn: [] },
  { id: 'M02', dir: 'm02-identity', tablePrefix: 'idn', apiPrefix: '/api/v1/identity', dependsOn: ['M01'] },
  { id: 'M03', dir: 'm03-assets', tablePrefix: 'ast', apiPrefix: '/api/v1/assets', dependsOn: ['M01'] },
  { id: 'M04', dir: 'm04-labels-survey', tablePrefix: 'qr', apiPrefix: '/api/v1/labels', dependsOn: ['M01', 'M03'] },
  { id: 'M05', dir: 'm05-work', tablePrefix: 'wrk', apiPrefix: '/api/v1/work', dependsOn: ['M01', 'M03'] },
  { id: 'M06', dir: 'm06-planned-maintenance', tablePrefix: 'pm', apiPrefix: '/api/v1/pm', dependsOn: ['M01', 'M03', 'M05'] },
  { id: 'M07', dir: 'm07-stores', tablePrefix: 'stk', apiPrefix: '/api/v1/stores', dependsOn: ['M01', 'M03', 'M05'] },
  { id: 'M08', dir: 'm08-workshops', tablePrefix: 'res', apiPrefix: '/api/v1/workshops', dependsOn: ['M01', 'M02'] },
  { id: 'M09', dir: 'm09-planning', tablePrefix: 'pln', apiPrefix: '/api/v1/planning', dependsOn: ['M01', 'M03', 'M05', 'M06', 'M07', 'M08'] },
  { id: 'M10', dir: 'm10-sync', tablePrefix: 'syn', apiPrefix: '/api/v1/sync', dependsOn: [] },
  { id: 'M11', dir: 'm11-excel', tablePrefix: 'xls', apiPrefix: '/api/v1/excel', dependsOn: [] },
  { id: 'M12', dir: 'm12-monitoring', tablePrefix: 'mon', apiPrefix: '/api/v1/monitoring', dependsOn: ['M01', 'M03'] },
  { id: 'M13', dir: 'm13-reports', tablePrefix: 'rpt', apiPrefix: '/api/v1/reports', dependsOn: [] },
  { id: 'M14', dir: 'm14-operations', tablePrefix: 'ops', apiPrefix: '/api/v1/ops', dependsOn: [] },
];

export const moduleById = (id: ModuleId): ModuleManifest => {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown module ${id}`);
  return m;
};

/** Dependency-first order for migrations. Throws on a cycle. */
export function topoOrder(mods: readonly ModuleManifest[] = MODULES): ModuleManifest[] {
  const out: ModuleManifest[] = [];
  const state = new Map<ModuleId, 1 | 2>();
  const visit = (m: ModuleManifest, path: ModuleId[]) => {
    if (state.get(m.id) === 2) return;
    if (state.get(m.id) === 1) throw new Error(`Module dependency cycle: ${[...path, m.id].join(' -> ')}`);
    state.set(m.id, 1);
    for (const d of m.dependsOn) {
      const dep = mods.find((x) => x.id === d);
      if (!dep) throw new Error(`${m.id} depends on unknown module ${d}`);
      visit(dep, [...path, m.id]);
    }
    state.set(m.id, 2);
    out.push(m);
  };
  for (const m of mods) visit(m, []);
  return out;
}
