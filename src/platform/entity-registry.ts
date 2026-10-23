import type { RecordClass } from './contracts.js';
import { MODULES, PLATFORM_TABLE_PREFIX, type OwnerModule } from './modules.js';

/**
 * Every persisted entity is registered with its record class (who may write it,
 * how it syncs). M10 (sync), M11 (Excel) and the write path read this registry,
 * so they never need to import module code.
 */
export interface EntityDef {
  /** `<prefix>.<name>`, e.g. org.ship */
  type: string;
  module: OwnerModule;
  /** `<prefix>_<name>` */
  table: string;
  recordClass: RecordClass;
  /** Entity types that must exist locally before this one can be applied (sync dependency closure). */
  requires?: readonly string[];
  /** 'fleet' = replicated to every installation (reference data); 'record' = follows home_scope_id. */
  distribution: 'fleet' | 'record';
  /** Columns whose values must never appear in the (widely replicated) audit envelope, e.g. password hashes. The sync payload still carries them. */
  redact?: readonly string[];
  /**
   * For 'record' entities that follow an installation instead of a ship or site (users provisioned to a ship, their credentials).
   * Delivered to installation X when `installationColumn` equals X, or when a live row of `viaType` links `column` to X.
   * Without a matching rule such a record reaches nobody, so a credential never leaves the hub by accident.
   */
  audience?: { installationColumn: string } | { column: string; viaType: string; viaColumn: string; viaInstallationColumn: string };
}

export class EntityRegistry {
  private defs = new Map<string, EntityDef>();

  register(def: EntityDef): void {
    const prefix = def.module === 'platform' ? PLATFORM_TABLE_PREFIX : MODULES.find((m) => m.id === def.module)?.tablePrefix;
    if (!prefix) throw new Error(`Unknown module ${def.module}`);
    const [tp, name] = def.type.split('.');
    if (tp !== prefix || !name) throw new Error(`Entity type ${def.type} must start with "${prefix}."`);
    if (def.table !== `${prefix}_${name}`) throw new Error(`Table for ${def.type} must be ${prefix}_${name}`);
    if (this.defs.has(def.type)) throw new Error(`Entity ${def.type} already registered`);
    this.defs.set(def.type, def);
  }

  get(type: string): EntityDef {
    const d = this.defs.get(type);
    if (!d) throw new Error(`Unregistered entity type ${type}`);
    return d;
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  all(): EntityDef[] {
    return [...this.defs.values()];
  }

  /** Dependency types must be registered and must not form a cycle (sync applies parents first). */
  validate(): string[] {
    const problems: string[] = [];
    for (const d of this.defs.values()) {
      for (const r of d.requires ?? []) if (!this.defs.has(r)) problems.push(`${d.type} requires unregistered ${r}`);
    }
    const seen = new Map<string, 1 | 2>();
    const visit = (t: string, path: string[]) => {
      if (seen.get(t) === 2) return;
      if (seen.get(t) === 1) return void problems.push(`Entity dependency cycle: ${[...path, t].join(' -> ')}`);
      seen.set(t, 1);
      for (const r of this.defs.get(t)?.requires ?? []) if (this.defs.has(r)) visit(r, [...path, t]);
      seen.set(t, 2);
    };
    for (const t of this.defs.keys()) visit(t, []);
    return problems;
  }
}

export const PLATFORM_ENTITIES: readonly EntityDef[] = [
  { type: 'sys.installation', module: 'platform', table: 'sys_installation', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'sys.audit_event', module: 'platform', table: 'sys_audit_event', recordClass: 'event', distribution: 'record' },
  { type: 'sys.number_sequence', module: 'platform', table: 'sys_number_sequence', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'sys.number_range', module: 'platform', table: 'sys_number_range', recordClass: 'hub_reference', requires: ['sys.number_sequence'], distribution: 'record' },
];

export function createPlatformRegistry(): EntityRegistry {
  const r = new EntityRegistry();
  for (const d of PLATFORM_ENTITIES) r.register(d);
  return r;
}
