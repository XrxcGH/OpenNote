// Pictures the tools draw: line plots and diagrams, built as SVG text from numbers alone. In the window they use
// the theme's tokens, so they follow light, dark, and contrast themes; put on a page they use the light theme's
// values, since a picture keeps its colors wherever it goes.
import { tokens } from '../../../../theme/tokens';
import { numberText } from './format';
import { toShown, unitOf, type Kind, type System } from './units';

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

/** What a drawing needs from the window: the unit system, the palette, and words for its labels. */
export interface DrawContext {
  readonly system: System;
  readonly palette: Palette;
  readonly say: (key: string) => string;
}

export interface PlotSeries {
  /** The series' name, under the tool's plot strings. */
  readonly id: string;
  /** Points in base SI. A NaN y breaks the line. */
  readonly points: readonly (readonly [number, number])[];
  readonly dashed?: boolean;
}

export interface PlotSpec {
  readonly x: { readonly label: string; readonly kind: Kind };
  readonly y: { readonly label: string; readonly kind: Kind };
  readonly series: readonly PlotSeries[];
  readonly marks?: readonly { readonly x: number; readonly y: number; readonly id: string }[];
  /** Draw an axis on a logarithmic scale (its values must be above zero). */
  readonly xLog?: boolean;
  readonly yLog?: boolean;
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

/** Round numbers for a logarithmic axis: each power of ten, and 2 and 5 times it when there are few decades. */
export function logTicks(lo: number, hi: number): number[] {
  if (!(lo > 0) || !(hi > lo)) return [lo];
  const first = Math.floor(Math.log10(lo));
  const last = Math.ceil(Math.log10(hi));
  const multipliers = last - first <= 2 ? [1, 2, 5] : [1];
  const out: number[] = [];
  for (let k = first; k <= last; k++)
    for (const m of multipliers) {
      const v = m * 10 ** k;
      if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) out.push(v);
    }
  return out;
}

export const W = 480;
export const H = 300;
const M = { left: 64, right: 16, top: 16, bottom: 44 };

function range(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < 1e-12 * (Math.abs(hi) + 1)) {
    lo -= Math.abs(lo) * 0.1 + 1;
    hi += Math.abs(hi) * 0.1 + 1;
  }
  return [lo, hi];
}

/** A line plot as SVG text, in the chosen units, with axes, ticks, a legend, and labeled marks. */
export function plotSvg(spec: PlotSpec, ctx: DrawContext, prefix: string): string {
  const { palette: p, system } = ctx;
  const sx = (v: number) => toShown(v, spec.x.kind, system);
  const sy = (v: number) => toShown(v, spec.y.kind, system);
  const xs = spec.series.flatMap((s) => s.points.map(([x]) => sx(x))).concat((spec.marks ?? []).map((m) => sx(m.x)));
  const ys = spec.series.flatMap((s) => s.points.map(([, y]) => sy(y))).concat((spec.marks ?? []).map((m) => sy(m.y)));
  const [x0, x1] = range(xs);
  const [y0raw, y1raw] = range(ys);
  const pad = spec.yLog ? 0 : (y1raw - y0raw) * 0.08;
  const [y0, y1] = [y0raw - pad, y1raw + pad];
  const fx = spec.xLog ? Math.log10 : (v: number) => v;
  const fy = spec.yLog ? Math.log10 : (v: number) => v;
  const px = (v: number) => M.left + ((fx(v) - fx(x0)) / (fx(x1) - fx(x0))) * (W - M.left - M.right);
  const py = (v: number) => H - M.bottom - ((fy(v) - fy(y0)) / (fy(y1) - fy(y0))) * (H - M.top - M.bottom);
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${p.surface}"/>`];
  for (const t of spec.xLog ? logTicks(x0, x1) : ticks(x0, x1)) {
    parts.push(`<line x1="${px(t)}" y1="${M.top}" x2="${px(t)}" y2="${H - M.bottom}" stroke="${p.grid}"/>`);
    parts.push(text(px(t), H - M.bottom + 16, numberText(t, 4), p.muted, 'middle'));
  }
  for (const t of spec.yLog ? logTicks(y0, y1) : ticks(y0, y1)) {
    parts.push(`<line x1="${M.left}" y1="${py(t)}" x2="${W - M.right}" y2="${py(t)}" stroke="${p.grid}"/>`);
    parts.push(text(M.left - 6, py(t) + 4, numberText(t, 4), p.muted, 'end'));
  }
  if (!spec.yLog && y0 < 0 && y1 > 0) parts.push(axisLine(M.left, py(0), W - M.right, py(0), p.muted));
  spec.series.forEach((series, i) => parts.push(path(series, i, { sx, sy, px, py, p })));
  for (const mark of spec.marks ?? []) {
    const [x, y] = [px(sx(mark.x)), py(sy(mark.y))];
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${p.text}"/>`);
    parts.push(text(x + 6, y - 6, ctx.say(`${prefix}.plot.${mark.id}`), p.text, 'start'));
  }
  const withUnit = (label: string, kind: Kind) => {
    const unit = unitOf(kind, system);
    return unit === '' ? label : `${label} (${unit})`;
  };
  const xLabel = withUnit(ctx.say(`${prefix}.plot.${spec.x.label}`), spec.x.kind);
  const yLabel = withUnit(ctx.say(`${prefix}.plot.${spec.y.label}`), spec.y.kind);
  parts.push(text((M.left + W - M.right) / 2, H - 8, xLabel, p.text, 'middle'));
  parts.push(
    `<text x="14" y="${(M.top + H - M.bottom) / 2}" fill="${p.text}" font-size="12" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${(M.top + H - M.bottom) / 2})">${escapeXml(yLabel)}</text>`,
  );
  spec.series.forEach((series, i) => {
    const y = M.top + 14 + i * 16;
    const color = p.pens[i % p.pens.length];
    const dash = series.dashed ? ' stroke-dasharray="6 4"' : '';
    parts.push(
      `<line x1="${W - 150}" y1="${y - 4}" x2="${W - 130}" y2="${y - 4}" stroke="${color}" stroke-width="2"${dash}/>`,
    );
    parts.push(text(W - 126, y, ctx.say(`${prefix}.plot.${series.id}`), p.text, 'start'));
  });
  return svg(parts, p);
}

interface Scale {
  sx(v: number): number;
  sy(v: number): number;
  px(v: number): number;
  py(v: number): number;
  p: Palette;
}

function path(series: PlotSeries, i: number, s: Scale): string {
  let d = '';
  let pen = false;
  for (const [x, y] of series.points) {
    const Y = s.sy(y);
    if (!Number.isFinite(Y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${s.px(s.sx(x)).toFixed(2)} ${s.py(Y).toFixed(2)} `;
    pen = true;
  }
  const dash = series.dashed ? ' stroke-dasharray="6 4"' : '';
  return `<path d="${d.trim()}" fill="none" stroke="${s.p.pens[i % s.p.pens.length]}" stroke-width="2"${dash}/>`;
}

export const text = (x: number, y: number, words: string, fill: string, anchor: 'start' | 'middle' | 'end') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="12" text-anchor="${anchor}">` +
  `${escapeXml(words)}</text>`;

export const axisLine = (x1: number, y1: number, x2: number, y2: number, stroke: string, dashed = false) =>
  `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}"` +
  `${dashed ? ' stroke-dasharray="4 3"' : ''}/>`;

/** Wraps drawn parts in an SVG element of the standard size. */
export const svg = (parts: readonly string[], palette: Palette, width = W, height = H): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
  `font-family="${escapeXml(palette.font)}">${parts.join('')}</svg>`;
