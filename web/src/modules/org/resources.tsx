import { t } from '../../platform/i18n';
import { toLocalDisplay } from '../../platform/time';
import { StatusChip } from '../../platform/ui';
import type { Rec } from '../../platform/api';
import type { FieldDef } from '../../platform/form';
import type { ColumnDef, ResourceConfig } from './ResourceScreen';

const code: FieldDef = { key: 'code', labelKey: 'org.field.code', type: 'text', required: true, maxLength: 32, hintKey: 'org.hint.code' };
const name: FieldDef = { key: 'name', labelKey: 'org.field.name', type: 'text', required: true, maxLength: 120 };
const sortOrder: FieldDef = { key: 'sortOrder', labelKey: 'org.field.sortOrder', type: 'number' };
const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });
const status: FieldDef = {
  key: 'status',
  labelKey: 'org.field.status',
  type: 'select',
  options: (): Array<{ value: string; label: string }> => [opt('active', 'status.active'), opt('inactive', 'status.inactive')],
};
const cCode: ColumnDef = { key: 'code', labelKey: 'org.field.code' };
const cName: ColumnDef = { key: 'name', labelKey: 'org.field.name' };
const cStatus: ColumnDef = { key: 'status', labelKey: 'org.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> };
const rowName = (r: Rec) => `${String(r.code)} – ${String(r.name)}`;

export const fleetConfig: ResourceConfig = {
  noun: 'fleet', collection: 'fleets', titleKey: 'org.title.fleet', newKey: 'org.new.fleet', hubOnly: true, searchable: false, rowName,
  columns: [cCode, cName],
  fields: () => [code, name],
};

export const commandConfig: ResourceConfig = {
  noun: 'command', collection: 'commands', titleKey: 'org.title.commands', newKey: 'org.new.command', hubOnly: true, rowName,
  columns: [cCode, cName, { key: 'shortName', labelKey: 'org.field.shortName' }, { key: 'sortOrder', labelKey: 'org.field.sortOrder' }, cStatus],
  fields: () => [code, name, { key: 'shortName', labelKey: 'org.field.shortName', type: 'text', maxLength: 40 }, sortOrder, status],
  defaults: { status: 'active' },
};

export const departmentConfig: ResourceConfig = {
  noun: 'department', collection: 'departments', titleKey: 'org.title.departments', newKey: 'org.new.department', hubOnly: true, rowName,
  columns: [cCode, cName, { key: 'sortOrder', labelKey: 'org.field.sortOrder' }, cStatus],
  fields: () => [code, name, sortOrder, status],
  defaults: { status: 'active' },
};

export const providerConfig: ResourceConfig = {
  noun: 'external_provider', collection: 'external-providers', titleKey: 'org.title.providers', newKey: 'org.new.provider', hubOnly: true, rowName,
  columns: [cCode, cName, { key: 'contactName', labelKey: 'org.field.contactName' }, { key: 'contactPhone', labelKey: 'org.field.contactPhone' }, cStatus],
  fields: () => [
    code, name,
    { key: 'contactName', labelKey: 'org.field.contactName', type: 'text', maxLength: 120 },
    { key: 'contactPhone', labelKey: 'org.field.contactPhone', type: 'text', maxLength: 40 },
    { key: 'contactEmail', labelKey: 'org.field.contactEmail', type: 'text', maxLength: 160 },
    { key: 'notes', labelKey: 'org.field.notes', type: 'textarea', maxLength: 1000 },
    status,
  ],
  defaults: { status: 'active' },
};

export const workshopConfig: ResourceConfig = {
  noun: 'workshop', collection: 'workshops', titleKey: 'org.title.workshops', newKey: 'org.new.workshop', hubOnly: true, rowName,
  refs: {
    commands: { collection: 'commands', label: (r) => `${String(r.code)} – ${String(r.name)}`, filter: (r) => r.status === 'active' },
    ships: { collection: 'ships', label: (r) => `${String(r.code)} – ${String(r.name)}` },
  },
  columns: [
    cCode, cName,
    { key: 'kind', labelKey: 'org.field.kind', render: (r) => <span>{t(`org.workshop.kind.${String(r.kind)}`)}</span> },
    { key: 'hasReplica', labelKey: 'org.field.hasReplica', render: (r) => (r.hasReplica ? '✓' : '') },
    cStatus,
  ],
  fields: (refs) => [
    code, name,
    {
      key: 'kind', labelKey: 'org.field.kind', type: 'select', required: true, hintKey: 'org.hint.workshop_kind',
      options: () => [opt('onboard', 'org.workshop.kind.onboard'), opt('command', 'org.workshop.kind.command'), opt('specialist', 'org.workshop.kind.specialist')],
    },
    { key: 'commandId', labelKey: 'org.field.commandId', type: 'select', required: true, options: refs.commands ?? [], showWhen: (v) => v.kind === 'command' },
    { key: 'shipId', labelKey: 'org.field.shipId', type: 'select', required: true, options: refs.ships ?? [], showWhen: (v) => v.kind === 'onboard' },
    { key: 'hasReplica', labelKey: 'org.field.hasReplica', type: 'checkbox' },
    status,
  ],
  defaults: { status: 'active', kind: 'specialist' },
};

export const shipConfig: ResourceConfig = {
  noun: 'ship', collection: 'ships', titleKey: 'org.title.ships', newKey: 'org.new.ship', hubOnly: true, rowName,
  columns: [
    cCode, cName,
    { key: 'pennantNo', labelKey: 'org.field.pennantNo' },
    { key: 'shipClass', labelKey: 'org.field.shipClass' },
    cStatus,
    {
      key: 'currentCommand', labelKey: 'org.field.currentCommand',
      render: (r: Rec, tz: string) => {
        const c = r.currentCommand as { code: string; name: string; assignedSince: string } | null;
        return c ? <span title={`${toLocalDisplay(c.assignedSince, tz)}`}>{c.code} – {c.name}</span> : <span className="muted">—</span>;
      },
    },
  ],
  fields: () => [
    code, name,
    { key: 'pennantNo', labelKey: 'org.field.pennantNo', type: 'text', maxLength: 20 },
    { key: 'shipClass', labelKey: 'org.field.shipClass', type: 'text', maxLength: 60 },
    { key: 'shipType', labelKey: 'org.field.shipType', type: 'text', maxLength: 60 },
    {
      key: 'status', labelKey: 'org.field.status', type: 'select',
      options: () => [opt('active', 'status.active'), opt('laid_up', 'status.laid_up'), opt('decommissioned', 'status.decommissioned')],
    },
  ],
  defaults: { status: 'active' },
};
