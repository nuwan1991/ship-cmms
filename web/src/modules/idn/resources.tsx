import type { Rec } from '../../platform/api';
import type { FieldDef } from '../../platform/form';
import { t } from '../../platform/i18n';
import type { ColumnDef } from '../../platform/ResourceScreen';
import { toLocalDisplay } from '../../platform/time';
import { StatusChip } from '../../platform/ui';
import { IDN, type IdnConfig } from './binding';

const opt = (value: string, labelKey: string) => ({ value, label: t(labelKey) });
const status: FieldDef = { key: 'status', labelKey: 'idn.field.status', type: 'select', options: () => [opt('active', 'status.active'), opt('inactive', 'status.inactive')] };
const cStatus: ColumnDef = { key: 'status', labelKey: 'idn.field.status', render: (r) => <StatusChip value={String(r.status)} labelPrefix="status" /> };
const lookup = (refKey: string, idKey: string): ColumnDef['render'] => (r, _tz, refs) => refs[refKey]?.find((o) => o.value === r[idKey])?.label ?? String(r[idKey] ?? '');
const when = (key: string): ColumnDef['render'] => (r, tz) => toLocalDisplay(r[key] as string | null, tz);

const USERS = { users: { apiBase: IDN, collection: 'users', label: (r: Rec) => String(r.displayName) } };
const ROLES = { roles: { apiBase: IDN, collection: 'roles', label: (r: Rec) => `${String(r.code)} – ${String(r.name)}` } };
const SCOPES = ['fleet', 'command', 'ship', 'workshop', 'department'];
const ORG = '/api/v1/org';
const orgRef = (collection: string) => ({ apiBase: ORG, collection, label: (r: Rec) => `${String(r.code)} – ${String(r.name)}` });
/** Scoped targets, keyed by scope kind, so the scope is picked by name rather than typed as a raw id. */
const SCOPE_REFS = { command: orgRef('commands'), ship: orgRef('ships'), workshop: orgRef('workshops'), department: orgRef('departments') };

/** Ship sections and command departments, labelled with their owner because every ship has its own ELEC / ENG / GEN. */
const ownerLabel = (r: Rec) => `${r.ownerCode ? `${String(r.ownerCode)} / ` : ''}${String(r.code)} – ${String(r.name)}`;
const SECTIONS = {
  sections: { apiBase: '/api/v1/org', collection: 'ship-sections', label: ownerLabel, filter: (r: Rec) => r.status === 'active' },
  departments: { apiBase: '/api/v1/org', collection: 'departments', label: ownerLabel, filter: (r: Rec) => r.status === 'active' },
};
const sectionOptions = (refs: Record<string, Array<{ value: string; label: string }>>) => [...(refs.sections ?? []), ...(refs.departments ?? [])];

export const userConfig: IdnConfig = {
  noun: 'user', collection: 'users', titleKey: 'idn.title.users', newKey: 'idn.new.user',
  refs: SECTIONS,
  rowName: (r) => String(r.displayName),
  columns: [
    { key: 'rank', labelKey: 'idn.field.rank' }, { key: 'tradeBranch', labelKey: 'idn.field.tradeBranch' },
    { key: 'serviceNumber', labelKey: 'idn.field.serviceNumber' }, { key: 'displayName', labelKey: 'idn.field.displayName' },
    { key: 'personnelCategory', labelKey: 'idn.field.personnelCategory', render: (r) => (r.personnelCategory ? t(`idn.personnelCategory.${String(r.personnelCategory)}`) : '') },
    { key: 'sectionId', labelKey: 'idn.field.section', render: (r, _tz, refs) => sectionOptions(refs).find((o) => o.value === r.sectionId)?.label ?? String(r.sectionId ?? '') },
    cStatus,
  ],
  fields: (refs) => [
    { key: 'rank', labelKey: 'idn.field.rank', type: 'text', maxLength: 60 },
    { key: 'tradeBranch', labelKey: 'idn.field.tradeBranch', type: 'text', maxLength: 60 },
    { key: 'serviceNumber', labelKey: 'idn.field.serviceNumber', type: 'text', maxLength: 40 },
    { key: 'displayName', labelKey: 'idn.field.displayName', type: 'text', required: true, maxLength: 120 },
    { key: 'personnelCategory', labelKey: 'idn.field.personnelCategory', type: 'select', options: () => [opt('officer', 'idn.personnelCategory.officer'), opt('sailor', 'idn.personnelCategory.sailor')] },
    { key: 'sectionId', labelKey: 'idn.field.section', type: 'select', options: sectionOptions(refs), hintKey: 'idn.hint.section' },
    status,
  ],
};

export const roleConfig: IdnConfig = {
  noun: 'role', collection: 'roles', titleKey: 'idn.title.roles', newKey: 'idn.new.role',
  rowName: (r) => `${String(r.code)} – ${String(r.name)}`,
  columns: [{ key: 'code', labelKey: 'idn.field.code' }, { key: 'name', labelKey: 'idn.field.name' }, { key: 'description', labelKey: 'idn.field.description' }, cStatus],
  fields: () => [
    { key: 'code', labelKey: 'idn.field.code', type: 'text', required: true, maxLength: 32, createOnly: true },
    { key: 'name', labelKey: 'idn.field.name', type: 'text', required: true, maxLength: 120 },
    { key: 'description', labelKey: 'idn.field.description', type: 'textarea', maxLength: 500 },
    status,
  ],
};

