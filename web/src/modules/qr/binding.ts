import type { Rec } from '../../platform/api';
export const QR = '/api/v1/labels';
export const ORG = '/api/v1/org';
export const optionLabel = (r: Rec): string => `${String(r.code ?? r.labelNo ?? '')} – ${String(r.name ?? '')}`;
