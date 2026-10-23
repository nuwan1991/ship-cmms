import type { Rec } from '../../platform/api';
import { t } from '../../platform/i18n';
import type { ColumnDef } from '../../platform/ResourceScreen';
import { StatusChip } from '../../platform/ui';
import { AST, type WrkConfig } from './binding';

const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });
const cStatus: ColumnDef = { key: 'status', labelKey: 'wrk.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> };

/** Technical advisories: hub reference data, shown on equipment of the same classification. */
export const advisoryConfig: WrkConfig = {
  noun: 'advisory', collection: 'advisories', titleKey: 'wrk.title.advisories', newKey: 'wrk.new.advisory', hubOnly: true,
  rowName: (r: Rec) => `${String(r.code)} – ${String(r.title)}`,
  refs: { classes: { apiBase: AST, collection: 'classifications', label: (r: Rec) => `${String(r.code)} – ${String(r.name)}`, filter: (r: Rec) => r.kind === 'equipment' } },
  columns: [
    { key: 'code', labelKey: 'wrk.field.code' }, { key: 'title', labelKey: 'wrk.field.title' },
    { key: 'severity', labelKey: 'wrk.field.severity', render: (r) => t(`wrk.severity.${String(r.severity)}`) }, cStatus,
  ],
  fields: (refs) => [
    { key: 'code', labelKey: 'wrk.field.code', type: 'text', required: true, createOnly: true, maxLength: 32 },
    { key: 'title', labelKey: 'wrk.field.title', type: 'text', required: true, maxLength: 160 },
    { key: 'body', labelKey: 'wrk.field.body', type: 'textarea', maxLength: 4000 },
    { key: 'severity', labelKey: 'wrk.field.severity', type: 'select', options: [opt('info', 'wrk.severity.info'), opt('caution', 'wrk.severity.caution'), opt('warning', 'wrk.severity.warning')] },
    { key: 'classificationId', labelKey: 'wrk.field.classification', type: 'select', hintKey: 'wrk.hint.advisory_class', options: refs.classes ?? [] },
    { key: 'status', labelKey: 'wrk.field.status', type: 'select', options: [opt('active', 'status.active'), opt('inactive', 'status.inactive')] },
  ],
  defaults: { severity: 'info', status: 'active' },
};
