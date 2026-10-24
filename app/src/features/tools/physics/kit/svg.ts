// Draws a Plot as SVG text: an x-y plot with axes and ticks, or a sketch with equal scales (orbits, ray diagrams,
// field lines). The window shows it with the theme's color tokens, so it follows light, dark, and contrast themes;
// Insert draws it again with the colors the theme has now, so the picture on the page keeps them.
import { formatNumber } from '../../../../core/expr';
import type { Plot, Tone } from './types';

export interface Palette {
  ink: string;
  muted: string;
  grid: string;
  accent: string;
  second: string;
  third: string;
  danger: string;
  font: string;
}

/** Theme tokens, for the picture shown in the window. */
export const TOKEN_PALETTE: Palette = {
  ink: 'var(--color-text-primary)',
  muted: 'var(--color-text-muted)',
  grid: 'var(--color-border-subtle)',
  accent: 'var(--color-accent-primary)',
  second: 'var(--color-accent-clay)',
  third: 'var(--color-accent-dusk)',
  danger: 'var(--color-status-danger)',
  font: 'var(--font-ui)',
};

const WIDTH = 520;
const AXES_HEIGHT = 320;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (value: number) => (Math.round(value * 100) / 100).toString();

/** A round step near span / count: 1, 2, or 5 times a power of ten. */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit >= 5 ? 5 : unit >= 2 ? 2 : 1) * power;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function dataBox(plot: Plot): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  };
  for (const series of plot.series) for (const [x, y] of series.points) add(x, y);
  for (const c of plot.circles ?? []) {
    const r = c.px ? 0 : c.r;
    add(c.x - r, c.y - r);
    add(c.x + r, c.y + r);
  }
  for (const label of plot.labels ?? []) add(label.x, label.y);
  for (const arrow of plot.arrows ?? []) {
    add(arrow.x1, arrow.y1);
    add(arrow.x2, arrow.y2);
  }
  const box = {
    x0: plot.x.min ?? (xs.length ? Math.min(...xs) : 0),
    x1: plot.x.max ?? (xs.length ? Math.max(...xs) : 1),
    y0: plot.y.min ?? (ys.length ? Math.min(...ys) : 0),
    y1: plot.y.max ?? (ys.length ? Math.max(...ys) : 1),
  };
  const widen = (low: number, high: number): [number, number] => {
    if (high > low) return [low, high];
    const pad = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1;
    return [low - pad, high + pad];
  };
  [box.x0, box.x1] = widen(box.x0, box.x1);
  [box.y0, box.y1] = widen(box.y0, box.y1);
  const padX = plot.x.min === undefined && plot.x.max === undefined ? (box.x1 - box.x0) * 0.04 : 0;
  const padY = plot.y.min === undefined && plot.y.max === undefined ? (box.y1 - box.y0) * 0.06 : 0;
  return { x0: box.x0 - padX, x1: box.x1 + padX, y0: box.y0 - padY, y1: box.y1 + padY };
}

interface Frame {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  sx(x: number): number;
  sy(y: number): number;
  scale: number;
}

function frameFor(plot: Plot, box: Box): Frame {
  if (plot.frame === 'axes') {
    const [left, right, top, bottom] = [60, WIDTH - 16, 14, AXES_HEIGHT - 44];
    const kx = (right - left) / (box.x1 - box.x0);
    const ky = (bottom - top) / (box.y1 - box.y0);
    return {
      width: WIDTH,
      height: AXES_HEIGHT,
      left,
      top,
      right,
      bottom,
      sx: (x) => left + (x - box.x0) * kx,
      sy: (y) => bottom - (y - box.y0) * ky,
      scale: kx,
    };
  }
  const margin = plot.frame === 'equal' ? 28 : 12;
  const inner = WIDTH - 2 * margin;
  const scale = inner / (box.x1 - box.x0);
  const height = Math.min(Math.max((box.y1 - box.y0) * scale + 2 * margin, 160), 560);
  const k = Math.min(scale, (height - 2 * margin) / (box.y1 - box.y0));
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  return {
    width: WIDTH,
    height,
    left: margin,
    top: margin,
    right: WIDTH - margin,
    bottom: height - margin,
    sx: (x) => WIDTH / 2 + (x - cx) * k,
    sy: (y) => height / 2 - (y - cy) * k,
    scale: k,
  };
}

function ticks(low: number, high: number): number[] {
  const step = niceStep(high - low);
  const out: number[] = [];
  for (let i = Math.ceil(low / step - 1e-9); i * step <= high + step * 1e-9; i++)
    out.push(Number((i * step).toPrecision(12)));
  return out;
}

const tickText = (value: number) => {
  const text = formatNumber(value, { digits: 4 });
  return text.replace(/^-/, '−');
};

