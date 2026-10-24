import { describe, expect, it } from 'vitest';
import { ELECTRICAL_CATALOGUE } from '../../src/modules/m03-assets/catalogue/electrical.js';
import { applyRemap, catalogueDescription, loadStandardCatalogue, remapPlan, retireLegacy } from '../../src/modules/m03-assets/classification-merge.js';
import { resolveClassificationCode, standardEquivalent } from '../../src/modules/m03-assets/index.js';
import { createAsset, createEntity, tombstoneEntity, updateEntity } from '../../src/modules/m03-assets/service.js';
import { verifySyncedTables } from '../../src/platform/records.js';
import { codeOf, makeAstEnv, sql, type AstEnv } from './ast-helpers.js';

const id = (r: Record<string, unknown>) => r.id as string;
const classId = (env: AstEnv, code: string) => sql(env, 'SELECT id FROM ast_classification WHERE code = ? AND deleted_at IS NULL', code)[0]!.id as string;
const map = (env: AstEnv, legacyCode: string, targetCode: string, relation = 'exact', legacySystem = 'CMMS') =>
  createEntity(env.hubActor(), 'classification_map', { legacySystem, legacyCode, targetClassificationId: classId(env, targetCode), relation });

/** Standard catalogue loaded, plus legacy classes ALTERNATOR (1:1), SWITCHBOARD (split) and BEARING (component) in use. */
function legacyFleet() {
  const env = makeAstEnv();
  const hub = env.hubActor();
  loadStandardCatalogue(hub);
  const alt = id(createEntity(hub, 'classification', { code: 'ALTERNATOR', name: 'Alternator', kind: 'equipment' }));
  const swbd = id(createEntity(hub, 'classification', { code: 'SWITCHBOARD', name: 'Switchboard', kind: 'equipment' }));
  createEntity(hub, 'classification', { code: 'BEARING', name: 'Bearing', kind: 'component' });
  map(env, 'ALTERNATOR', 'SWBS-311-ALT');
  map(env, 'SWITCHBOARD', 'SWBS-324-MSB', 'narrower');
  map(env, 'SWITCHBOARD', 'SWBS-324-ESB', 'narrower');
  map(env, 'BEARING', 'CMP-EL-BRG', 'broader');

  // The hub registers one alternator; the ship installation builds its own tree and registers another.
  const hubAsset = createAsset(hub, { name: 'Spare alternator', classificationId: alt, homeShipId: env.shipId }).asset;
  const ship = env.shipActor(env.shipId);
  env.grant(ship.wctx.installation.installationId, 10);
  const sys = createEntity(ship, 'position', { shipId: env.shipId, positionTag: '3', name: 'Electric plant' });
  const altPos = createEntity(ship, 'position', { shipId: env.shipId, parentId: id(sys), positionTag: '3.1', name: 'No. 1 alternator', classificationId: alt });
  const swbdPos = createEntity(ship, 'position', { shipId: env.shipId, parentId: id(sys), positionTag: '3.2', name: 'Switchboard', classificationId: swbd });
  const shipAsset = createAsset(ship, { name: 'No. 1 alternator', classificationId: alt, homeShipId: env.shipId, positionId: id(altPos) }).asset;
  return { env, hub, ship, alt, swbd, hubAsset: id(hubAsset), shipAsset: id(shipAsset), altPos: id(altPos), swbdPos: id(swbdPos) };
}

