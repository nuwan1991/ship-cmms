import type { Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import type { ColumnDef } from '../../platform/ResourceScreen';
import { StatusChip } from '../../platform/ui';
import { ORG, type StkConfig } from './binding';

const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });
const cStatus: ColumnDef = { key: 'status', labelKey: 'stk.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> };

/** Parts catalogue: hub reference data. */
export const partConfig: StkConfig = {
  noun: 'part', collection: 'parts', titleKey: 'stk.title.parts', newKey: 'stk.new.part', hubOnly: true, searchable: true,
  rowName: (r: Rec) => `${String(r.partNo)} – ${String(r.name)}`,
  columns: [
    { key: 'partNo', labelKey: 'stk.field.partNo' }, { key: 'name', labelKey: 'stk.field.name' }, { key: 'unit', labelKey: 'stk.field.unit' },
    { key: 'category', labelKey: 'stk.field.category' }, { key: 'manufacturer', labelKey: 'stk.field.manufacturer' }, cStatus,
  ],
  fields: () => [
    { key: 'partNo', labelKey: 'stk.field.partNo', type: 'text', required: true, createOnly: true, maxLength: 40 },
    { key: 'name', labelKey: 'stk.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'unit', labelKey: 'stk.field.unit', type: 'text', hintKey: 'stk.hint.unit', maxLength: 12 },
    { key: 'category', labelKey: 'stk.field.category', type: 'text', maxLength: 60 },
    { key: 'manufacturer', labelKey: 'stk.field.manufacturer', type: 'text', maxLength: 120 },
    { key: 'manufacturerPartNo', labelKey: 'stk.field.manufacturerPartNo', type: 'text', maxLength: 80 },
    { key: 'description', labelKey: 'stk.field.description', type: 'textarea', maxLength: 500 },
    { key: 'status', labelKey: 'stk.field.status', type: 'select', options: [opt('active', 'status.active'), opt('inactive', 'status.inactive')] },
  ],
  defaults: { unit: 'each', status: 'active' },
};

/** Stock locations: a store, locker or workshop shelf at a ship, workshop or the fleet level. */
export const locationConfig: StkConfig = {
  noun: 'location', collection: 'locations', titleKey: 'stk.title.locations', newKey: 'stk.new.location', hubOnly: false, searchable: true,
  rowName: (r: Rec) => `${String(r.code)} – ${String(r.name)}`,
  refs: { ships: { apiBase: ORG, collection: 'ships', label: (r: Rec) => `${String(r.code)} – ${String(r.name)}` } },
  columns: [
    { key: 'code', labelKey: 'stk.field.code' }, { key: 'name', labelKey: 'stk.field.name' },
    { key: 'kind', labelKey: 'stk.field.kind', render: (r) => t(`stk.lkind.${String(r.kind)}`) },
    { key: 'homeScopeId', labelKey: 'stk.field.site', render: (r, _tz, refs) => refs.ships?.find((o) => o.value === r.homeScopeId)?.label ?? (r.homeScopeId ? String(r.homeScopeId) : t('stk.site.fleet')) },
    cStatus,
  ],
  fields: (refs) => [
    { key: 'code', labelKey: 'stk.field.code', type: 'text', required: true, createOnly: true, maxLength: 40 },
    { key: 'name', labelKey: 'stk.field.name', type: 'text', required: true, maxLength: 160 },
    { key: 'kind', labelKey: 'stk.field.kind', type: 'select', options: ['store', 'locker', 'workshop', 'other'].map((k) => opt(k, `stk.lkind.${k}`)) },
    { key: 'siteId', labelKey: 'stk.field.site', type: 'select', createOnly: true, hintKey: 'stk.hint.site', options: refs.ships ?? [] },
    { key: 'status', labelKey: 'stk.field.status', type: 'select', options: [opt('active', 'status.active'), opt('inactive', 'status.inactive')] },
  ],
  defaults: { kind: 'store', status: 'active' },
};
