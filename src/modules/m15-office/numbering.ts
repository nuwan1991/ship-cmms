/** Office reference sequences (FR-C1). Prefixes are data: the office can change them before first use (A2). */
import { AppError } from '../../platform/errors.js';
import { defineSequence, grantRange, nextNumber } from '../../platform/ranges.js';
import type { WriteContext } from '../../platform/records.js';

export const OFFICE_SEQUENCES = [
  { code: 'ofc_task', prefix: 'TSK', width: 5, description: 'Office task' },
  { code: 'ofc_corr_in', prefix: 'COR-IN', width: 5, description: 'Incoming correspondence' },
  { code: 'ofc_corr_out', prefix: 'COR-OUT', width: 5, description: 'Outgoing correspondence' },
  { code: 'ofc_minute', prefix: 'MIN', width: 5, description: 'Minute sheet' },
  { code: 'ofc_matter', prefix: 'MAT', width: 5, description: 'Correspondence matter (file thread)' },
  { code: 'ofc_handover', prefix: 'HOV', width: 4, description: 'Handover packet' },
  { code: 'ofc_handover_item', prefix: 'HOI', width: 5, description: 'Handover item' },
  { code: 'ofc_equipment', prefix: 'EQM', width: 5, description: 'Office equipment record' },
  { code: 'ofc_wo', prefix: 'OWO', width: 5, description: 'Office work order' },
  { code: 'ofc_supply', prefix: 'SUP', width: 5, description: 'Supply demand' },
] as const;
export type OfficeSequence = (typeof OFFICE_SEQUENCES)[number]['code'];

/** Define every office sequence that does not exist yet. Safe to repeat. Hub (or the single office installation) only. */
export function ensureOfficeSequences(w: WriteContext, prefixes: Partial<Record<OfficeSequence, string>> = {}): string[] {
  const made: string[] = [];
  for (const s of OFFICE_SEQUENCES) {
    if (w.db.prepare('SELECT 1 FROM sys_number_sequence WHERE code = ? AND deleted_at IS NULL').get(s.code)) continue;
    defineSequence(w, { code: s.code, prefix: prefixes[s.code] ?? s.prefix, width: s.width, description: s.description });
    made.push(s.code);
  }
  return made;
}

/** Grant `size` numbers of every office sequence to an installation (until M10 automates range requests). */
export function grantOfficeRanges(w: WriteContext, installationId: string, size: number): void {
  ensureOfficeSequences(w);
  for (const s of OFFICE_SEQUENCES) grantRange(w, { sequenceCode: s.code, installationId, size });
}

/** Next reference number; a clear message when office numbering has not been set up. */
export function nextRef(w: WriteContext, code: OfficeSequence): string {
  try {
    return nextNumber(w.db, w.installation, code).tag;
  } catch (e) {
    if (e instanceof AppError && (e.code === 'DEPENDENCY_MISSING' || e.code === 'RANGE_EXHAUSTED')) {
      throw new AppError(e.code, `${e.message}. Run: npm run office -- setup`, e.details);
    }
    throw e;
  }
}
