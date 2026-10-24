/**
 * Standard classification catalogue and the merge of legacy classifications into it (DECISIONS D62).
 *
 * The merge never edits or deletes a legacy classification: the hub records a crosswalk (ast_classification_map), each
 * installation re-points the positions and assets it owns (single writer, D05), and the hub finally marks fully re-pointed
 * legacy classifications inactive. Inactive classifications stay valid targets, so references held by other modules
 * (PM task templates, part compatibility, advisories) keep working until those modules re-link them.
 */
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { withReason, type Actor } from './actor.js';
import { ELECTRICAL_CATALOGUE, ELECTRICAL_CATALOGUE_VERSION, type CatalogueEntry } from './catalogue/electrical.js';
import type { Row } from './queries.js';
import { LOCAL_LEGACY_SYSTEM } from './schemas.js';
import { createEntity, updateEntity } from './service.js';

export { LOCAL_LEGACY_SYSTEM };

const AUTO = ['exact', 'broader'];

const classByCode = (db: Db, code: string): Row | undefined =>
  db.prepare('SELECT * FROM ast_classification WHERE code = ? AND deleted_at IS NULL').get(code.toUpperCase()) as Row | undefined;

// ------------------------------------------------------------------ standard catalogue

export interface CatalogueLoadResult {
  version: string;
  created: string[];
  existing: string[];
  /** Codes that already exist but differ from the standard. They are reported, never overwritten. */
  differences: Array<{ code: string; field: 'name' | 'kind' | 'parent'; current: string | null; standard: string | null }>;
}

export const catalogueDescription = (e: CatalogueEntry): string =>
  `${e.ref}${e.ext ? ' · Navy extension' : ''} · Standard catalogue ${ELECTRICAL_CATALOGUE_VERSION}`;

/** Hub: create every catalogue classification that does not exist yet. Safe to repeat; all or nothing. */
export function loadStandardCatalogue(a: Actor, entries: readonly CatalogueEntry[] = ELECTRICAL_CATALOGUE): CatalogueLoadResult {
  const db = a.wctx.db;
  const out: CatalogueLoadResult = { version: ELECTRICAL_CATALOGUE_VERSION, created: [], existing: [], differences: [] };
  db.transaction(() => {
    for (const e of entries) {
      const parent = e.parentCode ? classByCode(db, e.parentCode) : undefined;
      if (e.parentCode && !parent) throw new AppError('DEPENDENCY_MISSING', `Catalogue entry ${e.code} needs its parent ${e.parentCode} first`);
      const cur = classByCode(db, e.code);
      if (!cur) {
        createEntity(a, 'classification', { code: e.code, name: e.name, kind: e.kind, parentId: parent ? parent.id : null, description: catalogueDescription(e) });
        out.created.push(e.code);
        continue;
      }
      out.existing.push(e.code);
      if (cur.name !== e.name) out.differences.push({ code: e.code, field: 'name', current: cur.name as string, standard: e.name });
      if (cur.kind !== e.kind) out.differences.push({ code: e.code, field: 'kind', current: cur.kind as string, standard: e.kind });
      const curParent = cur.parent_id ? (db.prepare('SELECT code FROM ast_classification WHERE id = ?').get(cur.parent_id) as { code: string } | undefined)?.code ?? null : null;
      if (curParent !== (e.parentCode ?? null)) out.differences.push({ code: e.code, field: 'parent', current: curParent, standard: e.parentCode ?? null });
    }
  })();
  return out;
}

// ------------------------------------------------------------------ crosswalk lookups (public surface)

/** Active crosswalk rows for a legacy code that allow automatic re-pointing, with their live target. */
function autoTargets(db: Db, code: string, legacySystem?: string): Row[] {
  return db
    .prepare(
      `SELECT DISTINCT c.* FROM ast_classification_map m JOIN ast_classification c ON c.id = m.target_classification_id AND c.deleted_at IS NULL
       WHERE m.deleted_at IS NULL AND m.status = 'active' AND m.legacy_code = ? AND m.relation IN ('exact','broader')
       ${legacySystem ? 'AND m.legacy_system = ?' : ''} ORDER BY c.code`,
    )
    .all(code.toUpperCase(), ...(legacySystem ? [legacySystem.toUpperCase()] : [])) as Row[];
}

