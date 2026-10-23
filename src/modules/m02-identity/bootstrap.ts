/**
 * First-administrator bootstrap, run at the hub from the command line (there is no one to sign in until it runs).
 * Goes through the normal write path, so ownership, audit and change log apply. Not an HTTP route.
 */
import type { AppContext } from '../../platform/app-context.js';
import { AppError } from '../../platform/errors.js';
import { createRecord } from '../../platform/records.js';
import { uuidv7 } from '../../platform/ids.js';
import { nowUtc } from '../../platform/time.js';
import { makeActor } from './actor.js';
import { assertPasswordPolicy, hashPassword } from './passwords.js';
import { Username } from './schemas.js';

export const ADMIN_ROLE_CODE = 'ADMIN';

export async function createFirstAdmin(ctx: AppContext, input: { username: string; password: string; displayName: string }): Promise<{ userId: string; roleId: string }> {
  const inst = ctx.identity;
  if (!inst || inst.kind !== 'hub') throw new AppError('NOT_OWNER', 'Administrators are created at the hub');
  const username = Username.parse(input.username);
  assertPasswordPolicy(input.password, username);
  if (ctx.db.prepare("SELECT 1 FROM idn_user WHERE deleted_at IS NULL LIMIT 1").get()) throw new AppError('DUPLICATE', 'Users already exist; create further administrators through the API');
  const hash = await hashPassword(input.password);
  const a = makeActor(ctx, { userId: 'system', installationId: inst.installationId, displayName: 'System bootstrap' });
  return ctx.db.transaction(() => {
    const role = createRecord(a.wctx, 'idn.role', { code: ADMIN_ROLE_CODE, name: 'Administrator', description: 'Full access to everything, including identity administration' });
    createRecord(a.wctx, 'idn.role_permission', { role_id: role.id, permission: '*' });
    const user = createRecord(a.wctx, 'idn.user', { display_name: input.displayName });
    createRecord(a.wctx, 'idn.credential', { user_id: user.id, username, password_hash: hash, credential_version: 1 });
    createRecord(a.wctx, 'idn.role_assignment', { user_id: user.id, role_id: role.id, scope_kind: 'fleet', scope_id: null, valid_from: nowUtc(), valid_until: null, id: uuidv7() });
    return { userId: user.id as string, roleId: role.id as string };
  })();
}
