// The brand pens and highlighters (spec 8.2, BRAND.md section 4). The colors come from brand/tokens.json through the
// generated tokens module, so a color change there reaches the pens with no edit here. A stroke stores the slot and
// the light-theme color; the slot lets the dark theme draw the pen's dark value (spec 8.2).

import { tokens } from '../../../theme/tokens';

/** Red, green, blue, and alpha bytes in sRGB with straight alpha, the form a stroke record stores. */
export type Rgba = readonly [number, number, number, number];

export type ColorScheme = 'light' | 'dark';

/** Slot 0 marks a color the person chose, which has no dark value. */
export const CUSTOM_SLOT = 0;
/** The first pen slot (Ink). The seven pens take slots 1 to 7. */
export const FIRST_PEN_SLOT = 1;
/** The first highlighter slot (Honey). The five highlighters take slots 32 to 36. */
export const FIRST_HIGHLIGHTER_SLOT = 32;

export type PaletteKind = 'pen' | 'highlighter';

export interface PaletteEntry {
  readonly slot: number;
  readonly name: string;
  readonly kind: PaletteKind;
  readonly light: Rgba;
  readonly dark: Rgba;
}

/** Reads `#RRGGBB` or `#RRGGBBAA`. Returns null for anything else, so a damaged color never throws. */
export function parseHex(hex: string): Rgba | null {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!match) return null;
  const rgb = parseInt(match[1], 16);
  const alpha = match[2] === undefined ? 255 : parseInt(match[2], 16);
  return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha];
}

function entries(kind: PaletteKind, first: number, list: readonly { name: string; light: string; dark: string }[]) {
  return list.map((item, i): PaletteEntry => {
    const light = parseHex(item.light);
    const dark = parseHex(item.dark);
    if (!light || !dark) throw new Error(`brand/tokens.json has a bad color for ${item.name}`);
    return { slot: first + i, name: item.name, kind, light, dark };
  });
}

/** Every brand color, pens first, in slot order. */
export const PALETTE: readonly PaletteEntry[] = [
  ...entries('pen', FIRST_PEN_SLOT, tokens.ink.pens),
  ...entries('highlighter', FIRST_HIGHLIGHTER_SLOT, tokens.ink.highlighters),
];

export const PENS: readonly PaletteEntry[] = PALETTE.filter((entry) => entry.kind === 'pen');
export const HIGHLIGHTERS: readonly PaletteEntry[] = PALETTE.filter((entry) => entry.kind === 'highlighter');

const bySlot = new Map(PALETTE.map((entry) => [entry.slot, entry]));
const byName = new Map(PALETTE.map((entry) => [entry.name.toLowerCase(), entry]));

/** The brand color in a slot, or undefined for the custom slot and for slots a newer version added. */
export function paletteEntry(slot: number): PaletteEntry | undefined {
  return bySlot.get(slot);
}

export function paletteByName(name: string): PaletteEntry | undefined {
  return byName.get(name.toLowerCase());
}

/** The color to draw: the slot's dark value in the dark theme, and the stored color everywhere else. */
export function resolveColor(style: { slot: number; color: Rgba }, scheme: ColorScheme): Rgba {
  if (scheme === 'light') return style.color;
  return bySlot.get(style.slot)?.dark ?? style.color;
}

/** A CSS color for a canvas fill or an SVG attribute. Fully opaque colors use the short hexadecimal form. */
export function toCss([r, g, b, a]: Rgba): string {
  // checks-disable-next-line brand-consistency: this prints a stroke's stored color, which is not a brand token
  if (a === 255) return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  // checks-disable-next-line brand-consistency: same here, the color comes from the stroke
  return `rgb(${r} ${g} ${b} / ${Math.round((a / 255) * 1000) / 1000})`;
}

/** The alpha as a fraction, which the highlighter mask applies once for the whole stroke. */
export function alphaOf(color: Rgba): number {
  return color[3] / 255;
}

/** The pen slot a recolor menu picks for each kind of tool: highlighters take highlighter colors only. */
export function slotsForTool(tool: 'highlighter' | string): readonly PaletteEntry[] {
  return tool === 'highlighter' ? HIGHLIGHTERS : PENS;
}