export interface ResolvedClassification { id: string; code: string; kind: string; viaLegacy: { system: string | null; code: string } | null }

/**
 * Turn a code typed by a person or found in an import into a classification. A code with exactly one automatic crosswalk
 * target resolves to that standard classification, so new data lands on the standard even before the legacy one is retired;
 * otherwise the code itself is used. Returns null when nothing matches or the crosswalk is ambiguous.
 */
export function resolveClassificationCode(db: Db, code: string, legacySystem?: string): ResolvedClassification | null {
  const c = code.trim().toUpperCase();
  const targets = autoTargets(db, c, legacySystem);
  if (targets.length === 1) {
    const t = targets[0]!;
    return { id: t.id as string, code: t.code as string, kind: t.kind as string, viaLegacy: { system: legacySystem?.toUpperCase() ?? null, code: c } };
  }
  if (targets.length > 1) return null;
  const direct = classByCode(db, c);
  return direct ? { id: direct.id as string, code: direct.code as string, kind: direct.kind as string, viaLegacy: null } : null;
}

/** The standard classification that replaces an existing (legacy) classification of this CMMS, or null if it is not mapped 1:1. */
export function standardEquivalent(db: Db, classificationId: string): string | null {
  const c = db.prepare('SELECT code FROM ast_classification WHERE id = ? AND deleted_at IS NULL').get(classificationId) as { code: string } | undefined;
  if (!c) return null;
  const t = autoTargets(db, c.code, LOCAL_LEGACY_SYSTEM);
  return t.length === 1 ? (t[0]!.id as string) : null;
}

// ------------------------------------------------------------------ re-pointing positions and assets

export interface RemapItem {
  entityType: 'ast.position' | 'ast.asset';
  id: string;
  label: string;
  version: number;
  fromCode: string;
  /** Set when the record can be re-pointed automatically. */
  toCode: string | null;
  toId: string | null;
  /** Standard codes a person chooses from when the legacy code was split (relation `narrower`) or is ambiguous. */
  candidates: string[];
}

export interface RemapPlan {
  /** Records this installation owns and can re-point itself. */
  auto: RemapItem[];
  /** Records this installation owns that need a person to pick the standard class. */
  manual: RemapItem[];
  /** Records using a mapped legacy class that other installations own; they re-point them when they run the remap. */
  ownedElsewhere: number;
}

/** What the remap would do at this installation. Read-only. */
export function remapPlan(db: Db, installationId: string): RemapPlan {
  const plan: RemapPlan = { auto: [], manual: [], ownedElsewhere: 0 };
  const legacy = db
    .prepare(
      `SELECT DISTINCT c.* FROM ast_classification c JOIN ast_classification_map m ON m.legacy_code = c.code AND m.legacy_system = ?
       WHERE c.deleted_at IS NULL AND m.deleted_at IS NULL AND m.status = 'active' AND m.relation <> 'related' ORDER BY c.code`,
    )
    .all(LOCAL_LEGACY_SYSTEM) as Row[];
  for (const c of legacy) {
    const rows = db
      .prepare(
        `SELECT m.relation, t.id, t.code FROM ast_classification_map m JOIN ast_classification t ON t.id = m.target_classification_id AND t.deleted_at IS NULL
         WHERE m.deleted_at IS NULL AND m.status = 'active' AND m.legacy_system = ? AND m.legacy_code = ? AND m.relation <> 'related' ORDER BY t.code`,
      )
      .all(LOCAL_LEGACY_SYSTEM, c.code) as Array<{ relation: string; id: string; code: string }>;
    const auto = rows.filter((r) => AUTO.includes(r.relation));
    const single = auto.length === 1 && rows.length === 1 ? auto[0]! : null;
    const candidates = single ? [] : [...new Set(rows.map((r) => r.code))];
    const records = [
      ...(db.prepare("SELECT 'ast.position' AS t, id, position_tag || ' ' || name AS label, version, owner_installation_id FROM ast_position WHERE classification_id = ? AND deleted_at IS NULL").all(c.id) as Row[]),
      ...(db.prepare("SELECT 'ast.asset' AS t, id, asset_tag || ' ' || name AS label, version, owner_installation_id FROM ast_asset WHERE classification_id = ? AND deleted_at IS NULL").all(c.id) as Row[]),
    ];
    for (const r of records) {
      if (r.owner_installation_id !== installationId) { plan.ownedElsewhere++; continue; }
      const item: RemapItem = {
        entityType: r.t as RemapItem['entityType'], id: r.id as string, label: r.label as string, version: r.version as number,
        fromCode: c.code as string, toCode: single?.code ?? null, toId: single?.id ?? null, candidates,
      };
      (single ? plan.auto : plan.manual).push(item);
    }
  }
  return plan;
}

