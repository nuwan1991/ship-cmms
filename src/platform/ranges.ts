/**
 * Centrally allocated, non-overlapping number ranges so installations can issue
 * permanent equipment tags and QR label numbers while offline without collisions.
 * The hub grants ranges (hub_reference records, immutable once granted); each
 * installation consumes its own ranges using a purely local cursor.
 */
import type { Db } from './db/open.js';
import type { LocalIdentity } from './identity.js';
import { AppError } from './errors.js';
import { createRecord, type Row, type WriteContext } from './records.js';

export const formatTag = (prefix: string, n: number, width: number): string => `${prefix}-${String(n).padStart(width, '0')}`;

export function defineSequence(ctx: WriteContext, s: { code: string; prefix: string; width: number; description?: string }): Row {
  return createRecord(ctx, 'sys.number_sequence', { code: s.code, prefix: s.prefix, width: s.width, description: s.description ?? null });
}

/** Hub only (enforced by record class). Grants the next free block of `size` numbers. */
export function grantRange(ctx: WriteContext, g: { sequenceCode: string; installationId: string; size: number }): Row {
  if (!Number.isInteger(g.size) || g.size < 1) throw new AppError('VALIDATION_FAILED', 'Range size must be a positive integer');
  return ctx.db.transaction(() => {
    const seq = ctx.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(g.sequenceCode);
    if (!seq) throw new AppError('NOT_FOUND', `Number sequence ${g.sequenceCode} is not defined`);
    const { next } = ctx.db.prepare('SELECT COALESCE(MAX(range_end), 0) + 1 AS next FROM sys_number_range WHERE sequence_code = ?').get(g.sequenceCode) as { next: number };
    return createRecord(ctx, 'sys.number_range', {
      sequence_code: g.sequenceCode,
      allocated_to_installation_id: g.installationId,
      range_start: next,
      range_end: next + g.size - 1,
    });
  })();
}

interface RangeRow { id: string; range_end: number; next: number }

function myRanges(db: Db, who: LocalIdentity, sequenceCode: string): RangeRow[] {
  return db
    .prepare(
      `SELECT r.id, r.range_end, COALESCE(c.next_value, r.range_start) AS next
         FROM sys_number_range r LEFT JOIN sys_number_cursor c ON c.range_id = r.id
        WHERE r.sequence_code = ? AND r.allocated_to_installation_id = ? AND r.deleted_at IS NULL
        ORDER BY r.range_start`,
    )
    .all(sequenceCode, who.installationId) as RangeRow[];
}

/** Next number from this installation's own ranges. Throws RANGE_EXHAUSTED when none are left (sync to obtain more). */
export function nextNumber(db: Db, who: LocalIdentity, sequenceCode: string): { value: number; tag: string } {
  return db.transaction(() => {
    const seq = db.prepare('SELECT prefix, width FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(sequenceCode) as { prefix: string; width: number } | undefined;
    if (!seq) throw new AppError('DEPENDENCY_MISSING', `Number sequence ${sequenceCode} has not been synchronized to this installation`);
    const r = myRanges(db, who, sequenceCode).find((x) => x.next <= x.range_end);
    if (!r) throw new AppError('RANGE_EXHAUSTED', `No unused ${sequenceCode} numbers remain; synchronize with the hub to receive a new range`, { sequenceCode });
    db.prepare('INSERT INTO sys_number_cursor (range_id, next_value) VALUES (?, ?) ON CONFLICT(range_id) DO UPDATE SET next_value = excluded.next_value').run(r.id, r.next + 1);
    return { value: r.next, tag: formatTag(seq.prefix, r.next, seq.width) };
  })();
}

/** For low-water warnings in the UI. */
export function rangeRemaining(db: Db, who: LocalIdentity, sequenceCode: string): number {
  return myRanges(db, who, sequenceCode).reduce((n, r) => n + Math.max(0, r.range_end - r.next + 1), 0);
}
