/** Stored event times are UTC ISO-8601 with milliseconds and a Z suffix. */
export type UtcIso = string;
/** Planning dates are calendar dates in the installation's local zone: YYYY-MM-DD. */
export type LocalDate = string;

export const DEFAULT_DISPLAY_TZ = 'Asia/Colombo';

const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const nowUtc = (): UtcIso => new Date().toISOString();
// V8 rolls impossible dates over (2026-02-30 -> 2026-03-02), so validate by round-trip.
export const isUtcIso = (s: unknown): s is UtcIso =>
  typeof s === 'string' && UTC_RE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;
export const isLocalDate = (s: unknown): s is LocalDate =>
  typeof s === 'string' && DATE_RE.test(s) && new Date(`${s}T00:00:00.000Z`).toISOString().startsWith(s);

/** Display only. Never store the result. Format: "YYYY-MM-DD HH:mm". */
export function toLocalDisplay(iso: UtcIso, timeZone: string = DEFAULT_DISPLAY_TZ): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
