/**
 * Web composition root: the ONLY file that imports from more than one module's UI.
 * Each module's chat adds one import and spreads its nav items and routes here (mirrors src/modules/index.ts).
 */
import type { ReactElement } from 'react';
import type { NavItem } from './platform/nav';
import { orgNav, orgRoutes } from './modules/org';

export interface ModuleRoute {
  path: string;
  element: ReactElement;
}

export const NAV: readonly NavItem[] = [...orgNav];
export const ROUTES: readonly ModuleRoute[] = [...orgRoutes];
