/** Permission codes `pm.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type PmNoun = 'task_template' | 'plan' | 'meter' | 'meter_reading' | 'calibration' | 'due';
export const perm = (noun: PmNoun, action: string): string => `pm.${noun}.${action}`;

export const PM_PERMISSIONS: readonly string[] = [
  'pm.task_template.view', 'pm.task_template.create', 'pm.task_template.update', 'pm.task_template.remove',
  'pm.plan.view', 'pm.plan.create', 'pm.plan.update', 'pm.plan.remove', 'pm.plan.complete', 'pm.plan.generate',
  'pm.meter.view', 'pm.meter.create', 'pm.meter.update', 'pm.meter.remove',
  'pm.meter_reading.view', 'pm.meter_reading.create',
  'pm.calibration.view', 'pm.calibration.create',
  'pm.due.view',
];
