// checks-disable-file brand-consistency: print colors for an inserted picture, which must not follow the app theme
// The kit's plots as a small SVG tree: axes with ticks (linear or log), lines, dashed lines, dots, segments, marked
// points and a legend. One tree draws in the window, in theme colors, and also writes the picture that Insert puts
// on the page, in fixed print colors, so the two never differ. Pure: no DOM.
import { num } from '../common';
import type { XY } from '../common';
import type { PlotSpec } from './spec';

export interface SvgNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly children?: readonly (SvgNode | string)[];
}

/** The plot's words, already looked up: title, axis labels, and one legend label per series. */
export interface PlotWords {
  readonly title: string;
  readonly x: string;
  readonly y: string;
  readonly series: readonly string[];
}

export const PLOT_W = 520;
export const PLOT_H = 320;
const M = { left: 60, right: 14, top: 30, bottom: 58 };
const TONES = ['$s0', '$s1', '$s2', '$s3', '$s4'] as const;

interface Axis {
  readonly lo: number;
  readonly hi: number;
  readonly log: boolean;
}

const finitePoint = (p: XY, ax: Axis, ay: Axis) =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && (!ax.log || p.x > 0) && (!ay.log || p.y > 0);

function range(values: readonly number[], log: boolean): [number, number] {
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (usable.length === 0) return log ? [1, 10] : [0, 1];
  let lo = Math.min(...usable);
  let hi = Math.max(...usable);
  if (log) {
    lo = Math.log10(lo);
    hi = Math.log10(hi);
    if (hi - lo < 1e-9) [lo, hi] = [lo - 0.5, hi + 0.5];
    return [Math.floor(lo * 4) / 4, Math.ceil(hi * 4) / 4];
  }
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.1 : 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.04;
  return [lo - pad, hi + pad];
}

/** Round tick values: 1, 2, or 5 times a power of ten, about `count` of them. */
export function ticks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const power = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => span / s <= count) ?? 10 * power;
  // Whole multiples of the step, counted by index and rounded, so 0.1 steps land on 0.3 rather than 0.30000000000000004.
  const out: number[] = [];
  const first = Math.ceil(lo / step - 1e-9);
  const last = Math.floor(hi / step + 1e-9);
  for (let i = first; i <= last; i += 1) out.push(i === 0 ? 0 : Number((i * step).toPrecision(12)));
  return out;
}

function axes(plot: PlotSpec): { ax: Axis; ay: Axis } {
  const points = plot.series.flatMap((s) => s.points).concat(plot.marks ?? []);
  const logX = plot.logX ?? false;
  const logY = plot.logY ?? false;
  let [x0, x1] = plot.window
    ? [plot.window.x0, plot.window.x1]
    : range(
        points.map((p) => p.x),
        logX,
      );
  let [y0, y1] = plot.window
    ? [plot.window.y0, plot.window.y1]
    : range(
        points.map((p) => p.y),
        logY,
      );
  if (plot.equal && !logX && !logY) {
    const w = PLOT_W - M.left - M.right;
    const h = PLOT_H - M.top - M.bottom;
    const scale = Math.max((x1 - x0) / w, (y1 - y0) / h);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    [x0, x1] = [cx - (scale * w) / 2, cx + (scale * w) / 2];
    [y0, y1] = [cy - (scale * h) / 2, cy + (scale * h) / 2];
  }
  return { ax: { lo: x0, hi: x1, log: logX }, ay: { lo: y0, hi: y1, log: logY } };
}

const node = (tag: string, attrs: SvgNode['attrs'], children?: SvgNode['children']): SvgNode =>
  children ? { tag, attrs, children } : { tag, attrs };

const r = (v: number) => Math.round(v * 10) / 10;

