// checks-disable-file brand-consistency: the standard colors are data the palette offers, not interface colors
// The palette's swatches: eight theme columns with five tints and shades each, and ten standard colors.

import { darken, lighten } from './math';
import { themeColor } from './parse';
import type { MessageKey } from '../../strings/t';
import type { Scheme, ThemeColors, ThemeName } from './parse';

/** The theme columns, left to right: ink, the six accent pens, then paper. */
export const THEME_COLUMNS: readonly { name: ThemeName; label: MessageKey }[] = [
  { name: 'text', label: 'color.colInk' },
  { name: 'accent1', label: 'color.colIndigo' },
  { name: 'accent2', label: 'color.colBrick' },
  { name: 'accent3', label: 'color.colFern' },
  { name: 'accent4', label: 'color.colPlum' },
  { name: 'accent5', label: 'color.colAmber' },
  { name: 'accent6', label: 'color.colWalnut' },
  { name: 'background', label: 'color.colPaper' },
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
  /** The string key of the name part: "Indigo" for a base or a tint. Strings wrap it for the accessible name. */
  readonly name: MessageKey;
  readonly tint?: { kind: 'lighter' | 'darker'; percent: number };
}

/**
 * One theme column: the base, then the five tints and shades. A tint is stored as `#rrggbb` and exported to DOCX
 * and XLSX, so it comes from the document's (light) theme value whatever the UI scheme is. The scheme changes only
 * what the base swatch draws.
 */
export function themeColumn(
  column: (typeof THEME_COLUMNS)[number],
  scheme: Scheme,
  theme: ThemeColors = {},
): Swatch[] {
  const base = themeColor(column.name, scheme, theme);
  const stored = themeColor(column.name, 'light', theme);
  return [
    { value: `theme:${column.name}`, hex: base, name: column.label },
    ...TINTS.map((tint): Swatch => {
      const hex = tint.kind === 'lighter' ? lighten(stored, tint.percent) : darken(stored, tint.percent);
      return { value: hex, hex, name: column.label, tint };
    }),
  ];
}

/** The ten standard colors: fixed values that no theme changes. */
export const STANDARD_COLORS: readonly { hex: string; name: MessageKey }[] = [
  { hex: '#8b1a1a', name: 'color.stdDarkRed' },
  { hex: '#e03131', name: 'color.stdRed' },
  { hex: '#f08c00', name: 'color.stdOrange' },
  { hex: '#fcc419', name: 'color.stdYellow' },
  { hex: '#94d82d', name: 'color.stdLightGreen' },
  { hex: '#2f9e44', name: 'color.stdGreen' },
  { hex: '#3bc9db', name: 'color.stdLightBlue' },
  { hex: '#1971c2', name: 'color.stdBlue' },
  { hex: '#1b2a6b', name: 'color.stdDarkBlue' },
  { hex: '#7048e8', name: 'color.stdPurple' },
];
