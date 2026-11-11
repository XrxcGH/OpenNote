// The Text styles dialog's values (ARCHITECTURE.md section 17.3): the version 1 keys of the ten first styles, in
// page units, as the dialog shows them. The notebook keeps version 2 keys (ADR 0082); `dialogValues` and
// `fromDialog` convert between the two. cssVars.ts puts the styles on the page.
import { tokens } from '../../../theme/tokens';
import { patchStyle, readStyle } from './model';
import type { StyleFormat, StyleJson, StyleSheetJson } from './model';

export const STYLE_NAMES = ['normal', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title', 'quote', 'code'] as const;
export type StyleName = (typeof STYLE_NAMES)[number];

/** The bundled fonts and the Windows fallbacks BRAND.md names. The app never lists installed fonts. */
export const STYLE_FONTS = [
  'Atkinson Hyperlegible Next',
  'Literata',
  'Atkinson Hyperlegible Mono',
  'Segoe UI Variable',
  'Cambria',
  'Cascadia Code',
] as const;
export type StyleFont = (typeof STYLE_FONTS)[number];

export interface StyleValues {
  font?: StyleFont;
  /** Pixels, 10 to 72. */
  size?: number;
  /** 400 to 700. */
  weight?: number;
  /** A pen name or #rrggbb. */
  color?: string;
  /** Pixels, 0 to 64. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** A multiple of the size, 1.0 to 2.0. */
  lineHeight?: number;
}

/** A notebook's styles: only what differs from the defaults. */
export type NotebookStyles = Partial<Record<StyleName, StyleValues>>;

export const STYLE_LIMITS = {
  size: [10, 72],
  weight: [400, 700],
  spaceBefore: [0, 64],
  spaceAfter: [0, 64],
  lineHeight: [1, 2],
} as const;

const PROPERTIES = ['font', 'size', 'weight', 'color', 'spaceBefore', 'spaceAfter', 'lineHeight'] as const;
type Property = (typeof PROPERTIES)[number];

const isFont = (value: unknown): value is StyleFont => STYLE_FONTS.includes(value as StyleFont);
const round = (value: number, step: number) => Math.round(value / step) * step;
const toPx = (points: unknown) => (typeof points === 'number' ? Math.round((points * 4) / 3) : undefined);

/** A style's dialog values from what the notebook keeps. Values the dialog can't show are left out. */
export function dialogValuesOf(raw: StyleJson | undefined): StyleValues {
  const format = readStyle(raw);
  const values: StyleValues = {
    font: isFont(format.font) ? format.font : undefined,
    size: toPx(format.sizePt),
    weight: format.weight !== undefined && format.weight >= 400 && format.weight <= 700 ? format.weight : undefined,
    color: format.textColor?.startsWith('theme:') ? undefined : format.textColor,
    spaceBefore: toPx(format.before),
    spaceAfter: toPx(format.after),
    lineHeight: format.line?.rule === 'multiple' ? format.line.value : undefined,
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as StyleValues;
}

/** The dialog values of every style the dialog lists. */
export function dialogValues(sheet: StyleSheetJson): NotebookStyles {
  const out: NotebookStyles = {};
  for (const name of STYLE_NAMES) {
    const values = dialogValuesOf(sheet[name]);
    if (Object.keys(values).length > 0) out[name] = values;
  }
  return out;
}

/** The version 2 key and value of one dialog value. */
function v2(property: Property, value: string | number | undefined): [keyof StyleFormat, unknown] {
  const num = typeof value === 'number' ? value : undefined;
  switch (property) {
    case 'size':
      return ['sizePt', num === undefined ? undefined : round((num * 3) / 4, 0.5)];
    case 'color':
      return ['textColor', value];
    case 'spaceBefore':
      return ['before', num === undefined ? undefined : round((num * 3) / 4, 0.05)];
    case 'spaceAfter':
      return ['after', num === undefined ? undefined : round((num * 3) / 4, 0.05)];
    case 'lineHeight':
      return ['line', num === undefined ? undefined : { rule: 'multiple', value: round(num, 0.01) }];
    default:
      return [property, value];
  }
}

/**
 * The notebook's styles after the dialog. Each value the person changed is written as its version 2 key. Every other
 * key of the style, known or not, stays as it was.
 */
export function fromDialog(sheet: StyleSheetJson, before: NotebookStyles, after: NotebookStyles): StyleSheetJson {
  const next: Record<string, StyleJson> = { ...sheet };
  for (const name of STYLE_NAMES) {
    const patch: Record<string, unknown> = {};
    for (const property of PROPERTIES) {
      const value = after[name]?.[property];
      if (before[name]?.[property] === value) continue;
      const [key, converted] = v2(property, value === '' ? undefined : value);
      patch[key] = typeof converted === 'number' ? Math.round(converted * 100) / 100 : converted;
    }
    if (Object.keys(patch).length === 0) continue;
    const style = patchStyle(sheet[name], patch);
    if (Object.keys(style).length === 0) delete next[name];
    else next[name] = style;
  }
  return next;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG's contrast ratio between two #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The color a style or pen shows on each theme's page: pens have their own dark shade. */
function shades(color: string): { light: string; dark: string } | null {
  const pen = tokens.ink.pens.find((candidate) => candidate.name.toLowerCase() === color);
  if (pen) return { light: pen.light, dark: pen.dark };
  return /^#[0-9a-f]{6}$/i.test(color) ? { light: color, dark: color } : null;
}

/**
 * A custom color's contrast against the light and dark pages. Below 4.5:1 in either theme, it isn't ok, and the
 * styles dialog and the text color picker show a warning next to the field.
 */
export function contrastWarning(color: string): { light: number; dark: number; ok: boolean } {
  const shade = shades(color);
  if (!shade) return { light: 0, dark: 0, ok: false };
  const round = (ratio: number) => Math.round(ratio * 100) / 100;
  const light = round(contrastRatio(shade.light, tokens.color.light.surface.page));
  const dark = round(contrastRatio(shade.dark, tokens.color.dark.surface.page));
  return { light, dark, ok: light >= 4.5 && dark >= 4.5 };
}

/** The styles with one style's values replaced, dropping empty ones so only differences are stored. */
export function withStyle(styles: NotebookStyles, style: StyleName, values: StyleValues): NotebookStyles {
  const kept = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
  const next: NotebookStyles = { ...styles, [style]: kept };
  if (Object.keys(kept).length === 0) delete next[style];
  return next;
}
