/** Which work order actions make sense for the current value on each status axis. Pure, so the rules are testable and the buttons never offer a move the server would refuse. */
export interface Axes { progress: string; approval: string; returnToService: string; closure: string }
export type WorkOrderAction = 'start' | 'hold' | 'resume' | 'complete' | 'rework' | 'request_review' | 'decide' | 'accept' | 'close' | 'reopen';

export function availableActions(ax: Axes): Set<WorkOrderAction> {
  const out = new Set<WorkOrderAction>();
  if (ax.closure === 'closed') { out.add('reopen'); return out; }
  if (ax.progress === 'planned') out.add('start');
  if (ax.progress === 'in_progress') { out.add('hold'); out.add('complete'); }
  if (ax.progress === 'on_hold') out.add('resume');
  if (ax.progress === 'work_complete') { out.add('rework'); out.add('accept'); out.add('close'); }
  if (ax.approval === 'pending_review') out.add('decide');
  else out.add('request_review');
  if (ax.closure === 'reopened' && ax.progress !== 'work_complete') out.delete('close');
  return out;
}

/** `progress` change requested by an action. */
export const PROGRESS_TARGET: Partial<Record<WorkOrderAction, 'in_progress' | 'on_hold' | 'work_complete'>> = {
  start: 'in_progress', resume: 'in_progress', rework: 'in_progress', hold: 'on_hold', complete: 'work_complete',
};

/** Equipment tag typed by the user, tidied the way the server expects it. */
export const normalizeTag = (s: string): string => s.trim().toUpperCase();
