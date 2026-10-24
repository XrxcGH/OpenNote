// The geometry of a life-systems plot: scaled paths, horizontal bars (for population pyramids), ticks on round
// numbers, decades on a log axis or category names, and a legend. The window draws it with theme colors (Plot.tsx),
// and plotSvg writes the same picture with fixed colors for the page. Each series has its own dash pattern or fill,
// so color is never the only way to tell them apart.
import { tokens } from '../../../../theme/tokens';
import type { Axis, PlotData } from '../types';
import { formatNumber } from './text';

export const WIDTH = 360;
export const HEIGHT = 220;
const MARGIN = { left: 56, right: 12, top: 12, bottom: 40 };
export const DASHES = ['', '6 3', '2 3', '8 3 2 3', '1 2'];
/** Light-theme accents for the picture written to the page (tokens.css). */
const LIGHT = tokens.color.light;
const PRINT_COLORS = [
  LIGHT.accent.primary,
  LIGHT.accent.dusk,
  LIGHT.accent.candle,
  LIGHT.accent.night,
  LIGHT.text.secondary,
];

export type PathKind = 'line' | 'points' | 'bars' | 'outline';

export interface PlotPath {
  d: string;
  dash: string;
  index: number;
  kind: PathKind;
  markers: [number, number][];
  rects: { x: number; y: number; w: number; h: number }[];
}

