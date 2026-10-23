import type { EntityDef } from '../../platform/entity-registry.js';

/** Catalogue and compatibility are hub reference data; locations, levels and transfer documents belong to the site that holds them; stock changes are append-only events. */
export const STK_ENTITIES: readonly EntityDef[] = [
  { type: 'stk.part', module: 'M07', table: 'stk_part', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'stk.part_compatibility', module: 'M07', table: 'stk_part_compatibility', recordClass: 'hub_reference', requires: ['stk.part', 'ast.classification'], distribution: 'fleet' },
  { type: 'stk.location', module: 'M07', table: 'stk_location', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'stk.stock_level', module: 'M07', table: 'stk_stock_level', recordClass: 'owner_mutable', requires: ['stk.part', 'stk.location'], distribution: 'record' },
  { type: 'stk.transaction', module: 'M07', table: 'stk_transaction', recordClass: 'event', requires: ['stk.part', 'stk.location'], distribution: 'record' },
  { type: 'stk.reservation', module: 'M07', table: 'stk_reservation', recordClass: 'event', requires: ['stk.part', 'stk.location'], distribution: 'record' },
  { type: 'stk.transfer', module: 'M07', table: 'stk_transfer', recordClass: 'owner_mutable', requires: ['stk.location'], distribution: 'record' },
];
