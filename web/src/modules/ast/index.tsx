import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { AstResourceScreen } from './binding';
import { AssetsScreen } from './AssetsScreen';
import { astLabelsEn } from './labels.en';
import { PositionsScreen } from './PositionsScreen';
import { classificationConfig } from './resources';

registerLabels(astLabelsEn);

export const astNav: NavItem[] = [
  { module: 'ast', path: '/ast/assets', labelKey: 'ast.nav.assets', requiredPermission: 'ast.asset.view', order: 210 },
  { module: 'ast', path: '/ast/positions', labelKey: 'ast.nav.positions', requiredPermission: 'ast.position.view', order: 220 },
  { module: 'ast', path: '/ast/classifications', labelKey: 'ast.nav.classifications', requiredPermission: 'ast.classification.view', order: 230 },
];

export const astRoutes = [
  { path: '/ast/assets', element: <AssetsScreen /> },
  { path: '/ast/positions', element: <PositionsScreen /> },
  { path: '/ast/classifications', element: <AstResourceScreen config={classificationConfig} /> },
];
