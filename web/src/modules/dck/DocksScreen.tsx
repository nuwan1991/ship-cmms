import type { Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import { ResourceScreen, type ResourceConfig } from '../../platform/ResourceScreen';
import { StatusChip } from '../../platform/ui';
import { DCK, DOCK_KINDS, show } from './binding';

const metres = (r: Rec): string => [r.maxLengthM, r.maxBeamM, r.maxDraughtM].some((x) => x != null) ? `${show(r.maxLengthM)} × ${show(r.maxBeamM)} × ${show(r.maxDraughtM)}` : '—';

/** Docking facilities (hub reference data): graving docks, floating docks, slipways and ship lifts. */
const dockConfig: ResourceConfig = {
  apiBase: DCK, permPrefix: 'dck', noun: 'dock', collection: 'docks', titleKey: 'dck.title.docks', newKey: 'dck.new.dock', editKey: 'dck.edit.dock', removeKey: 'dck.remove.dock',
  hubOnly: true, rowName: (r) => `${String(r.code)} – ${String(r.name)}`, defaults: { kind: 'graving_dock', status: 'active', capacityShips: '1' },
  columns: [
    { key: 'code', labelKey: 'dck.field.code' }, { key: 'name', labelKey: 'dck.field.name' },
    { key: 'kind', labelKey: 'dck.field.kind', render: (r) => t(`dck.kind.${String(r.kind)}`) },
    { key: 'operator', labelKey: 'dck.field.operator' },
    { key: 'limits', labelKey: 'dck.field.limits', render: metres },
    { key: 'capacityShips', labelKey: 'dck.field.capacityShips' },
    { key: 'status', labelKey: 'dck.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> },
  ],
  fields: () => [
    { key: 'code', labelKey: 'dck.field.code', type: 'text', required: true, maxLength: 40, createOnly: true },
    { key: 'name', labelKey: 'dck.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'kind', labelKey: 'dck.field.kind', type: 'select', required: true, options: DOCK_KINDS.map((k) => ({ value: k, label: t(`dck.kind.${k}`) })) },
    { key: 'operator', labelKey: 'dck.field.operator', type: 'text', maxLength: 160, hintKey: 'dck.hint.operator' },
    { key: 'maxLengthM', labelKey: 'dck.field.maxLengthM', type: 'text', maxLength: 12, hintKey: 'dck.hint.decimal' },
    { key: 'maxBeamM', labelKey: 'dck.field.maxBeamM', type: 'text', maxLength: 12, hintKey: 'dck.hint.decimal' },
    { key: 'maxDraughtM', labelKey: 'dck.field.maxDraughtM', type: 'text', maxLength: 12, hintKey: 'dck.hint.decimal' },
    { key: 'liftCapacityT', labelKey: 'dck.field.liftCapacityT', type: 'text', maxLength: 12, hintKey: 'dck.hint.decimal' },
    { key: 'capacityShips', labelKey: 'dck.field.capacityShips', type: 'number', hintKey: 'dck.hint.capacity' },
    { key: 'note', labelKey: 'dck.field.note', type: 'textarea', maxLength: 1000 },
    { key: 'status', labelKey: 'dck.field.status', type: 'select', options: [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] },
  ],
};

export function DocksScreen() {
  return <ResourceScreen config={dockConfig} />;
}
