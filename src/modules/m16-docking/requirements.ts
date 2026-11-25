/**
 * Pre-docking requirements (D76). Hub templates hold the standard checklist of a ship class (a template without a class applies to
 * every ship); each ship may add standing items of its own. A docking's checklist is copied from both when the docking is planned,
 * can be refreshed while it is planned (only new source items are added), and takes one-off items. Mandatory items that are still
 * pending block dock-in unless someone with dck.requirement.waive records a reason.
 */
import { toSnake } from '../../platform/canonical.js';
import type { ScopeRef } from '../../platform/contracts.js';
import type { Db } from '../../platform/db/open.js';
import { AppError } from '../../platform/errors.js';
import { createRecord, tombstoneRecord, updateRecord } from '../../platform/records.js';
import { nowUtc } from '../../platform/time.js';
import { getShip, resolveParty } from '../m01-organization/index.js';
import { authorize, withReason, type Actor } from './actor.js';
import { perm } from './permissions.js';
import { exists, getLive, toApi, type Row } from './queries.js';
import * as S from './schemas.js';

const blocked = (message: string, details?: Record<string, unknown>) => new AppError('WORKFLOW_BLOCKED', message, details);
const invalid = (message: string, fields: string[]) => new AppError('VALIDATION_FAILED', message, { fields });
const missing = (what: string, id: unknown) => new AppError('DEPENDENCY_MISSING', `${what} ${String(id)} does not exist on this installation`, { entity: what, id });
const notFound = (what: string, id: unknown) => new AppError('NOT_FOUND', `${what} ${String(id)} not found`);
const FLEET: ScopeRef = { kind: 'fleet' };
const shipScope = (shipId: unknown): ScopeRef => ({ kind: 'ship', id: String(shipId) });
const snake = (input: Record<string, unknown>): Row => Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), typeof v === 'boolean' ? (v ? 1 : 0) : v]));
function guard<T>(fn: () => T): T {
  try { return fn(); } catch (e) {
    if ((e as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('DUPLICATE', 'A record with the same unique value already exists');
    throw e;
  }
}
const nextSeq = (db: Db, table: string, col: string, id: string): number =>
  ((db.prepare(`SELECT COALESCE(MAX(seq), 0) AS n FROM ${table} WHERE ${col} = ? AND deleted_at IS NULL`).get(id) as { n: number }).n) + 1;
const normClass = (s: unknown): string => String(s ?? '').trim().toLowerCase();
const itemValues = (b: { category: string; title: string; description?: string | null | undefined; responsible?: string | null | undefined; leadDays?: number | undefined; mandatory?: boolean | undefined }) => ({
  category: b.category, title: b.title, description: b.description ?? null, responsible: b.responsible ?? null, lead_days: b.leadDays ?? 7, mandatory: b.mandatory === false ? 0 : 1,
});

// ------------------------------------------------------------------ class templates (hub reference data)

export function createReqTemplate(a: Actor, input: unknown): Row {
  const b = S.parse(S.TemplateCreate, input);
  authorize(a, perm('req_template', 'create'), FLEET);
  return guard(() => toApi(createRecord(a.wctx, 'dck.req_template', { ...snake(b), ship_class: b.shipClass ?? null, status: b.status ?? 'active' })));
}
export function updateReqTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.TemplateUpdate, input);
  authorize(a, perm('req_template', 'update'), FLEET);
  if (!getLive(a.wctx.db, 'req_template', id)) throw notFound('Checklist template', id);
  return guard(() => toApi(updateRecord(a.wctx, 'dck.req_template', id, expectedVersion, snake(rest))));
}
export function tombstoneReqTemplate(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('req_template', 'remove'), FLEET);
  if (!getLive(a.wctx.db, 'req_template', id)) throw notFound('Checklist template', id);
  if (exists(a.wctx.db, 'SELECT 1 FROM dck_req_template_item WHERE template_id = ? AND deleted_at IS NULL', id)) throw blocked('The template still has items; remove them or mark the template inactive', { templateId: id });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.req_template', id, expectedVersion, reason));
}

