import { describe, expect, it } from 'vitest';
import { buildMovementBody } from './AssetsScreen';
import { astLabelsEn } from './labels.en';
import { astNav } from './index';

describe('ast movement body', () => {
  it('combines the custody pair, drops blanks, keeps the kind', () => {
    expect(buildMovementBody('custody_transfer', { custodyKind: 'workshop', custodyId: 'w1', note: '', occurredAt: '2026-01-01T00:00:00.000Z' }))
      .toEqual({ kind: 'custody_transfer', custody: { kind: 'workshop', id: 'w1' }, occurredAt: '2026-01-01T00:00:00.000Z' });
    expect(buildMovementBody('remove', { assetStatus: '', custodyKind: '', custodyId: '' })).toEqual({ kind: 'remove' });
  });
});
describe('ast labels and nav', () => {
  it('every nav label exists and every permission uses the ast prefix', () => {
    for (const n of astNav) { expect(astLabelsEn[n.labelKey]).toBeTruthy(); expect(n.requiredPermission).toMatch(/^ast\./); }
  });
});
