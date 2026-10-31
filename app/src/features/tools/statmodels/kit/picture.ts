// Pictures the tools draw: scatter, line and step plots, and diagrams, built as SVG text from numbers alone. In the
// window they use the theme's tokens, so they follow light, dark, and contrast themes; put on a page they use the
// light theme's values, since a picture keeps its colors wherever it goes. Each series has its own marker shape as
// well as its own color, so color is never the only way to tell them apart.
import { tokens } from '../../../../theme/tokens';
import { numberText } from './format';

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

/** What a drawing needs from the window: the palette, and words for its labels. */
export interface DrawContext {
  readonly palette: Palette;
  readonly say: (key: string) => string;
  /** The tool's strings prefix, such as kitStatModels.glm. */
  readonly prefix: string;
}

export type SeriesStyle = 'line' | 'points' | 'step' | 'dashed';

export interface PlotSeries {
  /** The series' name under the tool's plot strings, or `name` as typed (such as a group in the data). */
  readonly id: string;
  readonly name?: string;
  /** A NaN y breaks the line. */
  readonly points: readonly (readonly [number, number])[];
  readonly style?: SeriesStyle;
  /** Which pen and marker; the series' place in the list when left out. */
  readonly pen?: number;
  /** False keeps the series out of the legend, such as censoring marks drawn on a curve. */
  readonly legend?: false;
}

export interface PlotSpec {
  readonly x: { readonly label: string };
  readonly y: { readonly label: string };
  readonly series: readonly PlotSeries[];
  /** Reference lines across the plot, such as y = 0. */
  readonly hlines?: readonly number[];
  readonly vlines?: readonly number[];
  /** Points labeled with text, such as case numbers. */
  readonly marks?: readonly { readonly x: number; readonly y: number; readonly text: string }[];
  /** Shaded bands, such as confidence intervals: [x, low, high]. */
  readonly bands?: readonly { readonly points: readonly (readonly [number, number, number])[]; readonly pen: number }[];
  /** Fixed axis ranges, when the data alone would mislead (such as 0 to 1 for a probability). */
  readonly xRange?: readonly [number, number];
  readonly yRange?: readonly [number, number];
  readonly legend?: boolean;
}

export const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Round numbers for an axis from lo to hi: about five of them. */
export function ticks(lo: number, hi: number): number[] {
  if (!(hi > lo)) return [lo];
  const rough = (hi - lo) / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export const W = 480;
export const H = 320;
export const MARGIN = { left: 64, right: 16, top: 16, bottom: 44 };

export function range(values: readonly number[], pad = 0): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-12 * (Math.abs(hi) + 1)) {
    lo -= Math.abs(lo) * 0.1 + 1;
    hi += Math.abs(hi) * 0.1 + 1;
  }
  const extra = (hi - lo) * pad;
  return [lo - extra, hi + extra];
}

export interface Frame {
  readonly px: (v: number) => number;
  readonly py: (v: number) => number;
  readonly parts: string[];
}

/** Axes, grid, tick labels, and axis titles for the given ranges, with scales from data to the picture. */
export function frame(
  xr: readonly [number, number],
  yr: readonly [number, number],
  labels: { x: string; y: string },
  p: Palette,
): Frame {
  const [x0, x1] = xr;
  const [y0, y1] = yr;
  const px = (v: number) => MARGIN.left + ((v - x0) / (x1 - x0)) * (W - MARGIN.left - MARGIN.right);
  const py = (v: number) => H - MARGIN.bottom - ((v - y0) / (y1 - y0)) * (H - MARGIN.top - MARGIN.bottom);
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  for (const t of ticks(x0, x1)) {
    parts.push(line(px(t), MARGIN.top, px(t), H - MARGIN.bottom, p.grid));
    parts.push(text(px(t), H - MARGIN.bottom + 16, numberText(t, 4), p.muted, 'middle'));
  }
  for (const t of ticks(y0, y1)) {
    parts.push(line(MARGIN.left, py(t), W - MARGIN.right, py(t), p.grid));
    parts.push(text(MARGIN.left - 6, py(t) + 4, numberText(t, 4), p.muted, 'end'));
  }
  const midY = (MARGIN.top + H - MARGIN.bottom) / 2;
  parts.push(text((MARGIN.left + W - MARGIN.right) / 2, H - 8, labels.x, p.text, 'middle'));
  parts.push(
    `<text x="14" y="${midY}" fill="${p.text}" font-size="12" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${midY})">${escapeXml(labels.y)}</text>`,
  );
  return { px, py, parts };
}

const label = (ctx: DrawContext, id: string) => ctx.say(`${ctx.prefix}.plot.${id}`);

