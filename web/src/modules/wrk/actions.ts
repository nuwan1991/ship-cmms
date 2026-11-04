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

// ---------------------------------------------------------------- parties and form defaults

/**
 * Party types offered on screen. Ship sections and command departments are both `department` on the wire (one org table);
 * the screen tells them apart by the department's owner.
 */
export const UI_PARTY_KINDS = ['ship', 'ship_section', 'command', 'command_department', 'workshop', 'external_provider'] as const;
export type UiPartyKind = (typeof UI_PARTY_KINDS)[number];
export const wirePartyKind = (k: string): string => (k === 'ship_section' || k === 'command_department' ? 'department' : k);
/** Screen kind of a stored party; a department needs its owner kind to say whether it is a ship section. */
export const uiPartyKind = (kind: string, departmentOwnerKind?: unknown): string =>
  kind !== 'department' ? kind : departmentOwnerKind === 'ship' ? 'ship_section' : 'command_department';

/** Where the signed-in user belongs (`home` on /identity/me). */
export interface UserHome { sectionId: string | null; sectionOwnerKind: 'ship' | 'command' | null; shipId: string | null; commandId: string | null }

/**
 * Pre-filled ship and party for a new work order: the user's own ship section when they have one, otherwise their ship,
 * otherwise their command department or command. Everything stays editable.
 */
export function workOrderDefaults(home: UserHome | null | undefined): { shipId: string; executingKind: string; executingId: string } {
  const h = home ?? { sectionId: null, sectionOwnerKind: null, shipId: null, commandId: null };
  const shipId = h.shipId ?? '';
  if (h.sectionId && h.sectionOwnerKind === 'ship') return { shipId, executingKind: 'ship_section', executingId: h.sectionId };
  if (h.shipId) return { shipId, executingKind: 'ship', executingId: h.shipId };
  if (h.sectionId && h.sectionOwnerKind === 'command') return { shipId, executingKind: 'command_department', executingId: h.sectionId };
  if (h.commandId) return { shipId, executingKind: 'command', executingId: h.commandId };
  return { shipId, executingKind: '', executingId: '' };
}

/** Departments for a screen party kind: a ship's own sections (all ships' when no ship is chosen) or the command departments. */
export function departmentsFor<T extends Record<string, unknown>>(rows: readonly T[], kind: string, shipId?: string): T[] {
  if (kind === 'ship_section') return rows.filter((r) => r.ownerKind === 'ship' && (!shipId || r.ownerId === shipId));
  if (kind === 'command_department') return rows.filter((r) => r.ownerKind !== 'ship');
  return [];
}
