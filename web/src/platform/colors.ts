import type { CSSProperties } from 'react';

/**
 * Display colours shared by several modules' screens (D68): operational status (fixed) and defect categories (stored with the
 * category at the hub, e.g. Electrical green, Marine Engineering maroon, Weapon light grey). Sea deployment is light blue (CSS `.sea`).
 */
export const STATUS_KEYS = ['operational', 'semi_operational', 'non_operational'] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

/** Relative luminance of #RRGGBB (WCAG). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0.5;
  const ch = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(m[1]!) + 0.7152 * ch(m[2]!) + 0.0722 * ch(m[3]!);
}

/** Text colour that stays readable on `bg`: dark on light colours (light grey, light blue), white on dark ones (maroon). */
export const textOn = (bg: string): string => (luminance(bg) > 0.3 ? '#17202A' : '#FFFFFF');

/** Solid badge for a category; with no colour (uncategorised) a neutral outline. Light colours get a darker border so they stay visible. */
export function categoryStyle(color: string | null | undefined): CSSProperties {
  if (!color) return { background: 'var(--muted-bg)', color: 'var(--muted)', border: '1px dashed var(--line)' };
  return { background: color, color: textOn(color), border: `1px solid ${luminance(color) > 0.5 ? '#8A9099' : color}` };
}

/** Swatch (legend square, bar segment) for a category colour. */
export function swatchStyle(color: string | null | undefined): CSSProperties {
  if (!color) return { background: 'var(--muted-bg)', border: '1px dashed var(--muted)' };
  return { background: color, border: `1px solid ${luminance(color) > 0.5 ? '#8A9099' : color}` };
}