describe('standard electrical catalogue', () => {
  it('is well formed: unique valid codes, parents listed first with the same kind, names and descriptions fit', () => {
    const seen = new Map<string, string>();
    for (const e of ELECTRICAL_CATALOGUE) {
      expect(e.code).toMatch(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/);
      expect(seen.has(e.code), e.code).toBe(false);
      if (e.parentCode) expect(seen.get(e.parentCode), `${e.code} parent`).toBe(e.kind);
      expect(e.name.length).toBeLessThanOrEqual(120);
      expect(catalogueDescription(e).length).toBeLessThanOrEqual(500);
      seen.set(e.code, e.kind);
    }
    expect(ELECTRICAL_CATALOGUE.filter((e) => e.ext).length).toBeGreaterThan(10);
  });

  it('loads at the hub, is safe to repeat, and reports differences without overwriting them', () => {
    const env = makeAstEnv();
    expect(env.ctx.entities.validate()).toEqual([]);
    expect(verifySyncedTables(env.ctx.db, env.ctx.entities)).toEqual([]);
    const first = loadStandardCatalogue(env.hubActor());
    expect(first.created).toHaveLength(ELECTRICAL_CATALOGUE.length);
    const msb = sql(env, "SELECT c.*, p.code AS parent_code FROM ast_classification c JOIN ast_classification p ON p.id = c.parent_id WHERE c.code = 'SWBS-324-MSB'")[0]!;
    expect(msb).toMatchObject({ name: 'Main switchboard', kind: 'equipment', parent_code: 'SWBS-324' });
    expect(msb.description).toContain('IEC 60092-302');
    expect(sql(env, "SELECT description FROM ast_classification WHERE code = 'SWBS-313-ESS'")[0]!.description).toContain('Navy extension');

    const cur = sql(env, "SELECT * FROM ast_classification WHERE code = 'SWBS-324-MSB'")[0]!;
    updateEntity(env.hubActor(), 'classification', cur.id, { expectedVersion: cur.version, name: 'Main switchboard (local name)' });
    const again = loadStandardCatalogue(env.hubActor());
    expect(again.created).toEqual([]);
    expect(again.differences).toEqual([{ code: 'SWBS-324-MSB', field: 'name', current: 'Main switchboard (local name)', standard: 'Main switchboard' }]);
    expect(sql(env, "SELECT name FROM ast_classification WHERE code = 'SWBS-324-MSB'")[0]!.name).toBe('Main switchboard (local name)');
  });

  it('is hub reference data: a ship cannot load it', () => {
    const env = makeAstEnv();
    expect(codeOf(() => loadStandardCatalogue(env.shipActor(env.shipId)))).toBe('NOT_OWNER');
  });
});

