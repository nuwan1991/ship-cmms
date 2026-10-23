/** Permission codes `ops.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). Restoring is a command-line action on the stopped application, so it has no web permission. */
export type OpsNoun = 'status' | 'backup' | 'integrity';
export const perm = (noun: OpsNoun, action: string): string => `ops.${noun}.${action}`;

export const OPS_PERMISSIONS: readonly string[] = ['ops.status.view', 'ops.backup.view', 'ops.backup.create', 'ops.backup.verify', 'ops.integrity.view', 'ops.integrity.run'];
