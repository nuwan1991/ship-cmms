/**
 * Unit-level visibility (D72). A holder of ofc.scope.all sees the whole office. Anyone else sees records of their own unit
 * and the units below it, of units they are in-charge or officer of (and below), and records assigned to them personally.
 */
import { AppError } from '../../platform/errors.js';
import type { Row } from '../../platform/records.js';
import type { Actor } from './actor.js';
import { holds } from './common.js';
import { unitAndDescendants } from './queries.js';
import { commandScope } from './service.js';

export interface Visibility { all: boolean; personId: string | null; units: string[] }

export function personOfUser(a: Actor, commandId: string): Row | undefined {
  return a.wctx.db.prepare('SELECT * FROM ofc_person WHERE command_id = ? AND user_id = ? AND deleted_at IS NULL').get(commandId, a.principal.userId) as Row | undefined;
}

export function visibility(a: Actor, commandId: string): Visibility {
  const person = personOfUser(a, commandId);
  if (holds(a, 'ofc.scope.all', commandScope(commandId))) return { all: true, personId: (person?.id as string) ?? null, units: [] };
  const roots = new Set<string>();
  if (person?.unit_id) roots.add(person.unit_id as string);
  const led = a.wctx.db.prepare('SELECT id FROM ofc_org_unit WHERE command_id = ? AND deleted_at IS NULL AND (head_user_id = ? OR deputy_user_id = ?)').all(commandId, a.principal.userId, a.principal.userId) as Array<{ id: string }>;
  for (const u of led) roots.add(u.id);
  const units = new Set<string>();
  for (const r of roots) for (const u of unitAndDescendants(a.wctx.db, r)) units.add(u);
  return { all: false, personId: (person?.id as string) ?? null, units: [...units] };
}

/** SQL condition limiting a list to what the user may see. */
export function visibleWhere(v: Visibility, unitCol: string, personCols: readonly string[]): { where: string[]; params: unknown[] } {
  if (v.all) return { where: [], params: [] };
  const parts: string[] = [];
  const params: unknown[] = [];
  if (v.units.length) { parts.push(`${unitCol} IN (${v.units.map(() => '?').join(',')})`); params.push(...v.units); }
  if (v.personId) for (const c of personCols) { parts.push(`${c} = ?`); params.push(v.personId); }
  return { where: [parts.length ? `(${parts.join(' OR ')})` : '0'], params };
}

export function canSee(v: Visibility, row: Row, unitCol: string, personCols: readonly string[]): boolean {
  if (v.all) return true;
  if (row[unitCol] && v.units.includes(row[unitCol] as string)) return true;
  return !!v.personId && personCols.some((c) => row[c] === v.personId);
}

export function assertVisible(a: Actor, row: Row, unitCol: string, personCols: readonly string[], label: string): Visibility {
  const v = visibility(a, row.command_id as string);
  if (!canSee(v, row, unitCol, personCols)) throw new AppError('FORBIDDEN', `${label} belongs to another section or workshop`);
  return v;
}
