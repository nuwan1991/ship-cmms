import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { DockingDetailScreen } from './DockingDetail';
import { DockingsScreen } from './DockingsScreen';
import { DocksScreen } from './DocksScreen';
import { DueScreen } from './DueScreen';
import { dckLabelsEn } from './labels.en';

registerLabels(dckLabelsEn);

export const dckNav: NavItem[] = [
  { module: 'dck', path: '/docking/due', labelKey: 'dck.nav.due', requiredPermission: 'dck.due.view', order: 500 },
  { module: 'dck', path: '/docking/dockings', labelKey: 'dck.nav.dockings', requiredPermission: 'dck.docking.view', order: 510 },
  { module: 'dck', path: '/docking/docks', labelKey: 'dck.nav.docks', requiredPermission: 'dck.dock.view', order: 520 },
];

export const dckRoutes = [
  { path: '/docking/due', element: <DueScreen /> },
  { path: '/docking/dockings', element: <DockingsScreen /> },
  { path: '/docking/dockings/:id', element: <DockingDetailScreen /> },
  { path: '/docking/docks', element: <DocksScreen /> },
];
