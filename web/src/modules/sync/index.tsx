import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { BundlesScreen, ConflictsScreen, InstallationsScreen, StatusScreen } from './SyncScreens';
import { synLabelsEn } from './labels.en';

registerLabels(synLabelsEn);

export const synNav: NavItem[] = [
  { module: 'syn', path: '/sync/status', labelKey: 'syn.nav.status', requiredPermission: 'syn.status.view', order: 800 },
  { module: 'syn', path: '/sync/installations', labelKey: 'syn.nav.installations', requiredPermission: 'syn.peer.view', order: 810 },
  { module: 'syn', path: '/sync/conflicts', labelKey: 'syn.nav.conflicts', requiredPermission: 'syn.conflict.view', order: 820 },
  { module: 'syn', path: '/sync/bundles', labelKey: 'syn.nav.bundles', requiredPermission: 'syn.bundle.export', order: 830 },
];

export const synRoutes = [
  { path: '/sync/status', element: <StatusScreen /> },
  { path: '/sync/installations', element: <InstallationsScreen /> },
  { path: '/sync/conflicts', element: <ConflictsScreen /> },
  { path: '/sync/bundles', element: <BundlesScreen /> },
];
