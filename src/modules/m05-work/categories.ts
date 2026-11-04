/**
 * Defect categories (DECISIONS D67): main categories (Electrical, Marine Engineering, Weapon) and their subcategories.
 * The list is hub reference data delivered to every installation. A defect carries `category_id` (main, required when the list
 * exists) and `subcategory_id` (optional). When a defect is reported without a category, it is suggested from the department
 * responsible for the equipment's position (M03 responsibility -> M01 department code -> `department_codes` of a main category).
 */
import { z } from 'zod';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { createRecord, tombstoneRecord, updateRecord, type WriteContext } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { resolveParty } from '../m01-organization/index.js';
import { currentInstallation, positionChain, responsibilityAt } from '../m03-assets/index.js';
import { authorize, type Actor } from './actor.js';
import { perm } from './permissions.js';
import { toApi, type Row } from './queries.js';
import { parse } from './schemas.js';

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/, 'use A-Z, 0-9, _ . - (max 32 characters)');
const Color = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'use a colour like #2F9E44').transform((s) => s.toUpperCase());
const DeptCodes = z.string().trim().max(200).transform((s) => s.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean).join(','));
const Version = z.number().int().min(1);

export const CategoryCreate = z.strictObject({
  code: Code, name: z.string().trim().min(1).max(120), parentId: z.uuid().nullable().optional(),
  departmentCodes: DeptCodes.nullable().optional(), color: Color.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(), status: z.enum(['active', 'inactive']).optional(),
});
export const CategoryUpdate = CategoryCreate.omit({ code: true }).partial().extend({ expectedVersion: Version });
export const CategoryTombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

/** The standard list loaded at a new hub (and on request). Codes are permanent; loading only adds what is missing. */
export const STANDARD_CATEGORIES: ReadonlyArray<{ code: string; name: string; color: string; departments: string; subs: ReadonlyArray<[string, string]> }> = [
  {
    code: 'ELEC', name: 'Electrical', color: '#2F9E44', departments: 'EE,COM',
    subs: [
      ['ELEC-GEN', 'Power generation'], ['ELEC-DIST', 'Distribution and switchboards'], ['ELEC-LIGHT', 'Lighting'],
      ['ELEC-MOTOR', 'Motors and drives'], ['ELEC-BATT', 'Batteries and UPS'], ['ELEC-NAVCOM', 'Navigation and communications electrical'],
    ],
  },
  {
    code: 'ME', name: 'Marine Engineering', color: '#7A1F2B', departments: 'ME',
    subs: [
      ['ME-HULL', 'Hull and structure'], ['ME-PROP', 'Main propulsion'], ['ME-SHAFT', 'Shafting and propellers'], ['ME-STEER', 'Steering gear'],
      ['ME-AUX', 'Auxiliary machinery'], ['ME-PIPE', 'Pumps and piping'], ['ME-HVAC', 'Air conditioning and refrigeration'], ['ME-FIRE', 'Fire fighting'],
    ],
  },
  {
    code: 'WPN', name: 'Weapon', color: '#C9CDD2', departments: 'WPN',
    subs: [['WPN-GUN', 'Guns'], ['WPN-MSL', 'Missiles'], ['WPN-FC', 'Fire control'], ['WPN-SENS', 'Sensors'], ['WPN-AMMO', 'Ammunition handling']],
  },
];

const invalid = (message: string, details?: Row) => new AppError('VALIDATION_FAILED', message, details);
const blocked = (message: string, details?: Row) => new AppError('WORKFLOW_BLOCKED', message, details);
const liveCategory = (db: Db, id: string): Row | undefined => db.prepare('SELECT * FROM wrk_defect_category WHERE id = ? AND deleted_at IS NULL').get(id) as Row | undefined;
const reload = (db: Db, id: string): Row => toApi(db.prepare('SELECT * FROM wrk_defect_category WHERE id = ?').get(id) as Row);

export function findCategoryByCode(db: Db, code: string): Row | null {
  return (db.prepare('SELECT * FROM wrk_defect_category WHERE code = ? AND deleted_at IS NULL').get(code.trim().toUpperCase()) as Row | undefined) ?? null;
}

