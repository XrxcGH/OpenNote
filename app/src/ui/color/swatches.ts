// The palette's swatches: eight theme columns with five tints and shades each, and ten standard colors.

import { darken, lighten } from './math';
import { themeColor } from './parse';
import type { Scheme, ThemeColors, ThemeName } from './parse';

/** The theme columns, left to right: ink, the six accent pens, then paper. */
export const THEME_COLUMNS: readonly { name: ThemeName; label: string }[] = [
  { name: 'text', label: 'Ink' },
  { name: 'accent1', label: 'Indigo' },
  { name: 'accent2', label: 'Brick' },
  { name: 'accent3', label: 'Fern' },
  { name: 'accent4', label: 'Plum' },
  { name: 'accent5', label: 'Amber' },
  { name: 'accent6', label: 'Walnut' },
  { name: 'background', label: 'Paper' },
];

/** The tint and shade rows under the base color, top to bottom. */
export const TINTS = [
  { kind: 'lighter', percent: 80 },
  { kind: 'lighter', percent: 60 },
  { kind: 'lighter', percent: 40 },
  { kind: 'darker', percent: 25 },
  { kind: 'darker', percent: 50 },
] as const;

export interface Swatch {
  /** What a pick stores: `theme:NAME` for the base, `#rrggbb` for a tint or a standard color. */
  readonly value: string;
  /** What the swatch draws and what a tint resolved to. */
  readonly hex: string;
  /** The English name part: "Indigo" or "Indigo, lighter 40%". Strings wrap it for the accessible name. */
  readonly name: string;
  readonly tint?: { kind: 'lighter' | 'darker'; percent: number };
}

/** One theme column: the base, then the five tints and shades. */
export function themeColumn(
  column: (typeof THEME_COLUMNS)[number],
  scheme: Scheme,
  theme: ThemeColors = {},
): Swatch[] {
  const base = themeColor(column.name, scheme, theme);
  return [
    { value: `theme:${column.name}`, hex: base, name: column.label },
    ...TINTS.map((tint): Swatch => {
      const hex = tint.kind === 'lighter' ? lighten(base, tint.percent) : darken(base, tint.percent);
      return { value: hex, hex, name: column.label, tint };
    }),
  ];
}

/** The ten standard colors: fixed values that no theme changes. */
export const STANDARD_COLORS: readonly { hex: string; name: string }[] = [
  { hex: '#8b1a1a', name: 'Dark red' },
  { hex: '#e03131', name: 'Red' },
  { hex: '#f08c00', name: 'Orange' },
  { hex: '#fcc419', name: 'Yellow' },
  { hex: '#94d82d', name: 'Light green' },
  { hex: '#2f9e44', name: 'Green' },
  { hex: '#3bc9db', name: 'Light blue' },
  { hex: '#1971c2', name: 'Blue' },
  { hex: '#1b2a6b', name: 'Dark blue' },
  { hex: '#7048e8', name: 'Purple' },
];
