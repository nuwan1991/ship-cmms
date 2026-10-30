// File Tracker parser: reads the procurement "File Update" .xlsx and turns
// every sheet into file records (one record per file / GORF, with its items).
// Plain JS with no dependencies so the same code runs in the browser and in
// Node (build.mjs). Unzipping uses the built-in DecompressionStream.
(function (root) {
  'use strict';

  // ---------- minimal .xlsx reader ----------

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not an .xlsx file (zip directory not found)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      const start = local + 30 + lNameLen + lExtraLen;
      files[name] = { method, data: u8.subarray(start, start + csize) };
    }
    return {
      has: (name) => name in files,
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
        return dec.decode(raw);
      },
    };
  }

  function xmlDecode(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k[1] === 'x') return String.fromCodePoint(parseInt(k.slice(2), 16));
      return String.fromCodePoint(parseInt(k.slice(1), 10));
    });
  }

  function attr(tag, name) {
    const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
    return m ? xmlDecode(m[1]) : null;
  }

  function textOf(xml) {
    // Concatenate every <t> run (rich text has several), skipping phonetic runs.
    xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    let out = '';
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml))) out += xmlDecode(m[1]);
    return out;
  }

  function colIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const c = ref.charCodeAt(i);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  async function readXlsx(buf) {
    const zip = await unzip(buf);
    const wbXml = await zip.text('xl/workbook.xml');
    const relsXml = (await zip.text('xl/_rels/workbook.xml.rels')) || '';
    const rels = {};
    for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
      const target = attr(m[0], 'Target');
      rels[attr(m[0], 'Id')] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    }
    const sstXml = (await zip.text('xl/sharedStrings.xml')) || '';
    const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

    const sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
      const name = attr(m[0], 'name');
      const path = rels[attr(m[0], 'r:id')];
      const xml = path && (await zip.text(path));
      if (!xml) continue;
      const rows = [];
      for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        if (!rm[2]) continue;
        const r = parseInt(attr(rm[0], 'r'), 10) - 1;
        const row = [];
        for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          if (!cm[2]) continue;
          const ref = attr(cm[0], 'r');
          const t = attr(cm[0], 't');
          let v = null;
          if (t === 'inlineStr') v = textOf(cm[2]);
          else {
            const vm = /<v>([\s\S]*?)<\/v>/.exec(cm[2]);
            if (!vm) continue;
            const raw = xmlDecode(vm[1]);
            if (t === 's') v = sst[parseInt(raw, 10)];
            else if (t === 'str' || t === 'e') v = raw;
            else if (t === 'b') v = raw === '1';
            else v = Number(raw);
          }
          if (v === null || v === '') continue;
          row[colIndex(ref)] = v;
        }
        if (row.length) rows[r] = row;
      }
      sheets.push({ name: name.trim(), rows });
    }
    return sheets;
  }

  // ---------- record extraction ----------

  const clean = (v) => (v == null ? '' : String(v).replace(/[ \s]+/g, ' ').trim());

  // Reference numbers look like ENA/APO/FO/ELE/2026/2815 or DPC/0367/C2/2026.
  const ID_RE = /\b[A-Z]{2,}(?:\/[A-Z0-9()]+){2,}/g;

  const IS_ID = /^[A-Z]{2,}(?:\/[A-Z0-9()]+){2,}$/;

  function classifyId(id) {
    if (/GORF|RJRF/.test(id)) return 'gorf';
    if (/\/RL\//.test(id)) return 'rl';
    if (/\/(?:FO|RFO|RCFO)\//.test(id)) return 'file';
    if (/\/(?:PO|RCPO|FPO)\//.test(id) || /^(?:DPC|MTR)\//.test(id)) return 'order';
    if (/\/(?:PR|PRF|RCPR|PRRF)\//.test(id)) return 'pr';
    return null;
  }

  const HEADER_RULES = [
    ['totalFile', /total\s*price\s*\(file\)/i],
    ['total', /^total\s*price/i],
    ['uprice', /u(nit)?\.?\s*(price|cost)/i],
    ['sn', /^(s\s*\/?\s*n|sr\.?\s*no)\b/i],
    ['itemName', /^item\s*name/i],
    ['itemCode', /item\s*cor?de?/i],
    ['dglCode', /dgl\s*code/i],
    ['item', /^(item|description|item\s*description)$/i],
    ['deno', /^deno/i],
    ['qty', /^qty/i],
    ['gorf', /gorf|rjrf/i],
    ['pr', /^pr\s*no/i],
    ['rl', /^rl\s*no/i],
    ['file', /^file\s*n(o|umber)/i],
    ['order', /^(order|oder)/i],
    ['position', /present\s*position/i],
    ['remarks', /^remarks/i],
    ['system', /system\s*name/i],
  ];

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const row = rows[r];
      if (!row) continue;
      const cols = {};
      row.forEach((v, c) => {
        const h = clean(v);
        if (!h) return;
        for (const [key, re] of HEADER_RULES) {
          if (re.test(h) && !(key in cols)) { cols[key] = c; break; }
        }
      });
      if ('item' in cols) return { index: r, cols, width: row.length };
    }
    return null;
  }

  const SUPPLIER_STOP = /^(ITEM|RECIVED|RECEIVED|TEC|GRN|APO|ARO|DPC|NHQ|ENA|WNA|NON|SPDC|FILE|PO|PR|RC|QC|HOD|AA|DGL)$/;

  function extractSuppliers(text) {
    const found = [];
    const add = (s) => {
      s = clean(s).replace(/^(from\s+)?(M\/s\.?\s*)?/i, '').replace(/\s+(at|dated|for|on)\b.*$/i, '').replace(/\s*(recived|received)\s*$/i, '').replace(/[\s,.]+$/, '');
      if (s.length < 3) return;
      const words = s.split(' ');
      if (words.every((w) => SUPPLIER_STOP.test(w.toUpperCase()))) return;
      if (!found.some((f) => f.toUpperCase() === s.toUpperCase())) found.push(s);
    };
    const t = text.replace(ID_RE, ' | ').replace(/ · /g, ' | ');
    for (const m of t.matchAll(/\bfrom\s+((?:M\/s\.?\s*)?[A-Za-z][A-Za-z&.()'\- ]*?)(?=\s*(?:\d|\||recived|received|$))/gi)) add(m[1]);
    for (const m of t.matchAll(/((?:\b[A-Z][\w&.'\-]*\s+){1,6}\(?(?:Pvt|PVT)\)?\.?\s*(?:Ltd|LTD)(?![a-z])\.?)/g)) add(m[1]);
    // ALL-CAPS name directly before a date or "Due": "ACE INTERNATIONAL 10/06/2026"
    for (const m of t.matchAll(/(?:^|\|)\s*([A-Z][A-Z&.()'\-]*(?:\s+[A-Z&.()'\-]+)*?)\s*(?=\d{1,2}\/\d{1,2}\/\d{4}|Due\b)/g)) {
      if (m[1].split(/\s+/).length >= 2 || /^[A-Z]{5,}$/.test(m[1])) add(m[1]);
    }
    // Drop names that are just part of a longer one ("ENGINEERING PVT LTD" vs "RK ENGINEERING PVT LTD").
    return found.filter((s) => !found.some((o) => o !== s && o.toUpperCase().endsWith(s.toUpperCase())));
  }

  function deriveStatus(rec) {
    const t = (rec.position + ' ' + rec.remarks).toLowerCase();
    if (/recived|received|\bgrn\b/.test(t) || /recev|receiv/i.test(rec.sheet)) return 'Received';
    if (/reject/.test(t)) return 'Rejected';
    if (/dispatch|shipping to/.test(t)) return 'Dispatched';
    if (/purchase order|order no|oder no|oder number/.test(t) || rec.order) return 'PO created';
    if (/fund (allocated|request)/.test(t)) return 'Funding';
    if (/\btec\b|bids?|tender|price schedule|evaluation|specification|quotation/.test(t)) return 'Tender / TEC';
    if (/file (open|created)|procurement file|assign file|file transfer/.test(t) || rec.file) return 'File open';
    if (rec.pr || rec.gorf) return 'PR / GORF';
    return 'Not started';
  }

  // "ENA/APO/FO/ELE/2026/2815" -> "ENA/APO"; the office that holds the file.
  function officeOf(file) {
    const m = /^([A-Z]+\/[A-Z0-9]+)\//.exec(file || '');
    return m ? m[1] : '';
  }

  function num(v) {
    if (typeof v === 'number') return v;
    const n = Number(clean(v).replace(/,/g, ''));
    return clean(v) && !isNaN(n) ? n : null;
  }

  function parseSheet(sheet) {
    const rows = sheet.rows;
    const hdr = findHeader(rows);
    if (!hdr) return [];
    const { cols } = hdr;
    // Sheets without a "Present position" column keep the status in "Remarks".
    if (!('position' in cols) && 'remarks' in cols) { cols.position = cols.remarks; delete cols.remarks; }
    const idCols = new Set(['gorf', 'pr', 'rl', 'file', 'order'].filter((k) => k in cols).map((k) => cols[k]));
    const skipCols = new Set(['itemCode', 'dglCode'].filter((k) => k in cols).map((k) => cols[k]));
    const numCols = new Set(['qty', 'uprice', 'total', 'totalFile'].filter((k) => k in cols).map((k) => cols[k]));
    const textCols = new Set(['position', 'remarks', 'system', 'itemName', 'deno', 'item', 'sn'].filter((k) => k in cols).map((k) => cols[k]));

    const records = [];
    let section = '';
    let cur = null;
    let lastRow = -1;

    const get = (row, key) => (key in cols ? row[cols[key]] : undefined);

    for (let r = hdr.index + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row) continue;
      const filled = row.map((v, c) => [c, v]).filter(([, v]) => clean(v) !== '');
      if (!filled.length) continue;
      if (r - lastRow > 2) cur = null; // a gap of blank rows ends the current file

      const sn = clean(get(row, 'sn'));
      const item = clean(get(row, 'item'));

      // Section heading: a lone text cell, usually in the first column.
      if (!item && filled.length === 1 && typeof filled[0][1] === 'string') {
        section = clean(filled[0][1]);
        cur = null;
        continue;
      }
      // A bare year ("2025") under a heading is a sub-heading.
      if (/^\d{4}$/.test(item) && filled.length === 1) continue;
      // Sub-total rows only carry numbers.
      if (!item && filled.every(([, v]) => typeof v === 'number')) continue;

      // Collect reference numbers from every cell, and free text from the rest.
      const ids = { gorf: [], pr: [], rl: [], file: [], order: [] };
      const notes = { position: [], remarks: [], idText: {} };
      for (const [c, v] of filled) {
        if (skipCols.has(c) || typeof v !== 'string') continue;
        const s = clean(v);
        const found = s.match(ID_RE) || [];
        for (const id of found) {
          const k = classifyId(id);
          if (k && !ids[k].includes(id)) ids[k].push(id);
        }
        if (idCols.has(c)) {
          const rest = clean(s.replace(ID_RE, ''));
          if (rest && !found.length) {
            const key = Object.keys(cols).find((k) => cols[k] === c);
            notes.idText[key] = rest;
          } else if (rest && rest.length > 3) notes.remarks.push(rest);
        } else if (c === cols.position) notes.position.push(s);
        else if (c === cols.remarks) notes.remarks.push(s);
        else if (!textCols.has(c) && !numCols.has(c)) notes.remarks.push(s);
      }
      for (const k of Object.keys(notes.idText)) if (!ids[k].length) ids[k].push(notes.idText[k]);

      const line = {
        item: item || clean(get(row, 'itemName')),
        name2: clean(get(row, 'itemName')),
        code: clean(get(row, 'itemCode')),
        deno: clean(get(row, 'deno')),
        qty: num(get(row, 'qty')),
        uprice: num(get(row, 'uprice')),
        total: num(get(row, 'total')),
      };
      if (line.name2.toUpperCase() === line.item.toUpperCase()) line.name2 = '';

      // Stray cells (an item code under S/N, a note) with no item and no reference.
      if (!line.item && !Object.values(ids).some((a) => a.length)) continue;
      const conflicts = cur && Object.keys(ids).some((k) => ids[k].length && cur[k] && !ids[k].every((id) => cur[k].includes(id)));
      if (sn || !cur || conflicts) {
        cur = {
          sheet: sheet.name,
          section,
          sn,
          gorf: '', pr: '', rl: '', file: '', order: '',
          position: '', remarks: '', supplier: '',
          system: clean(get(row, 'system')),
          totalFile: num(get(row, 'totalFile')),
          items: [],
          row: r + 1,
        };
        records.push(cur);
      }
      for (const k of Object.keys(ids)) {
        for (const id of ids[k]) {
          if (!cur[k]) cur[k] = id;
          else if (!cur[k].split(' / ').includes(id)) cur[k] += ' / ' + id;
        }
      }
      if (notes.position.length) cur.position = clean([cur.position, ...notes.position].filter(Boolean).join(' '));
      if (notes.remarks.length) cur.remarks = clean([cur.remarks, ...notes.remarks].filter(Boolean).join(' · '));
      if (line.item) cur.items.push(line);
      lastRow = r;
    }

    for (const rec of records) {
      // Ignore leftover "RC" / "APO" placeholders when a real number came later.
      for (const k of ['gorf', 'pr', 'rl', 'file', 'order']) {
        const parts = rec[k].split(' / ');
        if (parts.length < 2) continue;
        // Keep real numbers over "RC"/"APO" placeholders, and drop typo copies ("NA/SPD/..." of "ENA/SPD/...").
        const ids = parts.filter((p) => IS_ID.test(p));
        const kept = ids.filter((p) => !ids.some((o) => o !== p && o.endsWith(p)));
        rec[k] = kept.join(' / ') || rec[k];
      }
      rec.supplier = extractSuppliers([rec.position, rec.remarks].join(' | ')).join(' / ');
      rec.status = deriveStatus(rec);
      rec.office = officeOf(rec.file);
      rec.value = rec.totalFile || rec.items.reduce((s, i) => s + (i.total || 0), 0) || null;
    }
    // Drop legend / note rows: nothing that identifies a file or an ordered item.
    return records.filter((r) => r.sn || r.gorf || r.pr || r.rl || r.file || r.order || r.items.some((i) => i.qty != null || i.total != null));
  }

  async function parseWorkbook(buf, opts) {
    const skip = (opts && opts.skipSheets) || /^sheet\d+( \(\d+\))?$/i;
    const sheets = await readXlsx(buf);
    const records = [];
    for (const s of sheets) {
      if (skip.test(s.name)) continue;
      records.push(...parseSheet(s));
    }
    records.forEach((r, i) => (r.id = i + 1));
    return records;
  }

  const api = { parseWorkbook, readXlsx, extractSuppliers, classifyId };
  root.FileTrackerParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
