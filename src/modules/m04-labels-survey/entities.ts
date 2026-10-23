import type { EntityDef } from '../../platform/entity-registry.js';

/** Labels, surveys and survey items are written by the installation that holds them; prints are append-only; templates are hub reference data. */
export const QR_ENTITIES: readonly EntityDef[] = [
  { type: 'qr.survey_template', module: 'M04', table: 'qr_survey_template', recordClass: 'hub_reference', distribution: 'fleet' },
  { type: 'qr.label', module: 'M04', table: 'qr_label', recordClass: 'owner_mutable', requires: ['ast.asset'], distribution: 'record' },
  { type: 'qr.label_print', module: 'M04', table: 'qr_label_print', recordClass: 'event', requires: ['qr.label'], distribution: 'record' },
  { type: 'qr.survey', module: 'M04', table: 'qr_survey', recordClass: 'owner_mutable', requires: ['org.location', 'qr.survey_template'], distribution: 'record' },
  { type: 'qr.survey_item', module: 'M04', table: 'qr_survey_item', recordClass: 'owner_mutable', requires: ['qr.survey', 'ast.asset'], distribution: 'record' },
];
