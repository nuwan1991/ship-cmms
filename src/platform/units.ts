/**
 * Quantities and money are stored as integers, never floats (CONTRACTS.md §5).
 *  - stock/material quantity: thousandths of a unit  -> column suffix `_milli`, plus `uom` code
 *  - money: minor units (cents)                     -> column suffix `_minor`, plus `currency` (ISO 4217, default LKR)
 *  - running time: whole minutes                    -> column suffix `_minutes`
 */
export const DEFAULT_CURRENCY = 'LKR';

export function decimalToMilli(s: string): number {
  if (!/^-?\d+(\.\d{1,3})?$/.test(s)) throw new RangeError(`Invalid quantity "${s}" (max 3 decimals)`);
  const neg = s.startsWith('-');
  const [i = '0', f = ''] = s.replace('-', '').split('.');
  const v = Number(i) * 1000 + Number(f.padEnd(3, '0'));
  return neg ? -v : v;
}

export function milliToDecimal(n: number): string {
  if (!Number.isInteger(n)) throw new RangeError('milli value must be an integer');
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`;
}

export const minutesToHours = (m: number): number => m / 60;
export const hoursToMinutes = (h: number): number => Math.round(h * 60);
