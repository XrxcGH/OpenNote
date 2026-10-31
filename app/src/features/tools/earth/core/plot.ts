// An x–y plot as a Figure: axes with round-number ticks (or decades on a log axis), one path or set of dots per
// series, a legend in words, and optional marker lines. Depth plots can turn the y axis upside down.
import { fmt } from './format';
import { SERIES, pathOf } from './figure';
import type { Figure, Mark, Role } from './figure';

export interface Series {
  points: readonly (readonly [number, number])[];
  label?: string;
  role?: Role;
  dash?: boolean;
  /** Dots at the points instead of a line through them. */
  dots?: boolean;
}

export interface PlotSpec {
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  series: readonly Series[];
  x?: readonly [number, number];
  y?: readonly [number, number];
  logX?: boolean;
  logY?: boolean;
  /** Larger values lower down, as depth is drawn. */
  flipY?: boolean;
  /** Explicit x ticks with their labels, in place of the round-number ticks (months on a climate diagram). */
  xTicks?: readonly { x: number; label: string }[];
  vlines?: readonly { x: number; label?: string }[];
  hlines?: readonly { y: number; label?: string }[];
  width?: number;
  height?: number;
  /** Extra marks drawn in data coordinates through the plot's own scales. */
  extra?: (sx: (x: number) => number, sy: (y: number) => number) => readonly Mark[];
}

