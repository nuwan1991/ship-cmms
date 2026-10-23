/** Permission codes `rpt.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). */
export type RptNoun = 'report' | 'dashboard' | 'notification';
export const perm = (noun: RptNoun, action: string): string => `rpt.${noun}.${action}`;

export const RPT_PERMISSIONS: readonly string[] = ['rpt.report.view', 'rpt.report.export', 'rpt.dashboard.view', 'rpt.notification.view', 'rpt.notification.acknowledge', 'rpt.notification.refresh'];
