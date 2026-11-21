/** Read side of M15. SQL stays inside the module. */
import { toCamel } from '../../platform/canonical.js';
import type { Db } from '../../platform/db/open.js';

export type Row = Record<string, unknown>;

export function toApi(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) if (k !== 'bytes') out[toCamel(k)] = v;
  return out;
}

export const getUnit = (db: Db, id: string): Row | undefined =>
  db.prepare('SELECT * FROM ofc_org_unit WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;

/** Units of one command in tree order (depth-first by sort_order, code), each with its depth and path of codes. */
export function unitTree(db: Db, commandId: string, includeInactive = false): Row[] {
  const rows = db.prepare(`SELECT * FROM ofc_org_unit WHERE command_id = ? AND deleted_at IS NULL ${includeInactive ? '' : "AND status = 'active'"} ORDER BY sort_order, code`).all(commandId) as Row[];
  const kids = new Map<string | null, Row[]>();
  const ids = new Set(rows.map((r) => r.id as string));
  for (const r of rows) {
    const p = r.parent_id && ids.has(r.parent_id as string) ? (r.parent_id as string) : null;
    kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  const out: Row[] = [];
  const walk = (p: string | null, depth: number, path: string[]) => {
    for (const r of kids.get(p) ?? []) {
      const pp = [...path, r.code as string];
      out.push({ ...r, depth, path: pp.join(' / ') });
      walk(r.id as string, depth + 1, pp);
    }
  };
  walk(null, 0, []);
  return out;
}

/** The unit and all units below it (for "my unit and below" filters and roll-up reports). */
export function unitAndDescendants(db: Db, unitId: string): string[] {
  const rows = db.prepare(
    `WITH RECURSIVE t(id) AS (SELECT id FROM ofc_org_unit WHERE id = ? AND deleted_at IS NULL
       UNION SELECT u.id FROM ofc_org_unit u JOIN t ON u.parent_id = t.id WHERE u.deleted_at IS NULL)
     SELECT id FROM t`,
  ).all(unitId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Links touching a record, from both ends; `direction` says which end this record is. */
export function linksOf(db: Db, type: string, id: string): Row[] {
  return db.prepare(
    `SELECT *, 'out' AS direction FROM ofc_link WHERE from_type = ? AND from_id = ? AND deleted_at IS NULL
     UNION ALL SELECT *, 'in' AS direction FROM ofc_link WHERE to_type = ? AND to_id = ? AND deleted_at IS NULL
     ORDER BY created_at`,
  ).all(type, id, type, id) as Row[];
}

export function attachmentsOf(db: Db, type: string, id: string): Row[] {
  return db.prepare(
    `SELECT a.*, l.id AS link_id, l.version AS link_version FROM ofc_attachment_link l JOIN ofc_attachment a ON a.id = l.attachment_id
      WHERE l.record_type = ? AND l.record_id = ? AND l.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY l.created_at`,
  ).all(type, id) as Row[];
}

export const timelineOf = (db: Db, type: string, id: string): Row[] =>
  db.prepare('SELECT * FROM ofc_record_event WHERE record_type = ? AND record_id = ? ORDER BY occurred_at, id').all(type, id) as Row[];
