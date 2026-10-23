/** M03 binding of the shared resource screen. */
import type { ReactNode } from 'react';
import type { Rec } from '../../platform/api';
import { ResourceScreen as BaseResourceScreen, type ResourceConfig as BaseConfig } from '../../platform/ResourceScreen';

export const AST = '/api/v1/assets';
export const ORG = '/api/v1/org';
export type AstConfig = Omit<BaseConfig, 'apiBase' | 'permPrefix' | 'editKey' | 'removeKey'>;

export function AstResourceScreen({ config, rowActions, headerExtra }: { config: AstConfig; rowActions?: (row: Rec, reload: () => void) => ReactNode; headerExtra?: ReactNode }) {
  return (
    <BaseResourceScreen
      config={{ ...config, apiBase: AST, permPrefix: 'ast', editKey: 'ast.edit.record', removeKey: 'ast.remove.record' }}
      {...(rowActions ? { rowActions } : {})}
      {...(headerExtra ? { headerExtra } : {})}
    />
  );
}

export const optionLabel = (r: Rec): string => `${String(r.code ?? r.positionTag ?? '')} – ${String(r.name)}`;
