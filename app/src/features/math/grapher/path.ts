// SVG path output. Sampled curves become `d` strings in pixel coordinates, clipped to the drawing area so that an
// asymptote shooting off to 1e15 is cut at the edge, not drawn at full length. The output is vector, so it prints and
// exports at any resolution.

import type { Pixel, Segment, Size, Viewport } from './types';
import { toPixel } from './viewport';

export interface PathOptions {
  /** Decimal places for coordinates. Two is precise to a hundredth of a pixel. */
  readonly decimals?: number;
  /** How far past the edge to keep the line, in pixels, so its rounded cap isn't visible at the edge. */
  readonly margin?: number;
}

/** Pixel coordinates beyond this are pulled in first, so clipping arithmetic stays exact enough. */
const PIXEL_LIMIT = 1e9;

export interface ClipBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The value a fraction `t` of the way from `a` to `b`, exact at both ends. */
function lerp(t: number, a: number, b: number): number {
  return t === 0 ? a : t === 1 ? b : a + t * (b - a);
}

/** The part of the line from `p0` to `p1` inside `box` (Liang-Barsky), or null when none of it is. */
export function clipLine(p0: Pixel, p1: Pixel, box: ClipBox): [Pixel, Pixel] | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const edges: [number, number][] = [
    [-dx, p0.x - box.left],
    [dx, box.right - p0.x],
    [-dy, p0.y - box.top],
    [dy, box.bottom - p0.y],
  ];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return null;
      t1 = Math.min(t1, r);
    }
  }
  const start = { x: lerp(t0, p0.x, p1.x), y: lerp(t0, p0.y, p1.y) };
  const end = { x: lerp(t1, p0.x, p1.x), y: lerp(t1, p0.y, p1.y) };
  return [start, end];
}

function limit(v: number): number {
  return Math.max(-PIXEL_LIMIT, Math.min(PIXEL_LIMIT, v));
}

/** Cuts a polyline to `box`. A line that leaves the box and comes back is two runs, as the drawing needs. */
export function clipPolyline(points: readonly Pixel[], box: ClipBox): Pixel[][] {
  const runs: Pixel[][] = [];
  let run: Pixel[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const clipped = clipLine(points[i - 1], points[i], box);
    if (clipped === null) {
      run = [];
      continue;
    }
    const [start, end] = clipped;
    const last = run[run.length - 1];
    if (last === undefined || last.x !== start.x || last.y !== start.y) {
      run = [start];
      runs.push(run);
    }
    run.push(end);
  }
  return runs;
}

function format(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** "M x y L x y ..." for one run, leaving out points that land on the same rounded spot as the one before. */
function runToPath(run: readonly Pixel[], decimals: number): string {
  let path = '';
  let previous = '';
  for (const p of run) {
    const coordinates = `${format(p.x, decimals)} ${format(p.y, decimals)}`;
    if (coordinates === previous) continue;
    path += `${previous === '' ? 'M' : 'L'}${coordinates}`;
    previous = coordinates;
  }
  return path;
}

/** The SVG path data for sampled segments, in pixels from the top left of a `size` drawing area. */
export function segmentsToPath(
  segments: readonly Segment[],
  view: Viewport,
  size: Size,
  options: PathOptions = {},
): string {
  const { decimals = 2, margin = 4 } = options;
  const box: ClipBox = { left: -margin, top: -margin, right: size.width + margin, bottom: size.height + margin };
  const paths: string[] = [];
  for (const segment of segments) {
    const pixels = segment.map((p) => {
      const pixel = toPixel(view, size, p);
      return { x: limit(pixel.x), y: limit(pixel.y) };
    });
    for (const run of clipPolyline(pixels, box)) {
      const path = runToPath(run, decimals);
      if (path.includes('L')) paths.push(path);
    }
  }
  return paths.join('');
}
