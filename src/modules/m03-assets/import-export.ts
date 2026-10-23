/** Excel/CSV template for the equipment register (M11 drives it through the ImportExportPort). */
import type { AppContext } from '../../platform/app-context.js';
import { cell, rowError, rowFail } from '../../platform/import-export.js';
import type { ImportExportPort } from '../../platform/ports.js';
import { findPartyByCode, resolveParty } from '../m01-organization/index.js';
import { authorize, makeActor } from './actor.js';
import { perm } from './permissions.js';
import { type Row } from './queries.js';
import { createAsset, updateEntity } from './service.js';

const classByCode = (ctx: AppContext, code: string): { id: string } | undefined =>
  ctx.db.prepare('SELECT id FROM ast_classification WHERE code = ? AND deleted_at IS NULL').get(code.toUpperCase()) as { id: string } | undefined;

export function assetsPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'ast.asset', templateCode: 'assets', module: 'M03', title: 'Equipment register',
    importPermission: 'ast.asset.create', exportPermission: 'ast.asset.view',
    columns: [
      { key: 'assetTag', label: 'Equipment tag', hint: 'Leave empty to register new equipment (a tag is allocated). Give an existing tag to update it. Tags are never typed in for new equipment.', example: 'SLN-EQ-00000001' },
      { key: 'name', label: 'Name', hint: 'Required for new equipment.', example: 'Main alternator' },
      { key: 'serialNumber', label: 'Serial number', example: 'ALT-77831' },
      { key: 'manufacturer', label: 'Manufacturer', example: 'Stamford' },
      { key: 'model', label: 'Model', example: 'HCI544' },
      { key: 'classificationCode', label: 'Classification code', hint: 'An equipment classification defined by the hub.', example: 'ALTERNATOR' },
      { key: 'homeShipCode', label: 'Ship code', hint: 'The ship the equipment belongs to. Cannot be changed by import once registered.', example: 'DEMO-101' },
      { key: 'notes', label: 'Notes' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const db = ctx.db;
      const tag = cell(row, 'assetTag')?.toUpperCase(), name = cell(row, 'name');
      const serialNumber = cell(row, 'serialNumber'), manufacturer = cell(row, 'manufacturer'), model = cell(row, 'model'), notes = cell(row, 'notes');
      const classCode = cell(row, 'classificationCode'), shipCode = cell(row, 'homeShipCode');
      let classificationId: string | undefined;
      if (classCode) {
        classificationId = classByCode(ctx, classCode)?.id;
        if (!classificationId) return rowFail(`No classification has the code ${classCode.toUpperCase()}`);
      }
      let shipId: string | undefined;
      if (shipCode) {
        shipId = findPartyByCode(db, 'ship', shipCode)?.id;
        if (!shipId) return rowFail(`No ship has the code ${shipCode.toUpperCase()}`);
      }
      try {
        if (tag) {
          const cur = db.prepare('SELECT * FROM ast_asset WHERE asset_tag = ? AND deleted_at IS NULL').get(tag) as Row | undefined;
          if (!cur) return rowFail(`No equipment has the tag ${tag}. Leave the tag empty to register new equipment.`);
          if (shipId && shipId !== (cur.home_scope_id ?? null)) return rowFail('The ship of registered equipment cannot be changed by import; record a movement instead');
          const patch: Record<string, unknown> = {};
          if (name && name !== cur.name) patch.name = name;
          if (serialNumber !== undefined && serialNumber !== cur.serial_number) patch.serialNumber = serialNumber;
          if (manufacturer !== undefined && manufacturer !== cur.manufacturer) patch.manufacturer = manufacturer;
          if (model !== undefined && model !== cur.model) patch.model = model;
          if (notes !== undefined && notes !== cur.notes) patch.notes = notes;
          if (classificationId !== undefined && classificationId !== cur.classification_id) patch.classificationId = classificationId;
          if (Object.keys(patch).length === 0) return { ok: true, action: 'skip', reference: tag };
          updateEntity(a, 'asset', cur.id as string, { expectedVersion: cur.version, ...patch });
          return { ok: true, action: 'update', reference: tag };
        }
        if (!name) return rowFail('Name is required for new equipment');
        if (manufacturer && serialNumber) {
          const dup = db.prepare('SELECT asset_tag FROM ast_asset WHERE manufacturer = ? AND serial_number = ? AND deleted_at IS NULL').get(manufacturer, serialNumber) as { asset_tag: string } | undefined;
          if (dup) return { ok: false, errors: [`Possible duplicate: ${dup.asset_tag} already has this manufacturer and serial number. Put that tag in the first column to update it.`], duplicateOf: dup.asset_tag };
        }
        const { asset } = createAsset(a, {
          name, ...(serialNumber ? { serialNumber } : {}), ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : {}), ...(notes ? { notes } : {}),
          ...(classificationId ? { classificationId } : {}), ...(shipId ? { homeShipId: shipId } : {}),
        });
        return { ok: true, action: 'create', reference: String(asset.assetTag) };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(scope, principal) {
      authorize(makeActor(ctx, principal), perm('asset', 'view'), scope);
      const shipFilter = scope.kind === 'ship' && scope.id;
      const rows = ctx.db.prepare(`SELECT a.*, c.code AS class_code FROM ast_asset a LEFT JOIN ast_classification c ON c.id = a.classification_id WHERE a.deleted_at IS NULL ${shipFilter ? 'AND a.home_scope_id = ?' : ''} ORDER BY a.asset_tag`).all(...(shipFilter ? [scope.id] : [])) as Row[];
      return rows.map((r) => ({
        assetTag: r.asset_tag, name: r.name, serialNumber: r.serial_number, manufacturer: r.manufacturer, model: r.model, classificationCode: r.class_code,
        homeShipCode: r.home_scope_id ? resolveParty(ctx.db, { kind: 'ship', id: r.home_scope_id as string })?.code ?? '' : '', notes: r.notes,
      }));
    },
  };
}
