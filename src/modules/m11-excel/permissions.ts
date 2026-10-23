/** Permission codes `xls.<noun>.<action>` (CONTRACTS §7), announced on the event bus at startup (D25). What a row may change is decided by the owning module's own permissions. */
export type XlsNoun = 'template' | 'export' | 'import';
export const perm = (noun: XlsNoun, action: string): string => `xls.${noun}.${action}`;

export const XLS_PERMISSIONS: readonly string[] = ['xls.template.view', 'xls.export.run', 'xls.import.view', 'xls.import.preview', 'xls.import.commit'];
