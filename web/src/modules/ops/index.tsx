import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { BackupsScreen, HealthScreen, IntegrityScreen } from './OpsScreens';
import { opsLabelsEn } from './labels.en';

registerLabels(opsLabelsEn);

export const opsNav: NavItem[] = [
  { module: 'ops', path: '/ops/status', labelKey: 'ops.nav.status', requiredPermission: 'ops.status.view', order: 900 },
  { module: 'ops', path: '/ops/backups', labelKey: 'ops.nav.backups', requiredPermission: 'ops.backup.view', order: 910 },
  { module: 'ops', path: '/ops/integrity', labelKey: 'ops.nav.integrity', requiredPermission: 'ops.integrity.view', order: 920 },
];

export const opsRoutes = [
  { path: '/ops/status', element: <HealthScreen /> },
  { path: '/ops/backups', element: <BackupsScreen /> },
  { path: '/ops/integrity', element: <IntegrityScreen /> },
];
