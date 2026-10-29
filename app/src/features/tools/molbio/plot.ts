// Line and point plots as Figures: axes with round ticks, one or more series told apart by dash as well as tone,
// and a legend in words. Used for GC windows, charge curves, hydropathy, LOD curves, and allele trajectories.
import type { Figure, Label, Shape } from './figure';
import { fmt } from './shared';

export interface Series {
  name: Label;
  x: number[];
  y: number[];
  /** Points drawn as dots instead of a line. */
  dots?: boolean;
}

export interface PlotSpec {
  xLabel: Label;
  yLabel: Label;
  series: Series[];
  xRange?: [number, number];
  yRange?: [number, number];
  /** Horizontal reference lines, such as zero charge or LOD = 3. */
  marks?: number[];
  /** False hides the legend, as for many replicate runs drawn alike. */
  legend?: boolean;
  width?: number;
  height?: number;
}

const DASHES = ['', '6 4', '2 3', '10 3 2 3'];
const PAD = { left: 56, right: 16, top: 14, bottom: 44 };

/** About `count` round tick values covering [lo, hi]. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function extent(values: number[], fallback: [number, number]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return fallback;
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi === lo) {
    lo -= Math.abs(lo) * 0.1 || 1;
    hi += Math.abs(hi) * 0.1 || 1;
  }
  return [lo, hi];
}

function polyline(points: [number, number][]): string {
  let d = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    pen = true;
  }
  return d;
}

function axes(spec: PlotSpec, box: { w: number; h: number }, scale: Scale): Shape[] {
  const shapes: Shape[] = [];
  const { x: sx, y: sy, xr, yr } = scale;
  for (const v of ticks(xr[0], xr[1])) {
    shapes.push({ kind: 'line', x1: sx(v), y1: PAD.top, x2: sx(v), y2: box.h - PAD.bottom, stroke: 'faint', width: 1 });
    shapes.push({
      kind: 'text',
      x: sx(v),
      y: box.h - PAD.bottom + 16,
      label: fmt(v, 4),
      size: 11,
      anchor: 'middle',
      tone: 'muted',
    });
  }
  for (const v of ticks(yr[0], yr[1])) {
    shapes.push({ kind: 'line', x1: PAD.left, y1: sy(v), x2: box.w - PAD.right, y2: sy(v), stroke: 'faint', width: 1 });
    shapes.push({
      kind: 'text',
      x: PAD.left - 6,
      y: sy(v) + 4,
      label: fmt(v, 4),
      size: 11,
      anchor: 'end',
      tone: 'muted',
    });
  }
  for (const v of spec.marks ?? []) {
    if (v >= yr[0] && v <= yr[1]) {
      shapes.push({
        kind: 'line',
        x1: PAD.left,
        y1: sy(v),
        x2: box.w - PAD.right,
        y2: sy(v),
        stroke: 'muted',
        width: 1,
        dash: '3 3',
      });
    }
  }
  shapes.push({
    kind: 'rect',
    x: PAD.left,
    y: PAD.top,
    w: box.w - PAD.left - PAD.right,
    h: box.h - PAD.top - PAD.bottom,
    stroke: 'muted',
    width: 1,
  });
  shapes.push({
    kind: 'text',
    x: (PAD.left + box.w - PAD.right) / 2,
    y: box.h - 8,
    label: spec.xLabel,
    size: 12,
    anchor: 'middle',
  });
  const midY = (PAD.top + box.h - PAD.bottom) / 2;
  shapes.push({ kind: 'text', x: 14, y: midY, label: spec.yLabel, size: 12, anchor: 'middle', rotate: -90 });
  return shapes;
}

interface Scale {
  x(v: number): number;
  y(v: number): number;
  xr: [number, number];
  yr: [number, number];
}

/** A plot of the series on shared axes. */
export function linePlot(spec: PlotSpec): Figure {
  const box = { w: spec.width ?? 520, h: spec.height ?? 260 };
  const xr =
    spec.xRange ??
    extent(
      spec.series.flatMap((s) => s.x),
      [0, 1],
    );
  const yr = spec.yRange ?? extent([...spec.series.flatMap((s) => s.y), ...(spec.marks ?? [])], [0, 1]);
  const scale: Scale = {
    x: (v) => PAD.left + ((v - xr[0]) / (xr[1] - xr[0])) * (box.w - PAD.left - PAD.right),
    y: (v) => box.h - PAD.bottom - ((v - yr[0]) / (yr[1] - yr[0])) * (box.h - PAD.top - PAD.bottom),
    xr,
    yr,
  };
  const shapes = axes(spec, box, scale);
  spec.series.forEach((series, i) => {
    const points = series.x.map((x, j): [number, number] => [scale.x(x), scale.y(series.y[j] ?? NaN)]);
    if (series.dots) {
      for (const [x, y] of points)
        if (Number.isFinite(x) && Number.isFinite(y))
          shapes.push({ kind: 'circle', cx: x, cy: y, r: 3, fill: i === 0 ? 'accent' : 'ink', stroke: 'none' });
    } else {
      const dash = DASHES[i % DASHES.length];
      shapes.push({
        kind: 'path',
        d: polyline(points),
        stroke: i === 0 ? 'accent' : 'ink',
        width: 2,
        ...(dash ? { dash } : {}),
      });
    }
  });
  if (spec.series.length > 1 && spec.legend !== false) {
    spec.series.forEach((series, i) => {
      const y = PAD.top + 12 + i * 16;
      const x = box.w - PAD.right - 150;
      const dash = DASHES[i % DASHES.length];
      shapes.push({
        kind: 'line',
        x1: x,
        y1: y - 4,
        x2: x + 22,
        y2: y - 4,
        stroke: i === 0 ? 'accent' : 'ink',
        width: 2,
        ...(dash ? { dash } : {}),
      });
      shapes.push({ kind: 'text', x: x + 28, y, label: series.name, size: 11 });
    });
  }
  return { width: box.w, height: box.h, shapes };
}
