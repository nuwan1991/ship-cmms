import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { IdnResourceScreen } from './binding';
import { idnLabelsEn } from './labels.en';
import { assignmentConfig, gatePolicyConfig, grantConfig, provisioningConfig } from './resources';
import { ReviewQueueScreen } from './ReviewQueueScreen';
import { RevocationsScreen } from './RevocationsScreen';
import { RolesScreen } from './RolesScreen';
import { UsersScreen } from './UsersScreen';

registerLabels(idnLabelsEn);

export const idnNav: NavItem[] = [
  { module: 'idn', path: '/identity/users', labelKey: 'idn.nav.users', requiredPermission: 'idn.user.view', order: 210 },
  { module: 'idn', path: '/identity/roles', labelKey: 'idn.nav.roles', requiredPermission: 'idn.role.view', order: 220 },
  { module: 'idn', path: '/identity/assignments', labelKey: 'idn.nav.assignments', requiredPermission: 'idn.role_assignment.view', order: 230 },
  { module: 'idn', path: '/identity/gates', labelKey: 'idn.nav.gates', requiredPermission: 'idn.gate_policy.view', order: 240 },
  { module: 'idn', path: '/identity/grants', labelKey: 'idn.nav.grants', requiredPermission: 'idn.offline_grant.view', order: 250 },
  { module: 'idn', path: '/identity/provisioning', labelKey: 'idn.nav.provisioning', requiredPermission: 'idn.user_installation.view', order: 260 },
  { module: 'idn', path: '/identity/review', labelKey: 'idn.nav.review', requiredPermission: 'idn.approval.view', order: 270 },
  { module: 'idn', path: '/identity/revocations', labelKey: 'idn.nav.revocations', requiredPermission: 'idn.revocation.view', order: 280 },
];

export const idnRoutes = [
  { path: '/identity/users', element: <UsersScreen /> },
  { path: '/identity/roles', element: <RolesScreen /> },
  { path: '/identity/assignments', element: <IdnResourceScreen config={assignmentConfig} /> },
  { path: '/identity/gates', element: <IdnResourceScreen config={gatePolicyConfig} /> },
  { path: '/identity/grants', element: <IdnResourceScreen config={grantConfig} /> },
  { path: '/identity/provisioning', element: <IdnResourceScreen config={provisioningConfig} /> },
  { path: '/identity/review', element: <ReviewQueueScreen /> },
  { path: '/identity/revocations', element: <RevocationsScreen /> },
];
