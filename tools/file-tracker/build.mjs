// Builds a single, self-contained File Tracker page (works offline, easy to
// send by WhatsApp/email) with the workbook's data built in.
//
//   node tools/file-tracker/build.mjs "File Update - 2026 September.xlsx" [out.html]
//
// Without an .xlsx it builds an empty page that can load the Excel itself.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [input, outArg] = process.argv.slice(2);
const parserSrc = fs.readFileSync(path.join(here, 'parser.js'), 'utf8');
let html = fs.readFileSync(path.join(here, 'tracker.html'), 'utf8');

let data = null;
if (input) {
  vm.runInThisContext(parserSrc, { filename: 'parser.js' });
  const records = await globalThis.FileTrackerParser.parseWorkbook(fs.readFileSync(input));
  data = {
    source: path.basename(input),
    generated: new Date().toLocaleDateString('en-GB'),
    builtAt: Date.now(),
    records,
  };
  console.log(`Parsed ${records.length} files from ${path.basename(input)}`);
}

// Inline everything; "</" is escaped so the data cannot close the <script> tag.
const inline = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
html = html
  .replace('<script src="parser.js"></script>', () => `<script>\n${inline(parserSrc)}\n</script>`)
  .replace('/*__DATA__*/null', () => inline(JSON.stringify(data)));

const out = outArg || (input ? input.replace(/\.xlsx$/i, '') + ' - Tracker.html' : 'File Tracker.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${out}`);
