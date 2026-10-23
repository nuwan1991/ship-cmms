/** M01 binding of the shared resource screen: fixes the API base, permission prefix and record labels. */
import type { ReactNode } from 'react';
import type { Rec } from '../../platform/api';
import {
  ResourceScreen as BaseResourceScreen, useRefOptions as useBaseRefOptions,
  type ColumnDef, type Option, type RefDef, type ResourceConfig as BaseConfig,
} from '../../platform/ResourceScreen';

export const ORG = '/api/v1/org';
export type { ColumnDef, Option, RefDef };
export type ResourceConfig = Omit<BaseConfig, 'apiBase' | 'permPrefix' | 'editKey' | 'removeKey'>;

export const useRefOptions = (refs: Record<string, RefDef> | undefined): Record<string, Option[]> => useBaseRefOptions(refs, ORG);

export function ResourceScreen({ config, rowActions, headerExtra }: { config: ResourceConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode; headerExtra?: ReactNode }) {
  return <BaseResourceScreen config={{ ...config, apiBase: ORG, permPrefix: 'org', editKey: 'org.edit.record', removeKey: 'org.remove.record' }} {...(rowActions ? { rowActions } : {})} {...(headerExtra ? { headerExtra } : {})} />;
}