export interface PlotModel {
  paths: PlotPath[];
  xTicks: { at: number; label: string }[];
  yTicks: { at: number; label: string }[];
  frame: { left: number; right: number; top: number; bottom: number };
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power;
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

function range(values: number[], axis: Axis, bars: boolean): [number, number] {
  if (axis.categories) return [-0.5, axis.categories.length - 0.5];
  const log = !!axis.log;
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  let low = axis.min ?? Math.min(...usable, ...(bars ? [0] : []));
  let high = axis.max ?? Math.max(...usable, ...(bars ? [0] : []));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return log ? [0, 1] : [0, 1];
  if (bars && low < 0 && high > 0) {
    const edge = Math.max(-low, high);
    low = -edge;
    high = edge;
  }
  if (log) {
    low = Math.log10(low);
    high = Math.log10(high);
  }
  if (low === high) {
    low -= 0.5;
    high += 0.5;
  }
  return [low, high];
}

function axisTicks(axis: Axis, low: number, high: number, scale: (v: number) => number) {
  if (axis.categories) {
    const every = Math.max(1, Math.ceil(axis.categories.length / 12));
    return axis.categories
      .map((label, i) => ({ at: scale(i), label, i }))
      .filter((tick) => tick.i % every === 0)
      .map(({ at, label }) => ({ at, label }));
  }
  const values = axis.log
    ? niceTicks(Math.ceil(low), Math.floor(high), 5).filter(Number.isInteger)
    : niceTicks(low, high);
  return values.map((v) => {
    const shown = axis.log ? 10 ** v : v;
    return { at: scale(v), label: formatNumber(axis.absolute ? Math.abs(shown) : shown, 4) };
  });
}

const kindOf = (style: PlotData['series'][number]['style']): PathKind =>
  style === 'points' || style === 'bars' || style === 'outline' ? style : 'line';

/** Scales a plot into the frame. Points that are not finite (or not positive on a log axis) break the line. */
export function plotModel(plot: PlotData): PlotModel {
  const bars = plot.series.some((s) => s.style === 'bars' || s.style === 'outline');
  const xs = plot.series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = plot.series.flatMap((s) => s.points.map((p) => p[1]));
  const [x0, x1] = range(xs, plot.x, bars);
  const [y0, y1] = range(ys, plot.y, false);
  const frame = { left: MARGIN.left, right: WIDTH - MARGIN.right, top: MARGIN.top, bottom: HEIGHT - MARGIN.bottom };
  const sx = (x: number) => frame.left + ((x - x0) / (x1 - x0)) * (frame.right - frame.left);
  const sy = (y: number) => frame.bottom - ((y - y0) / (y1 - y0)) * (frame.bottom - frame.top);
  const tx = (x: number) => (plot.x.log ? Math.log10(x) : x);
  const ty = (y: number) => (plot.y.log ? Math.log10(y) : y);
  const band = (0.8 * (frame.bottom - frame.top)) / Math.max(1, y1 - y0);
  const paths = plot.series.map((series, index): PlotPath => {
    const kind = kindOf(series.style);
    let d = '';
    let pen = false;
    const markers: [number, number][] = [];
    const rects: PlotPath['rects'] = [];
    for (const [x, y] of series.points) {
      const px = tx(x);
      const py = ty(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        pen = false;
        continue;
      }
      const X = Math.min(Math.max(sx(px), frame.left - 1), frame.right + 1);
      const Y = Math.min(Math.max(sy(py), frame.top - 1), frame.bottom + 1);
      if (kind === 'bars' || kind === 'outline') {
        const zero = sx(0);
        rects.push({ x: Math.min(zero, X), y: Y - band / 2, w: Math.abs(X - zero), h: band });
        continue;
      }
      markers.push([X, Y]);
      d += `${pen ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`;
      pen = true;
    }
    const dash = series.style === 'dashed' || kind === 'outline' ? '6 3' : DASHES[index % DASHES.length];
    return { d, dash, index, kind, markers, rects };
  });
  return {
    paths,
    xTicks: axisTicks(plot.x, x0, x1, sx),
    yTicks: axisTicks(plot.y, y0, y1, sy),
    frame,
  };
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svgSeries(path: PlotPath, color: string): string[] {
  if (path.kind === 'points')
    return path.markers.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"/>`);
  if (path.kind === 'bars' || path.kind === 'outline') {
    const paint =
      path.kind === 'bars'
        ? `fill="${color}" fill-opacity="0.75"`
        : `fill="none" stroke="${color}" stroke-width="1.4" stroke-dasharray="${path.dash}"`;
    return path.rects.map(
      (r) =>
        `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" ${paint}/>`,
    );
  }
  return [`<path d="${path.d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="${path.dash}"/>`];
}

/** The plot as a standalone SVG with fixed light colors, for the picture inserted into a page. */
export function plotSvg(model: PlotModel, labels: { x: string; y: string; names: string[]; title: string }): string {
  const { frame } = model;
  const legendY = HEIGHT + 8;
  const height = HEIGHT + 16 + labels.names.length * 16;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * 2}" height="${height * 2}" viewBox="0 0 ${WIDTH} ${height}">`,
    `<title>${escape(labels.title)}</title>`,
    `<rect width="${WIDTH}" height="${height}" fill="${LIGHT.surface.page}"/>`,
    `<g font-family="Segoe UI, sans-serif" font-size="10" fill="${LIGHT.text.primary}">`,
    `<path d="M${frame.left} ${frame.top}V${frame.bottom}H${frame.right}" fill="none" stroke="${LIGHT.border.control}"/>`,
  ];
  for (const tick of model.xTicks)
    parts.push(
      `<text x="${tick.at.toFixed(1)}" y="${frame.bottom + 14}" text-anchor="middle">${escape(tick.label)}</text>`,
    );
  for (const tick of model.yTicks)
    parts.push(
      `<text x="${frame.left - 4}" y="${(tick.at + 3).toFixed(1)}" text-anchor="end">${escape(tick.label)}</text>`,
    );
  parts.push(
    `<text x="${(frame.left + frame.right) / 2}" y="${HEIGHT - 6}" text-anchor="middle">${escape(labels.x)}</text>`,
    `<text transform="translate(12 ${(frame.top + frame.bottom) / 2}) rotate(-90)" text-anchor="middle">${escape(labels.y)}</text>`,
  );
  model.paths.forEach((path, i) => {
    const color = PRINT_COLORS[i % PRINT_COLORS.length];
    parts.push(...svgSeries(path, color));
    const y = legendY + i * 16;
    parts.push(
      `<path d="M${frame.left} ${y}h24" stroke="${color}" stroke-width="2" stroke-dasharray="${path.dash}"/>`,
      `<text x="${frame.left + 30}" y="${y + 3}">${escape(labels.names[i] ?? '')}</text>`,
    );
  });
  parts.push('</g></svg>');
  return parts.join('');
}
