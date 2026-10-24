import type { EntityDef } from '../../platform/entity-registry.js';

/**
 * Classifications and the legacy crosswalk are hub reference data. Positions, responsibilities and assets are written by the installation that holds them
 * (ship or workshop) and follow their ship scope. Movements are append-only events from any installation.
 * ast_asset_current is derived: rebuilt locally from movements, never synchronized.
 */
export const AST_ENTITIES: readonly EntityDef[] = [
  { type: 'ast.classification', module: 'M03', table: 'ast_classification', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'ast.classification_map', module: 'M03', table: 'ast_classification_map', recordClass: 'hub_reference', requires: ['ast.classification'], distribution: 'fleet' },
  { type: 'ast.position', module: 'M03', table: 'ast_position', recordClass: 'owner_mutable', requires: ['org.ship', 'ast.classification'], distribution: 'record' },
  { type: 'ast.position_responsibility', module: 'M03', table: 'ast_position_responsibility', recordClass: 'owner_mutable', requires: ['ast.position', 'org.department'], distribution: 'record' },
  { type: 'ast.asset', module: 'M03', table: 'ast_asset', recordClass: 'owner_mutable', requires: ['ast.classification'], distribution: 'record' },
  { type: 'ast.asset_movement', module: 'M03', table: 'ast_asset_movement', recordClass: 'event', requires: ['ast.asset', 'ast.position'], distribution: 'record' },
  { type: 'ast.asset_current', module: 'M03', table: 'ast_asset_current', recordClass: 'derived', distribution: 'record' },
];
