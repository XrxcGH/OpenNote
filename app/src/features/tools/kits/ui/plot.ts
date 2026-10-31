// Plots for the kits as SVG text, so the same picture shows in the window and goes into the page. Axes are linear or
// logarithmic (base 10), with several series of lines or markers, shaded regions, notes, and reference lines. Equal
// axes keep one unit the same length on both, for polar, Nyquist, and root-locus plots. On screen the pens are the
// theme's ink colors; on paper they are fixed colors on the page color, so an inserted picture reads in any theme.
import type { Palette } from './palette';
import { paletteOf } from './palette';
import { el, px, svgDocument } from './svg';

export { escapeXml } from './svg';

export type Point = readonly [number, number];

export interface PlotAxis {
  label: string;
  log?: boolean;
  /** Names drawn as the ticks at 0, 1, 2, and so on, in place of numbers. */
  categories?: readonly string[];
  /** Fixed limits; otherwise the axis fits the data. */
  min?: number;
  max?: number;
}

export interface PlotSeries {
  name: string;
  points: readonly Point[];
  /** Lines (default), markers only, or both. A non-finite point breaks a line. */
  style?: 'line' | 'markers' | 'both';
  dashed?: boolean;
  /** Which pen, from 0; series take the pens in order by default. */
  pen?: number;
}

export interface PlotRegion {
  /** A band between x0 and x1, and between y0 and y1 when given (else the full height). */
  x0: number;
  x1: number;
  y0?: number;
  y1?: number;
  label?: string;
}

export interface PlotNote {
  at: Point;
  text: string;
  /** Draws a marker at the point as well. */
  marker?: boolean;
}

export interface PlotSpec {
  title: string;
  x: PlotAxis;
  y: PlotAxis;
  series: readonly PlotSeries[];
  regions?: readonly PlotRegion[];
  notes?: readonly PlotNote[];
  /** Reference lines, such as y = 0 or the −1 point's axis. */
  lines?: readonly ({ x: number } | { y: number })[];
  equalAxes?: boolean;
}

/** The visible part of the plane, in data units (log10 of the value on a log axis). */
export interface PlotView {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PlotOptions {
  width?: number;
  height?: number;
  palette?: 'screen' | 'paper';
  view?: PlotView;
}

const MARGIN = { left: 56, right: 16, top: 28, bottom: 44 };

const usable = (value: number, log: boolean | undefined): boolean => Number.isFinite(value) && (!log || value > 0);
const axisValue = (value: number, log: boolean | undefined): number => (log ? Math.log10(value) : value);

function dataRange(values: readonly number[], log: boolean | undefined): [number, number] {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) {
    if (!usable(value, log)) continue;
    const v = axisValue(value, log);
    low = Math.min(low, v);
    high = Math.max(high, v);
  }
  return [low, high];
}

function extent(values: readonly number[], axis: PlotAxis): [number, number] {
  const [dataLow, dataHigh] = dataRange(values, axis.log);
  const low = axis.min !== undefined ? axisValue(axis.min, axis.log) : dataLow;
  const high = axis.max !== undefined ? axisValue(axis.max, axis.log) : dataHigh;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  if (high - low < 1e-12 * Math.max(1, Math.abs(high))) {
    const pad = axis.log ? 0.5 : Math.abs(high) > 0 ? Math.abs(high) * 0.1 : 1;
    return [low - pad, high + pad];
  }
  // A little room around the data, but none past a fixed limit.
  const pad = axis.log ? 0 : (high - low) * 0.05;
  return [axis.min !== undefined ? low : low - pad, axis.max !== undefined ? high : high + pad];
}

function collect(spec: PlotSpec, pick: 0 | 1): number[] {
  const values: number[] = [];
  for (const series of spec.series) for (const point of series.points) values.push(point[pick]);
  for (const note of spec.notes ?? []) values.push(note.at[pick]);
  return values;
}

/** The view that shows all the data, widened on one axis for equal axes. */
export function fitView(spec: PlotSpec, width = 520, height = 320): PlotView {
  const [x0, x1] = extent(collect(spec, 0), spec.x);
  const [y0, y1] = extent(collect(spec, 1), spec.y);
  if (!spec.equalAxes || spec.x.log || spec.y.log) return { x0, x1, y0, y1 };
  const w = width - MARGIN.left - MARGIN.right;
  const h = height - MARGIN.top - MARGIN.bottom;
  const scale = Math.max((x1 - x0) / w, (y1 - y0) / h);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return { x0: cx - (scale * w) / 2, x1: cx + (scale * w) / 2, y0: cy - (scale * h) / 2, y1: cy + (scale * h) / 2 };
}

/** The view scaled about its center: factor 0.5 zooms in, 2 zooms out. */
export function zoomView(view: PlotView, factor: number): PlotView {
  const cx = (view.x0 + view.x1) / 2;
  const cy = (view.y0 + view.y1) / 2;
  const hw = ((view.x1 - view.x0) / 2) * factor;
  const hh = ((view.y1 - view.y0) / 2) * factor;
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
}

