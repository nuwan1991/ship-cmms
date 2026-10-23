import type { EntityDef } from '../../platform/entity-registry.js';

/** Only the export log is shared; import jobs and rows are local working data and are not registered for synchronization. */
export const XLS_ENTITIES: readonly EntityDef[] = [
  { type: 'xls.export_log', module: 'M11', table: 'xls_export_log', recordClass: 'event', distribution: 'record' },
];
