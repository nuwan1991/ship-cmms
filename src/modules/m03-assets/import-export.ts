/** Excel/CSV template for the equipment register (M11 drives it through the ImportExportPort). */
import type { AppContext } from '../../platform/app-context.js';
import { cell, rowError, rowFail } from '../../platform/import-export.js';
import type { ImportExportPort } from '../../platform/ports.js';
import { findLocationByCode, findPartyByCode, getLocation, resolveParty } from '../m01-organization/index.js';
import { authorize, makeActor } from './actor.js';
import { perm } from './permissions.js';
import { getAssetState, type Row } from './queries.js';
import { ASSET_STATUSES } from './schemas.js';
import { resolveClassificationCode } from './classification-merge.js';
import { createAsset, createEntity, updateEntity } from './service.js';

const classByCode = (ctx: AppContext, code: string): Row | undefined =>
  ctx.db.prepare('SELECT * FROM ast_classification WHERE code = ? AND deleted_at IS NULL').get(code.toUpperCase()) as Row | undefined;

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
      { key: 'classificationCode', label: 'Classification code', hint: 'An equipment classification defined by the hub. A legacy code that the hub has mapped to one standard class is translated to it.', example: 'SWBS-311-ALT' },
      { key: 'homeShipCode', label: 'Ship code', hint: 'The ship the equipment belongs to. Cannot be changed by import once registered.', example: 'DEMO-101' },
      { key: 'positionTag', label: 'Position tag', hint: 'New equipment: the position of the ship it is installed in (needs the ship code). Registered equipment: must match where it is now; record a movement on the asset screen to move it.', example: '2.1.3' },
      { key: 'locationCode', label: 'Location code', hint: 'New equipment: the compartment or space of the ship it is in (needs the ship code). Registered equipment: must match where it is now.', example: 'ER-01' },
      { key: 'assetStatus', label: 'Status', hint: `New equipment: one of ${ASSET_STATUSES.join(', ')} (default in_service). Registered equipment: must match its status now.`, example: 'in_service' },
      { key: 'notes', label: 'Notes' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const db = ctx.db;
      const tag = cell(row, 'assetTag')?.toUpperCase(), name = cell(row, 'name');
      const serialNumber = cell(row, 'serialNumber'), manufacturer = cell(row, 'manufacturer'), model = cell(row, 'model'), notes = cell(row, 'notes');
      const classCode = cell(row, 'classificationCode'), shipCode = cell(row, 'homeShipCode');
      const positionTag = cell(row, 'positionTag'), locationCode = cell(row, 'locationCode')?.toUpperCase(), assetStatus = cell(row, 'assetStatus')?.toLowerCase();
      let classificationId: string | undefined;
      if (classCode) {
        classificationId = resolveClassificationCode(db, classCode)?.id;
        if (!classificationId) return rowFail(`No classification has the code ${classCode.toUpperCase()}, or the legacy code maps to more than one standard class`);
      }
      let shipId: string | undefined;
      if (shipCode) {
        shipId = findPartyByCode(db, 'ship', shipCode)?.id;
        if (!shipId) return rowFail(`No ship has the code ${shipCode.toUpperCase()}`);
      }
      if (assetStatus && !(ASSET_STATUSES as readonly string[]).includes(assetStatus)) return rowFail(`Status must be one of ${ASSET_STATUSES.join(', ')}`);
      try {
        if (tag) {
          const cur = db.prepare('SELECT * FROM ast_asset WHERE asset_tag = ? AND deleted_at IS NULL').get(tag) as Row | undefined;
          if (!cur) return rowFail(`No equipment has the tag ${tag}. Leave the tag empty to register new equipment.`);
          if (shipId && shipId !== (cur.home_scope_id ?? null)) return rowFail('The ship of registered equipment cannot be changed by import; record a movement instead');
          const now = currentPlace(cur.id as string);
          if ((positionTag !== undefined && positionTag !== now.positionTag) || (locationCode !== undefined && locationCode !== now.locationCode) || (assetStatus !== undefined && assetStatus !== now.assetStatus)) {
            return rowFail('The position, location or status of registered equipment cannot be changed by import; record a movement on the asset screen instead');
          }
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
        if ((positionTag || locationCode) && !shipId) return rowFail('Give the ship code when giving a position tag or location code');
        let positionId: string | undefined, locationId: string | undefined;
        if (positionTag) {
          positionId = (db.prepare('SELECT id FROM ast_position WHERE home_scope_id = ? AND position_tag = ? AND deleted_at IS NULL').get(shipId, positionTag) as { id: string } | undefined)?.id;
          if (!positionId) return rowFail(`Ship ${shipCode!.toUpperCase()} has no position with the tag ${positionTag}`);
        }
        if (locationCode) {
          locationId = findLocationByCode(db, shipId!, locationCode)?.id;
          if (!locationId) return rowFail(`Ship ${shipCode!.toUpperCase()} has no location with the code ${locationCode}`);
        }
        if (manufacturer && serialNumber) {
          const dup = db.prepare('SELECT asset_tag FROM ast_asset WHERE manufacturer = ? AND serial_number = ? AND deleted_at IS NULL').get(manufacturer, serialNumber) as { asset_tag: string } | undefined;
          if (dup) return { ok: false, errors: [`Possible duplicate: ${dup.asset_tag} already has this manufacturer and serial number. Put that tag in the first column to update it.`], duplicateOf: dup.asset_tag };
        }
        const { asset } = createAsset(a, {
          name, ...(serialNumber ? { serialNumber } : {}), ...(manufacturer ? { manufacturer } : {}), ...(model ? { model } : {}), ...(notes ? { notes } : {}),
          ...(classificationId ? { classificationId } : {}), ...(shipId ? { homeShipId: shipId } : {}),
          ...(positionId ? { positionId } : {}), ...(locationId ? { locationId } : {}), ...(assetStatus ? { assetStatus } : {}),
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
        homeShipCode: r.home_scope_id ? resolveParty(ctx.db, { kind: 'ship', id: r.home_scope_id as string })?.code ?? '' : '',
        ...currentPlace(r.id as string), notes: r.notes,
      }));
    },
  };

  /** Where the equipment is now, as the codes the sheet uses (empty when not installed or not placed). */
  function currentPlace(assetId: string): { positionTag: string; locationCode: string; assetStatus: string } {
    const s = getAssetState(ctx.db, assetId);
    const pos = s?.positionId ? ctx.db.prepare('SELECT position_tag FROM ast_position WHERE id = ?').get(s.positionId) as { position_tag: string } | undefined : undefined;
    return { positionTag: pos?.position_tag ?? '', locationCode: (s?.locationId ? getLocation(ctx.db, s.locationId)?.code : undefined) ?? '', assetStatus: s?.assetStatus ?? '' };
  }
}