/** About `count` round tick values from low to high: steps of 1, 2, or 5 times a power of ten. */
export function niceTicks(low: number, high: number, count = 6): number[] {
  if (!(high > low) || !Number.isFinite(low) || !Number.isFinite(high)) return [];
  const raw = (high - low) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let k = Math.ceil(low / step - 1e-9); k * step <= high + step * 1e-9; k += 1) {
    ticks.push(Math.abs(k * step) < step * 1e-9 ? 0 : k * step);
  }
  return ticks;
}

/** Decade ticks on a log axis (exponents), thinned to at most `count`. */
function logTicks(low: number, high: number, count = 7): number[] {
  const first = Math.ceil(low - 1e-9);
  const last = Math.floor(high + 1e-9);
  const every = Math.max(1, Math.ceil((last - first + 1) / count));
  const ticks: number[] = [];
  for (let e = first; e <= last; e += every) ticks.push(e);
  return ticks;
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
const superscript = (value: number): string => [...String(value)].map((c) => SUPERSCRIPT[c] ?? c).join('');

/** A tick label: short, with powers of ten for very large or small values. */
export function tickText(value: number, log = false): string {
  if (log) return value === 0 ? '1' : value === 1 ? '10' : `10${superscript(value)}`;
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const text =
    abs >= 1e5 || abs < 1e-3 ? value.toExponential(1).replace('e+', 'e') : String(Number(value.toPrecision(4)));
  return text.replace(/^-/, '−');
}

interface Frame {
  spec: PlotSpec;
  view: PlotView;
  ink: Palette;
  left: number;
  top: number;
  w: number;
  h: number;
}

const sx = (f: Frame, v: number) => f.left + ((v - f.view.x0) / (f.view.x1 - f.view.x0)) * f.w;
const sy = (f: Frame, v: number) => f.top + f.h - ((v - f.view.y0) / (f.view.y1 - f.view.y0)) * f.h;
const frameX = (f: Frame, value: number) => sx(f, axisValue(value, f.spec.x.log));
const frameY = (f: Frame, value: number) => sy(f, axisValue(value, f.spec.y.log));

function screenPoint(f: Frame, point: Point): [number, number] | null {
  if (!usable(point[0], f.spec.x.log) || !usable(point[1], f.spec.y.log)) return null;
  return [frameX(f, point[0]), frameY(f, point[1])];
}

/** The path of a series, broken at points that cannot be drawn and clamped far outside the frame. */
function seriesPath(f: Frame, points: readonly Point[]): string {
  const limit = 1e5;
  const parts: string[] = [];
  let pen = false;
  for (const point of points) {
    const at = screenPoint(f, point);
    if (!at) {
      pen = false;
      continue;
    }
    const x = Math.max(-limit, Math.min(limit, at[0]));
    const y = Math.max(-limit, Math.min(limit, at[1]));
    parts.push(`${pen ? 'L' : 'M'}${px(x)} ${px(y)}`);
    pen = true;
  }
  return parts.join(' ');
}

const small = (f: Frame, color = f.ink.muted) => ({ 'font-size': 11, fill: color });

/** The ticks of an axis in view and their labels: the category names at whole positions, or numbers. */
function axisTicks(axis: PlotAxis, low: number, high: number, count: number): [number, string][] {
  if (axis.categories) {
    return axis.categories.flatMap((name, i): [number, string][] => (i >= low && i <= high ? [[i, name]] : []));
  }
  const ticks = axis.log ? logTicks(low, high) : niceTicks(low, high, count);
  return ticks.map((tick) => [tick, tickText(tick, axis.log)]);
}

function axesSvg(f: Frame): string[] {
  const { spec, ink } = f;
  const out: string[] = [];
  const xTicks = axisTicks(spec.x, f.view.x0, f.view.x1, 6);
  const yTicks = axisTicks(spec.y, f.view.y0, f.view.y1, 5);
  const bottom = f.top + f.h;
  for (const [tick, text] of xTicks) {
    const x = sx(f, tick);
    out.push(el('line', { x1: x, y1: f.top, x2: x, y2: bottom, stroke: ink.grid, 'stroke-width': 1 }));
    out.push(el('text', { x, y: bottom + 16, 'text-anchor': 'middle', ...small(f) }, text));
  }
  for (const [tick, text] of yTicks) {
    const y = sy(f, tick);
    out.push(el('line', { x1: f.left, y1: y, x2: f.left + f.w, y2: y, stroke: ink.grid, 'stroke-width': 1 }));
    const attrs = { x: f.left - 6, y, dy: '0.35em', 'text-anchor': 'end', ...small(f) };
    out.push(el('text', attrs, text));
  }
  out.push(el('rect', { x: f.left, y: f.top, width: f.w, height: f.h, fill: 'none', stroke: ink.muted }));
  const xLabel = { x: f.left + f.w / 2, y: bottom + 34, 'text-anchor': 'middle', 'font-size': 12, fill: ink.text };
  out.push(el('text', xLabel, spec.x.label));
  const midY = px(f.top + f.h / 2);
  const yLabel = { x: 14, y: midY, 'text-anchor': 'middle', 'font-size': 12, fill: ink.text };
  out.push(el('text', { ...yLabel, transform: `rotate(-90 14 ${midY})` }, spec.y.label));
  return out;
}

function regionSvg(f: Frame, region: PlotRegion): string[] {
  const xa = frameX(f, region.x0);
  const xb = frameX(f, region.x1);
  const ya = region.y1 === undefined ? f.top : frameY(f, region.y1);
  const yb = region.y0 === undefined ? f.top + f.h : frameY(f, region.y0);
  const x = Math.max(f.left, Math.min(xa, xb));
  const y = Math.max(f.top, Math.min(ya, yb));
  const width = Math.min(f.left + f.w, Math.max(xa, xb)) - x;
  const height = Math.min(f.top + f.h, Math.max(ya, yb)) - y;
  if (!(width > 0) || !(height > 0)) return [];
  const out = [el('rect', { x, y, width, height, fill: f.ink.pens[4], 'fill-opacity': 0.12 })];
  if (region.label) out.push(el('text', { x: x + 4, y: y + 14, ...small(f) }, region.label));
  return out;
}

function referenceSvg(f: Frame, line: { x: number } | { y: number }): string[] {
  const stroke = { stroke: f.ink.muted, 'stroke-width': 1.25 };
  if ('x' in line) {
    if (!usable(line.x, f.spec.x.log)) return [];
    const x = frameX(f, line.x);
    return [el('line', { x1: x, y1: f.top, x2: x, y2: f.top + f.h, ...stroke })];
  }
  if (!usable(line.y, f.spec.y.log)) return [];
  const y = frameY(f, line.y);
  return [el('line', { x1: f.left, y1: y, x2: f.left + f.w, y2: y, ...stroke })];
}

function seriesSvg(f: Frame): string[] {
  const out: string[] = [];
  f.spec.series.forEach((series, index) => {
    const color = f.ink.pens[(series.pen ?? index) % f.ink.pens.length];
    const style = series.style ?? 'line';
    const d = style === 'markers' ? '' : seriesPath(f, series.points);
    if (d) {
      const dash = series.dashed ? '6 4' : undefined;
      const attrs = { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' };
      out.push(el('path', { ...attrs, 'stroke-dasharray': dash }));
    }
    if (style === 'line') return;
    for (const point of series.points) {
      const at = screenPoint(f, point);
      if (at) out.push(el('circle', { cx: at[0], cy: at[1], r: 3.5, fill: color }));
    }
  });
  return out;
}

function notesSvg(f: Frame): string[] {
  const out: string[] = [];
  for (const note of f.spec.notes ?? []) {
    const at = screenPoint(f, note.at);
    if (!at) continue;
    if (note.marker) out.push(el('circle', { cx: at[0], cy: at[1], r: 4, fill: f.ink.pens[1] }));
    const right = at[0] > f.left + f.w * 0.7;
    const attrs = { x: at[0] + (right ? -6 : 6), y: at[1] - 6, 'text-anchor': right ? 'end' : 'start' };
    out.push(el('text', { ...attrs, ...small(f, f.ink.text) }, note.text));
  }
  return out;
}

function legendSvg(f: Frame): string[] {
  if (f.spec.series.length < 2) return [];
  const out: string[] = [];
  let x = f.left;
  f.spec.series.forEach((series, index) => {
    const color = f.ink.pens[(series.pen ?? index) % f.ink.pens.length];
    out.push(el('rect', { x, y: 10, width: 12, height: 4, fill: color }));
    out.push(el('text', { x: x + 16, y: 15, ...small(f, f.ink.text) }, series.name));
    x += 28 + series.name.length * 6.2;
  });
  return out;
}

let plotCount = 0;

/** The plot as a standalone SVG document. */
export function plotSvg(spec: PlotSpec, options: PlotOptions = {}): string {
  const width = options.width ?? 520;
  const height = options.height ?? 320;
  const palette = options.palette ?? 'paper';
  const ink = paletteOf(palette);
  const view = options.view ?? fitView(spec, width, height);
  const w = width - MARGIN.left - MARGIN.right;
  const h = height - MARGIN.top - MARGIN.bottom;
  const f: Frame = { spec, view, ink, left: MARGIN.left, top: MARGIN.top, w, h };
  plotCount += 1;
  const clipId = `kitplot-${plotCount}`;
  const clip = `<defs><clipPath id="${clipId}">${el('rect', { x: f.left, y: f.top, width: w, height: h })}</clipPath></defs>`;
  const inside = [
    ...(spec.regions ?? []).flatMap((region) => regionSvg(f, region)),
    ...(spec.lines ?? []).flatMap((line) => referenceSvg(f, line)),
    ...seriesSvg(f),
    ...notesSvg(f),
  ];
  const background = palette === 'paper' ? el('rect', { width, height, fill: ink.page }) : '';
  const body = [clip, background, ...axesSvg(f), `<g clip-path="url(#${clipId})">`, ...inside, '</g>', ...legendSvg(f)];
  return svgDocument(width, height, spec.title, body.join(''));
}
