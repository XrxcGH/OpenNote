// The statistics kit's plots: axes named by message keys and marks (bars, dots, lines, rules, intervals, and box
// plots), turned into the kit foundation's PlotSpec, so KitPlot draws them in the window and plotSvg draws the
// picture that goes into a page. Pure apart from the words.
import type { PlotRegion, PlotSeries, PlotSpec as KitPlotSpec, Point } from '../kits/ui/plot';
import type { AxisKey } from './report';

export interface XY {
  readonly x: number;
  readonly y: number;
}

export interface Axis {
  readonly label: AxisKey;
  /** Names placed at 0, 1, 2, and so on. */
  readonly categories?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}

export interface Interval {
  readonly at: number;
  readonly lo: number;
  readonly hi: number;
  readonly mid: number;
}

export interface Box {
  readonly at: number;
  readonly lo: number;
  readonly q1: number;
  readonly med: number;
  readonly q3: number;
  readonly hi: number;
  readonly out: readonly number[];
}

export type Mark =
  | { readonly kind: 'bars'; readonly tone?: number; readonly bars: readonly { x0: number; x1: number; y: number }[] }
  | { readonly kind: 'points'; readonly tone?: number; readonly points: readonly XY[]; readonly hollow?: boolean }
  | { readonly kind: 'line'; readonly tone?: number; readonly points: readonly XY[]; readonly dashed?: boolean }
  | { readonly kind: 'vline'; readonly tone?: number; readonly x: number; readonly dashed?: boolean }
  | { readonly kind: 'hline'; readonly tone?: number; readonly y: number; readonly dashed?: boolean }
  | {
      readonly kind: 'intervals';
      readonly tone?: number;
      readonly items: readonly Interval[];
      readonly across?: boolean;
    }
  | { readonly kind: 'boxes'; readonly tone?: number; readonly items: readonly Box[] };

export interface PlotSpec {
  readonly title: AxisKey;
  /** Names for the tones, drawn as a key in the corner, so color is never the only cue. */
  readonly legend?: readonly string[];
  readonly x: Axis;
  readonly y: Axis;
  readonly marks: readonly Mark[];
}

const GAP: Point = [Number.NaN, Number.NaN];
type Say = (key: string) => string;

function markSeries(mark: Mark, pen: number, name: string, regions: PlotRegion[], outlierName: string): PlotSeries[] {
  switch (mark.kind) {
    case 'bars': {
      const outline: Point[] = [];
      for (const bar of mark.bars) {
        regions.push({ x0: bar.x0, x1: bar.x1, y0: 0, y1: bar.y });
        outline.push([bar.x0, 0], [bar.x0, bar.y], [bar.x1, bar.y], [bar.x1, 0], GAP);
      }
      return [{ name, points: outline, pen }];
    }
    case 'points':
      return [{ name, points: mark.points.map((p): Point => [p.x, p.y]), style: 'markers', pen }];
    case 'line':
      return [{ name, points: mark.points.map((p): Point => [p.x, p.y]), pen, dashed: mark.dashed ?? false }];
    case 'intervals': {
      const flip = mark.across ?? false;
      const at = (pos: number, v: number): Point => (flip ? [v, pos] : [pos, v]);
      // Each interval is a line marked at its ends and at its estimate.
      const points = mark.items.flatMap((item) => [
        at(item.at, item.lo),
        at(item.at, item.mid),
        at(item.at, item.hi),
        GAP,
      ]);
      return [{ name, points, style: 'both', pen }];
    }
    case 'boxes': {
      const w = 0.3;
      const lines: Point[] = [];
      const out: Point[] = [];
      for (const b of mark.items) {
        const x = b.at;
        lines.push(
          [x - w, b.q1],
          [x + w, b.q1],
          [x + w, b.q3],
          [x - w, b.q3],
          [x - w, b.q1],
          GAP,
          [x - w, b.med],
          [x + w, b.med],
          GAP,
          [x, b.q3],
          [x, b.hi],
          GAP,
          [x, b.q1],
          [x, b.lo],
          GAP,
        );
        for (const v of b.out) out.push([x, v]);
      }
      return [
        { name, points: lines, pen },
        ...(out.length ? [{ name: outlierName, points: out, style: 'markers' as const, pen }] : []),
      ];
    }
    default:
      return [];
  }
}

/** The kit foundation's plot for one of this kit's specs, with every key put into words. */
export function toKitPlot(spec: PlotSpec, say: Say): KitPlotSpec {
  const word = (key: AxisKey) => say(`kitStatInfer.axis.${key}`);
  const regions: PlotRegion[] = [];
  const lines: ({ x: number } | { y: number })[] = [];
  const series: PlotSeries[] = [];
  spec.marks.forEach((mark, i) => {
    const pen = mark.tone ?? i;
    if (mark.kind === 'vline') lines.push({ x: mark.x });
    else if (mark.kind === 'hline') lines.push({ y: mark.y });
    else series.push(...markSeries(mark, pen, spec.legend?.[pen] ?? word(spec.title), regions, word('outliers')));
  });
  const categoryAxis = (axis: Axis) => (axis.categories ? { min: -0.6, max: axis.categories.length - 0.4 } : {});
  const limits = (axis: Axis) => ({
    ...categoryAxis(axis),
    ...(axis.categories ? { categories: axis.categories } : {}),
    ...(axis.min === undefined ? {} : { min: axis.min }),
    ...(axis.max === undefined ? {} : { max: axis.max }),
  });
  return {
    title: word(spec.title),
    x: { label: spec.x.categories ? '' : word(spec.x.label), ...limits(spec.x) },
    y: { label: spec.y.categories ? '' : word(spec.y.label), ...limits(spec.y) },
    series,
    ...(regions.length ? { regions } : {}),
    ...(lines.length ? { lines } : {}),
  };
}
