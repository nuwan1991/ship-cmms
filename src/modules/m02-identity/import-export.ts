/** Excel/CSV template for the nominal list of users (M11 drives it through the ImportExportPort). Never carries usernames or passwords. */
import type { AppContext } from '../../platform/app-context.js';
import { cell, rowError, rowFail } from '../../platform/import-export.js';
import type { ImportExportPort } from '../../platform/ports.js';
import { makeActor } from './actor.js';
import { authorize } from './guard.js';
import { perm } from './permissions.js';
import { PERSONNEL_CATEGORIES } from './schemas.js';
import { createResource, updateResource, type Row } from './service.js';

export function usersPort(ctx: AppContext): ImportExportPort {
  return {
    entityType: 'idn.user', templateCode: 'users', module: 'M02', title: 'Users (nominal list)',
    importPermission: 'idn.user.create', exportPermission: 'idn.user.view',
    columns: [
      { key: 'listNumber', label: 'S/N', hint: 'Row number on your list. Not stored.', example: '1' },
      { key: 'rank', label: 'Rank', example: 'LT' },
      { key: 'tradeBranch', label: 'Trade/Branch', example: 'Electrical' },
      { key: 'serviceNumber', label: 'Off No', required: true, hint: 'Official number. Unique; a number that already exists updates that person.', example: '4521' },
      { key: 'displayName', label: 'Name', hint: 'Required for a new person.', example: 'A B Perera' },
      { key: 'personnelCategory', label: 'Officer/Sailor', hint: `One of ${PERSONNEL_CATEGORIES.join(', ')}.`, example: 'officer' },
      { key: 'status', label: 'Status', hint: 'active or inactive (default active).', example: 'active' },
    ],
    importRow(row, principal) {
      const a = makeActor(ctx, principal);
      const serviceNumber = cell(row, 'serviceNumber'), displayName = cell(row, 'displayName');
      const rank = cell(row, 'rank'), tradeBranch = cell(row, 'tradeBranch');
      const personnelCategory = cell(row, 'personnelCategory')?.toLowerCase(), status = cell(row, 'status')?.toLowerCase();
      if (!serviceNumber) return rowFail('Off No is required');
      if (personnelCategory && !(PERSONNEL_CATEGORIES as readonly string[]).includes(personnelCategory)) return rowFail(`Officer/Sailor must be one of ${PERSONNEL_CATEGORIES.join(', ')}`);
      if (status && status !== 'active' && status !== 'inactive') return rowFail('Status must be active or inactive');
      try {
        const cur = ctx.db.prepare('SELECT * FROM idn_user WHERE service_number = ? AND deleted_at IS NULL').get(serviceNumber) as Row | undefined;
        if (!cur) {
          if (!displayName) return rowFail('Name is required for a new person');
          createResource(a, 'user', { displayName, serviceNumber, ...(rank ? { rank } : {}), ...(tradeBranch ? { tradeBranch } : {}), ...(personnelCategory ? { personnelCategory } : {}), ...(status ? { status } : {}) });
          return { ok: true, action: 'create', reference: serviceNumber };
        }
        const patch: Record<string, unknown> = {};
        if (displayName && displayName !== cur.display_name) patch.displayName = displayName;
        if (rank && rank !== cur.rank) patch.rank = rank;
        if (tradeBranch && tradeBranch !== cur.trade_branch) patch.tradeBranch = tradeBranch;
        if (personnelCategory && personnelCategory !== cur.personnel_category) patch.personnelCategory = personnelCategory;
        if (status && status !== cur.status) patch.status = status;
        if (Object.keys(patch).length === 0) return { ok: true, action: 'skip', reference: serviceNumber };
        updateResource(a, ctx, 'user', cur.id as string, { expectedVersion: cur.version, ...patch });
        return { ok: true, action: 'update', reference: serviceNumber };
      } catch (e) {
        return rowError(e);
      }
    },
    exportRows(_scope, principal) {
      authorize(makeActor(ctx, principal), perm('user', 'view'));
      const rows = ctx.db.prepare('SELECT * FROM idn_user WHERE deleted_at IS NULL ORDER BY display_name, id').all() as Row[];
      return rows.map((r, i) => ({
        listNumber: i + 1, rank: r.rank, tradeBranch: r.trade_branch, serviceNumber: r.service_number,
        displayName: r.display_name, personnelCategory: r.personnel_category, status: r.status,
      }));
    },
  };
}