/** A plot as SVG text, with axes, ticks, an optional legend, bands, reference lines, and labeled marks. */
export function plotSvg(spec: PlotSpec, ctx: DrawContext): string {
  const p = ctx.palette;
  const xs = spec.series.flatMap((s) => s.points.map(([x]) => x)).concat(spec.vlines ?? []);
  const ys = spec.series
    .flatMap((s) => s.points.map(([, y]) => y))
    .concat((spec.bands ?? []).flatMap((b) => b.points.flatMap(([, lo, hi]) => [lo, hi])))
    .concat(spec.hlines ?? []);
  const f = frame(
    spec.xRange ?? range(xs, 0.02),
    spec.yRange ?? range(ys, 0.06),
    {
      x: label(ctx, spec.x.label),
      y: label(ctx, spec.y.label),
    },
    p,
  );
  const parts = f.parts;
  for (const band of spec.bands ?? []) parts.push(bandPath(band.points, f, p.pens[band.pen % p.pens.length]));
  for (const y of spec.hlines ?? []) parts.push(line(MARGIN.left, f.py(y), W - MARGIN.right, f.py(y), p.muted, true));
  for (const x of spec.vlines ?? []) parts.push(line(f.px(x), MARGIN.top, f.px(x), H - MARGIN.bottom, p.muted, true));
  spec.series.forEach((series, i) => parts.push(seriesSvg(series, series.pen ?? i, f, p)));
  for (const mark of spec.marks ?? []) parts.push(text(f.px(mark.x) + 6, f.py(mark.y) - 6, mark.text, p.text, 'start'));
  if (spec.legend !== false && spec.series.filter((s) => s.legend !== false).length > 1)
    parts.push(...legend(spec.series, ctx));
  return svg(parts, p);
}

function legend(series: readonly PlotSeries[], ctx: DrawContext): string[] {
  const p = ctx.palette;
  const shown = series.map((s, i) => ({ s, index: s.pen ?? i })).filter(({ s }) => s.legend !== false);
  return shown.flatMap(({ s, index }, row) => {
    const y = MARGIN.top + 14 + row * 16;
    const color = p.pens[index % p.pens.length];
    const name = s.name ?? label(ctx, s.id);
    const sample =
      s.style === 'points'
        ? marker(W - 140, y - 4, index, color)
        : line(W - 150, y - 4, W - 130, y - 4, color, s.style === 'dashed', 2);
    return [sample, text(W - 126, y, name, p.text, 'start')];
  });
}

function bandPath(points: readonly (readonly [number, number, number])[], f: Frame, color: string): string {
  const ok = points.filter(([x, lo, hi]) => [x, lo, hi].every(Number.isFinite));
  if (ok.length < 2) return '';
  const top = ok.map(([x, , hi]) => `${f.px(x).toFixed(2)} ${f.py(hi).toFixed(2)}`);
  const bottom = [...ok].reverse().map(([x, lo]) => `${f.px(x).toFixed(2)} ${f.py(lo).toFixed(2)}`);
  return `<path d="M${top.join(' L')} L${bottom.join(' L')} Z" fill="${color}" fill-opacity="0.15" stroke="none"/>`;
}

function seriesSvg(series: PlotSeries, index: number, f: Frame, p: Palette): string {
  const color = p.pens[index % p.pens.length];
  if (series.style === 'points')
    return series.points
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      .map(([x, y]) => marker(f.px(x), f.py(y), index, color))
      .join('');
  let d = '';
  let down = false;
  let last: number | null = null;
  for (const [x, y] of series.points) {
    if (!Number.isFinite(y) || !Number.isFinite(x)) {
      down = false;
      continue;
    }
    const X = f.px(x).toFixed(2);
    const Y = f.py(y).toFixed(2);
    if (series.style === 'step' && down && last !== null) d += `L${X} ${last.toFixed(2)} `;
    d += `${down ? 'L' : 'M'}${X} ${Y} `;
    last = f.py(y);
    down = true;
  }
  const dash = series.style === 'dashed' ? ' stroke-dasharray="6 4"' : '';
  return `<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"${dash}/>`;
}

/** A marker whose shape follows the series: circle, square, triangle, diamond, then cross. */
export function marker(x: number, y: number, index: number, color: string): string {
  const r = 3.5;
  const at = (dx: number, dy: number) => `${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)}`;
  switch (index % 5) {
    case 0:
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${color}"/>`;
    case 1:
      return `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" fill="${color}"/>`;
    case 2:
      return `<path d="M${at(0, -r - 1)} L${at(r + 1, r)} L${at(-r - 1, r)} Z" fill="${color}"/>`;
    case 3:
      return `<path d="M${at(0, -r - 1)} L${at(r + 1, 0)} L${at(0, r + 1)} L${at(-r - 1, 0)} Z" fill="${color}"/>`;
    default:
      return `<path d="M${at(-r, -r)} L${at(r, r)} M${at(r, -r)} L${at(-r, r)}" stroke="${color}" stroke-width="2"/>`;
  }
}

export const text = (
  x: number,
  y: number,
  words: string,
  fill: string,
  anchor: 'start' | 'middle' | 'end',
  size = 12,
) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="${size}" text-anchor="${anchor}">` +
  `${escapeXml(words)}</text>`;

export const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, dashed = false, width = 1) =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}"` +
  `${width === 1 ? '' : ` stroke-width="${width}"`}${dashed ? ' stroke-dasharray="4 3"' : ''}/>`;

/** Wraps drawn parts in an SVG element of the standard size. */
export const svg = (parts: readonly string[], palette: Palette, width = W, height = H): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
  `font-family="${escapeXml(palette.font)}">${parts.join('')}</svg>`;
