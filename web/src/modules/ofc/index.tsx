import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { CorrespondenceScreen } from './CorrespondenceScreen';
import { HandoverDetailScreen, HandoversScreen } from './HandoverScreens';
import { MattersScreen } from './MattersScreen';
import { UnitsScreen } from './UnitsScreen';
import { TasksScreen } from './TasksScreen';
import { PersonnelScreen } from './PersonnelScreen';
import { MyWorkScreen } from './MyWorkScreen';
import { EquipmentScreen } from './EquipmentScreen';
import { WorkOrdersScreen } from './WorkOrdersScreen';
import { SupplyScreen } from './SupplyScreen';
import { DashboardScreen } from './DashboardScreen';
import { ReportsScreen } from './ReportsScreen';
import { ImportScreen } from './ImportScreen';
import { ofcLabelsEn } from './labels.en';

registerLabels(ofcLabelsEn);

/** Office menu (SLE (E&T) II – North). Order 50–90 puts it first in the menu for office users. */
export const ofcNav: NavItem[] = [
  { module: 'ofc', path: '/ofc/dashboard', labelKey: 'ofc.nav.dashboard', requiredPermission: 'ofc.report.view', order: 30 },
  { module: 'ofc', path: '/ofc/reports', labelKey: 'ofc.nav.reports', requiredPermission: 'ofc.report.view', order: 85 },
  { module: 'ofc', path: '/ofc/my-work', labelKey: 'ofc.nav.mywork', requiredPermission: 'ofc.task.view', order: 40 },
  { module: 'ofc', path: '/ofc/tasks', labelKey: 'ofc.nav.tasks', requiredPermission: 'ofc.task.view', order: 45 },
  { module: 'ofc', path: '/ofc/correspondence', labelKey: 'ofc.nav.correspondence', requiredPermission: 'ofc.correspondence.view', order: 50 },
  { module: 'ofc', path: '/ofc/matters', labelKey: 'ofc.nav.matters', requiredPermission: 'ofc.correspondence.view', order: 55 },
  { module: 'ofc', path: '/ofc/handovers', labelKey: 'ofc.nav.handovers', requiredPermission: 'ofc.handover.view', order: 60 },
  { module: 'ofc', path: '/ofc/work-orders', labelKey: 'ofc.nav.workorders', requiredPermission: 'ofc.work_order.view', order: 62 },
  { module: 'ofc', path: '/ofc/equipment', labelKey: 'ofc.nav.equipment', requiredPermission: 'ofc.equipment.view', order: 64 },
  { module: 'ofc', path: '/ofc/supply', labelKey: 'ofc.nav.supply', requiredPermission: 'ofc.supply.view', order: 66 },
  { module: 'ofc', path: '/ofc/personnel', labelKey: 'ofc.nav.personnel', requiredPermission: 'ofc.person.view', order: 70 },
  { module: 'ofc', path: '/ofc/import', labelKey: 'ofc.nav.import', requiredPermission: 'ofc.import.run', order: 95 },
  { module: 'ofc', path: '/ofc/units', labelKey: 'ofc.nav.units', requiredPermission: 'ofc.org_unit.view', order: 90 },
];

export const ofcRoutes = [
  { path: '/ofc/dashboard', element: <DashboardScreen /> },
  { path: '/ofc/reports', element: <ReportsScreen /> },
  { path: '/ofc/my-work', element: <MyWorkScreen /> },
  { path: '/ofc/tasks', element: <TasksScreen /> },
  { path: '/ofc/personnel', element: <PersonnelScreen /> },
  { path: '/ofc/work-orders', element: <WorkOrdersScreen /> },
  { path: '/ofc/equipment', element: <EquipmentScreen /> },
  { path: '/ofc/supply', element: <SupplyScreen /> },
  { path: '/ofc/correspondence', element: <CorrespondenceScreen /> },
  { path: '/ofc/matters', element: <MattersScreen /> },
  { path: '/ofc/handovers', element: <HandoversScreen /> },
  { path: '/ofc/handovers/:id', element: <HandoverDetailScreen /> },
  { path: '/ofc/import', element: <ImportScreen /> },
  { path: '/ofc/units', element: <UnitsScreen /> },
];
