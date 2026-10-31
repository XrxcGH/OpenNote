// A plot as SVG text: axes with round ticks (decades on log axes), the series as lines or marks, and a legend. One
// renderer serves the window, where colors are theme tokens, and the picture for the page, where they are fixed.
import { tokens } from '../../../../theme/tokens';
import { fmt } from '../core/format';
import type { Plot } from '../core/types';

export interface PlotText {
  title: string;
  description: string;
  x: string;
  y: string;
  series: readonly string[];
}

interface Palette {
  text: string;
  muted: string;
  axis: string;
  grid: string;
  background: string;
  series: readonly string[];
}

export const THEME_PALETTE: Palette = {
  text: 'var(--color-text-primary)',
  muted: 'var(--color-text-secondary)',
  axis: 'var(--color-border-control)',
  grid: 'var(--color-border-subtle)',
  background: 'transparent',
  series: [
    'var(--color-accent-primary)',
    'var(--color-accent-dusk)',
    'var(--color-accent-clay)',
    'var(--color-accent-night)',
  ],
};

const light = tokens.color.light;
export const PICTURE_PALETTE: Palette = {
  text: light.text.primary,
  muted: light.text.secondary,
  axis: light.border.control,
  grid: light.border.subtle,
  background: light.surface.page,
  series: [light.accent.primary, light.accent.dusk, light.accent.clay, light.accent.night],
};

// Color is never the only cue: each series also has its own dash pattern and mark shape.
const DASHES = ['', '7 4', '2 3', '9 3 2 3'];
const WIDTH = 520;
const HEIGHT = 320;
const PAD = { left: 64, right: 16, top: 16, bottom: 48 };

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Axis {
  lo: number;
  hi: number;
  log: boolean;
  ticks: number[];
}

function niceStep(span: number): number {
  const raw = span / 5;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3 ? 2 : unit < 7 ? 5 : 10) * power;
}

