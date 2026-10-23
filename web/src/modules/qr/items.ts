/** Survey template questions are typed as one line each: `key | Question text | yesno|text|number`. */
export interface TemplateItem { key: string; label: string; kind: 'text' | 'yesno' | 'number' }
const KINDS = ['text', 'yesno', 'number'] as const;

export function formatTemplateItems(items: readonly TemplateItem[] | undefined): string {
  return (items ?? []).map((i) => `${i.key} | ${i.label} | ${i.kind}`).join('\n');
}

/** Returns the parsed items, or the 1-based number of the first bad line. */
export function parseTemplateItems(text: string): { items: TemplateItem[] } | { badLine: number } {
  const items: TemplateItem[] = [];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!.trim();
    if (!line) continue;
    const [key = '', label = '', kind = 'text'] = line.split('|').map((p) => p.trim());
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key) || !label || !(KINDS as readonly string[]).includes(kind)) return { badLine: n + 1 };
    items.push({ key, label, kind: kind as TemplateItem['kind'] });
  }
  return { items };
}

/** Answers typed in the survey form → the typed values the API expects. */
export function coerceAnswers(items: readonly TemplateItem[], raw: Record<string, string>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const i of items) {
    const v = (raw[i.key] ?? '').trim();
    if (v === '') continue;
    if (i.kind === 'yesno') out[i.key] = v === 'yes';
    else if (i.kind === 'number') { const n = Number(v); if (Number.isFinite(n)) out[i.key] = n; }
    else out[i.key] = v;
  }
  return out;
}

/** True when the number of labels fits the range left on this installation. */
export const rangeWarning = (remaining: number | null, wanted: number): 'none' | 'short' | null =>
  remaining === null ? null : remaining === 0 ? 'none' : wanted > remaining ? 'short' : null;