/** Hub only, idempotent: add the standard categories that are not there yet. Returns how many rows were added. */
export function ensureDefectCategories(w: WriteContext): number {
  if (w.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'Defect categories are maintained at the hub');
  let added = 0;
  return w.db.transaction(() => {
    STANDARD_CATEGORIES.forEach((m, i) => {
      let main = findCategoryByCode(w.db, m.code);
      if (!main) {
        main = createRecord(w, 'wrk.defect_category', { code: m.code, name: m.name, color: m.color, department_codes: m.departments, sort_order: (i + 1) * 10, status: 'active' });
        added++;
      }
      m.subs.forEach(([code, name], j) => {
        if (findCategoryByCode(w.db, code)) return;
        createRecord(w, 'wrk.defect_category', { code, name, parent_id: main!.id, sort_order: (j + 1) * 10, status: 'active' });
        added++;
      });
    });
    return added;
  })();
}

function validateCategory(db: Db, next: Row, selfId: string | null): void {
  const parentId = (next.parent_id as string | null | undefined) ?? null;
  if (parentId) {
    if (parentId === selfId) throw invalid('A category cannot be its own main category');
    const parent = liveCategory(db, parentId);
    if (!parent) throw new AppError('DEPENDENCY_MISSING', `Main category ${parentId} does not exist`);
    if (parent.parent_id) throw invalid('Subcategories have one level only: choose a main category as the parent', { rule: 'CATEGORY_DEPTH' });
    if (selfId && db.prepare('SELECT 1 FROM wrk_defect_category WHERE parent_id = ? AND deleted_at IS NULL').get(selfId)) {
      throw invalid('This main category has subcategories; it cannot become a subcategory itself', { rule: 'CATEGORY_DEPTH' });
    }
  }
}

export function createDefectCategory(a: Actor, input: unknown): Row {
  const b = parse(CategoryCreate, input);
  authorize(a, perm('defect_category', 'create'), { kind: 'fleet' });
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'Defect categories are maintained at the hub');
  const db = a.wctx.db;
  const values: Row = {
    code: b.code, name: b.name, parent_id: b.parentId ?? null, department_codes: b.departmentCodes || null, color: b.color ?? null,
    sort_order: b.sortOrder ?? 0, status: b.status ?? 'active',
  };
  return db.transaction(() => {
    validateCategory(db, values, null);
    if (findCategoryByCode(db, b.code)) throw new AppError('DUPLICATE', `A category with code ${b.code} already exists`);
    return reload(db, createRecord(a.wctx, 'wrk.defect_category', values).id as string);
  })();
}

export function updateDefectCategory(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = parse(CategoryUpdate, input);
  authorize(a, perm('defect_category', 'update'), { kind: 'fleet' });
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'Defect categories are maintained at the hub');
  const db = a.wctx.db;
  const cur = liveCategory(db, id);
  if (!cur) throw new AppError('NOT_FOUND', `Defect category ${id} not found`);
  const patch: Row = {};
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.parentId !== undefined) patch.parent_id = rest.parentId;
  if (rest.departmentCodes !== undefined) patch.department_codes = rest.departmentCodes || null;
  if (rest.color !== undefined) patch.color = rest.color;
  if (rest.sortOrder !== undefined) patch.sort_order = rest.sortOrder;
  if (rest.status !== undefined) patch.status = rest.status;
  return db.transaction(() => {
    validateCategory(db, { ...cur, ...patch }, id);
    updateRecord(a.wctx, 'wrk.defect_category', id, expectedVersion, patch);
    return reload(db, id);
  })();
}

export function tombstoneDefectCategory(a: Actor, id: string, input: unknown): Row {
  const b = parse(CategoryTombstone, input);
  authorize(a, perm('defect_category', 'remove'), { kind: 'fleet' });
  const db = a.wctx.db;
  const cur = liveCategory(db, id);
  if (!cur) throw new AppError('NOT_FOUND', `Defect category ${id} not found`);
  if (db.prepare('SELECT 1 FROM wrk_defect_category WHERE parent_id = ? AND deleted_at IS NULL').get(id)) throw blocked('Remove or move its subcategories first');
  if (db.prepare('SELECT 1 FROM wrk_defect WHERE (category_id = ? OR subcategory_id = ?) AND deleted_at IS NULL').get(id, id)) {
    throw blocked('Defects use this category; set it inactive instead so their history keeps the name');
  }
  tombstoneRecord(a.wctx, 'wrk.defect_category', id, b.expectedVersion, b.reason);
  return reload(db, id);
}

// ------------------------------------------------------------------ choosing a defect's category

export interface CategorySuggestion { categoryId: string; code: string; name: string; departmentCode: string }