export function addTemplateItem(a: Actor, templateId: string, input: unknown): Row {
  const b = S.parse(S.ReqItemCreate, input);
  authorize(a, perm('req_template', 'update'), FLEET);
  if (!getLive(a.wctx.db, 'req_template', templateId)) throw notFound('Checklist template', templateId);
  return a.wctx.db.transaction(() => toApi(createRecord(a.wctx, 'dck.req_template_item', {
    template_id: templateId, seq: b.seq ?? nextSeq(a.wctx.db, 'dck_req_template_item', 'template_id', templateId), ...itemValues(b), status: 'active',
  })))();
}
export function updateTemplateItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.ReqItemUpdate, input);
  authorize(a, perm('req_template', 'update'), FLEET);
  if (!getLive(a.wctx.db, 'req_template_item', id)) throw notFound('Template item', id);
  return toApi(updateRecord(a.wctx, 'dck.req_template_item', id, expectedVersion, snake(rest)));
}
export function tombstoneTemplateItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  authorize(a, perm('req_template', 'update'), FLEET);
  if (!getLive(a.wctx.db, 'req_template_item', id)) throw notFound('Template item', id);
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.req_template_item', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ ship-specific standing items

export function addShipReqItem(a: Actor, input: unknown): Row {
  const b = S.parse(S.ShipReqItemCreate, input);
  if (!resolveParty(a.wctx.db, { kind: 'ship', id: b.shipId })) throw missing('Ship', b.shipId);
  authorize(a, perm('ship_req', 'create'), shipScope(b.shipId));
  return a.wctx.db.transaction(() => toApi(createRecord(a.wctx, 'dck.ship_req_item', {
    home_scope_id: b.shipId, ship_id: b.shipId, seq: b.seq ?? nextSeq(a.wctx.db, 'dck_ship_req_item', 'ship_id', b.shipId), ...itemValues(b), status: 'active',
  })))();
}
export function updateShipReqItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, ...rest } = S.parse(S.ReqItemUpdate, input);
  const cur = getLive(a.wctx.db, 'ship_req_item', id);
  if (!cur) throw notFound('Ship requirement', id);
  authorize(a, perm('ship_req', 'update'), shipScope(cur.ship_id));
  return toApi(updateRecord(a.wctx, 'dck.ship_req_item', id, expectedVersion, snake(rest)));
}
export function tombstoneShipReqItem(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const cur = getLive(a.wctx.db, 'ship_req_item', id);
  if (!cur) throw notFound('Ship requirement', id);
  authorize(a, perm('ship_req', 'remove'), shipScope(cur.ship_id));
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.ship_req_item', id, expectedVersion, reason));
}

// ------------------------------------------------------------------ the checklist of one docking

/** Active template items that apply to a ship: templates for its class, then templates for every ship; ordered by template code and seq. */
function applicableSourceItems(db: Db, shipId: string): Array<Row & { source: 'template' | 'ship' }> {
  const cls = normClass(getShip(db, shipId)?.shipClass);
  const templates = (db.prepare("SELECT * FROM dck_req_template WHERE deleted_at IS NULL AND status = 'active' ORDER BY ship_class IS NULL, code").all() as Row[])
    .filter((t) => t.ship_class == null || (cls !== '' && normClass(t.ship_class) === cls));
  const out: Array<Row & { source: 'template' | 'ship' }> = [];
  for (const t of templates) {
    for (const i of db.prepare("SELECT * FROM dck_req_template_item WHERE template_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY seq, id").all(t.id) as Row[]) out.push({ ...i, source: 'template' });
  }
  for (const i of db.prepare("SELECT * FROM dck_ship_req_item WHERE ship_id = ? AND deleted_at IS NULL AND status = 'active' ORDER BY seq, id").all(shipId) as Row[]) out.push({ ...i, source: 'ship' });
  return out;
}

/** Copy the applicable template and ship items that the docking does not have yet. No authorization here: callers authorize. */
export function fillChecklist(a: Actor, docking: Row): number {
  const db = a.wctx.db;
  const have = new Set((db.prepare('SELECT source_item_id FROM dck_requirement WHERE docking_id = ? AND deleted_at IS NULL AND source_item_id IS NOT NULL').all(docking.id) as Row[]).map((r) => r.source_item_id));
  let seq = nextSeq(db, 'dck_requirement', 'docking_id', docking.id as string);
  let added = 0;
  for (const i of applicableSourceItems(db, docking.ship_id as string)) {
    if (have.has(i.id)) continue;
    createRecord(a.wctx, 'dck.requirement', {
      home_scope_id: docking.ship_id, docking_id: docking.id, source: i.source, source_item_id: i.id, template_id: i.source === 'template' ? i.template_id : null, seq: seq++,
      category: i.category, title: i.title, description: i.description ?? null, responsible: i.responsible ?? null, lead_days: i.lead_days, mandatory: i.mandatory, status: 'pending',
    });
    added++;
  }
  return added;
}

