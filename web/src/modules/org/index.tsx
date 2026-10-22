import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { orgLabelsEn } from './labels.en';
import { LocationsScreen } from './LocationsScreen';
import { ResourceScreen } from './ResourceScreen';
import { commandConfig, departmentConfig, fleetConfig, providerConfig, workshopConfig } from './resources';
import { ShipsScreen } from './ShipsScreen';

registerLabels(orgLabelsEn);

export const orgNav: NavItem[] = [
  { module: 'org', path: '/org/commands', labelKey: 'org.nav.commands', requiredPermission: 'org.command.view', order: 110 },
  { module: 'org', path: '/org/ships', labelKey: 'org.nav.ships', requiredPermission: 'org.ship.view', order: 120 },
  { module: 'org', path: '/org/departments', labelKey: 'org.nav.departments', requiredPermission: 'org.department.view', order: 130 },
  { module: 'org', path: '/org/workshops', labelKey: 'org.nav.workshops', requiredPermission: 'org.workshop.view', order: 140 },
  { module: 'org', path: '/org/providers', labelKey: 'org.nav.providers', requiredPermission: 'org.external_provider.view', order: 150 },
  { module: 'org', path: '/org/locations', labelKey: 'org.nav.locations', requiredPermission: 'org.location.view', order: 160 },
  { module: 'org', path: '/org/fleet', labelKey: 'org.nav.fleet', requiredPermission: 'org.fleet.view', order: 170 },
];

export const orgRoutes = [
  { path: '/org/commands', element: <ResourceScreen config={commandConfig} /> },
  { path: '/org/ships', element: <ShipsScreen /> },
  { path: '/org/departments', element: <ResourceScreen config={departmentConfig} /> },
  { path: '/org/workshops', element: <ResourceScreen config={workshopConfig} /> },
  { path: '/org/providers', element: <ResourceScreen config={providerConfig} /> },
  { path: '/org/locations', element: <LocationsScreen /> },
  { path: '/org/fleet', element: <ResourceScreen config={fleetConfig} /> },
];
