/**
 * Permission codes `wrk.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25).
 * `wrk.work_order.approve` and `wrk.acceptance.accept` are also the GATE codes M02 configures (mode, offline policy).
 */
export type WrkNoun = 'defect' | 'repair_case' | 'work_order' | 'job_card' | 'advisory' | 'labour_entry' | 'finding' | 'test_record' | 'acceptance' | 'handover' | 'status_event';
export const perm = (noun: WrkNoun, action: string): string => `wrk.${noun}.${action}`;

export const GATE_APPROVE = 'wrk.work_order.approve';
export const GATE_ACCEPT = 'wrk.acceptance.accept';

const crud = (n: WrkNoun) => ['view', 'create', 'update', 'remove'].map((a) => perm(n, a));
export const WRK_PERMISSIONS: readonly string[] = [
  ...crud('defect'), perm('defect', 'convert'), perm('defect', 'dismiss'),
  ...crud('repair_case'), perm('repair_case', 'progress'), perm('repair_case', 'close'), perm('repair_case', 'reopen'),
  ...crud('work_order'), perm('work_order', 'progress'), perm('work_order', 'request_review'), GATE_APPROVE,
  perm('work_order', 'close'), perm('work_order', 'reopen'), perm('work_order', 'handover'), perm('work_order', 'accept_handover'),
  ...crud('job_card'), ...crud('advisory'),
  perm('labour_entry', 'view'), perm('labour_entry', 'create'), perm('finding', 'view'), perm('finding', 'create'),
  perm('test_record', 'view'), perm('test_record', 'create'),
  perm('acceptance', 'view'), perm('acceptance', 'create'), GATE_ACCEPT,
  perm('handover', 'view'), perm('status_event', 'view'),
];
