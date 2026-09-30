// Ink for the PDF export spike: pen strokes built with perfect-freehand and drawn as SVG paths, so they stay
// vector graphics in the PDF. Shapes are generated from a seeded random source, so every run draws the same ink.
import { getStroke } from 'perfect-freehand';

/** A pen sample: x and y in CSS pixels, and pressure from 0 to 1. */
export type Sample = [number, number, number];

/** The light values of the default pens and highlighters in brand/tokens.json. */
export const PENS = {
  indigo: '#2F4F9A',
  brick: '#B0342A',
  fern: '#2E7048',
  plum: '#6A4A9C',
  amber: '#B8620F',
  walnut: '#6E4B2E',
} as const;
export const HONEY = '#F2CF4A';
/** Highlighters are 40% opaque (tokens.json stores them as #RRGGBB66). */
export const HIGHLIGHTER_OPACITY = 0.4;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A small deterministic random source (mulberry32), so the ink is the same on every run. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pressure that starts light, peaks in the middle, and lifts at the end, like a real pen stroke. */
function pressure(t: number): number {
  return 0.3 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

/** Samples a parametric curve into pen samples. */
function trace(count: number, at: (t: number) => [number, number]): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const [x, y] = at(t);
    samples.push([x, y, pressure(t)]);
  }
  return samples;
}

/** Turns a perfect-freehand outline into an SVG path with quadratic curves, rounded to 0.01 px. */
export function outlinePath(outline: number[][]): string {
  if (outline.length < 2) return '';
  const round = (value: number) => Math.round(value * 100) / 100;
  const parts = ['M', round(outline[0][0]), round(outline[0][1]), 'Q'];
  outline.forEach(([x0, y0], i) => {
    const [x1, y1] = outline[(i + 1) % outline.length];
    parts.push(round(x0), round(y0), round((x0 + x1) / 2), round((y0 + y1) / 2));
  });
  parts.push('Z');
  return parts.join(' ');
}

/** Builds one stroke as an SVG path element. `size` is the pen width in CSS pixels. */
export function stroke(samples: Sample[], color: string, size: number, opacity = 1): SVGPathElement {
  const outline = getStroke(samples, {
    size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: false,
    last: true,
  });
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', outlinePath(outline));
  path.setAttribute('fill', color);
  if (opacity < 1) path.setAttribute('fill-opacity', String(opacity));
  path.dataset.stroke = color;
  return path;
}

/** An SVG element for ink, sized in CSS pixels. */
export function inkLayer(className: string, width: number, height: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** A slightly wavy line, as a hand draws a straight line. */
export function line(x0: number, y0: number, x1: number, y1: number, rng: () => number): Sample[] {
  const wobble = 0.6 + rng();
  const phase = rng() * Math.PI;
  const [dx, dy] = [x1 - x0, y1 - y0];
  const length = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / length, dx / length];
  return trace(Math.max(8, Math.round(length / 6)), (t) => {
    const offset = wobble * Math.sin(phase + t * Math.PI * 2);
    return [x0 + dx * t + nx * offset, y0 + dy * t + ny * offset];
  });
}

/** A hand-drawn ellipse that overshoots its start a little. */
export function ellipse(cx: number, cy: number, rx: number, ry: number, rng: () => number): Sample[] {
  const start = rng() * Math.PI * 2;
  const turn = Math.PI * 2 * (1.08 + rng() * 0.08);
  return trace(48, (t) => {
    const angle = start + turn * t;
    const grow = 1 + 0.06 * t;
    return [cx + rx * grow * Math.cos(angle), cy + ry * grow * Math.sin(angle)];
  });
}

/** A five-pointed star drawn in one stroke. */
export function star(cx: number, cy: number, radius: number): Sample[] {
  const points: [number, number][] = [];
  for (let i = 0; i <= 5; i++) {
    const angle = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return trace(50, (t) => {
    const position = t * 5;
    const index = Math.min(4, Math.floor(position));
    const local = position - index;
    const [a, b] = [points[index], points[index + 1]];
    return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
  });
}

/** Cursive-looking loops, like a quick handwritten word. */
export function scribble(x: number, y: number, width: number, height: number, rng: () => number): Sample[] {
  const loops = Math.max(3, Math.round(width / (height * 0.7)));
  const slant = 0.2 + rng() * 0.15;
  return trace(loops * 14, (t) => {
    const angle = t * loops * Math.PI * 2;
    const rise = height * (0.35 + 0.15 * Math.sin(t * 7 + rng() * 0.2));
    const px = x + t * width + rise * 0.45 * Math.cos(angle) + slant * rise;
    return [px, y - rise * (0.5 - 0.5 * Math.cos(angle))];
  });
}

/** An arrow as two strokes: the shaft and the head. */
export function arrow(x0: number, y0: number, x1: number, y1: number, rng: () => number): Sample[][] {
  const angle = Math.atan2(y1 - y0, x1 - x0);
  const head = 12;
  const left: [number, number] = [x1 - head * Math.cos(angle - 0.5), y1 - head * Math.sin(angle - 0.5)];
  const right: [number, number] = [x1 - head * Math.cos(angle + 0.5), y1 - head * Math.sin(angle + 0.5)];
  const shaft = line(x0, y0, x1, y1, rng);
  const tip = [...line(left[0], left[1], x1, y1, rng), ...line(x1, y1, right[0], right[1], rng).slice(1)];
  return [shaft, tip];
}

/** A wave, used for membranes in the sketches. */
export function wave(x: number, y: number, width: number, amplitude: number, periods: number): Sample[] {
  return trace(Math.round(periods * 16), (t) => [x + width * t, y + amplitude * Math.sin(t * periods * Math.PI * 2)]);
}
