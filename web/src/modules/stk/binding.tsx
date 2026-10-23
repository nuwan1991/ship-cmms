/** M07 binding of the shared resource screen. */
import type { ReactNode } from 'react';
import type { Rec } from '../../platform/api';
import { ResourceScreen as BaseResourceScreen, type ResourceConfig as BaseConfig } from '../../platform/ResourceScreen';

export const STK = '/api/v1/stores';
export const WRK = '/api/v1/work';
export const ORG = '/api/v1/org';
export type StkConfig = Omit<BaseConfig, 'apiBase' | 'permPrefix' | 'editKey' | 'removeKey'>;

export function StkResourceScreen({ config, rowActions }: { config: StkConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode }) {
  return (
    <BaseResourceScreen
      config={{ ...config, apiBase: STK, permPrefix: 'stk', editKey: 'stk.edit.record', removeKey: 'stk.remove.record' }}
      {...(rowActions ? { rowActions } : {})}
    />
  );
}
