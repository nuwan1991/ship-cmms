import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { CasesScreen } from './CasesScreen';
import { DefectsScreen } from './DefectsScreen';
import { WorkOrdersScreen } from './WorkOrdersScreen';
import { WrkResourceScreen } from './binding';
import { wrkLabelsEn } from './labels.en';
import { advisoryConfig } from './resources';

registerLabels(wrkLabelsEn);

export const wrkNav: NavItem[] = [
  { module: 'wrk', path: '/wrk/defects', labelKey: 'wrk.nav.defects', requiredPermission: 'wrk.defect.view', order: 410 },
  { module: 'wrk', path: '/wrk/cases', labelKey: 'wrk.nav.cases', requiredPermission: 'wrk.repair_case.view', order: 420 },
  { module: 'wrk', path: '/wrk/workorders', labelKey: 'wrk.nav.workorders', requiredPermission: 'wrk.work_order.view', order: 430 },
  { module: 'wrk', path: '/wrk/advisories', labelKey: 'wrk.nav.advisories', requiredPermission: 'wrk.advisory.view', order: 440 },
];

export const wrkRoutes = [
  { path: '/wrk/defects', element: <DefectsScreen /> },
  { path: '/wrk/cases', element: <CasesScreen /> },
  { path: '/wrk/workorders', element: <WorkOrdersScreen /> },
  { path: '/wrk/advisories', element: <WrkResourceScreen config={advisoryConfig} /> },
];