export interface RemapResult { updated: RemapItem[]; manual: RemapItem[]; failed: Array<RemapItem & { error: string }>; ownedElsewhere: number; dryRun: boolean }

/**
 * Re-point this installation's own positions and assets from legacy classifications to their 1:1 standard class.
 * Each record is updated through the normal service (permission, version check, audit, change log) with the reason
 * "Classification merge". A record that fails is reported and the others carry on; running it again picks up the rest.
 */
export function applyRemap(a: Actor, opts: { dryRun?: boolean } = {}): RemapResult {
  const plan = remapPlan(a.wctx.db, a.wctx.installation.installationId);
  const out: RemapResult = { updated: [], manual: plan.manual, failed: [], ownedElsewhere: plan.ownedElsewhere, dryRun: opts.dryRun === true };
  if (opts.dryRun) return { ...out, updated: plan.auto };
  for (const item of plan.auto) {
    const w = withReason(a, `Classification merge: ${item.fromCode} -> ${item.toCode ?? ''}`);
    try {
      updateEntity(w, item.entityType === 'ast.position' ? 'position' : 'asset', item.id, { expectedVersion: item.version, classificationId: item.toId });
      out.updated.push(item);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      out.failed.push({ ...item, error: `${e.code}: ${e.message}` });
    }
  }
  return out;
}

// ------------------------------------------------------------------ retiring legacy classifications

export interface RetireResult { retired: string[]; stillInUse: Array<{ code: string; positions: number; assets: number }>; dryRun: boolean }

/**
 * Hub: mark legacy classifications inactive once they have a 1:1 standard class and no live position or asset at the hub
 * still uses them. Inactive (not removed) so other modules' references and history stay valid; reversible by setting active.
 */
export function retireLegacy(a: Actor, opts: { dryRun?: boolean } = {}): RetireResult {
  const db = a.wctx.db;
  if (a.wctx.installation.kind !== 'hub') throw new AppError('NOT_OWNER', 'Classifications are retired at the hub');
  const out: RetireResult = { retired: [], stillInUse: [], dryRun: opts.dryRun === true };
  const legacy = db
    .prepare(
      `SELECT DISTINCT c.* FROM ast_classification c JOIN ast_classification_map m ON m.legacy_code = c.code AND m.legacy_system = ?
       WHERE c.deleted_at IS NULL AND c.status = 'active' AND m.deleted_at IS NULL AND m.status = 'active' ORDER BY c.code`,
    )
    .all(LOCAL_LEGACY_SYSTEM) as Row[];
  for (const c of legacy) {
    if (!standardEquivalent(db, c.id as string)) continue;
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE classification_id = ? AND deleted_at IS NULL`).get(c.id) as { n: number }).n;
    const positions = count('ast_position'), assets = count('ast_asset');
    if (positions + assets > 0) { out.stillInUse.push({ code: c.code as string, positions, assets }); continue; }
    if (!opts.dryRun) updateEntity(withReason(a, 'Classification merge: replaced by standard classification'), 'classification', c.id as string, { expectedVersion: c.version, status: 'inactive' });
    out.retired.push(c.code as string);
  }
  return out;
}
