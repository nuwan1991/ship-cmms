/**
 * Paste import: rows copied from Excel (tab separated) or CSV, first line = column headings. Headings are matched to fields by
 * name, ignoring case, spaces and punctuation, so the office's own annex headings can be used once mapped here.
 */
export type ColumnMap = Record<string, string>;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export const HANDOVER_COLUMNS: ColumnMap = {
  annex: 'annexRef', annexref: 'annexRef', annexno: 'annexRef', ref: 'annexRef', serial: 'annexRef', serno: 'annexRef', sno: 'annexRef', reference: 'annexRef',
  category: 'category', type: 'category',
  subject: 'subject', item: 'subject', title: 'subject', matter: 'subject',
  description: 'description', details: 'description',
  previousstatus: 'previousStatus', status: 'previousStatus', presentstatus: 'previousStatus', currentstatus: 'previousStatus', remarksonstatus: 'previousStatus',
  priority: 'priority', urgent: 'urgent', targetdate: 'targetDate', target: 'targetDate', duedate: 'targetDate',
  remarks: 'remarks', remark: 'remarks', originalref: 'originalRef', fileref: 'originalRef',
};
const CATEGORY: Record<string, string> = {
  responsibility: 'responsibility', responsibilities: 'responsibility', project: 'project', projects: 'project', pendingwork: 'pending_work', pending: 'pending_work', work: 'pending_work',
  unresolved: 'unresolved', unresolvedmatter: 'unresolved', correspondence: 'correspondence', letters: 'correspondence', equipment: 'equipment', other: 'other',
};

/** Split pasted text into rows of cells: tabs when present (Excel), otherwise CSV with quotes. */
export function splitRows(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
  if (lines.some((l) => l.includes('\t'))) return lines.map((l) => l.split('\t').map((c) => c.trim()));
  return lines.map((l) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i]!;
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** Accepts 2026-11-20, 20/11/2026, 20.11.2026 and 20-11-2026 (day first, as written in Sri Lanka). Anything else stays as typed so the server rejects it visibly. */
export function toIsoDate(s: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : t;
}

export function parseHandoverPaste(text: string): { headings: Array<{ heading: string; field: string | null }>; rows: Array<Record<string, unknown>> } {
  const [head, ...body] = splitRows(text);
  if (!head) return { headings: [], rows: [] };
  const fields = head.map((h) => HANDOVER_COLUMNS[norm(h)] ?? null);
  const rows = body.map((cells) => {
    const r: Record<string, unknown> = {};
    fields.forEach((f, i) => {
      const v = cells[i]?.trim() ?? '';
      if (!f || v === '') return;
      if (f === 'category') r.category = CATEGORY[norm(v)] ?? v;
      else if (f === 'urgent') r.urgent = /^(y|yes|true|1|urgent)$/i.test(v);
      else if (f === 'priority') r.priority = v.toLowerCase();
      else if (f === 'targetDate') r.targetDate = toIsoDate(v);
      else if (f === 'previousStatus' && r.previousStatus) r.previousStatus = `${String(r.previousStatus)}; ${v}`;
      else r[f] = v;
    });
    if (!r.category) r.category = 'pending_work';
    return r;
  });
  return { headings: head.map((h, i) => ({ heading: h, field: fields[i] ?? null })), rows };
}