function axes(plot: Plot, box: Box, f: Frame, p: Palette): string[] {
  const out: string[] = [];
  const text = `font-family:${p.font};font-size:11px;fill:${p.muted}`;
  for (const x of ticks(box.x0, box.x1)) {
    const px = n(f.sx(x));
    out.push(`<line x1="${px}" y1="${n(f.top)}" x2="${px}" y2="${n(f.bottom)}" style="stroke:${p.grid}"/>`);
    out.push(`<text x="${px}" y="${n(f.bottom + 15)}" text-anchor="middle" style="${text}">${tickText(x)}</text>`);
  }
  for (const y of ticks(box.y0, box.y1)) {
    const py = n(f.sy(y));
    out.push(`<line x1="${n(f.left)}" y1="${py}" x2="${n(f.right)}" y2="${py}" style="stroke:${p.grid}"/>`);
    out.push(`<text x="${n(f.left - 6)}" y="${py}" dy="4" text-anchor="end" style="${text}">${tickText(y)}</text>`);
  }
  const frame = `style="fill:none;stroke:${p.muted}"`;
  out.push(
    `<rect x="${n(f.left)}" y="${n(f.top)}" width="${n(f.right - f.left)}" height="${n(f.bottom - f.top)}" ${frame}/>`,
  );
  const label = `font-family:${p.font};font-size:12px;fill:${p.ink}`;
  const midX = n((f.left + f.right) / 2);
  out.push(
    `<text x="${midX}" y="${n(f.height - 6)}" text-anchor="middle" style="${label}">${escape(plot.x.label)}</text>`,
  );
  const midY = n((f.top + f.bottom) / 2);
  out.push(
    `<text transform="translate(14 ${midY}) rotate(-90)" text-anchor="middle" style="${label}">` +
      `${escape(plot.y.label)}</text>`,
  );
  return out;
}

const toneColor = (p: Palette, tone: Tone = 'accent') => p[tone];

function pathOf(points: readonly (readonly [number, number])[], f: Frame): string {
  let d = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${n(f.sx(x))} ${n(f.sy(y))}`;
    pen = true;
  }
  return d;
}

function marks(plot: Plot, f: Frame, p: Palette): string[] {
  const out: string[] = [];
  for (const s of plot.series) {
    const d = pathOf(s.points, f);
    if (d === '') continue;
    const color = toneColor(p, s.tone);
    const fill = s.fill ? `fill:${color};fill-opacity:0.12` : 'fill:none';
    const dash = s.dash ? ';stroke-dasharray:6 4' : '';
    out.push(
      `<path d="${d}${s.fill ? 'Z' : ''}" style="${fill};stroke:${color};stroke-width:${s.width ?? 2}${dash}"/>`,
    );
  }
  for (const c of plot.circles ?? []) {
    const color = toneColor(p, c.tone);
    const r = c.px ? c.r : c.r * f.scale;
    const fill = c.fill ? `fill:${color}` : 'fill:none';
    out.push(
      `<circle cx="${n(f.sx(c.x))}" cy="${n(f.sy(c.y))}" r="${n(r)}" style="${fill};stroke:${color};stroke-width:1.5"/>`,
    );
  }
  for (const a of plot.arrows ?? []) {
    const color = toneColor(p, a.tone);
    const [x1, y1, x2, y2] = [f.sx(a.x1), f.sy(a.y1), f.sx(a.x2), f.sy(a.y2)];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = (turn: number) => `${n(x2 - 9 * Math.cos(angle + turn))} ${n(y2 - 9 * Math.sin(angle + turn))}`;
    out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" style="stroke:${color};stroke-width:2"/>`);
    out.push(`<path d="M${n(x2)} ${n(y2)}L${head(0.4)}L${head(-0.4)}Z" style="fill:${color}"/>`);
  }
  return out;
}

function labels(plot: Plot, f: Frame, p: Palette): string[] {
  const out: string[] = [];
  for (const l of plot.labels ?? []) {
    const style = `font-family:${p.font};font-size:12px;fill:${toneColor(p, l.tone ?? 'ink')}`;
    const anchor = l.anchor ?? 'start';
    out.push(
      `<text x="${n(f.sx(l.x))}" y="${n(f.sy(l.y))}" text-anchor="${anchor}" style="${style}">${escape(l.text)}</text>`,
    );
  }
  return out;
}

function legend(plot: Plot, f: Frame, p: Palette, word: (key: string) => string): string[] {
  const out: string[] = [];
  (plot.legend ?? []).forEach((entry, i) => {
    const y = f.top + 14 + i * 16;
    const x = f.right - 150;
    const color = toneColor(p, entry.tone);
    const dash = entry.dash ? ';stroke-dasharray:6 4' : '';
    out.push(
      `<line x1="${n(x)}" y1="${n(y - 4)}" x2="${n(x + 22)}" y2="${n(y - 4)}" style="stroke:${color};stroke-width:2${dash}"/>`,
    );
    const style = `font-family:${p.font};font-size:11px;fill:${p.ink}`;
    out.push(`<text x="${n(x + 28)}" y="${n(y)}" style="${style}">${escape(word(entry.key))}</text>`);
  });
  return out;
}

/** The plot as SVG text, with `alt` as its accessible name; `word` says the legend's message keys. */
export function plotToSvg(plot: Plot, palette: Palette, alt: string, word: (key: string) => string = String): string {
  const box = dataBox(plot);
  const f = frameFor(plot, box);
  const clip = `physics-clip-${Math.round(f.width)}-${Math.round(f.height)}`;
  const body = [
    ...(plot.frame === 'axes' ? axes(plot, box, f, palette) : []),
    `<g clip-path="url(#${clip})">`,
    ...marks(plot, f, palette),
    '</g>',
    ...labels(plot, f, palette),
    ...legend(plot, f, palette, word),
  ];
  const size = `width="${n(f.width)}" height="${n(f.height)}" viewBox="0 0 ${n(f.width)} ${n(f.height)}"`;
  const rect = `<rect x="${n(f.left)}" y="${n(f.top)}" width="${n(f.right - f.left)}" height="${n(f.bottom - f.top)}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${size} role="img" aria-label="${escape(alt)}">` +
    `<title>${escape(alt)}</title><defs><clipPath id="${clip}">${rect}</clipPath></defs>${body.join('')}</svg>`
  );
}