function axis(values: readonly number[], log: boolean, extend?: number): Axis {
  const usable = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  let lo = usable.length ? Math.min(...usable) : 0;
  let hi = usable.length ? Math.max(...usable) : 1;
  if (log) {
    const a = Math.floor(Math.log10(lo));
    const b = Math.max(a + 1, Math.ceil(Math.log10(hi)));
    const ticks = Array.from({ length: b - a + 1 }, (_, i) => 10 ** (a + i));
    return { lo: 10 ** a, hi: 10 ** b, log, ticks };
  }
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  if (extend !== undefined && extend > hi - lo) {
    const middle = (lo + hi) / 2;
    lo = middle - extend / 2;
    hi = middle + extend / 2;
  }
  const step = niceStep(hi - lo);
  const start = Math.floor(lo / step + 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { lo: start, hi: end, log, ticks };
}

const position = (a: Axis, v: number, size: number) => {
  const f = a.log
    ? (Math.log10(v) - Math.log10(a.lo)) / (Math.log10(a.hi) - Math.log10(a.lo))
    : (v - a.lo) / (a.hi - a.lo);
  return f * size;
};

function axes(plot: Plot, w: number, h: number): { x: Axis; y: Axis } {
  const xs = plot.series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = plot.series.flatMap((s) => s.points.map((p) => p[1]));
  let x = axis(xs, !!plot.xLog);
  let y = axis(ys, !!plot.yLog);
  if (plot.equal && !x.log && !y.log) {
    // Equal scales: widen the axis whose range is short for its length.
    const perPixel = Math.max((x.hi - x.lo) / w, (y.hi - y.lo) / h);
    x = axis(xs, false, perPixel * w * 0.98);
    y = axis(ys, false, perPixel * h * 0.98);
  }
  return { x, y };
}

function mark(shape: number, cx: number, cy: number, color: string): string {
  const s = 3.5;
  const style = `style="fill:${color};stroke:${color}"`;
  if (shape % 3 === 1) return `<rect x="${cx - s}" y="${cy - s}" width="${2 * s}" height="${2 * s}" ${style}/>`;
  if (shape % 3 === 2)
    return `<path d="M${cx} ${cy - s - 1}L${cx + s + 1} ${cy + s}L${cx - s - 1} ${cy + s}Z" ${style}/>`;
  return `<circle cx="${cx}" cy="${cy}" r="${s}" ${style}/>`;
}

/** The plot as a standalone SVG document with a title and description for screen readers. */
export function plotSvg(plot: Plot, text: PlotText, palette: Palette = THEME_PALETTE, id = 'civil-plot'): string {
  const legendRows = Math.ceil(plot.series.length / 2);
  const height = HEIGHT + legendRows * 18;
  const w = WIDTH - PAD.left - PAD.right;
  const h = HEIGHT - PAD.top - PAD.bottom;
  const { x, y } = axes(plot, w, h);
  const px = (v: number) => PAD.left + position(x, v, w);
  const py = (v: number) => PAD.top + (plot.yDown ? position(y, v, h) : h - position(y, v, h));
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" ` +
      `role="img" aria-labelledby="${id}-t ${id}-d" font-family="${escape(tokens.font.ui)}" font-size="11">`,
    `<title id="${id}-t">${escape(text.title)}</title><desc id="${id}-d">${escape(text.description)}</desc>`,
    `<rect width="${WIDTH}" height="${height}" style="fill:${palette.background}"/>`,
  );
  for (const v of x.ticks) {
    const at = px(v);
    out.push(
      `<line x1="${at}" y1="${PAD.top}" x2="${at}" y2="${PAD.top + h}" style="stroke:${palette.grid}"/>`,
      `<text x="${at}" y="${PAD.top + h + 14}" text-anchor="middle" style="fill:${palette.muted}">${escape(fmt(v, 4))}</text>`,
    );
  }
  for (const v of y.ticks) {
    const at = py(v);
    out.push(
      `<line x1="${PAD.left}" y1="${at}" x2="${PAD.left + w}" y2="${at}" style="stroke:${palette.grid}"/>`,
      `<text x="${PAD.left - 6}" y="${at + 4}" text-anchor="end" style="fill:${palette.muted}">${escape(fmt(v, 4))}</text>`,
    );
  }
  out.push(
    `<rect x="${PAD.left}" y="${PAD.top}" width="${w}" height="${h}" style="fill:none;stroke:${palette.axis}"/>`,
    `<text x="${PAD.left + w / 2}" y="${PAD.top + h + 32}" text-anchor="middle" style="fill:${palette.text}">${escape(text.x)}</text>`,
    `<text transform="translate(14 ${PAD.top + h / 2}) rotate(-90)" text-anchor="middle" style="fill:${palette.text}">` +
      `${escape(text.y)}</text>`,
  );
  const inside = (p: readonly [number, number]) =>
    Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!x.log || p[0] > 0) && (!y.log || p[1] > 0);
  plot.series.forEach((series, index) => {
    const color = palette.series[index % palette.series.length]!;
    const points = series.points.filter(inside);
    if (series.style === 'points') {
      for (const p of points) out.push(mark(index, px(p[0]), py(p[1]), color));
    } else if (points.length > 1) {
      // A point that cannot be drawn, such as NaN, lifts the pen, so one series can hold several pieces.
      let up = true;
      const d = series.points
        .map((p) => {
          if (!inside(p)) {
            up = true;
            return '';
          }
          const move = up ? 'M' : 'L';
          up = false;
          return `${move}${px(p[0]).toFixed(2)} ${py(p[1]).toFixed(2)}`;
        })
        .join('');
      const dash = series.style === 'dashed' ? '7 4' : DASHES[index % DASHES.length];
      out.push(
        `<path d="${d}" style="fill:none;stroke:${color}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
      );
    }
    const lx = PAD.left + (index % 2) * (w / 2);
    const ly = HEIGHT + Math.floor(index / 2) * 18 - 4;
    out.push(
      series.style === 'points'
        ? mark(index, lx + 12, ly - 4, color)
        : `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 24}" y2="${ly - 4}" style="stroke:${color}" stroke-width="2"` +
            `${DASHES[index % DASHES.length] ? ` stroke-dasharray="${DASHES[index % DASHES.length]}"` : ''}/>`,
      `<text x="${lx + 30}" y="${ly}" style="fill:${palette.text}">${escape(text.series[index] ?? '')}</text>`,
    );
  });
  out.push('</svg>');
  return out.join('');
}
