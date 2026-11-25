/** Permission codes `dck.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type DckNoun = 'dock' | 'docking' | 'work_item' | 'survey' | 'due' | 'req_template' | 'ship_req' | 'requirement';
export const perm = (noun: DckNoun, action: string): string => `dck.${noun}.${action}`;

export const DCK_PERMISSIONS: readonly string[] = [
  'dck.dock.view', 'dck.dock.create', 'dck.dock.update', 'dck.dock.remove',
  'dck.docking.view', 'dck.docking.create', 'dck.docking.update', 'dck.docking.dock_in', 'dck.docking.undock', 'dck.docking.complete', 'dck.docking.cancel', 'dck.docking.remove',
  'dck.work_item.view', 'dck.work_item.create', 'dck.work_item.update', 'dck.work_item.remove',
  'dck.survey.view', 'dck.survey.create',
  'dck.due.view',
  'dck.req_template.view', 'dck.req_template.create', 'dck.req_template.update', 'dck.req_template.remove',
  'dck.ship_req.view', 'dck.ship_req.create', 'dck.ship_req.update', 'dck.ship_req.remove',
  'dck.requirement.view', 'dck.requirement.create', 'dck.requirement.update', 'dck.requirement.remove', 'dck.requirement.waive',
];
