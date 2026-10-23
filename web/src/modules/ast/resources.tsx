import type { Rec } from '../../platform/api';
import type { FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import type { ColumnDef } from '../../platform/ResourceScreen';
import { StatusChip } from '../../platform/ui';
import { AST, optionLabel, type AstConfig } from './binding';

const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });
const status: FieldDef = { key: 'status', labelKey: 'ast.field.status', type: 'select', options: () => [opt('active', 'status.active'), opt('inactive', 'status.inactive')] };
const cStatus: ColumnDef = { key: 'status', labelKey: 'ast.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> };

/** Equipment and component classes: hub reference data, shared by every ship. */
export const classificationConfig: AstConfig = {
  noun: 'classification', collection: 'classifications', titleKey: 'ast.title.classifications', newKey: 'ast.new.classification', hubOnly: true,
  rowName: (r: Rec) => optionLabel(r),
  refs: { parents: { apiBase: AST, collection: 'classifications', label: optionLabel } },
  columns: [
    { key: 'code', labelKey: 'ast.field.code' }, { key: 'name', labelKey: 'ast.field.name' },
    { key: 'kind', labelKey: 'ast.field.kind', render: (r) => t(`ast.kind.${String(r.kind)}`) },
    { key: 'description', labelKey: 'ast.field.description' }, cStatus,
  ],
  fields: (refs) => [
    { key: 'code', labelKey: 'ast.field.code', type: 'text', required: true, createOnly: true, maxLength: 32, hintKey: 'ast.hint.code' },
    { key: 'name', labelKey: 'ast.field.name', type: 'text', required: true, maxLength: 120 },
    { key: 'kind', labelKey: 'ast.field.kind', type: 'select', required: true, createOnly: true, options: [opt('equipment', 'ast.kind.equipment'), opt('component', 'ast.kind.component')] },
    { key: 'parentId', labelKey: 'ast.field.parent', type: 'select', createOnly: true, hintKey: 'ast.hint.parent', options: refs.parents ?? [] },
    { key: 'description', labelKey: 'ast.field.description', type: 'textarea', maxLength: 500 },
    status,
  ],
};
