// Words for a chart (Accessible charts): what kind it is, its axes, the range of its values, which way they move,
// and the highest and lowest points. The interface turns these facts into sentences. Also the list of points a
// person steps through with the arrow keys, and the rows of the same data as a table.
import { daysToIso } from '../dates';
import type { ChartData, ChartKind, Point, XKind } from './data';

export type Trend = 'rising' | 'falling' | 'steady' | 'mixed';

export interface Extreme {
  series: string;
  x: string;
  y: number;
}

export interface ChartFacts {
  kind: ChartKind;
  xName: string;
  seriesNames: string[];
  count: number;
  min: number;
  max: number;
  /** Null for a pie or a single point. */
  trend: Trend | null;
  highest: Extreme | null;
  lowest: Extreme | null;
}

/** A point's x as the words a person reads: the label, the number, or the date. */
export const xText = (x: Point['x'], kind: XKind = 'text'): string =>
  kind === 'date' && typeof x === 'number' ? daysToIso(x) : String(x);

function extremes(data: ChartData): { highest: Extreme | null; lowest: Extreme | null } {
  let highest: Extreme | null = null;
  let lowest: Extreme | null = null;
  for (const series of data.series) {
    for (const point of series.points) {
      const here = { series: series.name, x: xText(point.x, data.xKind), y: point.y };
      if (highest === null || point.y > highest.y) highest = here;
      if (lowest === null || point.y < lowest.y) lowest = here;
    }
  }
  return { highest, lowest };
}

/** Which way the first series moves, from the sign of the slope of a straight line through it. */
function trendOf(points: readonly Point[]): Trend | null {
  if (points.length < 3) return null;
  const ys = points.map((point) => point.y);
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  let covariance = 0;
  let variance = 0;
  ys.forEach((y, i) => {
    covariance += (i - meanX) * (y - meanY);
    variance += (i - meanX) ** 2;
  });
  const slope = covariance / variance;
  const spread = Math.max(...ys) - Math.min(...ys);
  if (spread === 0 || Math.abs(slope * (n - 1)) < spread * 0.15) return 'steady';
  // A line that mostly goes one way but swings a lot is mixed.
  const turns = ys.slice(2).filter((y, i) => Math.sign(y - ys[i + 1]) !== Math.sign(ys[i + 1] - ys[i])).length;
  if (turns > n / 2) return 'mixed';
  return slope > 0 ? 'rising' : 'falling';
}

export function describeChart(kind: ChartKind, data: ChartData): ChartFacts | null {
  const all = data.series.flatMap((series) => series.points);
  if (all.length === 0) return null;
  const ys = all.map((point) => point.y);
  const { highest, lowest } = extremes(data);
  return {
    kind,
    xName: data.xName,
    seriesNames: data.series.map((series) => series.name),
    count: data.series[0]?.points.length ?? 0,
    min: Math.min(...ys),
    max: Math.max(...ys),
    trend: kind === 'pie' ? null : trendOf(data.series[0]?.points ?? []),
    highest,
    lowest,
  };
}

export interface Step {
  series: string;
  seriesIndex: number;
  index: number;
  x: string;
  y: number;
}

/** The point at a place in the chart, or null if there is none. */
export function stepAt(data: ChartData, seriesIndex: number, index: number): Step | null {
  const series = data.series[seriesIndex];
  const point = series?.points[index];
  return point ? { series: series.name, seriesIndex, index, x: xText(point.x, data.xKind), y: point.y } : null;
}

/** Where an arrow key goes from a place: left and right along a series, up, and down between series. */
export function moveStep(
  data: ChartData,
  from: { series: number; index: number },
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End',
): { series: number; index: number } {
  const last = (data.series[from.series]?.points.length ?? 1) - 1;
  if (key === 'Home') return { series: from.series, index: 0 };
  if (key === 'End') return { series: from.series, index: last };
  if (key === 'ArrowLeft') return { series: from.series, index: Math.max(0, from.index - 1) };
  if (key === 'ArrowRight') return { series: from.series, index: Math.min(last, from.index + 1) };
  const series = Math.min(data.series.length - 1, Math.max(0, from.series + (key === 'ArrowDown' ? 1 : -1)));
  const length = (data.series[series]?.points.length ?? 1) - 1;
  return { series, index: Math.min(from.index, length) };
}

/** The data as a table: one row for each x, one column for each series. A series that lacks an x leaves it empty. */
export function dataTable(data: ChartData): { head: string[]; rows: string[][] } {
  const xs: string[] = [];
  for (const series of data.series) {
    for (const point of series.points)
      if (!xs.includes(xText(point.x, data.xKind))) xs.push(xText(point.x, data.xKind));
  }
  return {
    head: [data.xName, ...data.series.map((series) => series.name)],
    rows: xs.map((x) => [
      x,
      ...data.series.map((series) => {
        const found = series.points.find((point) => xText(point.x, data.xKind) === x);
        return found ? String(found.y) : '';
      }),
    ]),
  };
}
