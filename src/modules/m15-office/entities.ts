import type { EntityDef } from '../../platform/entity-registry.js';

/** Office records belong to the installation that holds the office (A9); timeline entries are append-only events. */
export const OFC_ENTITIES: readonly EntityDef[] = [
  { type: 'ofc.org_unit', module: 'M15', table: 'ofc_org_unit', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.link', module: 'M15', table: 'ofc_link', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.attachment', module: 'M15', table: 'ofc_attachment', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.attachment_link', module: 'M15', table: 'ofc_attachment_link', recordClass: 'owner_mutable', requires: ['ofc.attachment'], distribution: 'record' },
  { type: 'ofc.record_event', module: 'M15', table: 'ofc_record_event', recordClass: 'event', distribution: 'record' },
  { type: 'ofc.matter', module: 'M15', table: 'ofc_matter', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.correspondence', module: 'M15', table: 'ofc_correspondence', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.handover_packet', module: 'M15', table: 'ofc_handover_packet', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.handover_item', module: 'M15', table: 'ofc_handover_item', recordClass: 'owner_mutable', requires: ['ofc.handover_packet'], distribution: 'record' },
  { type: 'ofc.person', module: 'M15', table: 'ofc_person', recordClass: 'owner_mutable', distribution: 'record' },
  { type: 'ofc.responsibility', module: 'M15', table: 'ofc_responsibility', recordClass: 'owner_mutable', requires: ['ofc.person'], distribution: 'record' },
  { type: 'ofc.duty_period', module: 'M15', table: 'ofc_duty_period', recordClass: 'owner_mutable', requires: ['ofc.person'], distribution: 'record' },
  { type: 'ofc.task', module: 'M15', table: 'ofc_task', recordClass: 'owner_mutable', distribution: 'record' },
];
