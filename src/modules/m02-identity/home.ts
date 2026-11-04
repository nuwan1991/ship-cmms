/**
 * Where a signed-in user "belongs", used only to pre-fill forms (e.g. a new work order's ship and party). Grants no rights.
 * Order: the user's own section -> the ship this installation serves -> the single ship the user's ship-scoped roles cover.
 */
import type { Db } from '../../platform/db/open.js';
import { getDepartment } from '../m01-organization/index.js';
import { activeGrants } from './authority.js';

export interface UserHome {
  /** The user's section (a ship section or a command department), when set on the user. */
  sectionId: string | null;
  sectionOwnerKind: 'ship' | 'command' | null;
  shipId: string | null;
  commandId: string | null;
}

export function userHome(db: Db, userId: string, installationId: string | null): UserHome {
  const out: UserHome = { sectionId: null, sectionOwnerKind: null, shipId: null, commandId: null };
  const u = db.prepare('SELECT section_id FROM idn_user WHERE id = ? AND deleted_at IS NULL').get(userId) as { section_id: string | null } | undefined;
  const section = u?.section_id ? getDepartment(db, u.section_id) : null;
  if (section) {
    out.sectionId = section.id;
    out.sectionOwnerKind = section.ownerKind;
    if (section.ownerKind === 'ship') out.shipId = section.ownerId;
    if (section.ownerKind === 'command') out.commandId = section.ownerId;
  }
  if (!out.shipId && installationId) {
    const inst = db.prepare("SELECT org_unit_kind, org_unit_id FROM sys_installation WHERE id = ? AND deleted_at IS NULL").get(installationId) as
      | { org_unit_kind: string | null; org_unit_id: string | null } | undefined;
    if (inst?.org_unit_kind === 'ship' && inst.org_unit_id) out.shipId = inst.org_unit_id;
    if (!out.commandId && inst?.org_unit_kind === 'command' && inst.org_unit_id) out.commandId = inst.org_unit_id;
  }
  if (!out.shipId) {
    const ships = [...new Set(activeGrants(db, userId).filter((g) => g.scopeKind === 'ship' && g.scopeId).map((g) => g.scopeId as string))];
    if (ships.length === 1) out.shipId = ships[0]!;
  }
  return out;
}
