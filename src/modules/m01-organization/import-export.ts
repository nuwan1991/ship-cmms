/** Excel/CSV template for ship and workshop locations (M11 drives it through the ImportExportPort). */
import type { AppContext } from '../../platform/app-context.js';
import { cell, numCell, rowError, rowFail } from '../../platform/import-export.js';
import type { ImportExportPort } from '../../platform/ports.js';
import { authorize, makeActor } from './actor.js';
import { perm } from './permissions.js';
import { findLocationByCode, findPartyByCode, getLive, resolveParty, type Row } from './queries.js';
import { createEntity, updateEntity } from './service.js';

const KINDS = ['deck', 'compartment', 'space', 'room', 'tank', 'area', 'yard', 'other'];

export function locationsPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'org.location', templateCode: 'locations', module: 'M01', title: 'Ship and workshop locations',
    importPermission: 'org.location.create', exportPermission: 'org.location.view',
    columns: [
      { key: 'siteCode', label: 'Ship or workshop code', required: true, hint: 'The code of the ship or workshop the location belongs to.', example: 'DEMO-101' },
      { key: 'parentCode', label: 'Parent location code', hint: 'Leave empty for a top-level deck. A parent may appear earlier in the same file.', example: 'MAIN-DECK' },
      { key: 'code', label: 'Location code', required: true, hint: 'Unique within the ship or workshop. Existing codes are updated.', example: 'ER-01' },
      { key: 'name', label: 'Name', hint: 'Required for new locations.', example: 'Engine room' },
      { key: 'kind', label: 'Kind', hint: `One of ${KINDS.join(', ')}.`, example: 'compartment' },
      { key: 'sortOrder', label: 'Sort order', hint: 'Whole number; lower shows first.', example: '10' },
      { key: 'status', label: 'Status', hint: 'active or inactive.', example: 'active' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const db = ctx.db;
      const siteCode = cell(row, 'siteCode'), code = cell(row, 'code')?.toUpperCase(), name = cell(row, 'name');
      if (!siteCode) return rowFail('Ship or workshop code is required');
      if (!code) return rowFail('Location code is required');
      const ship = findPartyByCode(db, 'ship', siteCode), workshop = ship ? null : findPartyByCode(db, 'workshop', siteCode);
      const site = ship ?? workshop;
      if (!site) return rowFail(`No ship or workshop has the code ${siteCode.toUpperCase()}`);
      const parentCode = cell(row, 'parentCode')?.toUpperCase();
      let parentId: string | null = null;
      if (parentCode) {
        const parent = findLocationByCode(db, site.id, parentCode);
        if (!parent) return rowFail(`Parent location ${parentCode} does not exist at ${site.code}`);
        parentId = parent.id;
      }
      const kind = cell(row, 'kind')?.toLowerCase();
      if (kind && !KINDS.includes(kind)) return rowFail(`Kind must be one of ${KINDS.join(', ')}`);
      const sortOrder = numCell(row, 'sortOrder');
      if (sortOrder !== undefined && !Number.isInteger(sortOrder)) return rowFail('Sort order must be a whole number');
      const status = cell(row, 'status')?.toLowerCase();
      try {
        const existing = findLocationByCode(db, site.id, code);
        if (!existing) {
          if (!name) return rowFail('Name is required for a new location');
          createEntity(a, 'location', { siteKind: ship ? 'ship' : 'workshop', siteId: site.id, parentId, code, name, ...(kind ? { kind } : {}), ...(sortOrder !== undefined ? { sortOrder } : {}), ...(status ? { status } : {}) });
          return { ok: true, action: 'create', reference: `${site.code}/${code}` };
        }
        const cur = getLive(db, 'location', existing.id) as Row;
        const patch: Record<string, unknown> = {};
        if (name && name !== cur.name) patch.name = name;
        if (kind && kind !== cur.kind) patch.kind = kind;
        if (sortOrder !== undefined && sortOrder !== cur.sort_order) patch.sortOrder = sortOrder;
        if (status && status !== cur.status) patch.status = status;
        if (parentCode && parentId !== (cur.parent_id ?? null)) patch.parentId = parentId;
        if (Object.keys(patch).length === 0) return { ok: true, action: 'skip', reference: `${site.code}/${code}` };
        updateEntity(a, 'location', existing.id, { expectedVersion: cur.version, ...patch });
        return { ok: true, action: 'update', reference: `${site.code}/${code}` };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(scope, principal) {
      authorize(makeActor(ctx, principal), perm('location', 'view'), scope);
      const rows = ctx.db.prepare(`SELECT * FROM org_location WHERE deleted_at IS NULL ${scope.kind === 'ship' && scope.id ? 'AND home_scope_id = ?' : ''} ORDER BY home_scope_id, sort_order, code`).all(...(scope.kind === 'ship' && scope.id ? [scope.id] : [])) as Row[];
      const byId = new Map(rows.map((r) => [r.id as string, r.code as string]));
      return rows.map((r) => ({
        siteCode: resolveParty(ctx.db, { kind: r.site_kind as 'ship' | 'workshop', id: r.home_scope_id as string })?.code ?? '',
        parentCode: r.parent_id ? byId.get(r.parent_id as string) ?? (ctx.db.prepare('SELECT code FROM org_location WHERE id = ?').get(r.parent_id) as { code: string } | undefined)?.code ?? '' : '',
        code: r.code, name: r.name, kind: r.kind, sortOrder: r.sort_order, status: r.status,
      }));
    },
  };
}
