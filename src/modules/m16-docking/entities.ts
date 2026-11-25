import type { EntityDef } from '../../platform/entity-registry.js';

/** Docks are hub reference data; a docking and its work list belong to the installation that planned it and follow the ship; survey findings are append-only events. */
export const DCK_ENTITIES: readonly EntityDef[] = [
  { type: 'dck.dock', module: 'M16', table: 'dck_dock', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'dck.docking', module: 'M16', table: 'dck_docking', recordClass: 'owner_mutable', requires: ['org.ship', 'dck.dock'], distribution: 'record' },
  { type: 'dck.work_item', module: 'M16', table: 'dck_work_item', recordClass: 'owner_mutable', requires: ['dck.docking'], distribution: 'record' },
  { type: 'dck.survey_record', module: 'M16', table: 'dck_survey_record', recordClass: 'event', requires: ['dck.docking'], distribution: 'record' },
];
