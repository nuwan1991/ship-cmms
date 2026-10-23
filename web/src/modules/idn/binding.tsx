/** M02 binding of the shared resource screen. Identity data is hub-written reference data. */
import type { ReactNode } from 'react';
import type { Rec } from '../../platform/api';
import { ResourceScreen as BaseResourceScreen, type ResourceConfig as BaseConfig } from '../../platform/ResourceScreen';

export const IDN = '/api/v1/identity';
export type IdnConfig = Omit<BaseConfig, 'apiBase' | 'permPrefix' | 'editKey' | 'removeKey' | 'hubOnly'>;

export function IdnResourceScreen({ config, rowActions, headerExtra }: { config: IdnConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode; headerExtra?: ReactNode }) {
  return (
    <BaseResourceScreen
      config={{ ...config, apiBase: IDN, permPrefix: 'idn', editKey: 'idn.edit.record', removeKey: 'idn.remove.record', hubOnly: true }}
      {...(rowActions ? { rowActions } : {})}
      {...(headerExtra ? { headerExtra } : {})}
    />
  );
}
