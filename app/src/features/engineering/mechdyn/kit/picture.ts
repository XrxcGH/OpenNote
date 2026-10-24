// Plots the tools draw, built as SVG text from numbers alone. In the window they use the theme's tokens, so they
// follow light, dark, and contrast themes; put on a page they use the light theme's values, since a picture keeps
// its colors wherever it goes. Plots are in SI units, as the engines give them; the axis labels say which.
import { tokens } from '../../../../theme/tokens';
import type { Plot } from '../types';
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

/** Words for a plot's axes and series. */
export interface PlotWords {
  readonly x: string;
  readonly y: string;
  readonly series: readonly string[];
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

const W = 480;
const PLOT_H = 300;
const M = { left: 64, right: 16, top: 16, bottom: 44 };
const MAX_POINTS = 800;

function range(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) return [0, 1];
  if (hi - lo < 1e-12 * (Math.abs(hi) + 1)) {
    lo -= Math.abs(lo) * 0.1 + 1;
    hi += Math.abs(hi) * 0.1 + 1;
  }
  return [lo, hi];
}

/** At most MAX_POINTS of a series, evenly picked, always with its ends. */
function thin(points: readonly [number, number][]): readonly [number, number][] {
  if (points.length <= MAX_POINTS) return points;
  const stride = points.length / MAX_POINTS;
  const out: [number, number][] = [];
  for (let i = 0; i < MAX_POINTS; i += 1) out.push(points[Math.floor(i * stride)]);
  out.push(points[points.length - 1]);
  return out;
}

const text = (x: number, y: number, words: string, fill: string, anchor: 'start' | 'middle' | 'end') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${fill}" font-size="12" text-anchor="${anchor}">` +
  `${escapeXml(words)}</text>`;

/** A line plot as SVG text, with axes, ticks, and a legend under it. */
export function plotSvg(plot: Plot, words: PlotWords, p: Palette): string {
  const series = plot.series.map((one) => thin(one.points));
  const single = series.map((points) => points.length === 1);
  let [x0, x1] = range(series.flatMap((points) => points.map(([x]) => x)));
  let [y0, y1] = range(series.flatMap((points) => points.map(([, y]) => y)));
  const innerW = W - M.left - M.right;
  const innerH = PLOT_H - M.top - M.bottom;
  if (plot.equal) {
    const scale = Math.max((x1 - x0) / innerW, (y1 - y0) / innerH) * 1.08;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    [x0, x1] = [cx - (scale * innerW) / 2, cx + (scale * innerW) / 2];
    [y0, y1] = [cy - (scale * innerH) / 2, cy + (scale * innerH) / 2];
  } else {
    const pad = (y1 - y0) * 0.08;
    [y0, y1] = [y0 - pad, y1 + pad];
  }
  const px = (v: number) => M.left + ((v - x0) / (x1 - x0)) * innerW;
  const py = (v: number) => PLOT_H - M.bottom - ((v - y0) / (y1 - y0)) * innerH;
  const legendRows = Math.ceil(plot.series.length / 2);
  const height = PLOT_H + legendRows * 18 + 4;
  const parts: string[] = [`<rect width="${W}" height="${height}" fill="${p.surface}"/>`];
  for (const t of ticks(x0, x1)) {
    parts.push(`<line x1="${px(t)}" y1="${M.top}" x2="${px(t)}" y2="${PLOT_H - M.bottom}" stroke="${p.grid}"/>`);
    parts.push(text(px(t), PLOT_H - M.bottom + 16, numberText(t, 4), p.muted, 'middle'));
  }
  for (const t of ticks(y0, y1)) {
    parts.push(`<line x1="${M.left}" y1="${py(t)}" x2="${W - M.right}" y2="${py(t)}" stroke="${p.grid}"/>`);
    parts.push(text(M.left - 6, py(t) + 4, numberText(t, 4), p.muted, 'end'));
  }
  if (y0 < 0 && y1 > 0)
    parts.push(`<line x1="${M.left}" y1="${py(0)}" x2="${W - M.right}" y2="${py(0)}" stroke="${p.muted}"/>`);
  series.forEach((points, i) => {
    const color = p.pens[i % p.pens.length];
    if (single[i]) {
      const [x, y] = points[0];
      parts.push(`<circle cx="${px(x).toFixed(2)}" cy="${py(y).toFixed(2)}" r="4" fill="${color}"/>`);
      return;
    }
    let d = '';
    let down = false;
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        down = false;
        continue;
      }
      d += `${down ? 'L' : 'M'}${px(x).toFixed(2)} ${py(y).toFixed(2)} `;
      down = true;
    }
    const dash = i >= p.pens.length ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<path d="${d.trim()}" fill="none" stroke="${color}" stroke-width="2"${dash}/>`);
  });
  parts.push(text((M.left + W - M.right) / 2, PLOT_H - 8, words.x, p.text, 'middle'));
  const mid = (M.top + PLOT_H - M.bottom) / 2;
  parts.push(
    `<text x="14" y="${mid}" fill="${p.text}" font-size="12" text-anchor="middle" ` +
      `transform="rotate(-90 14 ${mid})">${escapeXml(words.y)}</text>`,
  );
  words.series.forEach((name, i) => {
    const x = M.left + (i % 2) * 200;
    const y = PLOT_H + 14 + Math.floor(i / 2) * 18;
    const color = p.pens[i % p.pens.length];
    parts.push(`<line x1="${x}" y1="${y - 4}" x2="${x + 20}" y2="${y - 4}" stroke="${color}" stroke-width="2"/>`);
    parts.push(text(x + 26, y, name, p.text, 'start'));
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" ` +
    `font-family="${escapeXml(p.font)}">${parts.join('')}</svg>`
  );
}
