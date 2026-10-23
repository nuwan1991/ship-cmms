/** Permission codes `qr.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type QrNoun = 'label' | 'label_print' | 'survey_template' | 'survey' | 'survey_item';
export const perm = (noun: QrNoun, action: string): string => `qr.${noun}.${action}`;

export const QR_PERMISSIONS: readonly string[] = [
  'qr.label.view', 'qr.label.create', 'qr.label.assign', 'qr.label.void', 'qr.label.print',
  'qr.label_print.view',
  'qr.survey_template.view', 'qr.survey_template.create', 'qr.survey_template.update', 'qr.survey_template.remove',
  'qr.survey.view', 'qr.survey.create', 'qr.survey.update', 'qr.survey.close', 'qr.survey.remove',
  'qr.survey_item.view', 'qr.survey_item.create', 'qr.survey_item.update', 'qr.survey_item.remove', 'qr.survey_item.convert',
];
