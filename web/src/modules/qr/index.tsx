import { registerLabels } from '../../platform/i18n';
import type { NavItem } from '../../platform/nav';
import { LabelsScreen } from './LabelsScreen';
import { SurveysScreen } from './SurveysScreen';
import { TemplatesScreen } from './TemplatesScreen';
import { qrLabelsEn } from './labels.en';

registerLabels(qrLabelsEn);

export const qrNav: NavItem[] = [
  { module: 'qr', path: '/qr/labels', labelKey: 'qr.nav.labels', requiredPermission: 'qr.label.view', order: 310 },
  { module: 'qr', path: '/qr/surveys', labelKey: 'qr.nav.surveys', requiredPermission: 'qr.survey.view', order: 320 },
  { module: 'qr', path: '/qr/templates', labelKey: 'qr.nav.templates', requiredPermission: 'qr.survey_template.view', order: 330 },
];

export const qrRoutes = [
  { path: '/qr/labels', element: <LabelsScreen /> },
  { path: '/qr/surveys', element: <SurveysScreen /> },
  { path: '/qr/templates', element: <TemplatesScreen /> },
];
