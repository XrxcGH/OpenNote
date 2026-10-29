// Plot specs for the statistics the subject tools draw, on kit-core's plot: a histogram, a density, the ECDF, a
// normal Q-Q plot, box plots side by side, a scatter with its fitted curve and bands, a step curve, a forest plot,
// and an ROC curve. Each returns a PlotSpec that KitPlot shows and the Insert menu turns into SVG; each series has
// a name, so the plot's text summary says what is drawn.
import type { PlotSpec, PlotSeries, PlotNote } from '../../kits/ui/plot';
import type { BandPoint } from '../num/lm';
import { boxWhiskers, ecdf, histogramBins, kernelDensity, normalQQ, stepCurve } from '../stats/plots';
import type { BinRule, Point } from '../stats/plots';
import { sayS } from './words';

const GAP: Point = [Number.NaN, Number.NaN];

/** A histogram drawn as the outline of its bars. */
export function histogramPlot(values: readonly number[], title: string, label: string, rule?: BinRule): PlotSpec {
  const bins = histogramBins(values, rule);
  const points: Point[] = [];
  for (const bin of bins) points.push([bin.from, 0], [bin.from, bin.count], [bin.to, bin.count], [bin.to, 0]);
  return {
    title,
    x: { label },
    y: { label: sayS('plot.count'), min: 0 },
    series: [{ name: sayS('plot.count'), points }],
  };
}

export function densityPlot(values: readonly number[], title: string, label: string, bandwidth?: number): PlotSpec {
  const { points } = kernelDensity(values, bandwidth);
  return {
    title,
    x: { label },
    y: { label: sayS('plot.density'), min: 0 },
    series: [{ name: sayS('plot.density'), points }],
  };
}

export function ecdfPlot(values: readonly number[], title: string, label: string): PlotSpec {
  return {
    title,
    x: { label },
    y: { label: sayS('plot.share'), min: 0, max: 1 },
    series: [{ name: sayS('plot.share'), points: stepCurve(ecdf(values), 0) }],
  };
}

export function qqPlot(values: readonly number[], title: string): PlotSpec {
  const { points, line } = normalQQ(values);
  const lo = points[0][0];
  const hi = points[points.length - 1][0];
  return {
    title,
    x: { label: sayS('plot.theoretical') },
    y: { label: sayS('plot.sample') },
    series: [
      { name: sayS('plot.data'), points, style: 'markers' },
      {
        name: sayS('plot.fit'),
        points: [
          [lo, line.intercept + line.slope * lo],
          [hi, line.intercept + line.slope * hi],
        ],
        dashed: true,
      },
    ],
  };
}

/** Box plots for each group at x = 1, 2, ...; outliers as markers. Groups with no values are left out. */
export function boxPlots(
  groups: readonly { name: string; values: readonly number[] }[],
  title: string,
  label: string,
): PlotSpec {
  const boxes: Point[] = [];
  const outliers: Point[] = [];
  const notes: PlotNote[] = [];
  groups.forEach((group, i) => {
    const b = boxWhiskers(group.values);
    if (!b) return;
    const x = i + 1;
    const w = 0.3;
    boxes.push(
      [x - w, b.q1],
      [x + w, b.q1],
      [x + w, b.q3],
      [x - w, b.q3],
      [x - w, b.q1],
      GAP,
      [x - w, b.median],
      [x + w, b.median],
      GAP,
      [x, b.q3],
      [x, b.highWhisker],
      GAP,
      [x, b.q1],
      [x, b.lowWhisker],
      GAP,
    );
    for (const v of b.outliers) outliers.push([x, v]);
    notes.push({ at: [x, b.lowWhisker], text: group.name });
  });
  const series: PlotSeries[] = [{ name: sayS('plot.values'), points: boxes }];
  if (outliers.length > 0) series.push({ name: sayS('plot.data'), points: outliers, style: 'markers' });
  return { title, x: { label: '', min: 0.5, max: groups.length + 0.5 }, y: { label }, series, notes };
}

/** Data as markers, the fitted curve, and dashed confidence and prediction bands. */
export function fitPlot(
  data: readonly Point[],
  bands: readonly BandPoint<number>[],
  title: string,
  axes: { x: string; y: string },
): PlotSpec {
  const sorted = [...bands].sort((a, b) => a.x - b.x);
  const series: PlotSeries[] = [
    { name: sayS('plot.data'), points: data, style: 'markers' },
    { name: sayS('plot.fit'), points: sorted.map((b): Point => [b.x, b.fit]) },
  ];
  if (sorted.length > 0) {
    const edge = (key: 'confidence' | 'prediction'): Point[] => [
      ...sorted.map((b): Point => [b.x, b.fit + b[key]]),
      GAP,
      ...sorted.map((b): Point => [b.x, b.fit - b[key]]),
    ];
    series.push({ name: sayS('plot.confidence'), points: edge('confidence'), dashed: true });
    series.push({ name: sayS('plot.prediction'), points: edge('prediction'), dashed: true, pen: 3 });
  }
  return { title, x: { label: axes.x }, y: { label: axes.y }, series };
}

/** A step curve, such as a survival curve that starts at 1. */
export function stepPlot(
  name: string,
  points: readonly Point[],
  title: string,
  axes: { x: string; y: string },
  from?: number,
): PlotSpec {
  return { title, x: { label: axes.x }, y: { label: axes.y }, series: [{ name, points: stepCurve(points, from) }] };
}

export interface ForestRow {
  label: string;
  estimate: number;
  low: number;
  high: number;
}

/** A forest plot: one row per estimate from the top, its interval as a line, and a reference line at `none`. */
export function forestPlot(rows: readonly ForestRow[], title: string, label: string, none = 0): PlotSpec {
  const n = rows.length;
  const y = (i: number) => n - i;
  const intervals: Point[] = [];
  rows.forEach((r, i) => intervals.push([r.low, y(i)], [r.high, y(i)], GAP));
  return {
    title,
    x: { label },
    y: { label: '', min: 0.5, max: n + 0.5 },
    series: [
      { name: sayS('plot.estimate'), points: rows.map((r, i): Point => [r.estimate, y(i)]), style: 'markers' },
      { name: sayS('plot.confidence'), points: intervals },
    ],
    notes: rows.map((r, i) => ({ at: [r.high, y(i)] as Point, text: r.label })),
    lines: [{ x: none }],
  };
}

/** The area under an ROC curve by the trapezoid rule, the points sorted by false positive rate. */
export function rocArea(points: readonly Point[]): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let area = 0;
  for (let i = 1; i < sorted.length; i += 1)
    area += ((sorted[i][0] - sorted[i - 1][0]) * (sorted[i][1] + sorted[i - 1][1])) / 2;
  return area;
}

/** An ROC curve from (0, 0) to (1, 1) with the chance diagonal. */
export function rocPlot(points: readonly Point[], title: string): PlotSpec {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    title,
    x: { label: sayS('plot.falsePositive'), min: 0, max: 1 },
    y: { label: sayS('plot.truePositive'), min: 0, max: 1 },
    series: [
      { name: sayS('plot.truePositive'), points: [[0, 0], ...sorted, [1, 1]] },
      {
        name: sayS('plot.chance'),
        points: [
          [0, 0],
          [1, 1],
        ],
        dashed: true,
      },
    ],
    equalAxes: true,
  };
}
