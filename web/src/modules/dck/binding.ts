import { useMemo } from 'react';
import type { Rec } from '../../platform/api';
import { useList } from '../../platform/useList';

export const DCK = '/api/v1/docking';
export const ORG = '/api/v1/org';
export const AST = '/api/v1/assets';

export const DOCK_KINDS = ['graving_dock', 'floating_dock', 'slipway', 'shiplift'];
export const DOCKING_TYPES = ['routine', 'emergency', 'refit', 'survey', 'other'];
export const DOCKING_STATUSES = ['planned', 'in_dock', 'undocked', 'completed', 'cancelled'];
export const ITEM_CATEGORIES = ['hull', 'underwater_fittings', 'propulsion', 'rudder_steering', 'sea_valves', 'cathodic_protection', 'painting', 'sensors', 'other'];
export const ITEM_STATUSES = ['open', 'in_progress', 'done', 'deferred', 'cancelled'];
export const SURVEY_AREAS = ['hull_plating', 'propeller', 'shaft', 'rudder', 'sea_chest', 'anodes', 'paint_coating', 'stabilisers', 'echo_sounder_log', 'other'];
export const CONDITIONS = ['good', 'fair', 'poor', 'defective'];
export const DUE_STATES = ['overdue', 'due_soon', 'never', 'in_dock', 'undocked', 'ok'];

/** Chip colour for docking, item, condition and due states. */
const TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  planned: 'muted', in_dock: 'ok', undocked: 'ok', completed: 'muted', cancelled: 'muted',
  open: 'warn', in_progress: 'ok', done: 'muted', deferred: 'warn',
  good: 'ok', fair: 'muted', poor: 'warn', defective: 'warn',
  overdue: 'warn', due_soon: 'warn', never: 'warn', ok: 'ok',
};
export const tone = (v: unknown): string => TONE[String(v)] ?? 'muted';
export const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

/** Ships by id ("code – name") and select options, from the organization register (read-only). */
export function useShips() {
  const list = useList(`${ORG}/ships`, { limit: '500' });
  return useMemo(() => {
    const label = (id: unknown): string => { const s = list.items.find((x) => x.id === id); return s ? `${String(s.code)} – ${String(s.name)}` : String(id ?? ''); };
    const options = list.items.filter((s: Rec) => s.status !== 'decommissioned').map((s: Rec) => ({ value: String(s.id), label: `${String(s.code)} – ${String(s.name)}` }));
    return { label, options };
  }, [list.items]);
}

/** Active docks as select options. */
export function useDocks() {
  const list = useList(`${DCK}/docks`, { status: 'active' });
  return useMemo(() => list.items.map((d: Rec) => ({ value: String(d.id), label: `${String(d.code)} – ${String(d.name)}${Number(d.capacityShips) > 1 ? ` (${String(d.capacityShips)})` : ''}` })), [list.items]);
}