/** About `count` round numbers spanning lo to hi. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

function extent(values: readonly number[], log: boolean): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (finite.length === 0) return log ? [1, 10] : [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  if (log) return [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(hi))];
  const ticks = niceTicks(lo, hi);
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  return [Math.min(lo, Math.floor(lo / step) * step), Math.max(hi, Math.ceil(hi / step) * step)];
}

const decades = ([lo, hi]: readonly [number, number]): number[] => {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.log10(hi) + 1e-9; e++) out.push(10 ** e);
  return out;
};

const PAD = { l: 52, r: 14, t: 14, b: 40 };

function scale(range: readonly [number, number], from: number, to: number, log: boolean) {
  const [lo, hi] = log ? [Math.log10(range[0]), Math.log10(range[1])] : range;
  return (v: number) => from + (((log ? Math.log10(v) : v) - lo) / (hi - lo)) * (to - from);
}

function axes(spec: PlotSpec, xr: readonly [number, number], yr: readonly [number, number], w: number, h: number) {
  const sx = scale(xr, PAD.l, w - PAD.r, !!spec.logX);
  const sy = spec.flipY ? scale(yr, PAD.t, h - PAD.b, !!spec.logY) : scale(yr, h - PAD.b, PAD.t, !!spec.logY);
  const marks: Mark[] = [];
  const xt = spec.xTicks ? spec.xTicks.map((t) => t.x) : spec.logX ? decades(xr) : niceTicks(xr[0], xr[1]);
  const xText = (v: number, i: number) => (spec.xTicks ? spec.xTicks[i].label : fmt(v, 4));
  const yt = spec.logY ? decades(yr) : niceTicks(yr[0], yr[1]);
  xt.forEach((v, i) => {
    marks.push({ kind: 'line', x1: sx(v), y1: PAD.t, x2: sx(v), y2: h - PAD.b, role: 'grid', width: 1 });
    marks.push({
      kind: 'text',
      x: sx(v),
      y: h - PAD.b + 14,
      text: xText(v, i),
      role: 'muted',
      anchor: 'middle',
      size: 10,
    });
  });
  for (const v of yt) {
    marks.push({ kind: 'line', x1: PAD.l, y1: sy(v), x2: w - PAD.r, y2: sy(v), role: 'grid', width: 1 });
    marks.push({ kind: 'text', x: PAD.l - 5, y: sy(v) + 3, text: fmt(v, 4), role: 'muted', anchor: 'end', size: 10 });
  }
  marks.push({ kind: 'path', d: `M${PAD.l} ${PAD.t}V${h - PAD.b}H${w - PAD.r}`, role: 'axis', width: 1 });
  marks.push({ kind: 'text', x: (PAD.l + w - PAD.r) / 2, y: h - 6, text: spec.xLabel, role: 'text', anchor: 'middle' });
  const mid = (PAD.t + h - PAD.b) / 2;
  marks.push({ kind: 'text', x: 12, y: mid, text: spec.yLabel, role: 'text', anchor: 'middle', rotate: -90 });
  return { sx, sy, marks };
}

/** The plot as a figure. Points outside the axes are clipped by leaving them out. */
export function linePlot(spec: PlotSpec): Figure {
  const w = spec.width ?? 360;
  const h = spec.height ?? 240;
  const all = spec.series.flatMap((s) => s.points);
  const xr =
    spec.x ??
    extent(
      all.map((p) => p[0]),
      !!spec.logX,
    );
  const yr =
    spec.y ??
    extent(
      all.map((p) => p[1]),
      !!spec.logY,
    );
  const { sx, sy, marks } = axes(spec, xr, yr, w, h);
  const inside = (p: readonly [number, number]) =>
    p[0] >= Math.min(...xr) - 1e-12 &&
    p[0] <= Math.max(...xr) + 1e-12 &&
    p[1] >= Math.min(...yr) - 1e-12 &&
    p[1] <= Math.max(...yr) + 1e-12;
  spec.series.forEach((s, i) => {
    const role = s.role ?? SERIES[i % SERIES.length];
    const shown = s.points.map((p) => (inside(p) && (!spec.logX || p[0] > 0) && (!spec.logY || p[1] > 0) ? p : null));
    if (s.dots) {
      for (const p of shown) if (p) marks.push({ kind: 'circle', cx: sx(p[0]), cy: sy(p[1]), r: 3, role, fill: true });
    } else {
      const pts = shown.map((p) => (p ? ([sx(p[0]), sy(p[1])] as const) : ([Number.NaN, Number.NaN] as const)));
      marks.push({ kind: 'path', d: pathOf(pts), role, dash: s.dash, width: 2 });
    }
  });
  for (const line of spec.vlines ?? []) {
    marks.push({
      kind: 'line',
      x1: sx(line.x),
      y1: PAD.t,
      x2: sx(line.x),
      y2: h - PAD.b,
      role: 'muted',
      dash: true,
      width: 1,
    });
    if (line.label)
      marks.push({ kind: 'text', x: sx(line.x) + 3, y: PAD.t + 10, text: line.label, role: 'muted', size: 10 });
  }
  for (const line of spec.hlines ?? []) {
    marks.push({
      kind: 'line',
      x1: PAD.l,
      y1: sy(line.y),
      x2: w - PAD.r,
      y2: sy(line.y),
      role: 'muted',
      dash: true,
      width: 1,
    });
    if (line.label)
      marks.push({
        kind: 'text',
        x: w - PAD.r - 3,
        y: sy(line.y) - 3,
        text: line.label,
        role: 'muted',
        anchor: 'end',
        size: 10,
      });
  }
  if (spec.extra) marks.push(...spec.extra(sx, sy));
  const labelled = spec.series.map((s, i) => ({ s, i })).filter(({ s }) => s.label);
  labelled.forEach(({ s, i }, row) => {
    const role = s.role ?? SERIES[i % SERIES.length];
    const y = PAD.t + 12 + row * 14;
    marks.push({
      kind: 'line',
      x1: w - PAD.r - 110,
      y1: y - 4,
      x2: w - PAD.r - 94,
      y2: y - 4,
      role,
      dash: s.dash,
      width: 2,
    });
    marks.push({ kind: 'text', x: w - PAD.r - 90, y, text: s.label!, role: 'text', size: 10 });
  });
  return { width: w, height: h, title: spec.title, description: spec.description, marks };
}
