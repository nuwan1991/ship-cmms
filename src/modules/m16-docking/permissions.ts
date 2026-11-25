/** Permission codes `dck.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type DckNoun = 'dock' | 'docking' | 'work_item' | 'survey' | 'due';
export const perm = (noun: DckNoun, action: string): string => `dck.${noun}.${action}`;

export const DCK_PERMISSIONS: readonly string[] = [
  'dck.dock.view', 'dck.dock.create', 'dck.dock.update', 'dck.dock.remove',
  'dck.docking.view', 'dck.docking.create', 'dck.docking.update', 'dck.docking.dock_in', 'dck.docking.undock', 'dck.docking.complete', 'dck.docking.cancel', 'dck.docking.remove',
  'dck.work_item.view', 'dck.work_item.create', 'dck.work_item.update', 'dck.work_item.remove',
  'dck.survey.view', 'dck.survey.create',
  'dck.due.view',
];
