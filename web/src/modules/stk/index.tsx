import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { StockScreen } from './StockScreen';
import { TransfersScreen } from './TransfersScreen';
import { StkResourceScreen } from './binding';
import { stkLabelsEn } from './labels.en';
import { locationConfig, partConfig } from './resources';

registerLabels(stkLabelsEn);

export const stkNav: NavItem[] = [
  { module: 'stk', path: '/stk/stock', labelKey: 'stk.nav.stock', requiredPermission: 'stk.transaction.view', order: 510 },
  { module: 'stk', path: '/stk/transfers', labelKey: 'stk.nav.transfers', requiredPermission: 'stk.transfer.view', order: 520 },
  { module: 'stk', path: '/stk/parts', labelKey: 'stk.nav.parts', requiredPermission: 'stk.part.view', order: 530 },
  { module: 'stk', path: '/stk/locations', labelKey: 'stk.nav.locations', requiredPermission: 'stk.location.view', order: 540 },
];

export const stkRoutes = [
  { path: '/stk/stock', element: <StockScreen /> },
  { path: '/stk/transfers', element: <TransfersScreen /> },
  { path: '/stk/parts', element: <StkResourceScreen config={partConfig} /> },
  { path: '/stk/locations', element: <StkResourceScreen config={locationConfig} /> },
];
