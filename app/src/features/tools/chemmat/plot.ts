// Draws a PlotData as SVG text. The same drawing serves the window (colors from the theme's tokens) and the picture
// inserted into a page (fixed colors, since a picture cannot read the theme). Lines differ by dash pattern as well as
// color, and a legend names each series.
import { tokens } from '../../../theme/tokens';
import type { PlotData } from './types';

const W = 520;
const BASE_H = 300;
const M = { left: 62, right: 16, top: 14, bottom: 52 };
const LEGEND_ROW = 16;

export interface PlotText {
  x: string;
  y: string;
  series: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** About `count` round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step)
    out.push(Number(v.toPrecision(12)));
  return out;
}

function tickLabel(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  return String(Number(v.toPrecision(4)));
}

interface Style {
  ink: string;
  grid: string;
  lines: string[];
  ground: string;
}

const light = tokens.color.light;

/** In the window the picture follows the theme; in a page it uses the light theme's colors on the page color. */
const THEMED: Style = {
  ink: 'currentColor',
  grid: 'var(--color-border-subtle)',
  lines: ['var(--color-accent-primary)', 'currentColor', 'var(--color-text-secondary)'],
  ground: '',
};
const FIXED: Style = {
  ink: light.text.primary,
  grid: light.border.subtle,
  lines: [light.text.link, light.text.primary, light.text.secondary],
  ground: light.surface.page,
};
const DASH = ['', '6 3', '2 3'];

const dashAttr = (i: number) => (DASH[i % DASH.length] ? ` stroke-dasharray="${DASH[i % DASH.length]}"` : '');
const text = (x: number, y: number, anchor: string, size: number, fill: string, body: string, extra = '') =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" fill="${fill}"${extra}>${body}</text>`;

interface Frame {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  height: number;
  px(x: number): number;
  py(y: number): number;
}

function frameOf(data: PlotData, height: number): Frame | null {
  const ok = ([x, y]: readonly [number, number]) => (!data.logX || x > 0) && (!data.logY || y > 0);
  const all = data.series.flatMap((s) => s.points.filter(ok));
  if (all.length === 0) return null;
  const fx = (x: number) => (data.logX ? Math.log10(x) : x);
  const fy = (y: number) => (data.logY ? Math.log10(y) : y);
  let x0 = Math.min(...all.map((p) => fx(p[0])));
  let x1 = Math.max(...all.map((p) => fx(p[0])));
  let y0 = Math.min(...all.map((p) => fy(p[1])));
  let y1 = Math.max(...all.map((p) => fy(p[1])));
  if (x1 === x0) [x0, x1] = [x0 - 1, x1 + 1];
  if (y1 === y0) [y0, y1] = [y0 - 1, y1 + 1];
  const pad = (y1 - y0) * 0.05;
  [y0, y1] = [y0 - pad, y1 + pad];
  const px = (x: number) => M.left + ((fx(x) - x0) / (x1 - x0)) * (W - M.left - M.right);
  const py = (y: number) => height - M.bottom - ((fy(y) - y0) / (y1 - y0)) * (height - M.top - M.bottom);
  return { x0, x1, y0, y1, height, px, py };
}

/** Tick values: round numbers on a linear axis, powers of ten on a log axis. */
function ticks(lo: number, hi: number, log: boolean): number[] {
  if (!log) return niceTicks(lo, hi);
  return Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.pow(10, Math.ceil(lo) + i));
}

