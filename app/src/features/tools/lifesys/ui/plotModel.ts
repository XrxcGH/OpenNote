// The geometry of a life-systems plot: scaled paths, ticks on round numbers (or decades on a log axis), and a legend.
// The window draws it with theme colors (Plot.tsx), and plotSvg writes the same picture with fixed colors for the
// page. Each series has its own dash pattern too, so color is never the only way to tell them apart.
import { tokens } from '../../../../theme/tokens';
import type { PlotData } from '../types';
import { formatNumber } from './text';

export const WIDTH = 360;
export const HEIGHT = 220;
const MARGIN = { left: 52, right: 12, top: 12, bottom: 40 };
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

export interface PlotModel {
  paths: { d: string; dash: string; index: number; points: boolean; markers: [number, number][] }[];
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

function range(values: number[], log: boolean, min?: number, max?: number): [number, number] {
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  let low = min ?? Math.min(...usable);
  let high = max ?? Math.max(...usable);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return log ? [1, 10] : [0, 1];
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

/** Scales a plot into the frame. Points that are not finite (or not positive on a log axis) break the line. */
export function plotModel(plot: PlotData): PlotModel {
  const xs = plot.series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = plot.series.flatMap((s) => s.points.map((p) => p[1]));
  const [x0, x1] = range(xs, !!plot.x.log, plot.x.min, plot.x.max);
  const [y0, y1] = range(ys, !!plot.y.log, plot.y.min, plot.y.max);
  const frame = { left: MARGIN.left, right: WIDTH - MARGIN.right, top: MARGIN.top, bottom: HEIGHT - MARGIN.bottom };
  const sx = (x: number) => frame.left + ((x - x0) / (x1 - x0)) * (frame.right - frame.left);
  const sy = (y: number) => frame.bottom - ((y - y0) / (y1 - y0)) * (frame.bottom - frame.top);
  const tx = (x: number) => (plot.x.log ? Math.log10(x) : x);
  const ty = (y: number) => (plot.y.log ? Math.log10(y) : y);
  const paths = plot.series.map((series, index) => {
    let d = '';
    let pen = false;
    const markers: [number, number][] = [];
    for (const [x, y] of series.points) {
      const px = tx(x);
      const py = ty(y);
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        pen = false;
        continue;
      }
      const X = Math.min(Math.max(sx(px), frame.left - 1), frame.right + 1);
      const Y = Math.min(Math.max(sy(py), frame.top - 1), frame.bottom + 1);
      markers.push([X, Y]);
      d += `${pen ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`;
      pen = true;
    }
    return {
      d,
      dash: series.style === 'dashed' ? '6 3' : DASHES[index % DASHES.length],
      index,
      points: series.style === 'points',
      markers,
    };
  });
  const ticks = (low: number, high: number, log: boolean, scale: (v: number) => number) =>
    (log ? niceTicks(Math.ceil(low), Math.floor(high), 5).filter(Number.isInteger) : niceTicks(low, high)).map((v) => ({
      at: scale(v),
      label: formatNumber(log ? 10 ** v : v, 4),
    }));
  return {
    paths,
    xTicks: ticks(x0, x1, !!plot.x.log, sx),
    yTicks: ticks(y0, y1, !!plot.y.log, sy),
    frame,
  };
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
  );
  parts.push(
    `<text transform="translate(12 ${(frame.top + frame.bottom) / 2}) rotate(-90)" text-anchor="middle">${escape(labels.y)}</text>`,
  );
  model.paths.forEach((path, i) => {
    const color = PRINT_COLORS[i % PRINT_COLORS.length];
    if (path.points)
      for (const [x, y] of path.markers)
        parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}"/>`);
    else
      parts.push(
        `<path d="${path.d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="${path.dash}"/>`,
      );
    const y = legendY + i * 16;
    parts.push(`<path d="M${frame.left} ${y}h24" stroke="${color}" stroke-width="2" stroke-dasharray="${path.dash}"/>`);
    parts.push(`<text x="${frame.left + 30}" y="${y + 3}">${escape(labels.names[i] ?? '')}</text>`);
  });
  parts.push('</g></svg>');
  return parts.join('');
}