export const assignmentConfig: IdnConfig = {
  noun: 'role_assignment', collection: 'role-assignments', titleKey: 'idn.title.assignments', newKey: 'idn.new.assignment',
  refs: { ...USERS, ...ROLES, ...SCOPE_REFS },
  rowName: (r) => `${String(r.scopeKind)} ${String(r.id).slice(-6)}`,
  columns: [
    { key: 'userId', labelKey: 'idn.field.user', render: lookup('users', 'userId') },
    { key: 'roleId', labelKey: 'idn.field.role', render: lookup('roles', 'roleId') },
    { key: 'scopeKind', labelKey: 'idn.field.scope', render: (r, _tz, refs) => {
      const kind = String(r.scopeKind);
      const target = r.scopeId ? refs[kind]?.find((o) => o.value === r.scopeId)?.label ?? String(r.scopeId).slice(-6) : '';
      return `${t(`idn.scope.${kind}`)}${target ? ` ${target}` : ''}`;
    } },
    { key: 'validFrom', labelKey: 'idn.field.validFrom', render: when('validFrom') },
    { key: 'validUntil', labelKey: 'idn.field.validUntil', render: when('validUntil') },
  ],
  fields: (refs) => [
    { key: 'userId', labelKey: 'idn.field.user', type: 'select', required: true, createOnly: true, options: refs.users ?? [] },
    { key: 'roleId', labelKey: 'idn.field.role', type: 'select', required: true, createOnly: true, options: refs.roles ?? [] },
    { key: 'scopeKind', labelKey: 'idn.field.scope', type: 'select', required: true, createOnly: true, options: SCOPES.map((s) => opt(s, `idn.scope.${s}`)) },
    { key: 'scopeId', labelKey: 'idn.field.scopeId', type: 'select', required: true, createOnly: true, hintKey: 'idn.hint.scopeId', options: (v) => refs[String(v.scopeKind)] ?? [], showWhen: (v) => v.scopeKind !== '' && v.scopeKind !== 'fleet' },
    { key: 'validFrom', labelKey: 'idn.field.validFrom', type: 'datetime' },
    { key: 'validUntil', labelKey: 'idn.field.validUntil', type: 'datetime', hintKey: 'idn.hint.validUntil' },
  ],
};

const MODES = ['mandatory_prior', 'review_pending_allowed', 'none'];
const OFFLINE = ['allow', 'provisional', 'deny'];
export const gatePolicyConfig: IdnConfig = {
  noun: 'gate_policy', collection: 'gate-policies', titleKey: 'idn.title.gates', newKey: 'idn.new.gate',
  rowName: (r) => String(r.gateCode),
  columns: [
    { key: 'gateCode', labelKey: 'idn.field.gateCode' },
    { key: 'mode', labelKey: 'idn.field.mode', render: (r) => t(`idn.mode.${String(r.mode)}`) },
    { key: 'offlinePolicy', labelKey: 'idn.field.offlinePolicy', render: (r) => (r.offlinePolicy ? t(`idn.offline.${String(r.offlinePolicy)}`) : t('idn.offline.default')) },
  ],
  fields: () => [
    { key: 'gateCode', labelKey: 'idn.field.gateCode', type: 'text', required: true, createOnly: true, hintKey: 'idn.hint.gateCode' },
    { key: 'mode', labelKey: 'idn.field.mode', type: 'select', required: true, options: MODES.map((m) => opt(m, `idn.mode.${m}`)) },
    { key: 'offlinePolicy', labelKey: 'idn.field.offlinePolicy', type: 'select', hintKey: 'idn.hint.offlinePolicy', options: OFFLINE.map((m) => opt(m, `idn.offline.${m}`)) },
  ],
};

export const grantConfig: IdnConfig = {
  noun: 'offline_grant', collection: 'offline-grants', titleKey: 'idn.title.grants', newKey: 'idn.new.grant',
  refs: ROLES,
  rowName: (r) => `${String(r.leaseDays)} days`,
  columns: [
    { key: 'installationId', labelKey: 'idn.field.installationId', render: (r) => (r.installationId ? String(r.installationId).slice(-8) : t('idn.all')) },
    { key: 'roleId', labelKey: 'idn.field.role', render: (r, _tz, refs) => (r.roleId ? refs.roles?.find((o) => o.value === r.roleId)?.label ?? String(r.roleId) : t('idn.all')) },
    { key: 'leaseDays', labelKey: 'idn.field.leaseDays' },
  ],
  fields: (refs) => [
    { key: 'installationId', labelKey: 'idn.field.installationId', type: 'text', createOnly: true, hintKey: 'idn.hint.grantScope' },
    { key: 'roleId', labelKey: 'idn.field.role', type: 'select', createOnly: true, options: refs.roles ?? [] },
    { key: 'leaseDays', labelKey: 'idn.field.leaseDays', type: 'number', required: true, hintKey: 'idn.hint.leaseDays' },
  ],
};

export const provisioningConfig: IdnConfig = {
  noun: 'user_installation', collection: 'user-installations', titleKey: 'idn.title.provisioning', newKey: 'idn.new.provisioning',
  refs: USERS,
  rowName: (r) => String(r.installationId).slice(-8),
  columns: [
    { key: 'userId', labelKey: 'idn.field.user', render: lookup('users', 'userId') },
    { key: 'installationId', labelKey: 'idn.field.installationId', render: (r) => String(r.installationId).slice(-8) },
    { key: 'leaseExpiresAt', labelKey: 'idn.field.leaseExpiresAt', render: when('leaseExpiresAt') },
  ],
  fields: (refs) => [
    { key: 'userId', labelKey: 'idn.field.user', type: 'select', required: true, createOnly: true, options: refs.users ?? [] },
    { key: 'installationId', labelKey: 'idn.field.installationId', type: 'text', required: true, createOnly: true },
    { key: 'leaseExpiresAt', labelKey: 'idn.field.leaseExpiresAt', type: 'datetime' },
  ],
};
