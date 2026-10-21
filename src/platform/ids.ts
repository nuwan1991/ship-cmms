import { randomBytes } from 'node:crypto';

/**
 * UUIDv7: time-ordered, globally unique, generated locally with no coordination.
 * Used for every internal record id (CONTRACTS.md §1). Human-readable tags
 * (e.g. SLN-EQ-00000001) are NOT ids; they come from number ranges (ranges.ts).
 */
let lastMs = -1;
let counter = 0;

export function uuidv7(nowMs: number = Date.now()): string {
  let ms = nowMs;
  if (ms <= lastMs) {
    // Same millisecond (or clock stepped back): keep ordering with a 12-bit counter.
    ms = lastMs;
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = randomBytes(2).readUInt16BE(0) & 0x1ff;
  }
  lastMs = ms;

  const b = Buffer.alloc(16);
  b.writeUIntBE(ms, 0, 6);
  b[6] = 0x70 | (counter >> 8);
  b[7] = counter & 0xff;
  randomBytes(8).copy(b, 8);
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;

  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);