function openDocking(db: Db, id: string, action: string): Row {
  const d = getLive(db, 'docking', id);
  if (!d) throw notFound('Docking', id);
  if (!['planned', 'in_dock', 'undocked'].includes(d.status as string)) throw blocked(`A docking that is ${String(d.status)} cannot be ${action}`, { rule: 'DOCKING_STATUS', status: d.status });
  return d;
}
export const checklistOf = (db: Db, dockingId: string): Row[] =>
  (db.prepare('SELECT * FROM dck_v_requirement WHERE docking_id = ? ORDER BY seq, requirement_id').all(dockingId) as Row[]).map(toApi);

/** Add the template and ship items that are new since the checklist was built (only while the docking is planned). */
export function refreshChecklist(a: Actor, dockingId: string): { added: number; items: Row[] } {
  const db = a.wctx.db;
  const d = openDocking(db, dockingId, 'given new requirements');
  authorize(a, perm('requirement', 'create'), shipScope(d.ship_id));
  if (d.status !== 'planned') throw blocked('The ship has already docked; add any further item by hand', { rule: 'DOCKING_STATUS' });
  const added = db.transaction(() => fillChecklist(a, d))();
  return { added, items: checklistOf(db, dockingId) };
}

export function addRequirement(a: Actor, dockingId: string, input: unknown): Row {
  const b = S.parse(S.RequirementCreate, input);
  const db = a.wctx.db;
  const d = openDocking(db, dockingId, 'given new requirements');
  authorize(a, perm('requirement', 'create'), shipScope(d.ship_id));
  return db.transaction(() => toApi(createRecord(a.wctx, 'dck.requirement', {
    home_scope_id: d.ship_id, docking_id: dockingId, source: 'adhoc', source_item_id: null, template_id: null, seq: b.seq ?? nextSeq(db, 'dck_requirement', 'docking_id', dockingId),
    ...itemValues(b), status: 'pending',
  })))();
}

/** Mark an item done (with a reference), not applicable (with a reason) or back to pending; or correct its details. */
export function updateRequirement(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, completedAt, ...rest } = S.parse(S.RequirementUpdate, input);
  const db = a.wctx.db;
  const cur = getLive(db, 'requirement', id);
  if (!cur) throw notFound('Requirement', id);
  openDocking(db, cur.docking_id as string, 'changed');
  authorize(a, perm('requirement', 'update'), shipScope(cur.home_scope_id));
  if (completedAt && Date.parse(completedAt) > Date.now() + 5 * 60_000) throw invalid('The time cannot be in the future', ['completedAt']);
  const status = rest.status ?? (cur.status as string);
  const note = rest.note !== undefined ? rest.note : (cur.note as string | null);
  if (status === 'not_applicable' && !note) throw invalid('Say why this item does not apply', ['note']);
  const patch = snake(rest);
  if (status === 'done') { if (cur.status !== 'done' || completedAt) patch.completed_at = completedAt ?? nowUtc(); } else if (cur.completed_at) patch.completed_at = null;
  return toApi(updateRecord(a.wctx, 'dck.requirement', id, expectedVersion, patch));
}

/** Only items added for this docking may be removed; template and ship items are marked not applicable instead. */
export function tombstoneRequirement(a: Actor, id: string, input: unknown): Row {
  const { expectedVersion, reason } = S.parse(S.Tombstone, input);
  const cur = getLive(a.wctx.db, 'requirement', id);
  if (!cur) throw notFound('Requirement', id);
  openDocking(a.wctx.db, cur.docking_id as string, 'changed');
  authorize(a, perm('requirement', 'remove'), shipScope(cur.home_scope_id));
  if (cur.source !== 'adhoc') throw blocked('This item comes from the class template or the ship list; mark it not applicable instead', { source: cur.source });
  return toApi(tombstoneRecord(withReason(a, reason).wctx, 'dck.requirement', id, expectedVersion, reason));
}

/** Mandatory checklist items still pending for a docking. */
export const pendingMandatory = (db: Db, dockingId: string): number =>
  (db.prepare("SELECT COUNT(*) AS n FROM dck_requirement WHERE docking_id = ? AND deleted_at IS NULL AND status = 'pending' AND mandatory = 1").get(dockingId) as { n: number }).n;
