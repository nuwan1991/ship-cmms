/**
 * Web composition root: the ONLY file that imports from more than one module's UI.
 * Each module's chat adds one import and spreads its nav items and routes here (mirrors src/modules/index.ts).
 */
import type { ReactElement } from 'react';
import type { NavItem } from './platform/nav';
import { astNav, astRoutes } from './modules/ast';
import { idnNav, idnRoutes } from './modules/idn';
import { orgNav, orgRoutes } from './modules/org';
import { qrNav, qrRoutes } from './modules/qr';
import { stkNav, stkRoutes } from './modules/stk';
import { wrkNav, wrkRoutes } from './modules/wrk';

export interface ModuleRoute {
  path: string;
  element: ReactElement;
}

export const NAV: readonly NavItem[] = [...orgNav, ...idnNav, ...astNav, ...qrNav, ...wrkNav, ...stkNav];
export const ROUTES: readonly ModuleRoute[] = [...orgRoutes, ...idnRoutes, ...astRoutes, ...qrRoutes, ...wrkRoutes, ...stkRoutes];