/** The tree for one plot. */
export function plotTree(plot: PlotSpec, words: PlotWords, id = 'aero-plot'): SvgNode {
  const { ax, ay } = axes(plot);
  const left = M.left;
  const right = PLOT_W - M.right;
  const top = M.top;
  const bottom = PLOT_H - M.bottom;
  const sx = (x: number) => {
    const v = ax.log ? Math.log10(x) : x;
    return left + ((v - ax.lo) / (ax.hi - ax.lo)) * (right - left);
  };
  const sy = (y: number) => {
    const v = ay.log ? Math.log10(y) : y;
    const f = (v - ay.lo) / (ay.hi - ay.lo);
    return plot.invertY ? top + f * (bottom - top) : bottom - f * (bottom - top);
  };
  const parts: SvgNode[] = [
    node('rect', { x: 0, y: 0, width: PLOT_W, height: PLOT_H, fill: '$bg' }),
    node('text', { x: left, y: 18, fill: '$text', fontSize: 13, fontWeight: 600 }, [words.title]),
  ];
  parts.push(...gridAndTicks(ax, 'x', sx, top, bottom), ...gridAndTicks(ay, 'y', sy, left, right));
  parts.push(
    node('rect', { x: left, y: top, width: right - left, height: bottom - top, fill: 'none', stroke: '$axis' }),
    node('text', { x: (left + right) / 2, y: bottom + 34, fill: '$muted', fontSize: 12, textAnchor: 'middle' }, [
      words.x,
    ]),
    node(
      'text',
      {
        x: 14,
        y: (top + bottom) / 2,
        fill: '$muted',
        fontSize: 12,
        textAnchor: 'middle',
        transform: `rotate(-90 14 ${(top + bottom) / 2})`,
      },
      [words.y],
    ),
  );
  const clip = { clipPath: `url(#${id}-area)` };
  parts.push(
    node('clipPath', { id: `${id}-area` }, [
      node('rect', { x: left, y: top, width: right - left, height: bottom - top }),
    ]),
  );
  plot.series.forEach((series, i) => {
    const tone = TONES[i % TONES.length]!;
    const pts = series.points;
    if (series.style === 'dots') {
      const dots = pts
        .filter((p) => finitePoint(p, ax, ay))
        .map((p) => node('circle', { cx: r(sx(p.x)), cy: r(sy(p.y)), r: 3, fill: tone }));
      parts.push(node('g', clip, dots));
      return;
    }
    let d = '';
    if (series.style === 'segments') {
      for (let k = 0; k + 1 < pts.length; k += 2) {
        const a = pts[k]!;
        const b = pts[k + 1]!;
        if (finitePoint(a, ax, ay) && finitePoint(b, ax, ay))
          d += `M${r(sx(a.x))} ${r(sy(a.y))}L${r(sx(b.x))} ${r(sy(b.y))}`;
      }
    } else {
      let pen = false;
      for (const p of pts) {
        if (!finitePoint(p, ax, ay)) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${r(sx(p.x))} ${r(sy(p.y))}`;
        pen = true;
      }
    }
    const dash: Record<string, string> = series.style === 'dashed' ? { strokeDasharray: '6 4' } : {};
    parts.push(node('path', { d, fill: 'none', stroke: tone, strokeWidth: 1.8, ...dash, ...clip }));
  });
  for (const mark of plot.marks ?? []) {
    if (!finitePoint(mark, ax, ay)) continue;
    parts.push(
      node('circle', { cx: r(sx(mark.x)), cy: r(sy(mark.y)), r: 4, fill: '$bg', stroke: '$text', strokeWidth: 1.5 }),
      node('text', { x: r(sx(mark.x)) + 7, y: r(sy(mark.y)) - 6, fill: '$text', fontSize: 11 }, [mark.label]),
    );
  }
  parts.push(...legend(words.series, bottom + 50));
  return node(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${PLOT_W} ${PLOT_H}`, width: PLOT_W, height: PLOT_H },
    parts,
  );
}

function gridAndTicks(axis: Axis, which: 'x' | 'y', scale: (v: number) => number, a: number, b: number): SvgNode[] {
  const values = axis.log
    ? ticks(Math.ceil(axis.lo), Math.floor(axis.hi), 6)
        .filter((v) => Number.isInteger(v))
        .map((v) => Math.pow(10, v))
    : ticks(axis.lo, axis.hi, which === 'x' ? 6 : 5);
  const out: SvgNode[] = [];
  for (const value of values) {
    const at = r(scale(value));
    const label = axis.log ? `1e${Math.round(Math.log10(value))}` : num(value, 4);
    if (which === 'x') {
      out.push(node('line', { x1: at, y1: a, x2: at, y2: b, stroke: '$grid' }));
      out.push(node('text', { x: at, y: b + 15, fill: '$muted', fontSize: 11, textAnchor: 'middle' }, [label]));
    } else {
      out.push(node('line', { x1: a, y1: at, x2: b, y2: at, stroke: '$grid' }));
      out.push(node('text', { x: a - 5, y: at + 4, fill: '$muted', fontSize: 11, textAnchor: 'end' }, [label]));
    }
  }
  return out;
}

function legend(labels: readonly string[], y: number): SvgNode[] {
  const out: SvgNode[] = [];
  let x = M.left;
  labels.forEach((label, i) => {
    if (label === '') return;
    const tone = TONES[i % TONES.length]!;
    out.push(node('line', { x1: x, y1: y - 4, x2: x + 18, y2: y - 4, stroke: tone, strokeWidth: 2.5 }));
    out.push(node('text', { x: x + 23, y, fill: '$text', fontSize: 11 }, [label]));
    x += 32 + label.length * 6.2;
  });
  return out;
}

/** Fixed colors for the picture Insert puts on the page, which is read on white like a printed figure. */
export const PRINT_COLORS: Readonly<Record<string, string>> = {
  $bg: '#ffffff',
  $text: '#1f2328',
  $muted: '#4b5260',
  $axis: '#6b7280',
  $grid: '#e3e5e8',
  $s0: '#2b6a8f',
  $s1: '#b4553a',
  $s2: '#4f7a3a',
  $s3: '#6b4fa0',
  $s4: '#a77c12',
};

const ATTR_NAMES: Readonly<Record<string, string>> = { viewBox: 'viewBox', xmlns: 'xmlns' };
const kebab = (name: string) => ATTR_NAMES[name] ?? name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quote = (text: string) => escape(text).replace(/"/g, '&quot;');

/** The tree as SVG text, with the tones replaced by fixed colors. */
export function svgText(tree: SvgNode, colors: Readonly<Record<string, string>> = PRINT_COLORS): string {
  const attrs = Object.entries(tree.attrs)
    .map(
      ([k, v]) => `${kebab(k)}="${quote(typeof v === 'string' && v.startsWith('$') ? (colors[v] ?? v) : String(v))}"`,
    )
    .join(' ');
  const inner = (tree.children ?? []).map((child) =>
    typeof child === 'string' ? escape(child) : svgText(child, colors),
  );
  return `<${tree.tag} ${attrs}>${inner.join('')}</${tree.tag}>`;
}
