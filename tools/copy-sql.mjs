// The compiled server finds its migrations next to the compiled code (platform/db/migrations, modules/<dir>/migrations): copy the .sql files into dist.
import { cpSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const src = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
let n = 0;
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.sql')) { const to = join(out, relative(src, p)); mkdirSync(dirname(to), { recursive: true }); cpSync(p, to); n++; }
  }
})(src);
if (!existsSync(join(out, 'main.js'))) throw new Error('dist/main.js is missing: did tsc fail?');
console.log(`Copied ${n} migration file(s) into dist/`);
