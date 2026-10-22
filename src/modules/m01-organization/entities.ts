import type { EntityDef } from '../../platform/entity-registry.js';

/**
 * Registered at startup so M10 (sync) and M11 (Excel) can act on org data without importing this module.
 * Reference data is hub-written and replicated fleet-wide; locations are written by the installation that holds the site.
 */
export const ORG_ENTITIES: readonly EntityDef[] = [
  { type: 'org.fleet', module: 'M01', table: 'org_fleet', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'org.command', module: 'M01', table: 'org_command', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'org.ship', module: 'M01', table: 'org_ship', recordClass: 'hub_reference', requires: ['org.fleet'], distribution: 'fleet' },
  { type: 'org.ship_command_assignment', module: 'M01', table: 'org_ship_command_assignment', recordClass: 'hub_reference', requires: ['org.ship', 'org.command'], distribution: 'fleet' },
  { type: 'org.department', module: 'M01', table: 'org_department', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'org.workshop', module: 'M01', table: 'org_workshop', recordClass: 'hub_reference', requires: ['org.command', 'org.ship'], distribution: 'fleet' },
  { type: 'org.external_provider', module: 'M01', table: 'org_external_provider', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'org.location', module: 'M01', table: 'org_location', recordClass: 'owner_mutable', requires: ['org.ship', 'org.workshop'], distribution: 'record' },
];
