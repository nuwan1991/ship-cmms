import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { DashboardScreen, NotificationsScreen, ReportsScreen } from './RptScreens';
import { rptLabelsEn } from './labels.en';

registerLabels(rptLabelsEn);

export const rptNav: NavItem[] = [
  { module: 'rpt', path: '/reports/overview', labelKey: 'rpt.nav.dashboard', requiredPermission: 'rpt.dashboard.view', order: 10 },
  { module: 'rpt', path: '/reports/list', labelKey: 'rpt.nav.reports', requiredPermission: 'rpt.report.view', order: 700 },
  { module: 'rpt', path: '/reports/notifications', labelKey: 'rpt.nav.notifications', requiredPermission: 'rpt.notification.view', order: 710 },
];

export const rptRoutes = [
  { path: '/reports/overview', element: <DashboardScreen /> },
  { path: '/reports/list', element: <ReportsScreen /> },
  { path: '/reports/notifications', element: <NotificationsScreen /> },
];
