import type { Rec } from '../../platform/api';

export interface TreeRow {
  rec: Rec;
  depth: number;
}

/** Flat parent_id list -> depth-first rows (siblings by sortOrder, then code). Orphans (parent not loaded) are shown as roots so nothing disappears. */
export function buildTree(items: readonly Rec[]): TreeRow[] {
  const byParent = new Map<string | null, Rec[]>();
  const ids = new Set(items.map((i) => i.id));
  for (const i of items) {
    const p = typeof i.parentId === 'string' && ids.has(i.parentId) ? i.parentId : null;
    byParent.set(p, [...(byParent.get(p) ?? []), i]);
  }
  const cmp = (a: Rec, b: Rec) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || String(a.code).localeCompare(String(b.code));
  const out: TreeRow[] = [];
  const walk = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const rec of [...(byParent.get(parent) ?? [])].sort(cmp)) {
      if (seen.has(rec.id)) continue; // defensive against cycles in bad data
      out.push({ rec, depth });
      walk(rec.id, depth + 1, new Set([...seen, rec.id]));
    }
  };
  walk(null, 0, new Set());
  return out;
}

/** Ids of `id` and everything below it: these cannot be chosen as its new parent. */
export function descendantIds(items: readonly Rec[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of items) if (typeof i.parentId === 'string' && out.has(i.parentId) && !out.has(i.id)) { out.add(i.id); grew = true; }
  }
  return out;
}
