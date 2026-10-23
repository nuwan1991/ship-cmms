import type { EntityDef } from '../../platform/entity-registry.js';

/** Work records are written by the installation that holds them; status, labour, findings, tests, acceptance and hand-over are append-only events from any installation. */
export const WRK_ENTITIES: readonly EntityDef[] = [
  { type: 'wrk.advisory', module: 'M05', table: 'wrk_advisory', recordClass: 'hub_reference', requires: ['ast.classification'], distribution: 'fleet' },
  { type: 'wrk.defect', module: 'M05', table: 'wrk_defect', recordClass: 'owner_mutable', requires: ['ast.asset', 'ast.position'], distribution: 'record' },
  { type: 'wrk.repair_case', module: 'M05', table: 'wrk_repair_case', recordClass: 'owner_mutable', requires: ['ast.asset', 'ast.position'], distribution: 'record' },
  { type: 'wrk.work_order', module: 'M05', table: 'wrk_work_order', recordClass: 'owner_mutable', requires: ['wrk.repair_case', 'ast.asset', 'ast.position', 'org.workshop'], distribution: 'record' },
  { type: 'wrk.job_card', module: 'M05', table: 'wrk_job_card', recordClass: 'owner_mutable', requires: ['wrk.work_order'], distribution: 'record' },
  { type: 'wrk.status_event', module: 'M05', table: 'wrk_status_event', recordClass: 'event', requires: ['wrk.work_order', 'wrk.repair_case'], distribution: 'record' },
  { type: 'wrk.labour_entry', module: 'M05', table: 'wrk_labour_entry', recordClass: 'event', requires: ['wrk.work_order'], distribution: 'record' },
  { type: 'wrk.finding', module: 'M05', table: 'wrk_finding', recordClass: 'event', requires: ['wrk.work_order'], distribution: 'record' },
  { type: 'wrk.test_record', module: 'M05', table: 'wrk_test_record', recordClass: 'event', requires: ['wrk.work_order'], distribution: 'record' },
  { type: 'wrk.acceptance', module: 'M05', table: 'wrk_acceptance', recordClass: 'event', requires: ['wrk.work_order'], distribution: 'record' },
  { type: 'wrk.handover', module: 'M05', table: 'wrk_handover', recordClass: 'event', requires: ['wrk.work_order'], distribution: 'record' },
];
