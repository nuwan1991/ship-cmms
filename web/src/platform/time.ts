/** Stored instants are UTC; the UI only ever displays/enters local time in the configured zone (default Asia/Colombo). */
export const DEFAULT_TZ = 'Asia/Colombo';

export function toLocalDisplay(iso: string | null | undefined, timeZone: string = DEFAULT_TZ): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

/** Offset (minutes east of UTC) of `timeZone` at the instant `ms`. */
function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** `YYYY-MM-DDTHH:mm` typed in the display zone -> UTC ISO with ms and Z. Returns null when the input is not a valid local date-time. */
export function localInputToUtcIso(value: string, timeZone: string = DEFAULT_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(naive).getUTCMonth() !== mo - 1) return null;
  let utc = naive - offsetMinutes(naive, timeZone) * 60000;
  utc = naive - offsetMinutes(utc, timeZone) * 60000; // settle across a DST edge
  return new Date(utc).toISOString();
}

/** UTC ISO -> value for <input type="datetime-local"> in the display zone. */
export function utcIsoToLocalInput(iso: string | null | undefined, timeZone: string = DEFAULT_TZ): string {
  return iso ? toLocalDisplay(iso, timeZone).replace(' ', 'T') : '';
}
