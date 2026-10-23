/** Excel/CSV template for the parts catalogue (M11 drives it through the ImportExportPort). */
import { cell, rowError, rowFail } from '../../platform/import-export.js';
import type { ImportExportPort } from '../../platform/ports.js';
import type { AppContext } from '../../platform/app-context.js';
import { authorize, makeActor } from './actor.js';
import { perm } from './permissions.js';
import { toApi, type Row } from './queries.js';
import { createPart, updatePart } from './service.js';

const FIELDS = ['name', 'unit', 'category', 'manufacturer', 'manufacturerPartNo', 'description', 'status'] as const;

export function partsPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'stk.part', templateCode: 'parts', module: 'M07', title: 'Parts catalogue',
    importPermission: 'stk.part.create', exportPermission: 'stk.part.view',
    columns: [
      { key: 'partNo', label: 'Part number', required: true, hint: 'Existing part numbers are updated; new ones are created.', example: 'BRG-6312' },
      { key: 'name', label: 'Name', required: true, example: 'Ball bearing 6312' },
      { key: 'unit', label: 'Unit', hint: 'each, m, kg, l, set … (default each).', example: 'each' },
      { key: 'category', label: 'Category', example: 'Bearings' },
      { key: 'manufacturer', label: 'Manufacturer', example: 'SKF' },
      { key: 'manufacturerPartNo', label: 'Manufacturer part number', example: '6312-2Z' },
      { key: 'description', label: 'Description' },
      { key: 'status', label: 'Status', hint: 'active or inactive (default active).', example: 'active' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const partNo = cell(row, 'partNo')?.toUpperCase();
      if (!partNo) return rowFail('Part number is required');
      const values = Object.fromEntries(FIELDS.map((f) => [f, cell(row, f)]).filter(([, v]) => v !== undefined)) as Record<string, string>;
      if (values.status) values.status = values.status.toLowerCase();
      try {
        const cur = ctx.db.prepare('SELECT * FROM stk_part WHERE part_no = ? AND deleted_at IS NULL').get(partNo) as Row | undefined;
        if (!cur) return { ok: true, action: 'create', reference: String(createPart(a, { partNo, ...values }).partNo) };
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => String(cur[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] ?? '') !== v));
        if (Object.keys(changed).length === 0) return { ok: true, action: 'skip', reference: partNo };
        updatePart(a, cur.id as string, { expectedVersion: cur.version, ...changed });
        return { ok: true, action: 'update', reference: partNo };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(scope, principal) {
      authorize(makeActor(ctx, principal), perm('part', 'view'), { kind: 'fleet' });
      void scope;
      return (ctx.db.prepare('SELECT * FROM stk_part WHERE deleted_at IS NULL ORDER BY part_no').all() as Row[]).map((r) => toApi(r));
    },
  };
}