function axes(data: PlotData, f: Frame, s: Style, t: PlotText): string[] {
  const parts: string[] = [];
  const bottom = f.height - M.bottom;
  for (const v of ticks(f.x0, f.x1, !!data.logX)) {
    const x = f.px(v);
    parts.push(`<line x1="${x.toFixed(1)}" y1="${M.top}" x2="${x.toFixed(1)}" y2="${bottom}" stroke="${s.grid}"/>`);
    parts.push(text(x, bottom + 16, 'middle', 11, s.ink, tickLabel(v)));
  }
  for (const v of ticks(f.y0, f.y1, !!data.logY)) {
    const y = f.py(v);
    parts.push(
      `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${W - M.right}" y2="${y.toFixed(1)}" stroke="${s.grid}"/>`,
    );
    parts.push(text(M.left - 6, y + 4, 'end', 11, s.ink, tickLabel(v)));
  }
  parts.push(
    `<rect x="${M.left}" y="${M.top}" width="${W - M.left - M.right}" height="${bottom - M.top}" fill="none" stroke="${s.ink}"/>`,
  );
  const midX = (M.left + W - M.right) / 2;
  parts.push(text(midX, bottom + 34, 'middle', 12, s.ink, esc(t.x)));
  const midY = (M.top + bottom) / 2;
  parts.push(text(0, 0, 'middle', 12, s.ink, esc(t.y), ` transform="translate(14 ${midY}) rotate(-90)"`));
  return parts;
}

function seriesParts(data: PlotData, f: Frame, s: Style): string[] {
  const parts: string[] = [];
  data.series.forEach((series, i) => {
    const pts = series.points.filter(([x, y]) => (!data.logX || x > 0) && (!data.logY || y > 0));
    const color = s.lines[i % s.lines.length];
    if (series.style === 'dots') {
      for (const [x, y] of pts)
        parts.push(`<circle cx="${f.px(x).toFixed(1)}" cy="${f.py(y).toFixed(1)}" r="3.5" fill="${color}"/>`);
    } else if (pts.length > 1) {
      const d = pts.map(([x, y], k) => `${k === 0 ? 'M' : 'L'}${f.px(x).toFixed(1)} ${f.py(y).toFixed(1)}`).join('');
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2"${dashAttr(i)}/>`);
    }
  });
  return parts;
}

/** The legend entries laid out left to right, wrapping to a new row when the line is full. */
function legendLayout(labels: string[]): { x: number; row: number }[] {
  let x = M.left;
  let row = 0;
  return labels.map((label) => {
    const width = 32 + label.length * 6.2;
    if (x + width > W - M.right && x > M.left) {
      x = M.left;
      row += 1;
    }
    const at = { x, row };
    x += width + 12;
    return at;
  });
}

function legend(data: PlotData, labels: string[], f: Frame, s: Style): string[] {
  const parts: string[] = [];
  const top = f.height - M.bottom + 44;
  legendLayout(labels).forEach(({ x, row }, i) => {
    const y = top + row * LEGEND_ROW;
    const color = s.lines[i % s.lines.length];
    parts.push(
      data.series[i]?.style === 'dots'
        ? `<circle cx="${x + 10}" cy="${y - 4}" r="3.5" fill="${color}"/>`
        : `<line x1="${x}" y1="${y - 4}" x2="${x + 20}" y2="${y - 4}" stroke="${color}" stroke-width="2"${dashAttr(i)}/>`,
    );
    parts.push(text(x + 26, y, 'start', 11, s.ink, esc(labels[i] ?? '')));
  });
  return parts;
}

/** The SVG for a plot. `themed` uses the app's color tokens; otherwise fixed colors on the page color. */
export function plotSvg(data: PlotData, t: PlotText, themed: boolean): string {
  const s = themed ? THEMED : FIXED;
  const rows = legendLayout(t.series).reduce((m, p) => Math.max(m, p.row + 1), 1);
  const height = BASE_H + 20 + rows * LEGEND_ROW;
  const frame = frameOf(data, height);
  if (!frame) return '';
  const body = [...axes(data, frame, s, t), ...seriesParts(data, frame, s), ...legend(data, t.series, frame, s)];
  const ground = s.ground ? `<rect width="${W}" height="${height}" fill="${s.ground}"/>` : '';
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}"`;
  return `${open} font-family="system-ui, sans-serif">${ground}${body.join('')}</svg>`;
}
