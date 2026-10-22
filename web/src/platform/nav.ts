/** Navigation registry. Mirrors the server's `NavItem` (src/platform/ports.ts); modules register items, the shell filters by permission. */
export interface NavItem {
  module: string;
  path: string;
  labelKey: string;
  requiredPermission?: string;
  order: number;
}

export function visibleNav(items: readonly NavItem[], can: (permission: string) => boolean): NavItem[] {
  return items.filter((i) => !i.requiredPermission || can(i.requiredPermission)).sort((a, b) => a.order - b.order || a.path.localeCompare(b.path));
}

export function groupByModule(items: readonly NavItem[]): Array<{ module: string; items: NavItem[] }> {
  const out: Array<{ module: string; items: NavItem[] }> = [];
  for (const i of items) {
    const g = out.find((x) => x.module === i.module);
    if (g) g.items.push(i);
    else out.push({ module: i.module, items: [i] });
  }
  return out;
}
