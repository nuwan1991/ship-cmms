import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/platform/errors.js';
import { defineSequence, grantRange, nextNumber, rangeRemaining } from '../../src/platform/ranges.js';
import { hubIdentity, makeEnv, shipIdentity } from '../helpers.js';

const setup = () => {
  const env = makeEnv();
  defineSequence(env.ctx(hubIdentity), { code: 'equipment_tag', prefix: 'SLN-EQ', width: 8 });
  return env;
};

describe('number ranges', () => {
  it('issues permanent tags in the SLN-EQ-00000001 format from the installation\'s own range', () => {
    const { db, ctx } = setup();
    grantRange(ctx(hubIdentity), { sequenceCode: 'equipment_tag', installationId: shipIdentity.installationId, size: 3 });
    expect(nextNumber(db, shipIdentity, 'equipment_tag')).toEqual({ value: 1, tag: 'SLN-EQ-00000001' });
    expect(nextNumber(db, shipIdentity, 'equipment_tag').tag).toBe('SLN-EQ-00000002');
    expect(rangeRemaining(db, shipIdentity, 'equipment_tag')).toBe(1);
  });

  it('grants non-overlapping ranges to different installations', () => {
    const { db, ctx } = setup();
    const a = grantRange(ctx(hubIdentity), { sequenceCode: 'equipment_tag', installationId: shipIdentity.installationId, size: 100 });
    const b = grantRange(ctx(hubIdentity), { sequenceCode: 'equipment_tag', installationId: hubIdentity.installationId, size: 50 });
    expect([a.range_start, a.range_end, b.range_start, b.range_end]).toEqual([1, 100, 101, 150]);
    expect(nextNumber(db, hubIdentity, 'equipment_tag').value).toBe(101);
  });

  it('blocks overlapping ranges at the database level even if application code is bypassed', () => {
    const { db, ctx } = setup();
    grantRange(ctx(hubIdentity), { sequenceCode: 'equipment_tag', installationId: shipIdentity.installationId, size: 10 });
    const ins = db.prepare(`INSERT INTO sys_number_range (id, owner_installation_id, created_at, created_by, created_installation_id, updated_at, updated_by,
      sequence_code, allocated_to_installation_id, range_start, range_end) VALUES ('x','o','t','u','i','t','u','equipment_tag','s',?,?)`);
    expect(() => ins.run(5, 20)).toThrow(/overlaps/);
  });

  it('reports exhaustion so the UI can ask the user to synchronize', () => {
    const { db, ctx } = setup();
    grantRange(ctx(hubIdentity), { sequenceCode: 'equipment_tag', installationId: shipIdentity.installationId, size: 1 });
    nextNumber(db, shipIdentity, 'equipment_tag');
    try {
      nextNumber(db, shipIdentity, 'equipment_tag');
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('RANGE_EXHAUSTED');
    }
  });

  it('refuses range grants from a non-hub installation and unknown sequences', () => {
    const { ctx } = setup();
    expect(() => grantRange(ctx(shipIdentity), { sequenceCode: 'equipment_tag', installationId: shipIdentity.installationId, size: 5 })).toThrow(/hub/);
    expect(() => grantRange(ctx(hubIdentity), { sequenceCode: 'nope', installationId: shipIdentity.installationId, size: 5 })).toThrow(/not defined/);
  });
});