describe('legacy crosswalk', () => {
  it('checks local legacy codes, kinds, self-mapping and duplicates; a mapped target cannot be removed', () => {
    const { env } = legacyFleet();
    expect(codeOf(() => map(env, 'NO-SUCH-CODE', 'SWBS-311-ALT'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => map(env, 'BEARING', 'SWBS-311-ALT'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => map(env, 'ALTERNATOR', 'ALTERNATOR'))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => map(env, 'ALTERNATOR', 'SWBS-311-ALT'))).toBe('DUPLICATE');
    // Codes from an outside system need not exist here and may hold spaces.
    expect(map(env, 'GEN 01/A', 'SWBS-311-DG', 'exact', 'OLD-PMS')).toMatchObject({ legacyCode: 'GEN 01/A', legacySystem: 'OLD-PMS' });
    expect(codeOf(() => map(env, 'X', 'SWBS-311-DG', 'exact', 'OLD-PMS'))).toBe('NO_ERROR');
    expect(codeOf(() => createEntity(env.shipActor(env.shipId), 'classification_map', { legacySystem: 'OLD-PMS', legacyCode: 'Y', targetClassificationId: classId(env, 'SWBS-311-DG'), relation: 'exact' }))).toBe('NOT_OWNER');
    const target = sql(env, "SELECT * FROM ast_classification WHERE code = 'SWBS-311-DG'")[0]!;
    expect(codeOf(() => tombstoneEntity(env.hubActor(), 'classification', target.id, { expectedVersion: target.version, reason: 'test' }))).toBe('WORKFLOW_BLOCKED');
  });

  it('resolves typed or imported codes to the standard class when the mapping is 1:1', () => {
    const { env, alt, swbd } = legacyFleet();
    map(env, 'GEN 01/A', 'SWBS-311-DG', 'exact', 'OLD-PMS');
    expect(resolveClassificationCode(env.ctx.db, 'alternator')).toMatchObject({ code: 'SWBS-311-ALT', viaLegacy: { code: 'ALTERNATOR' } });
    expect(resolveClassificationCode(env.ctx.db, 'GEN 01/A', 'OLD-PMS')).toMatchObject({ code: 'SWBS-311-DG' });
    expect(resolveClassificationCode(env.ctx.db, 'SWBS-324-MSB')).toMatchObject({ code: 'SWBS-324-MSB', viaLegacy: null });
    // A split legacy code is not translated; the legacy class itself is still valid.
    expect(resolveClassificationCode(env.ctx.db, 'SWITCHBOARD')).toMatchObject({ id: swbd, viaLegacy: null });
    expect(resolveClassificationCode(env.ctx.db, 'NOPE')).toBeNull();
    expect(standardEquivalent(env.ctx.db, alt)).toBe(classId(env, 'SWBS-311-ALT'));
    expect(standardEquivalent(env.ctx.db, swbd)).toBeNull();
  });
});

describe('remap and retire', () => {
  it('each installation re-points only what it owns; split codes wait for a person', () => {
    const { env, hub, ship, alt, hubAsset, shipAsset, altPos, swbdPos } = legacyFleet();
    const stdAlt = classId(env, 'SWBS-311-ALT');

    const hubPlan = remapPlan(env.ctx.db, hub.wctx.installation.installationId);
    expect(hubPlan.auto.map((i) => i.id)).toEqual([hubAsset]);
    expect(hubPlan.ownedElsewhere).toBe(3);

    const dry = applyRemap(ship, { dryRun: true });
    expect(dry.updated.map((i) => i.id).sort()).toEqual([altPos, shipAsset].sort());
    expect(sql(env, 'SELECT classification_id FROM ast_asset WHERE id = ?', shipAsset)[0]!.classification_id).toBe(alt);

    const done = applyRemap(ship);
    expect(done.failed).toEqual([]);
    expect(done.updated).toHaveLength(2);
    expect(done.manual).toMatchObject([{ id: swbdPos, fromCode: 'SWITCHBOARD', candidates: ['SWBS-324-ESB', 'SWBS-324-MSB'] }]);
    expect(sql(env, 'SELECT classification_id, version FROM ast_asset WHERE id = ?', shipAsset)[0]).toMatchObject({ classification_id: stdAlt, version: 2 });
    expect(sql(env, 'SELECT classification_id FROM ast_position WHERE id = ?', altPos)[0]!.classification_id).toBe(stdAlt);
    expect(sql(env, "SELECT reason FROM sys_audit_event WHERE entity_id = ? AND reason IS NOT NULL", shipAsset)[0]?.reason).toBe('Classification merge: ALTERNATOR -> SWBS-311-ALT');
    expect(applyRemap(ship).updated).toEqual([]);

    // The hub's own spare is still on the legacy class, so it is not retired yet.
    expect(retireLegacy(hub, { dryRun: true }).stillInUse).toEqual([{ code: 'ALTERNATOR', positions: 0, assets: 1 }]);
    applyRemap(hub);
    expect(retireLegacy(hub, { dryRun: true })).toMatchObject({ retired: ['ALTERNATOR', 'BEARING'], dryRun: true });
    expect(sql(env, "SELECT status FROM ast_classification WHERE code = 'ALTERNATOR'")[0]!.status).toBe('active');
    expect(retireLegacy(hub).retired).toEqual(['ALTERNATOR', 'BEARING']);
    expect(sql(env, "SELECT status, deleted_at FROM ast_classification WHERE code = 'ALTERNATOR'")[0]).toEqual({ status: 'inactive', deleted_at: null });
    expect(sql(env, "SELECT status FROM ast_classification WHERE code = 'SWITCHBOARD'")[0]!.status).toBe('active');
    expect(codeOf(() => retireLegacy(ship))).toBe('NOT_OWNER');
  });
});

describe('Excel templates', () => {
  it('imports classifications and the crosswalk, and translates legacy codes on asset import', () => {
    const { env } = legacyFleet();
    const principal = env.hubActor().principal;
    const port = (code: string) => env.ctx.importExport.get(code)!;
    const cls = port('classifications');
    expect(cls.importRow({ code: 'swbs-324-xyz', name: 'Test panel', kind: 'equipment', parentCode: 'SWBS-324' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'create' });
    expect(cls.importRow({ code: 'SWBS-324-XYZ', name: 'Test panel', kind: 'equipment', parentCode: 'SWBS-324' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'skip' });
    expect(cls.importRow({ code: 'SWBS-324-XYZ', kind: 'component' }, principal, { commit: true }).ok).toBe(false);
    expect(cls.importRow({ code: 'SWBS-324-XYZ', parentCode: 'SWBS-331' }, principal, { commit: true }).ok).toBe(false);
    expect(cls.importRow({ code: 'SWBS-324-XYZ', status: 'inactive' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'update' });
    expect(cls.exportRows({ kind: 'fleet' }, principal).find((r) => r.code === 'SWBS-324-MSB')).toMatchObject({ parentCode: 'SWBS-324', kind: 'equipment' });

    const m = port('classification-map');
    expect(m.importRow({ legacySystem: 'old-pms', legacyCode: 'MSB-01', targetCode: 'SWBS-324-MSB', relation: 'exact' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'create', reference: 'OLD-PMS:MSB-01 -> SWBS-324-MSB' });
    expect(m.importRow({ legacySystem: 'OLD-PMS', legacyCode: 'MSB-01', targetCode: 'SWBS-324-MSB', note: 'checked' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'update' });
    expect(m.importRow({ legacySystem: 'OLD-PMS', legacyCode: 'X', targetCode: 'NOPE', relation: 'exact' }, principal, { commit: true }).ok).toBe(false);
    expect(m.exportRows({ kind: 'fleet' }, principal).filter((r) => r.legacySystem === 'CMMS')).toHaveLength(4);

    expect(port('assets').importRow({ name: 'Main switchboard', classificationCode: 'MSB-01', homeShipCode: 'SH1' }, principal, { commit: true })).toMatchObject({ ok: true, action: 'create' });
    expect(sql(env, "SELECT c.code FROM ast_asset a JOIN ast_classification c ON c.id = a.classification_id WHERE a.name = 'Main switchboard'")[0]!.code).toBe('SWBS-324-MSB');
  });
});

describe('HTTP', () => {
  it('loads the catalogue, shows the plan and remaps through the API', async () => {
    const env = makeAstEnv({ devAuth: true });
    const call = async (method: 'GET' | 'POST', url: string, payload?: object) => {
      const r = await env.app.inject({ method, url, ...(payload ? { payload } : {}) });
      return { status: r.statusCode, json: r.json() };
    };
    const load = await call('POST', '/api/v1/assets/classifications/load-standard');
    expect(load.status).toBe(200);
    expect(load.json.created).toHaveLength(ELECTRICAL_CATALOGUE.length);
    const legacy = id(createEntity(env.hubActor(), 'classification', { code: 'ALTERNATOR', name: 'Alternator', kind: 'equipment' }));
    createAsset(env.hubActor(), { name: 'Alt', classificationId: legacy });
    const mapped = await call('POST', '/api/v1/assets/classification-maps', { legacySystem: 'CMMS', legacyCode: 'ALTERNATOR', targetClassificationId: classId(env, 'SWBS-311-ALT'), relation: 'exact' });
    expect(mapped.status).toBe(201);
    expect((await call('GET', '/api/v1/assets/classification-maps?legacySystem=CMMS')).json.items).toHaveLength(1);
    expect((await call('GET', '/api/v1/assets/classification-merge/plan')).json.auto).toHaveLength(1);
    expect((await call('POST', '/api/v1/assets/classification-merge/remap', {})).json).toMatchObject({ dryRun: true });
    expect((await call('POST', '/api/v1/assets/classification-merge/remap', { dryRun: false })).json.updated).toHaveLength(1);
    expect((await call('POST', '/api/v1/assets/classification-merge/retire', { dryRun: false })).json.retired).toEqual(['ALTERNATOR']);
  });
});
