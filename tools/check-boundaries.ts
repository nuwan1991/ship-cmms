/**
 * Enforces MODULE_MAP.md mechanically:
 *  1. module code imports only src/platform, itself, or the public index.ts of a declared dependency;
 *  2. platform code never imports modules or the composition root;
 *  3. every table/view a module creates carries that module's prefix (views: `<prefix>_v_`);
 *  4. the dependency graph is acyclic;
 *  5. no unregistered directories under src/modules.
 * Run: npm run check:boundaries
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODULES, PLATFORM_TABLE_PREFIX, topoOrder, type ModuleManifest } from '../src/platform/modules.js';

export interface Violation {
  file: string;
  message: string;
}

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s+['"]([^'"]+)['"]/g;

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, exts) : exts.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

type Area = { kind: 'platform' } | { kind: 'module'; dir: string; rest: string } | { kind: 'root' };

function classify(srcRoot: string, absNoExt: string): Area {
  const parts = relative(srcRoot, absNoExt).split(sep);
  if (parts[0] === 'platform') return { kind: 'platform' };
  if (parts[0] === 'modules' && parts[1] && parts[1] !== 'index') return { kind: 'module', dir: parts[1], rest: parts.slice(2).join('/') };
  return { kind: 'root' };
}

export function checkBoundaries(srcRoot: string, mods: readonly ModuleManifest[] = MODULES): Violation[] {
  const v: Violation[] = [];
  const rel = (f: string) => relative(srcRoot, f).split(sep).join('/');

  try {
    topoOrder(mods);
  } catch (e) {
    v.push({ file: 'platform/modules.ts', message: (e as Error).message });
  }

  const modulesDir = join(srcRoot, 'modules');
  if (existsSync(modulesDir)) {
    for (const d of readdirSync(modulesDir)) {
      if (statSync(join(modulesDir, d)).isDirectory() && !mods.some((m) => m.dir === d)) {
        v.push({ file: `modules/${d}`, message: 'directory is not declared in platform/modules.ts' });
      }
    }
  }

  const scan = (owner: 'platform' | ModuleManifest, files: string[]) => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3];
        if (!spec || !spec.startsWith('.')) continue; // npm / node: imports are fine
        const target = classify(srcRoot, resolve(dirname(file), spec.replace(/\.js$/, '')));
        if (owner === 'platform') {
          if (target.kind !== 'platform') v.push({ file: rel(file), message: `platform must not import ${target.kind === 'module' ? `module ${target.dir}` : 'the composition root'} ("${spec}")` });
          continue;
        }
        if (target.kind === 'platform') continue;
        if (target.kind === 'root') {
          v.push({ file: rel(file), message: `${owner.id} must not import the composition root ("${spec}")` });
          continue;
        }
        if (target.dir === owner.dir) continue;
        const dep = mods.find((x) => x.dir === target.dir);
        if (!dep || !owner.dependsOn.includes(dep.id)) {
          v.push({ file: rel(file), message: `${owner.id} must not import ${dep?.id ?? target.dir} (not in dependsOn)` });
        } else if (target.rest !== 'index') {
          v.push({ file: rel(file), message: `${owner.id} must import ${dep.id} only through its public index.ts, not "${spec}"` });
        }
      }
    }
  };

  scan('platform', walk(join(srcRoot, 'platform'), ['.ts']));
  for (const m of mods) scan(m, walk(join(modulesDir, m.dir), ['.ts']));

  const checkSql = (prefix: string, owner: string, dir: string) => {
    for (const file of walk(dir, ['.sql'])) {
      const sql = readFileSync(file, 'utf8').replace(/--.*$/gm, '');
      for (const m of sql.matchAll(/CREATE\s+(TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)) {
        const kind = m[1]!.toUpperCase();
        const name = m[2]!;
        const want = kind === 'VIEW' && owner !== 'platform' ? `${prefix}_v_` : `${prefix}_`;
        if (!name.startsWith(want)) v.push({ file: rel(file), message: `${owner} ${kind.toLowerCase()} "${name}" must start with "${want}"` });
      }
    }
  };
  checkSql(PLATFORM_TABLE_PREFIX, 'platform', join(srcRoot, 'platform'));
  for (const m of mods) checkSql(m.tablePrefix, m.id, join(modulesDir, m.dir));

  return v;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));
  const violations = checkBoundaries(srcRoot);
  if (violations.length) {
    for (const x of violations) console.error(`${x.file}: ${x.message}`);
    process.exit(1);
  }
  console.log('Module boundaries OK');
}
