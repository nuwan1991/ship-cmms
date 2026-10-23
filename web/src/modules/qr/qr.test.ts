import { describe, expect, it } from 'vitest';
import { coerceAnswers, formatTemplateItems, parseTemplateItems, rangeWarning } from './items';
import { qrLabelsEn } from './labels.en';
import { qrNav } from './index';

describe('template questions', () => {
  it('round-trips and skips blank lines', () => {
    const parsed = parseTemplateItems('oil_level | Oil level OK? | yesno\n\nremarks | Remarks | text\nhours | Running hours | number');
    expect(parsed).toEqual({ items: [{ key: 'oil_level', label: 'Oil level OK?', kind: 'yesno' }, { key: 'remarks', label: 'Remarks', kind: 'text' }, { key: 'hours', label: 'Running hours', kind: 'number' }] });
    if ('items' in parsed) expect(parseTemplateItems(formatTemplateItems(parsed.items))).toEqual(parsed);
  });
  it('reports the first bad line (1-based)', () => {
    expect(parseTemplateItems('ok | fine | yesno\nBad Key | x | text')).toEqual({ badLine: 2 });
    expect(parseTemplateItems('a | | text')).toEqual({ badLine: 1 });
    expect(parseTemplateItems('a | A | colour')).toEqual({ badLine: 1 });
  });
});
describe('answers', () => {
  const items = [{ key: 'ok', label: 'OK?', kind: 'yesno' as const }, { key: 'hrs', label: 'Hours', kind: 'number' as const }, { key: 'r', label: 'R', kind: 'text' as const }];
  it('are typed, and blanks or bad numbers are left out', () => {
    expect(coerceAnswers(items, { ok: 'no', hrs: '12.5', r: ' leaking ' })).toEqual({ ok: false, hrs: 12.5, r: 'leaking' });
    expect(coerceAnswers(items, { ok: '', hrs: 'abc' })).toEqual({});
  });
});
describe('number range warning', () => {
  it('flags an empty or too-small range only', () => {
    expect(rangeWarning(null, 5)).toBeNull();
    expect(rangeWarning(0, 1)).toBe('none');
    expect(rangeWarning(3, 5)).toBe('short');
    expect(rangeWarning(10, 5)).toBeNull();
  });
});
describe('qr nav', () => {
  it('has labels for every item and the qr permission prefix', () => {
    for (const n of qrNav) { expect(qrLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^qr\./); }
  });
});