/** Hub reference data: the classification list itself, so the standard catalogue and legacy lists can be reviewed in Excel. */
export function classificationsPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'ast.classification', templateCode: 'classifications', module: 'M03', title: 'Equipment classifications',
    importPermission: 'ast.classification.create', exportPermission: 'ast.classification.view',
    columns: [
      { key: 'code', label: 'Code', required: true, hint: 'Permanent. A-Z, 0-9, _ . - (max 32). Existing codes are updated, new codes are created.', example: 'SWBS-324-MSB' },
      { key: 'name', label: 'Name', example: 'Main switchboard' },
      { key: 'kind', label: 'Kind', hint: 'equipment or component. Cannot be changed later.', example: 'equipment' },
      { key: 'parentCode', label: 'Parent code', hint: 'Must already exist or be on an earlier row, with the same kind. Cannot be changed later.', example: 'SWBS-324' },
      { key: 'description', label: 'Description', example: 'SWBS 324; IEC 60092-302' },
      { key: 'status', label: 'Status', hint: 'active or inactive (default active).', example: 'active' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const code = cell(row, 'code')?.toUpperCase(), name = cell(row, 'name'), kind = cell(row, 'kind')?.toLowerCase();
      const parentCode = cell(row, 'parentCode')?.toUpperCase(), description = cell(row, 'description'), status = cell(row, 'status')?.toLowerCase();
      if (!code) return rowFail('Code is required');
      if (status && status !== 'active' && status !== 'inactive') return rowFail('Status must be active or inactive');
      try {
        const cur = classByCode(ctx, code);
        if (cur) {
          if (kind && kind !== cur.kind) return rowFail(`The kind of ${code} cannot be changed; create a new code instead`);
          const curParent = cur.parent_id ? (ctx.db.prepare('SELECT code FROM ast_classification WHERE id = ?').get(cur.parent_id) as { code: string } | undefined)?.code : undefined;
          if (parentCode !== undefined && parentCode !== curParent) return rowFail(`The parent of ${code} cannot be changed; create a new code instead`);
          const patch: Record<string, unknown> = {};
          if (name && name !== cur.name) patch.name = name;
          if (description !== undefined && description !== cur.description) patch.description = description;
          if (status && status !== cur.status) patch.status = status;
          if (Object.keys(patch).length === 0) return { ok: true, action: 'skip', reference: code };
          updateEntity(a, 'classification', cur.id as string, { expectedVersion: cur.version, ...patch });
          return { ok: true, action: 'update', reference: code };
        }
        if (!name) return rowFail('Name is required for a new classification');
        if (kind !== 'equipment' && kind !== 'component') return rowFail('Kind must be equipment or component');
        let parentId: string | null = null;
        if (parentCode) {
          const p = classByCode(ctx, parentCode);
          if (!p) return rowFail(`No classification has the code ${parentCode}`);
          parentId = p.id as string;
        }
        createEntity(a, 'classification', { code, name, kind, parentId, ...(description ? { description } : {}), ...(status ? { status } : {}) });
        return { ok: true, action: 'create', reference: code };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(scope, principal) {
      authorize(makeActor(ctx, principal), perm('classification', 'view'), scope);
      const rows = ctx.db.prepare('SELECT c.*, p.code AS parent_code FROM ast_classification c LEFT JOIN ast_classification p ON p.id = c.parent_id WHERE c.deleted_at IS NULL ORDER BY c.kind DESC, c.code').all() as Row[];
      return rows.map((r) => ({ code: r.code, name: r.name, kind: r.kind, parentCode: r.parent_code ?? '', description: r.description, status: r.status }));
    },
  };
}

/** Hub reference data: the crosswalk from legacy codes to standard classifications (DECISIONS D62). */
export function classificationMapPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'ast.classification_map', templateCode: 'classification-map', module: 'M03', title: 'Legacy classification mapping',
    importPermission: 'ast.classification_map.create', exportPermission: 'ast.classification_map.view',
    columns: [
      { key: 'legacySystem', label: 'Legacy system', required: true, hint: 'CMMS for codes that already exist as classifications here; otherwise a short name of the old source.', example: 'CMMS' },
      { key: 'legacyCode', label: 'Legacy code', required: true, hint: 'As the old system wrote it (max 60).', example: 'ALTERNATOR' },
      { key: 'legacyName', label: 'Legacy name', example: 'Alternator' },
      { key: 'targetCode', label: 'Standard code', required: true, hint: 'A classification that exists here, normally from the standard catalogue.', example: 'SWBS-311-ALT' },
      { key: 'relation', label: 'Relation', hint: 'exact or broader: records move automatically. narrower: one row per standard class, a person decides each record. related: reference only.', example: 'exact' },
      { key: 'note', label: 'Note' },
      { key: 'status', label: 'Status', hint: 'active or inactive (default active).', example: 'active' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const legacySystem = cell(row, 'legacySystem')?.toUpperCase(), legacyCode = cell(row, 'legacyCode')?.toUpperCase(), targetCode = cell(row, 'targetCode')?.toUpperCase();
      const legacyName = cell(row, 'legacyName'), relation = cell(row, 'relation')?.toLowerCase(), note = cell(row, 'note'), status = cell(row, 'status')?.toLowerCase();
      if (!legacySystem || !legacyCode || !targetCode) return rowFail('Legacy system, legacy code and standard code are required');
      const target = classByCode(ctx, targetCode);
      if (!target) return rowFail(`No classification has the code ${targetCode}`);
      try {
        const cur = ctx.db.prepare('SELECT * FROM ast_classification_map WHERE legacy_system = ? AND legacy_code = ? AND target_classification_id = ? AND deleted_at IS NULL').get(legacySystem, legacyCode, target.id) as Row | undefined;
        const reference = `${legacySystem}:${legacyCode} -> ${targetCode}`;
        if (cur) {
          const patch: Record<string, unknown> = {};
          if (legacyName !== undefined && legacyName !== cur.legacy_name) patch.legacyName = legacyName;
          if (relation && relation !== cur.relation) patch.relation = relation;
          if (note !== undefined && note !== cur.note) patch.note = note;
          if (status && status !== cur.status) patch.status = status;
          if (Object.keys(patch).length === 0) return { ok: true, action: 'skip', reference };
          updateEntity(a, 'classification_map', cur.id as string, { expectedVersion: cur.version, ...patch });
          return { ok: true, action: 'update', reference };
        }
        if (!relation) return rowFail('Relation is required: exact, broader, narrower or related');
        createEntity(a, 'classification_map', {
          legacySystem, legacyCode, targetClassificationId: target.id, relation,
          ...(legacyName ? { legacyName } : {}), ...(note ? { note } : {}), ...(status ? { status } : {}),
        });
        return { ok: true, action: 'create', reference };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(scope, principal) {
      authorize(makeActor(ctx, principal), perm('classification_map', 'view'), scope);
      const rows = ctx.db.prepare('SELECT m.*, c.code AS target_code FROM ast_classification_map m LEFT JOIN ast_classification c ON c.id = m.target_classification_id WHERE m.deleted_at IS NULL ORDER BY m.legacy_system, m.legacy_code, c.code').all() as Row[];
      return rows.map((r) => ({ legacySystem: r.legacy_system, legacyCode: r.legacy_code, legacyName: r.legacy_name, targetCode: r.target_code, relation: r.relation, note: r.note, status: r.status }));
    },
  };
}
