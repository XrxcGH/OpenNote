// Strokes for tests and benchmarks: hand-placed ones, and seeded generators so a failure replays.

import type { InkPoint, Stroke, Vec } from './types';

/** A stroke through the given points. Pressure and time are filled in unless `bare` is set. */
export function makeStroke(
  id: string,
  points: readonly Vec[],
  extra: Partial<Stroke> & { bare?: boolean } = {},
): Stroke {
  const { bare, ...rest } = extra;
  const filled: InkPoint[] = points.map((p, i) => (bare ? p : { ...p, pressure: 0.5, time: i * 10 }));
  return { id, tool: 'pen', width: 2, startTime: 1_000, points: filled, ...rest };
}

/** A straight stroke from one point to another with `steps` segments. */
export function lineStroke(id: string, from: Vec, to: Vec, steps = 10, extra: Partial<Stroke> = {}): Stroke {
  const points = Array.from({ length: steps + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / steps,
    y: from.y + ((to.y - from.y) * i) / steps,
  }));
  return makeStroke(id, points, extra);
}

/** A small deterministic random generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedPage {
  readonly width: number;
  readonly height: number;
  readonly strokes: Stroke[];
}

/** A page of `count` handwriting-like strokes: short wandering curves of about 80 points spread over the page. */
export function generatePage(count: number, seed = 1, width = 4000, height = 12000): GeneratedPage {
  const random = seededRandom(seed);
  const strokes: Stroke[] = [];
  for (let s = 0; s < count; s++) {
    let x = random() * width;
    let y = random() * height;
    let heading = random() * Math.PI * 2;
    const points: InkPoint[] = [];
    for (let i = 0; i < 80; i++) {
      points.push({ x, y, pressure: 0.3 + random() * 0.6, time: i * 8 });
      heading += (random() - 0.5) * 0.8;
      x += Math.cos(heading) * 1.2;
      y += Math.sin(heading) * 1.2;
    }
    strokes.push({ id: `s${s}`, tool: 'pen', width: 2, startTime: 1_000 + s, points });
  }
  return { width, height, strokes };
}

export interface EllipseSpec {
  readonly center: Vec;
  readonly rx: number;
  readonly ry: number;
  /** Points around the ellipse. Defaults to 60. */
  readonly count?: number;
  /** The starting angle in radians. Defaults to 0. */
  readonly start?: number;
  /** How many times around. Defaults to 1. */
  readonly turns?: number;
}

/** Points evenly around an ellipse, going clockwise on screen. The last point closes the loop for one turn. */
export function ellipsePoints({ center, rx, ry, count = 60, start = 0, turns = 1 }: EllipseSpec): Vec[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const a = start + (turns * 2 * Math.PI * i) / count;
    return { x: center.x + rx * Math.cos(a), y: center.y + ry * Math.sin(a) };
  });
}
