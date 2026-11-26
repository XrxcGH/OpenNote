// checks-disable-file brand-consistency: values here are palette data
// The shared color value parser (spec Appendix D.7, R-VAL-7, and R-VAL-8). `parseColor` reads what a person types;
// `parseColorValue` reads what a page stores; `resolveColor` turns a stored value into `#rrggbb` for drawing and
// for export. Tints are never stored: they become `#rrggbb` when applied.

import { tokens } from '../../theme/tokens';
import { hexToRgb, hslToRgb, rgbToHex } from './math';

export type Scheme = 'light' | 'dark';

export const THEME_NAMES = [
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'text',
  'background',
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export type ParsedColor = { ok: true; hex: string } | { ok: false };

/** The longest typed color worth matching: `hsl(360, 100%, 100%)` with generous spaces fits. */
export const MAX_COLOR_INPUT = 64;
/** One separator: a comma with optional spaces, or spaces alone. The two cannot match the same text twice. */
const SEP = String.raw`(?:\s*,\s*|\s+)`;

const byte = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
};

/**
 * Reads a typed color: `#rrggbb`, `rrggbb`, `#rgb`, `rgb(r, g, b)` or `hsl(h, s%, l%)`, in any case, with spaces
 * allowed around the parts. The result is lowercase `#rrggbb`.
 */
export function parseColor(input: string): ParsedColor {
  // A hostile paste must not cost more than a constant amount of work (Appendix D.7).
  if (input.length > MAX_COLOR_INPUT * 4) return { ok: false };
  const text = input.trim().toLowerCase();
  if (text.length > MAX_COLOR_INPUT) return { ok: false };
  const hex6 = /^#?([0-9a-f]{6})$/.exec(text);
  if (hex6) return { ok: true, hex: `#${hex6[1]}` };
  const hex3 = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (hex3) return { ok: true, hex: `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}` };
  const rgb = new RegExp(String.raw`^rgb\(\s*(\d{1,3})${SEP}(\d{1,3})${SEP}(\d{1,3})\s*\)$`).exec(text);
  if (rgb) {
    const parts = [byte(rgb[1]), byte(rgb[2]), byte(rgb[3])];
    if (parts.every((p): p is number => p !== null)) return { ok: true, hex: rgbToHex([parts[0], parts[1], parts[2]]) };
    return { ok: false };
  }
  const hsl = new RegExp(String.raw`^hsl\(\s*(\d{1,3})${SEP}(\d{1,3})%?${SEP}(\d{1,3})%?\s*\)$`).exec(text);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]), Number(hsl[2]), Number(hsl[3])];
    if (h <= 360 && s <= 100 && l <= 100) return { ok: true, hex: rgbToHex(hslToRgb([h, s, l])) };
  }
  return { ok: false };
}

/** The pens and highlighters by lowercase name, each with its light and dark value. */
const named = new Map<string, { light: string; dark: string }>(
  [...tokens.ink.pens, ...tokens.ink.highlighters].map((c) => [c.name.toLowerCase(), c]),
);

/** Theme colors, in the order of R-THM-2: accent1 to accent6 are indigo, brick, fern, plum, amber, walnut. */
export const THEME_PENS = ['indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'] as const;

export type ThemeColors = Partial<Record<ThemeName, string>>;

/** The color of a theme token: the notebook's theme when it sets one (R-THM-2), else the app's default. */
export function themeColor(name: ThemeName, scheme: Scheme, theme: ThemeColors = {}): string {
  const set = theme[name];
  if (set && hexToRgb(set)) return set.toLowerCase();
  if (name === 'text') return named.get('ink')![scheme].toLowerCase();
  if (name === 'background') return tokens.color[scheme].surface.page.toLowerCase();
  return named.get(THEME_PENS[Number(name.slice(6)) - 1])![scheme].toLowerCase();
}

/**
 * Turns a stored value (pen, highlighter, `#rrggbb`, `theme:NAME`) into `#rrggbb`. Highlighter values drop their
 * alpha. Null for a value outside the grammar, so a caller shows the neutral color a newer name needs (section 2.7).
 */
export function resolveColor(value: string, scheme: Scheme = 'light', theme: ThemeColors = {}): string | null {
  if (value.startsWith('theme:')) {
    const name = value.slice(6) as ThemeName;
    return (THEME_NAMES as readonly string[]).includes(name) ? themeColor(name, scheme, theme) : null;
  }
  const entry = named.get(value);
  if (entry) return entry[scheme].slice(0, 7).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(value) ? value : null;
}

/** True when a stored value is inside the grammar of R-VAL-7. */
export function isColorValue(value: string): boolean {
  return resolveColor(value) !== null;
}
