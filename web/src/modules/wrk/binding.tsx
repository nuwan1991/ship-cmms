/** M05 binding of the shared resource screen. */
import type { ReactNode } from 'react';
import type { Rec } from '../../platform/api';
import { ResourceScreen as BaseResourceScreen, type ResourceConfig as BaseConfig } from '../../platform/ResourceScreen';

export const WRK = '/api/v1/work';
export const AST = '/api/v1/assets';
export const ORG = '/api/v1/org';
export type WrkConfig = Omit<BaseConfig, 'apiBase' | 'permPrefix' | 'editKey' | 'removeKey'>;

export function WrkResourceScreen({ config, rowActions }: { config: WrkConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode }) {
  return (
    <BaseResourceScreen
      config={{ ...config, apiBase: WRK, permPrefix: 'wrk', editKey: 'wrk.edit.record', removeKey: 'wrk.remove.record' }}
      {...(rowActions ? { rowActions } : {})}
    />
  );
}

export const optionLabel = (r: Rec): string => `${String(r.code ?? r.woNo ?? r.caseNo ?? r.defectNo ?? '')} – ${String(r.name ?? r.title ?? '')}`;
