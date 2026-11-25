import type { FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import { CONDITIONS, DOCKING_TYPES, ITEM_CATEGORIES, ITEM_STATUSES, REQ_CATEGORIES, SURVEY_AREAS } from './binding';

type Opt = { value: string; label: string };
const opts = (values: string[], prefix: string): Opt[] => values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));

export function dockingFields(ships: Opt[], docks: Opt[], creating: boolean, dockLocked = false): FieldDef[] {
  return [
    ...(creating ? [{ key: 'shipId', labelKey: 'dck.field.ship', type: 'select' as const, required: true, options: ships, createOnly: true }] : []),
    ...(dockLocked ? [] : [{ key: 'dockId', labelKey: 'dck.field.dock', type: 'select' as const, options: docks, hintKey: 'dck.hint.dock' }]),
    { key: 'reference', labelKey: 'dck.field.reference', type: 'text', maxLength: 60, hintKey: 'dck.hint.reference' },
    { key: 'dockingType', labelKey: 'dck.field.type', type: 'select', required: true, options: opts(DOCKING_TYPES, 'dck.type') },
    { key: 'plannedDockIn', labelKey: 'dck.field.plannedDockIn', type: 'date', required: true },
    { key: 'plannedUndock', labelKey: 'dck.field.plannedUndock', type: 'date', required: true },
    { key: 'purpose', labelKey: 'dck.field.purpose', type: 'textarea', maxLength: 2000 },
    { key: 'authority', labelKey: 'dck.field.authority', type: 'text', maxLength: 160 },
    { key: 'remarks', labelKey: 'dck.field.remarks', type: 'textarea', maxLength: 2000 },
  ];
}

export function itemFields(editing: boolean): FieldDef[] {
  return [
    { key: 'category', labelKey: 'dck.field.category', type: 'select', required: true, options: opts(ITEM_CATEGORIES, 'dck.cat') },
    { key: 'title', labelKey: 'dck.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'description', labelKey: 'dck.field.description', type: 'textarea', maxLength: 2000 },
    { key: 'assetTag', labelKey: 'dck.field.assetTag', type: 'text', maxLength: 40, hintKey: 'dck.hint.asset_tag' },
    { key: 'executedBy', labelKey: 'dck.field.executedBy', type: 'text', maxLength: 160 },
    ...(editing ? [{ key: 'status', labelKey: 'dck.field.status', type: 'select' as const, options: opts(ITEM_STATUSES, 'dck.istatus') }] : []),
    { key: 'note', labelKey: 'dck.field.note', type: 'textarea', maxLength: 1000 },
  ];
}

export const surveyFields = (): FieldDef[] => [
  { key: 'area', labelKey: 'dck.field.area', type: 'select', required: true, options: opts(SURVEY_AREAS, 'dck.area') },
  { key: 'condition', labelKey: 'dck.field.condition', type: 'select', required: true, options: opts(CONDITIONS, 'dck.cond') },
  { key: 'finding', labelKey: 'dck.field.finding', type: 'textarea', required: true, maxLength: 2000 },
  { key: 'measurement', labelKey: 'dck.field.measurement', type: 'text', maxLength: 300, hintKey: 'dck.hint.measurement' },
  { key: 'surveyedBy', labelKey: 'dck.field.surveyedBy', type: 'text', maxLength: 160 },
  { key: 'actionRequired', labelKey: 'dck.field.actionRequired', type: 'checkbox' },
  { key: 'surveyedAt', labelKey: 'dck.field.surveyedAt', type: 'datetime', hintKey: 'dck.hint.now' },
];

/** A checklist line, in a class template, a ship's own list or one docking. */
export function reqItemFields(editing: boolean, withStatus = false): FieldDef[] {
  return [
    { key: 'category', labelKey: 'dck.field.category', type: 'select', required: true, options: opts(REQ_CATEGORIES, 'dck.rcat') },
    { key: 'title', labelKey: 'dck.field.requirement', type: 'text', required: true, maxLength: 160 },
    { key: 'description', labelKey: 'dck.field.description', type: 'textarea', maxLength: 1000 },
    { key: 'responsible', labelKey: 'dck.field.responsible', type: 'text', maxLength: 160, hintKey: 'dck.hint.responsible' },
    { key: 'leadDays', labelKey: 'dck.field.leadDays', type: 'text', maxLength: 3, hintKey: 'dck.hint.lead_days' },
    { key: 'mandatory', labelKey: 'dck.field.mandatory', type: 'checkbox' },
    ...(editing ? [{ key: 'seq', labelKey: 'dck.field.no', type: 'number' as const }] : []),
    ...(withStatus ? [{ key: 'status', labelKey: 'dck.field.status', type: 'select' as const, options: [{ value: 'active', label: t('status.active') }, { value: 'inactive', label: t('status.inactive') }] }] : []),
  ];
}
