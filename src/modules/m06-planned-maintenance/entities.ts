import type { EntityDef } from '../../platform/entity-registry.js';

/** Templates are hub reference data; plans and meters belong to the installation that holds the equipment; readings and calibrations are append-only events. */
export const PM_ENTITIES: readonly EntityDef[] = [
  { type: 'pm.task_template', module: 'M06', table: 'pm_task_template', recordClass: 'hub_reference', requires: ['ast.classification'], distribution: 'fleet' },
  { type: 'pm.meter', module: 'M06', table: 'pm_meter', recordClass: 'owner_mutable', requires: ['ast.asset'], distribution: 'record' },
  { type: 'pm.meter_reading', module: 'M06', table: 'pm_meter_reading', recordClass: 'event', requires: ['pm.meter'], distribution: 'record' },
  { type: 'pm.plan', module: 'M06', table: 'pm_plan', recordClass: 'owner_mutable', requires: ['pm.task_template', 'pm.meter', 'ast.asset'], distribution: 'record' },
  { type: 'pm.calibration_record', module: 'M06', table: 'pm_calibration_record', recordClass: 'event', requires: ['ast.asset'], distribution: 'record' },
];
