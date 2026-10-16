// Turns a table into chart series, without Plot, so summaries and fallbacks work before any chart code loads.
// Rows come in view order (filtered and sorted), so sorting a table ranks the bars.
// Every series is capped, so each mark stays readable and the 100 ms budget holds. Bars get one per 3 units of
// width, a pie gets six slices plus "Other", and lines are reduced with Largest-Triangle-Three-Buckets, which
// keeps the peaks.

import { formatValue } from '../format';
import type { Locale } from '../locale';
import type { Column, Table } from '../model';
import { isError, isNumber, round15 } from '../values';

export type ChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter';
export type Aggregate = 'none' | 'sum' | 'average' | 'count' | 'min' | 'max';
export type XKind = 'text' | 'number' | 'date';

export interface Point {
  /** A label for text, or a number (a day number for dates). */
  x: string | number;
  y: number;
}

export interface SeriesData {
  column: number;
  name: string;
  points: Point[];
}

/** What the data left out, so the chart can say so. The interface turns a code into words. */
export interface ChartNote {
  code: 'capped' | 'reduced' | 'skipped' | 'other';
  shown: number;
  total: number;
}

export interface ChartData {
  xKind: XKind;
  xName: string;
  series: SeriesData[];
  notes: ChartNote[];
}

export interface DeriveOptions {
  kind: ChartKind;
  /** The x column index. */
  x: number;
  /** The value column indices. */
  series: readonly number[];
  aggregate?: Aggregate;
  /** How many bars or categories fit. */
  maxBars: number;
  /** How many points a line or area can show. */
  maxPoints: number;
  otherLabel: string;
}

const MAX_SLICES = 6;

export function xKindOf(column: Column): XKind {
  if (column.type === 'date') return 'date';
  return column.type === 'number' || column.type === 'currency' || column.type === 'percent' ? 'number' : 'text';
}

/** Reads one series. Bars and pies label categories with the shown text, for dates and numbers too. */
function readPoints(table: Table, rows: readonly number[], xy: [number, number], labels: boolean, locale: Locale) {
  const [x, y] = xy;
  const xColumn = table.columns[x];
  const asText = labels || xKindOf(xColumn) === 'text';
  const points: Point[] = [];
  let skipped = 0;
  for (const r of rows) {
    const cells = table.rows[r].cells;
    const [xv, yv] = [cells[x].value, cells[y].value];
    if (xv === null || xv === '' || isError(xv) || (!asText && !isNumber(xv))) continue;
    if (!isNumber(yv)) {
      skipped++;
      continue;
    }
    points.push({ x: asText ? formatValue(xv, xColumn, locale) : (xv as number), y: yv });
  }
  return { points, skipped };
}

function combine(aggregate: Aggregate, ys: number[]): number {
  switch (aggregate) {
    case 'count':
      return ys.length;
    case 'min':
      return Math.min(...ys);
    case 'max':
      return Math.max(...ys);
    case 'average':
      return round15(ys.reduce((a, b) => a + b, 0) / ys.length);
    default:
      return round15(ys.reduce((a, b) => a + b, 0));
  }
}

/** Combines rows with the same x, in order of first appearance. */
export function aggregatePoints(points: readonly Point[], aggregate: Aggregate): Point[] {
  if (aggregate === 'none') return [...points];
  const groups = new Map<string | number, number[]>();
  for (const p of points) {
    const list = groups.get(p.x);
    if (list) list.push(p.y);
    else groups.set(p.x, [p.y]);
  }
  return [...groups].map(([x, ys]) => ({ x, y: combine(aggregate, ys) }));
}

