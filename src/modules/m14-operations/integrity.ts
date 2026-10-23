/**
 * The integrity query set (DATA_DICTIONARY, D07): problems that replication or a crash can leave behind and that no foreign key would have caught.
 * Findings are reported, never repaired automatically. Other modules' data is read only through their published views, except platform tables.
 */
import type { AppContext } from '../../platform/app-context.js';
import { verifySyncedTables } from '../../platform/records.js';
import { uuidv7 } from '../../platform/ids.js';
import { nowUtc } from '../../platform/time.js';

type Row = Record<string, unknown>;
export interface Finding { code: string; title: string; severity: 'error' | 'warning'; count: number; sample: unknown[] }

const SAMPLE = 5;
const one = (ctx: AppContext, sql: string): Row[] => ctx.db.prepare(sql).all() as Row[];
const exists = (ctx: AppContext, name: string): boolean => !!ctx.db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name);

/** References from a record to a record of a type it `requires`: the target must exist locally. Column `ship_id` is checked against `org.ship`, and so on. */
function danglingReferences(ctx: AppContext): Finding[] {
  const out: Finding[] = [];
  for (const d of ctx.entities.all()) {
    if (!d.requires?.length || d.recordClass === 'local' || d.recordClass === 'derived') continue;
    const cols = (ctx.db.prepare(`PRAGMA table_info(${d.table})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const req of d.requires) {
      const target = ctx.entities.get(req);
      const noun = req.split('.')[1]!;
      for (const col of [`${noun}_id`, `${noun}_a_id`].filter((c) => cols.includes(c))) {
        const rows = ctx.db.prepare(`SELECT t.id AS id, t.${col} AS missing FROM ${d.table} t WHERE t.${col} IS NOT NULL AND t.${col} <> '' AND NOT EXISTS (SELECT 1 FROM ${target.table} x WHERE x.id = t.${col})${d.recordClass === 'event' ? '' : ' AND t.deleted_at IS NULL'} LIMIT 1000`).all() as Row[];
        if (rows.length) out.push({ code: 'dangling_reference', title: `${d.type}.${col} points to a ${req} that is not on this installation`, severity: 'error', count: rows.length, sample: rows.slice(0, SAMPLE) });
      }
    }
  }
  return out;
}

export function runIntegrity(ctx: AppContext, userId: string): { id: string; ok: boolean; findings: Finding[]; durationMs: number } {
  const t0 = Date.now();
  const findings: Finding[] = [];
  const add = (f: Finding | null) => { if (f && f.count > 0) findings.push(f); };

  const ic = ctx.db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  if (!(ic.length === 1 && ic[0]!.integrity_check === 'ok')) add({ code: 'sqlite_integrity', title: 'SQLite reports damage in the database file', severity: 'error', count: ic.length, sample: ic.slice(0, SAMPLE) });
  const fk = ctx.db.pragma('foreign_key_check') as Row[];
  add({ code: 'foreign_key', title: 'A local table breaks a foreign key', severity: 'error', count: fk.length, sample: fk.slice(0, SAMPLE) });

  const schema = verifySyncedTables(ctx.db, ctx.entities);
  add({ code: 'synced_table_contract', title: 'A synchronized table is missing standard columns or guard triggers', severity: 'error', count: schema.length, sample: schema.slice(0, SAMPLE) });
  const reg = ctx.entities.validate();
  add({ code: 'entity_registry', title: 'The entity registry has a broken dependency', severity: 'error', count: reg.length, sample: reg.slice(0, SAMPLE) });

  for (const f of danglingReferences(ctx)) add(f);

  const overlaps = exists(ctx, 'sys_number_range') ? one(ctx, `SELECT a.sequence_code, a.range_start AS a_start, a.range_end AS a_end, b.range_start AS b_start, b.range_end AS b_end FROM sys_number_range a JOIN sys_number_range b
    ON b.sequence_code = a.sequence_code AND a.id < b.id AND a.range_start <= b.range_end AND b.range_start <= a.range_end LIMIT 1000`) : [];
  add({ code: 'number_range_overlap', title: 'Two number ranges overlap, so two installations could issue the same number', severity: 'error', count: overlaps.length, sample: overlaps.slice(0, SAMPLE) });

  const cursors = exists(ctx, 'sys_number_cursor') ? one(ctx, `SELECT c.range_id, c.next_value, r.range_end FROM sys_number_cursor c JOIN sys_number_range r ON r.id = c.range_id WHERE c.next_value > r.range_end + 1 LIMIT 1000`) : [];
  add({ code: 'number_cursor_past_range', title: 'A number counter is beyond the end of its range', severity: 'error', count: cursors.length, sample: cursors.slice(0, SAMPLE) });

  if (exists(ctx, 'org_v_assignment_overlap')) {
    const r = one(ctx, 'SELECT * FROM org_v_assignment_overlap LIMIT 1000');
    add({ code: 'assignment_overlap', title: 'A ship is attached to two commands at the same time', severity: 'warning', count: r.length, sample: r.slice(0, SAMPLE) });
  }
  if (exists(ctx, 'ast_v_position_conflicts')) {
    const r = one(ctx, 'SELECT * FROM ast_v_position_conflicts LIMIT 1000');
    add({ code: 'position_conflict', title: 'A position holds more than one asset', severity: 'warning', count: r.length, sample: r.slice(0, SAMPLE) });
  }
  if (exists(ctx, 'stk_v_balance')) {
    const r = one(ctx, 'SELECT part_id, location_id, on_hand FROM stk_v_balance WHERE on_hand < 0 LIMIT 1000');
    add({ code: 'negative_stock', title: 'A stock balance is below zero (offline issues that need a stock count)', severity: 'warning', count: r.length, sample: r.slice(0, SAMPLE) });
  }
  if (exists(ctx, 'syn_v_health')) {
    const h = ctx.db.prepare('SELECT open_conflicts FROM syn_v_health').get() as Row;
    add({ code: 'sync_conflicts', title: 'Synchronization conflicts are waiting for a decision', severity: 'warning', count: Number(h.open_conflicts ?? 0), sample: [] });
  }

  const durationMs = Date.now() - t0;
  const id = uuidv7();
  const problems = findings.reduce((n, f) => n + f.count, 0);
  const ok = !findings.some((f) => f.severity === 'error');
  ctx.db.prepare('INSERT INTO ops_integrity_check (id, ran_at, ran_by, ok, problem_count, findings_json, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, nowUtc(), userId, ok ? 1 : 0, problems, JSON.stringify(findings), durationMs);
  return { id, ok, findings, durationMs };
}

export function listChecks(ctx: AppContext): Row[] {
  return (ctx.db.prepare('SELECT * FROM ops_integrity_check ORDER BY ran_at DESC LIMIT 50').all() as Row[]).map((r) => ({ ...r, findings: JSON.parse(String(r.findings_json)) as Finding[], findings_json: undefined }));
}
