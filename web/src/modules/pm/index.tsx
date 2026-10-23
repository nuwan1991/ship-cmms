import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { CalibrationScreen } from './CalibrationScreen';
import { DueScreen } from './DueScreen';
import { MetersScreen } from './MetersScreen';
import { PlansScreen } from './PlansScreen';
import { TemplatesScreen } from './TemplatesScreen';
import { pmLabelsEn } from './labels.en';

registerLabels(pmLabelsEn);

export const pmNav: NavItem[] = [
  { module: 'pm', path: '/pm/due', labelKey: 'pm.nav.due', requiredPermission: 'pm.due.view', order: 450 },
  { module: 'pm', path: '/pm/plans', labelKey: 'pm.nav.plans', requiredPermission: 'pm.plan.view', order: 460 },
  { module: 'pm', path: '/pm/meters', labelKey: 'pm.nav.meters', requiredPermission: 'pm.meter.view', order: 470 },
  { module: 'pm', path: '/pm/calibration', labelKey: 'pm.nav.calibration', requiredPermission: 'pm.calibration.view', order: 480 },
  { module: 'pm', path: '/pm/templates', labelKey: 'pm.nav.templates', requiredPermission: 'pm.task_template.view', order: 490 },
];

export const pmRoutes = [
  { path: '/pm/due', element: <DueScreen /> },
  { path: '/pm/plans', element: <PlansScreen /> },
  { path: '/pm/meters', element: <MetersScreen /> },
  { path: '/pm/calibration', element: <CalibrationScreen /> },
  { path: '/pm/templates', element: <TemplatesScreen /> },
];