/** Largest-Triangle-Three-Buckets: keeps the first and last points and the most visible point in each bucket. */
export function lttb(points: readonly Point[], threshold: number): Point[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return [...points];
  const at = (i: number): number => (typeof points[i].x === 'number' ? (points[i].x as number) : i);
  const every = (n - 2) / (threshold - 2);
  const out: Point[] = [points[0]];
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const nextStart = Math.floor((i + 1) * every) + 1;
    const nextEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += at(j);
      avgY += points[j].y;
    }
    avgX /= nextEnd - nextStart;
    avgY /= nextEnd - nextStart;
    let best = -1;
    let chosen = Math.floor(i * every) + 1;
    for (let j = chosen; j < Math.floor((i + 1) * every) + 1; j++) {
      const area = Math.abs((at(a) - avgX) * (points[j].y - points[a].y) - (at(a) - at(j)) * (avgY - points[a].y));
      if (area > best) [best, chosen] = [area, j];
    }
    out.push(points[chosen]);
    a = chosen;
  }
  out.push(points[n - 1]);
  return out;
}

/** Largest six slices in table order, then the rest together as "Other". Non-positive values can't be slices. */
function toSlices(points: Point[], other: string, notes: ChartNote[]): { points: Point[]; dropped: number } {
  const positive = points.filter((p) => p.y > 0);
  const dropped = points.length - positive.length;
  if (positive.length <= MAX_SLICES + 1) return { points: positive, dropped };
  const top = new Set([...positive].sort((a, b) => b.y - a.y).slice(0, MAX_SLICES));
  const rest = positive.filter((p) => !top.has(p));
  const shown = positive.filter((p) => top.has(p));
  shown.push({ x: other, y: round15(rest.reduce((sum, p) => sum + p.y, 0)) });
  notes.push({ code: 'other', shown: MAX_SLICES, total: positive.length });
  return { points: shown, dropped };
}

function capCategories(series: SeriesData[], max: number, notes: ChartNote[]): void {
  const order: (string | number)[] = [];
  const seen = new Set<string | number>();
  for (const p of series.flatMap((s) => s.points)) {
    if (seen.has(p.x)) continue;
    seen.add(p.x);
    order.push(p.x);
  }
  if (order.length <= max) return;
  const keep = new Set(order.slice(0, max));
  for (const s of series) s.points = s.points.filter((p) => keep.has(p.x));
  notes.push({ code: 'capped', shown: max, total: order.length });
}

function reduceLines(series: SeriesData[], max: number, notes: ChartNote[]): void {
  const longest = Math.max(0, ...series.map((s) => s.points.length));
  if (longest <= max) return;
  for (const s of series) s.points = lttb(s.points, max);
  notes.push({ code: 'reduced', shown: max, total: longest });
}

/** Builds the series a chart draws from the rows a table shows. */
export function deriveChartData(
  table: Table,
  rows: readonly number[],
  options: DeriveOptions,
  locale: Locale,
): ChartData {
  const { kind } = options;
  const labels = kind === 'bar' || kind === 'pie';
  const xColumn = table.columns[options.x];
  const xKind = xColumn && !labels ? xKindOf(xColumn) : 'text';
  const notes: ChartNote[] = [];
  let skipped = 0;
  const series: SeriesData[] = options.series
    .filter((col) => table.columns[col] && xColumn)
    .map((col) => {
      const read = readPoints(table, rows, [options.x, col], labels, locale);
      skipped += read.skipped;
      const points = aggregatePoints(read.points, options.aggregate ?? 'none');
      return { column: col, name: table.columns[col].name, points };
    });
  if (kind === 'pie' && series[0]) {
    const slices = toSlices(series[0].points, options.otherLabel, notes);
    series.splice(1);
    series[0].points = slices.points;
    skipped += slices.dropped;
  }
  if ((kind === 'line' || kind === 'area') && xKind !== 'text') {
    for (const s of series) s.points.sort((p, q) => (p.x as number) - (q.x as number));
  }
  if (kind === 'bar') capCategories(series, options.maxBars, notes);
  if (kind === 'line' || kind === 'area') reduceLines(series, options.maxPoints, notes);
  if (skipped > 0) notes.unshift({ code: 'skipped', shown: 0, total: skipped });
  return { xKind, xName: xColumn?.name ?? '', series, notes };
}
