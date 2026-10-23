import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { ExcelScreen } from './ExcelScreen';
import { xlsLabelsEn } from './labels.en';

registerLabels(xlsLabelsEn);

export const xlsNav: NavItem[] = [
  { module: 'xls', path: '/xls', labelKey: 'xls.nav.excel', requiredPermission: 'xls.template.view', order: 910 },
];

export const xlsRoutes = [{ path: '/xls', element: <ExcelScreen /> }];
