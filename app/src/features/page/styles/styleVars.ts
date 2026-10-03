// Editable text styles (ARCHITECTURE.md section 17.3; owner: WP4). A notebook's styles become CSS custom properties
// on a root, such as --style-h2-size, and the page's CSS reads only those, with the type tokens as fallbacks.
// Changing a style re-renders nothing and moves nothing: it swaps variables. Markdown stays semantic.
import { tokens } from '../../../theme/tokens';
import './styleVars.module.css';

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

const kebab = (name: string) => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/** The custom property for a style's value: --style-h2-space-before. */
export function styleVar(style: StyleName, property: Property): string {
  return `--style-${style}-${kebab(property)}`;
}

const PENS = new Set(tokens.ink.pens.map((pen) => pen.name.toLowerCase()));

function cssValue(property: Property, value: string | number): string | null {
  switch (property) {
    case 'font':
      return STYLE_FONTS.includes(value as StyleFont) ? `"${value}"` : null;
    case 'color':
      if (PENS.has(String(value))) return `var(--ink-${value})`;
      return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : null;
    case 'lineHeight':
      return typeof value === 'number' ? String(clamp(value, STYLE_LIMITS.lineHeight)) : null;
    default: {
      if (typeof value !== 'number') return null;
      const clamped = clamp(Math.round(value), STYLE_LIMITS[property]);
      return property === 'weight' ? String(clamped) : `${clamped}px`;
    }
  }
}

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Sets the notebook's styles as custom properties on `root`, and marks each set property with a data attribute
 * that the page's CSS keys on. Properties the styles don't set are removed, so the tokens apply.
 */
export function applyNotebookStyles(root: HTMLElement, styles: NotebookStyles | undefined): void {
  for (const style of STYLE_NAMES) {
    for (const property of PROPERTIES) {
      const name = styleVar(style, property);
      const raw = styles?.[style]?.[property];
      const value = raw === undefined ? null : cssValue(property, raw);
      const flag = `data-${name.slice(2)}`;
      if (value === null) {
        root.style.removeProperty(name);
        root.removeAttribute(flag);
      } else {
        root.style.setProperty(name, value);
        root.setAttribute(flag, '');
      }
    }
  }
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
