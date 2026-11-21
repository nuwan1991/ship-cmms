import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { CorrespondenceScreen } from './CorrespondenceScreen';
import { HandoverDetailScreen, HandoversScreen } from './HandoverScreens';
import { MattersScreen } from './MattersScreen';
import { UnitsScreen } from './UnitsScreen';
import { TasksScreen } from './TasksScreen';
import { PersonnelScreen } from './PersonnelScreen';
import { MyWorkScreen } from './MyWorkScreen';
import { ofcLabelsEn } from './labels.en';

registerLabels(ofcLabelsEn);

/** Office menu (SLE (E&T) II – North). Order 50–90 puts it first in the menu for office users. */
export const ofcNav: NavItem[] = [
  { module: 'ofc', path: '/ofc/my-work', labelKey: 'ofc.nav.mywork', requiredPermission: 'ofc.task.view', order: 40 },
  { module: 'ofc', path: '/ofc/tasks', labelKey: 'ofc.nav.tasks', requiredPermission: 'ofc.task.view', order: 45 },
  { module: 'ofc', path: '/ofc/correspondence', labelKey: 'ofc.nav.correspondence', requiredPermission: 'ofc.correspondence.view', order: 50 },
  { module: 'ofc', path: '/ofc/matters', labelKey: 'ofc.nav.matters', requiredPermission: 'ofc.correspondence.view', order: 55 },
  { module: 'ofc', path: '/ofc/handovers', labelKey: 'ofc.nav.handovers', requiredPermission: 'ofc.handover.view', order: 60 },
  { module: 'ofc', path: '/ofc/personnel', labelKey: 'ofc.nav.personnel', requiredPermission: 'ofc.person.view', order: 70 },
  { module: 'ofc', path: '/ofc/units', labelKey: 'ofc.nav.units', requiredPermission: 'ofc.org_unit.view', order: 90 },
];

export const ofcRoutes = [
  { path: '/ofc/my-work', element: <MyWorkScreen /> },
  { path: '/ofc/tasks', element: <TasksScreen /> },
  { path: '/ofc/personnel', element: <PersonnelScreen /> },
  { path: '/ofc/correspondence', element: <CorrespondenceScreen /> },
  { path: '/ofc/matters', element: <MattersScreen /> },
  { path: '/ofc/handovers', element: <HandoversScreen /> },
  { path: '/ofc/handovers/:id', element: <HandoverDetailScreen /> },
  { path: '/ofc/units', element: <UnitsScreen /> },
];
