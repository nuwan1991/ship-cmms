import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkBoundaries } from '../tools/check-boundaries.js';
import { MODULES, topoOrder, type ModuleManifest } from '../src/platform/modules.js';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cmms-bound-'));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  return root;
}

const mods: ManifestLite[] = [
  { id: 'M01', dir: 'm01-organization', tablePrefix: 'org', apiPrefix: '/a', dependsOn: [] },
  { id: 'M03', dir: 'm03-assets', tablePrefix: 'ast', apiPrefix: '/b', dependsOn: ['M01'] },
  { id: 'M07', dir: 'm07-stores', tablePrefix: 'stk', apiPrefix: '/c', dependsOn: ['M01', 'M03'] },
];
type ManifestLite = ModuleManifest;

describe('module boundaries', () => {
  it('the real source tree complies', () => {
    expect(checkBoundaries(join(repo, 'src'))).toEqual([]);
  });

  it('the real dependency graph is acyclic and M01 comes first', () => {
    const order = topoOrder().map((m) => m.id);
    expect(order[0]).toBe('M01');
    expect(order.indexOf('M05')).toBeGreaterThan(order.indexOf('M03'));
    expect(order.indexOf('M09')).toBeGreaterThan(order.indexOf('M08'));
  });

  it('detects undeclared and deep imports, platform reaching into modules, and bad table prefixes', () => {
    const root = fixture({
      'platform/a.ts': "import { x } from '../modules/m01-organization/index.js';",
      'modules/m01-organization/index.ts': 'export const x = 1;',
      'modules/m01-organization/migrations/0001_a.sql': 'CREATE TABLE ast_wrong (id TEXT);',
      'modules/m03-assets/index.ts': "import { x } from '../m01-organization/index.js'; export const y = x;",
      'modules/m07-stores/deep.ts': "import { y } from '../m03-assets/internal/secret.js';",
      'modules/m07-stores/ok.ts': "import { x } from '../m01-organization/index.js';",
      'modules/m07-stores/migrations/0001_s.sql': 'CREATE VIEW stk_bad_view AS SELECT 1;',
      'modules/m01-organization/up.ts': "import { y } from '../m03-assets/index.js';",
      'modules/rogue/index.ts': '',
    });
    const messages = checkBoundaries(root, mods).map((v) => v.message).join('\n');
    expect(messages).toContain('platform must not import module m01-organization');
    expect(messages).toContain('must start with "org_"');
    expect(messages).toContain('M07 must import M03 only through its public index.ts');
    expect(messages).toContain('M01 must not import M03 (not in dependsOn)');
    expect(messages).toContain('must start with "stk_v_"');
    expect(messages).toContain('directory is not declared');
    expect(messages).not.toContain('ok.ts');
  });

  it('detects dependency cycles', () => {
    const cyc: ManifestLite[] = [
      { ...mods[0]!, dependsOn: ['M03'] },
      { ...mods[1]!, dependsOn: ['M01'] },
    ];
    expect(() => topoOrder(cyc)).toThrow(/cycle/);
  });
});

describe('documents stay in step with code', () => {
  const read = (f: string) => readFileSync(join(repo, f), 'utf8');
  it('MODULE_MAP.md lists every module with its directory, prefix and API prefix', () => {
    const map = read('MODULE_MAP.md');
    for (const m of MODULES) {
      expect(map, m.id).toContain(`| ${m.id} |`);
      expect(map, `${m.id} dir`).toContain(m.dir);
      expect(map, `${m.id} prefix`).toContain(`\`${m.tablePrefix}_\``);
      expect(map, `${m.id} api`).toContain(m.apiPrefix);
    }
  });
  it('every canonical document exists and BUILD_STATUS lists every module', () => {
    for (const f of ['PROJECT_SPEC.md', 'ARCHITECTURE.md', 'MODULE_MAP.md', 'CONTRACTS.md', 'DATA_DICTIONARY.md', 'SYNC_RULES.md', 'DECISIONS.md', 'BUILD_STATUS.md', 'CHAT_STARTER.md']) {
      expect(() => read(f), f).not.toThrow();
    }
    const status = read('BUILD_STATUS.md');
    for (const m of MODULES) expect(status, m.id).toContain(`| ${m.id} |`);
  });
});
