import type { Db } from './db/open.js';
import type { InstallationKind } from './contracts.js';
import { uuidv7 } from './ids.js';
import { nowUtc } from './time.js';

export interface LocalIdentity {
  installationId: string;
  kind: InstallationKind;
  code: string;
  name: string;
}

export function getLocalIdentity(db: Db): LocalIdentity | null {
  const r = db.prepare('SELECT installation_id, kind, code, name FROM sys_local_identity WHERE singleton = 1').get() as
    | { installation_id: string; kind: InstallationKind; code: string; name: string }
    | undefined;
  return r ? { installationId: r.installation_id, kind: r.kind, code: r.code, name: r.name } : null;
}

/**
 * Establish this installation's identity once. A hub generates its own id; every other
 * installation receives its id from the hub during provisioning (M10) and passes it in.
 * The matching sys_installation row is created by the hub (hub) or arrives via sync (others).
 */
export function setLocalIdentity(
  db: Db,
  input: { kind: InstallationKind; code: string; name: string; installationId?: string },
): LocalIdentity {
  if (getLocalIdentity(db)) throw new Error('Installation identity already initialized');
  if (input.kind !== 'hub' && !input.installationId) {
    throw new Error('Non-hub installations must be given their installation id by the hub (provisioning)');
  }
  const installationId = input.installationId ?? uuidv7();
  db.prepare(
    'INSERT INTO sys_local_identity (singleton, installation_id, kind, code, name, initialized_at) VALUES (1, ?, ?, ?, ?, ?)',
  ).run(installationId, input.kind, input.code, input.name, nowUtc());
  return { installationId, kind: input.kind, code: input.code, name: input.name };
}
