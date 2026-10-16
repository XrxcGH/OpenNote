// Plot marks for each chart kind, as data. Colors are CSS variables (strokes) and pattern references (fills), so a
// theme switch recolors a chart with no redraw. Bars share one mark and a color scale. Lines, areas, and dots get one
// mark per series, because dashes and shapes are per series.

import type { ChartData, Point, SeriesData } from './data';
import type { MarkSpec, SeriesStyle } from './types';

export interface Build {
  data: ChartData;
  styles: SeriesStyle[];
  patterns: boolean;
  stacked: boolean;
  horizontal: boolean;
}

/** The scale options and marks one kind contributes. */
export interface Layer {
  marks: MarkSpec[];
  scales: Record<string, unknown>;
}

const DAY_MS = 86_400_000;
const SHAPE_POINTS = 60;
const DOT_RADIUS = 3;
const AREA_OPACITY = 0.35;

/** Dates are day numbers in the data, and Dates in Plot. */
function xOf(build: Build, p: Point): unknown {
  return build.data.xKind === 'date' ? new Date((p.x as number) * DAY_MS) : p.x;
}

function series(build: Build): { data: SeriesData; style: SeriesStyle }[] {
  return build.data.series.map((data, i) => ({ data, style: build.styles[i] }));
}

function plain(build: Build, points: readonly Point[]): { x: unknown; y: number }[] {
  return points.map((p) => ({ x: xOf(build, p), y: p.y }));
}

export function barLayer(build: Build): Layer {
  const names = build.styles.map((s) => s.name);
  const rows = series(build).flatMap(({ data }) => data.points.map((p) => ({ x: p.x, y: p.y, series: data.name })));
  const single = build.styles.length === 1;
  const horizontal = build.horizontal;
  const [category, value, facet] = horizontal ? (['y', 'x', 'fy'] as const) : (['x', 'y', 'fx'] as const);
  const options: Record<string, unknown> = { [category]: 'x', [value]: 'y' };
  const scales: Record<string, unknown> = {};
  if (single) {
    options.fill = build.styles[0].paint;
  } else {
    options.fill = 'series';
    scales.color = { domain: names, range: build.styles.map((s) => s.paint), legend: false };
    if (!build.stacked) {
      // Grouped: the category becomes a facet, and the series divide each band.
      options[facet] = 'x';
      options[category] = 'series';
      scales[category] = { axis: null, domain: names };
      scales[facet] = { label: build.data.xName };
    }
  }
  const zero: MarkSpec = { mark: horizontal ? 'ruleX' : 'ruleY', data: [0], options: {} };
  return { marks: [{ mark: horizontal ? 'barX' : 'barY', data: rows, options }, zero], scales };
}

function lineMarks(build: Build): MarkSpec[] {
  return series(build).flatMap(({ data, style }) => {
    const points = plain(build, data.points);
    const line: Record<string, unknown> = { x: 'x', y: 'y', stroke: style.color, strokeWidth: 2 };
    if (build.patterns && style.dash) line.strokeDasharray = style.dash;
    const marks: MarkSpec[] = [{ mark: 'lineY', data: points, options: line }];
    if (build.patterns && points.length <= SHAPE_POINTS) {
      marks.push(dotMark(points, style));
    }
    return marks;
  });
}

function dotMark(points: readonly unknown[], style: SeriesStyle): MarkSpec {
  return {
    mark: 'dot',
    data: points,
    options: { x: 'x', y: 'y', stroke: style.color, fill: style.color, symbol: style.symbol, r: DOT_RADIUS },
  };
}

export const lineLayer = (build: Build): Layer => ({ marks: lineMarks(build), scales: {} });

export function scatterLayer(build: Build): Layer {
  const marks = series(build).map(({ data, style }) => dotMark(plain(build, data.points), style));
  return { marks, scales: {} };
}

/** Stacks series over every x they share, so each area sits on the one below. Missing values count as zero. */
function stackedAreas(build: Build): MarkSpec[] {
  const xs = [...new Set(build.data.series.flatMap((s) => s.points.map((p) => p.x)))];
  if (build.data.xKind !== 'text') xs.sort((a, b) => (a as number) - (b as number));
  const base = new Map<string | number, number>(xs.map((x) => [x, 0]));
  return series(build).map(({ data, style }) => {
    const byX = new Map(data.points.map((p) => [p.x, p.y]));
    const rows = xs.map((x) => {
      const y1 = base.get(x) ?? 0;
      const y2 = y1 + (byX.get(x) ?? 0);
      base.set(x, y2);
      return { x: xOf(build, { x, y: 0 }), y1, y2 };
    });
    return { mark: 'areaY', data: rows, options: { x: 'x', y1: 'y1', y2: 'y2', fill: style.paint } };
  });
}

function overlappingAreas(build: Build): MarkSpec[] {
  return series(build).flatMap(({ data, style }) => {
    const points = plain(build, data.points);
    const fill = { x: 'x', y: 'y', fill: style.paint, fillOpacity: AREA_OPACITY };
    const edge = { x: 'x', y: 'y', stroke: style.color, strokeWidth: 2 };
    return [
      { mark: 'areaY', data: points, options: fill },
      { mark: 'lineY', data: points, options: edge },
    ] as MarkSpec[];
  });
}

export const areaLayer = (build: Build): Layer => ({
  marks: build.stacked ? stackedAreas(build) : overlappingAreas(build),
  scales: {},
});
