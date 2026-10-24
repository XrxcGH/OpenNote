// The kit's plots as SVG text: axes with round ticks (linear or log), labeled with units, a few series, and marked
// points. The same text draws on screen, with colors from the theme's tokens, and becomes the picture the Insert
// menu puts on the page, with fixed colors (exportColors.ts). Pure, so it can be tested without a DOM.
import { fmt } from '../common/format';
import type { PlotSpec } from '../common/types';
import { defaultUnit, fromEngine, type System } from '../common/units';

export interface PlotColors {
  paper: string;
  grid: string;
  axis: string;
  text: string;
  pens: readonly string[];
  mark: string;
}

export const SCREEN_COLORS: PlotColors = {
  paper: 'var(--color-surface-page)',
  grid: 'var(--color-border-subtle)',
  axis: 'var(--color-text-secondary)',
  text: 'var(--color-text-secondary)',
  pens: ['var(--ink-indigo)', 'var(--ink-amber)', 'var(--ink-fern)', 'var(--ink-plum)', 'var(--ink-walnut)'],
  mark: 'var(--ink-brick)',
};

const W = 480;
const H = 300;
const PAD = { left: 64, right: 16, top: 16, bottom: 44 };

const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Round tick values covering [lo, hi]: steps of 1, 2, or 5 times a power of ten. */
export function linearTicks(lo: number, hi: number, target = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

/** Powers of ten covering [lo, hi], both above zero. */
export function logTicks(lo: number, hi: number): number[] {
  const ticks: number[] = [];
  for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9); e++) ticks.push(10 ** e);
  return ticks;
}

interface Axis {
  lo: number;
  hi: number;
  log: boolean;
}

function axisOf(values: number[], log: boolean): Axis {
  const finite = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 1;
  if (log) {
    if (!(lo > 0)) lo = 1;
    if (hi <= lo) hi = lo * 10;
    return { lo: lo / 1.3, hi: hi * 1.3, log };
  }
  if (hi - lo < 1e-12 * Math.max(1, Math.abs(hi))) [lo, hi] = [lo - 1, hi + 1];
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad, log };
}

const scale = (axis: Axis, v: number, from: number, to: number): number => {
  const t = axis.log
    ? (Math.log10(v) - Math.log10(axis.lo)) / (Math.log10(axis.hi) - Math.log10(axis.lo))
    : (v - axis.lo) / (axis.hi - axis.lo);
  return from + t * (to - from);
};

/** The axis title with its unit in the chosen system, such as "T (°C)". */
export function axisTitle(axis: PlotSpec['x'], system: System): string {
  const { label } = axis;
  const unit = defaultUnit(axis.qty, system, axis.unit);
  return unit ? `${label} (${unit})` : label;
}

/** The plot as SVG text, in the chosen unit system. */
// checks-disable-next-line modifiability: one drawing whose parts share the scales; the helpers above hold the math
export function plotSvg(spec: PlotSpec, system: System, colors: PlotColors, name: string): string {
  const xUnit = defaultUnit(spec.x.qty, system, spec.x.unit);
  const yUnit = defaultUnit(spec.y.qty, system, spec.y.unit);
  const series = spec.series.map((one) => ({
    ...one,
    points: one.points.map(([x, y]) => [fromEngine(x, spec.x.qty, xUnit), fromEngine(y, spec.y.qty, yUnit)] as const),
  }));
  const marks = (spec.marks ?? []).map((m) => ({
    ...m,
    x: fromEngine(m.x, spec.x.qty, xUnit),
    y: fromEngine(m.y, spec.y.qty, yUnit),
  }));
  const xs = [...series.flatMap((s) => s.points.map((p) => p[0])), ...marks.map((m) => m.x)];
  const ys = [...series.flatMap((s) => s.points.map((p) => p[1])), ...marks.map((m) => m.y)];
  const ax = axisOf(xs, !!spec.x.log);
  const ay = axisOf(ys, !!spec.y.log);
  const px = (v: number) => scale(ax, v, PAD.left, W - PAD.right);
  const py = (v: number) => scale(ay, v, H - PAD.bottom, PAD.top);
  const xTicks = ax.log ? logTicks(ax.lo, ax.hi) : linearTicks(ax.lo, ax.hi);
  const yTicks = ay.log ? logTicks(ay.lo, ay.hi) : linearTicks(ay.lo, ay.hi);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" ` +
      `aria-label="${escape(name)}" font-family="system-ui, sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H}" fill="${colors.paper}"/>`,
  ];
  for (const t of xTicks) {
    const x = px(t).toFixed(1);
    parts.push(`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H - PAD.bottom}" stroke="${colors.grid}"/>`);
    parts.push(
      `<text x="${x}" y="${H - PAD.bottom + 14}" text-anchor="middle" fill="${colors.text}">${fmt(t, 4)}</text>`,
    );
  }
  for (const t of yTicks) {
    const y = py(t).toFixed(1);
    parts.push(`<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="${colors.grid}"/>`);
    parts.push(`<text x="${PAD.left - 6}" y="${y}" dy="4" text-anchor="end" fill="${colors.text}">${fmt(t, 4)}</text>`);
  }
  const box = `${PAD.left},${PAD.top} ${W - PAD.right},${PAD.top} ${W - PAD.right},${H - PAD.bottom}`;
  parts.push(
    `<polyline points="${box} ${PAD.left},${H - PAD.bottom} ${PAD.left},${PAD.top}" fill="none" stroke="${colors.axis}"/>`,
  );
  parts.push(
    `<text x="${(PAD.left + W - PAD.right) / 2}" y="${H - 8}" text-anchor="middle" fill="${colors.text}">` +
      `${escape(axisTitle(spec.x, system))}</text>`,
    `<text transform="translate(14 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)" text-anchor="middle" ` +
      `fill="${colors.text}">${escape(axisTitle(spec.y, system))}</text>`,
  );
  series.forEach((one, i) => {
    const pen = colors.pens[i % colors.pens.length];
    const points = one.points
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!ax.log || x > 0) && (!ay.log || y > 0))
      .map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`)
      .join(' ');
    const dash = one.dashed ? ' stroke-dasharray="6 4"' : '';
    parts.push(`<polyline points="${points}" fill="none" stroke="${pen}" stroke-width="2"${dash}/>`);
    const ly = PAD.top + 12 + i * 14;
    parts.push(
      `<line x1="${W - PAD.right - 118}" y1="${ly - 4}" x2="${W - PAD.right - 100}" y2="${ly - 4}" stroke="${pen}" ` +
        `stroke-width="2"${dash}/>`,
      `<text x="${W - PAD.right - 96}" y="${ly}" fill="${colors.text}">${escape(one.name)}</text>`,
    );
  });
  for (const m of marks) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    const [x, y] = [px(m.x).toFixed(1), py(m.y).toFixed(1)];
    parts.push(`<circle cx="${x}" cy="${y}" r="4" fill="${colors.mark}" stroke="${colors.paper}" stroke-width="1.5"/>`);
    parts.push(`<text x="${x}" y="${y}" dx="6" dy="-6" fill="${colors.text}">${escape(m.label)}</text>`);
  }
  parts.push('</svg>');
  return parts.join('');
}