/** Main category suggested by the department responsible for the equipment's position (nearest responsibility up the tree). */
export function suggestCategory(db: Db, t: { assetId?: string | null | undefined; positionId?: string | null | undefined }, at: string = nowUtc()): CategorySuggestion | null {
  const positionId = t.positionId ?? (t.assetId ? currentInstallation(db, t.assetId)?.positionId ?? null : null);
  if (!positionId) return null;
  for (const pid of positionChain(db, positionId)) {
    const r = responsibilityAt(db, pid, at);
    if (!r) continue;
    const dept = resolveParty(db, { kind: 'department', id: String(r.departmentId) });
    if (!dept) return null;
    const c = db
      .prepare(
        `SELECT id, code, name FROM wrk_defect_category WHERE parent_id IS NULL AND deleted_at IS NULL AND status = 'active'
         AND (',' || COALESCE(department_codes, '') || ',') LIKE ? ORDER BY sort_order, code LIMIT 1`,
      )
      .get(`%,${dept.code},%`) as { id: string; code: string; name: string } | undefined;
    return c ? { categoryId: c.id, code: c.code, name: c.name, departmentCode: dept.code } : null;
  }
  return null;
}

const hasCategories = (db: Db): boolean => db.prepare("SELECT 1 FROM wrk_defect_category WHERE parent_id IS NULL AND deleted_at IS NULL AND status = 'active' LIMIT 1").get() !== undefined;

/**
 * Validate the chosen category / subcategory (a subcategory alone implies its main category). With neither, suggest one from the
 * equipment; when the list exists and nothing can be suggested the reporter must choose (CATEGORY_REQUIRED). `required` is false for
 * edits that leave the category alone.
 */
export function resolveDefectCategory(
  db: Db,
  input: { categoryId?: string | null | undefined; subcategoryId?: string | null | undefined },
  target: { assetId?: string | null | undefined; positionId?: string | null | undefined },
  required = true,
): { categoryId: string | null; subcategoryId: string | null } {
  let categoryId = input.categoryId ?? null;
  const subcategoryId = input.subcategoryId ?? null;
  if (subcategoryId) {
    const sub = liveCategory(db, subcategoryId);
    if (!sub || !sub.parent_id) throw invalid('Unknown subcategory', { rule: 'CATEGORY_UNKNOWN' });
    if (sub.status !== 'active') throw invalid(`Subcategory ${String(sub.name)} is no longer in use`, { rule: 'CATEGORY_INACTIVE' });
    if (categoryId && categoryId !== sub.parent_id) throw invalid('The subcategory belongs to a different main category', { rule: 'CATEGORY_MISMATCH' });
    categoryId = sub.parent_id as string;
  }
  if (categoryId) {
    const main = liveCategory(db, categoryId);
    if (!main || main.parent_id) throw invalid('Unknown main category', { rule: 'CATEGORY_UNKNOWN' });
    if (main.status !== 'active') throw invalid(`Category ${String(main.name)} is no longer in use`, { rule: 'CATEGORY_INACTIVE' });
    return { categoryId, subcategoryId };
  }
  if (!required) return { categoryId: null, subcategoryId: null };
  const s = suggestCategory(db, target);
  if (s) return { categoryId: s.categoryId, subcategoryId: null };
  if (hasCategories(db)) throw invalid('Choose a defect category (Electrical, Marine Engineering, Weapon ...)', { rule: 'CATEGORY_REQUIRED' });
  return { categoryId: null, subcategoryId: null };
}

/**
 * Give uncategorised defects owned by this installation the category suggested by their equipment. Without `apply` it only reports.
 * Defects that cannot be matched stay "Uncategorised" for a person to choose.
 */
export function categoriseExistingDefects(a: Actor, opts: { apply: boolean }): { uncategorised: number; matched: number; applied: number; left: Array<{ defectNo: string; title: string }> } {
  authorize(a, perm('defect', 'update'), { kind: 'fleet' });
  const db = a.wctx.db;
  const rows = db
    .prepare('SELECT * FROM wrk_defect WHERE category_id IS NULL AND deleted_at IS NULL AND owner_installation_id = ? ORDER BY reported_at')
    .all(a.wctx.installation.installationId) as Row[];
  let matched = 0;
  let applied = 0;
  const left: Array<{ defectNo: string; title: string }> = [];
  db.transaction(() => {
    for (const d of rows) {
      const s = suggestCategory(db, { assetId: d.asset_id as string | null, positionId: d.position_id as string | null });
      if (!s) { left.push({ defectNo: String(d.defect_no), title: String(d.title) }); continue; }
      matched++;
      if (opts.apply) { updateRecord(a.wctx, 'wrk.defect', d.id as string, d.version as number, { category_id: s.categoryId }); applied++; }
    }
  })();
  return { uncategorised: rows.length, matched, applied, left };
}
