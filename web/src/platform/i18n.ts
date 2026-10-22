/** All user-facing text is addressed by `labelKey` so translations (Sinhala/Tamil) can be added without touching screens. */
type Dict = Record<string, string>;
const dict: Dict = {};
const warned = new Set<string>();

export function registerLabels(labels: Dict): void {
  Object.assign(dict, labels);
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = dict[key];
  if (raw === undefined) {
    if (!warned.has(key) && import.meta.env?.DEV) {
      warned.add(key);
      console.warn(`[i18n] missing label: ${key}`);
    }
    return key;
  }
  return vars ? raw.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`)) : raw;
}
