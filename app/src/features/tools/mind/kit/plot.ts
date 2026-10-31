// Plots the tools draw: their description as data, the palettes, and the parts every drawing shares. In the
// window a picture uses the theme's tokens, so it follows light, dark, and contrast themes. Put on a page it uses the
// light theme's values, since a picture keeps its colors wherever it goes.
import { tokens } from '../../../../theme/tokens';

export interface Palette {
  readonly text: string;
  readonly muted: string;
  readonly grid: string;
  readonly surface: string;
  readonly font: string;
  readonly pens: readonly string[];
}

const pen = (name: string) =>
  tokens.ink.pens.find((one) => one.name === name)?.light ?? tokens.color.light.text.primary;

export const SCREEN: Palette = {
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  grid: 'var(--color-border-subtle)',
  surface: 'var(--color-surface-page)',
  font: 'var(--font-ui)',
  pens: ['var(--ink-indigo)', 'var(--ink-brick)', 'var(--ink-fern)', 'var(--ink-plum)', 'var(--ink-amber)'],
};

export const PAGE: Palette = {
  text: tokens.color.light.text.primary,
  muted: tokens.color.light.text.secondary,
  grid: tokens.color.light.border.subtle,
  surface: tokens.color.light.surface.page,
  font: tokens.font.ui,
  pens: ['Indigo', 'Brick', 'Fern', 'Plum', 'Amber'].map(pen),
};

/** Turns a plot key, with values for its placeholders, into words. */
export type Label = (id: string, vars?: Readonly<Record<string, string | number>>) => string;

export type SeriesKind = 'line' | 'points' | 'steps' | 'bars';

export interface PlotSeries {
  /** The series' name: a key under the tool's plot strings, unless `label` gives the text. */
  readonly id: string;
  readonly label?: string;
  /** Values for the series' name, such as its item number. */
  readonly vars?: Readonly<Record<string, string | number>>;
  /** A NaN y breaks a line. */
  readonly points: readonly (readonly [number, number])[];
  readonly kind?: SeriesKind;
  readonly dashed?: boolean;
  /** Half-widths of error bars, one for each point. */
  readonly errors?: readonly number[];
  /** Which pen and marker to use; by default the series' place in the list. */
  readonly pen?: number;
}

export interface PlotSpec {
  /** Axis names: keys under the tool's plot strings. */
  readonly x: { readonly id: string; readonly min?: number; readonly max?: number };
  readonly y: { readonly id: string; readonly min?: number; readonly max?: number };
  readonly series: readonly PlotSeries[];
  /** Dashed upright lines, such as phase changes, with an optional label at the top. */
  readonly marks?: readonly { readonly x: number; readonly label?: string }[];
  /** Draws the line y = x, as on an ROC plot. */
  readonly diagonal?: boolean;
  readonly square?: boolean;
}

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Round numbers for an axis from lo to hi: about five of them. */
export function ticks(lo: number, hi: number): number[] {
  if (!(hi > lo)) return [lo];
  const rough = (hi - lo) / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const size = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let v = Math.ceil(lo / size - 1e-9) * size; v <= hi + size * 1e-9; v += size)
    out.push(Math.abs(v) < size * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return out;
}

export function extent(values: number[], min?: number, max?: number): [number, number] {
  const finite = values.filter(Number.isFinite);
  let lo = min ?? (finite.length ? Math.min(...finite) : 0);
  let hi = max ?? (finite.length ? Math.max(...finite) : 1);
  if (hi === lo) {
    lo -= lo === 0 ? 1 : Math.abs(lo) * 0.1;
    hi += hi === 0 ? 1 : Math.abs(hi) * 0.1;
  }
  const pad = (hi - lo) * 0.04;
  return [min ?? lo - pad, max ?? hi + pad];
}

export const DASHES = ['', '6 4', '2 3', '8 3 2 3', '1 2'];

export type Attrs = Readonly<Record<string, string | number>>;

const attr = (v: string | number) => (typeof v === 'number' ? String(Number(v.toFixed(1))) : escapeXml(v));

/** An SVG element as text. Numbers are rounded to tenths; attribute text is escaped, inner text is not. */
export function el(name: string, attrs: Attrs, inner?: string): string {
  const list = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${attr(value)}"`)
    .join('');
  return inner === undefined ? `<${name}${list}/>` : `<${name}${list}>${inner}</${name}>`;
}

/** A marker of one of 5 shapes, so series differ by shape as well as color. */
export function marker(shape: number, x: number, y: number, color: string): string {
  const s = 3.5;
  const at = (dx: number, dy: number) => `${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}`;
  switch (shape % 5) {
    case 0:
      return el('circle', { cx: x, cy: y, r: s, fill: color });
    case 1:
      return el('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, fill: color });
    case 2:
      return el('polygon', { points: `${at(0, -s - 1)} ${at(s + 1, s)} ${at(-s - 1, s)}`, fill: color });
    case 3:
      return el('polygon', {
        points: `${at(0, -s - 1)} ${at(s + 1, 0)} ${at(0, s + 1)} ${at(-s - 1, 0)}`,
        fill: color,
      });
    default:
      return el('path', {
        d: `M${at(-s, -s)}L${at(s, s)}M${at(-s, s)}L${at(s, -s)}`,
        stroke: color,
        'stroke-width': 2,
      });
  }
}
