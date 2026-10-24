// Writing and scribbles for the hand-drawn corpus: letters, words, and the marks people make while taking notes,
// which must stay ink.

import type { Vec } from '../../types';
import { curve, dist, lerp, polyline, uniform, type Intent, type Rand } from './intent';
import { LETTERS, LIFT_ONLY_LETTERS, WORDS } from './letters';

/** A uniform Catmull-Rom curve through a glyph's points, sharp at the marked turns. */
function glyphPath(points: readonly Vec[], sharp: readonly boolean[]): Vec[] {
  const out: Vec[] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = i > 0 && !sharp[i] ? points[i - 1] : lerp(p1, p2, -1);
    const p3 = i + 2 < points.length && !sharp[i + 1] ? points[i + 2] : lerp(p2, p1, -1);
    const n = Math.max(2, Math.ceil(dist(p1, p2) * 60));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/** A word written in one stroke: its letters side by side, joined, each a little different. */
function written(r: Rand, text: string, height: number): Intent {
  const points: Vec[] = [];
  const sharp: boolean[] = [];
  let x = 0;
  for (const ch of text) {
    const glyph = LETTERS[ch];
    const slant = uniform(r, 0.05, 0.3);
    const wide = uniform(r, 0.85, 1.15);
    for (const [gx, gy, turn] of glyph) {
      points.push({ x: (x + gx * wide + slant * (1 - gy)) * height, y: gy * height });
      sharp.push(turn === 1);
    }
    x += 0.75 * wide;
  }
  return curve(glyphPath(points, sharp));
}

export interface InkSpec {
  readonly name: string;
  readonly liftOnly?: boolean;
  readonly make: (r: Rand, size: number) => Intent;
}

/** Marks made while taking notes that are no shape: zigzags, spirals, waves, scratch-outs, and the like. */
const SCRIBBLES: readonly InkSpec[] = [
  {
    name: 'zigzag',
    make: (r, size) => {
      const n = 3 + Math.floor(r() * 5);
      const h = size * uniform(r, 0.15, 0.4);
      return polyline(Array.from({ length: n + 1 }, (_, i) => ({ x: (size * i) / n, y: i % 2 === 0 ? 0 : h })));
    },
  },
  {
    name: 'spiral',
    make: (r, size) => {
      const turns = uniform(r, 1.6, 3.2);
      const way = r() < 0.5 ? 1 : -1;
      const count = Math.ceil(turns * 200);
      return curve(
        Array.from({ length: count + 1 }, (_, k) => {
          const s = k / count;
          const radius = (size / 2) * (0.12 + 0.88 * s);
          const a = way * 2 * Math.PI * turns * s;
          return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
        }),
      );
    },
  },
  {
    name: 'wave',
    make: (r, size) => {
      const cycles = uniform(r, 1.5, 4);
      const h = size * uniform(r, 0.08, 0.2);
      return curve(
        Array.from({ length: 201 }, (_, k) => ({
          x: (size * k) / 200,
          y: h * Math.sin((2 * Math.PI * cycles * k) / 200),
        })),
      );
    },
  },
  {
    name: 'scribble',
    make: (r, size) => {
      const pts = Array.from({ length: 8 + Math.floor(r() * 8) }, () => ({
        x: uniform(r, 0, size),
        y: uniform(r, 0, size * 0.6),
      }));
      return curve(
        glyphPath(
          pts,
          pts.map(() => false),
        ),
      );
    },
  },
  {
    name: 'scratch-out',
    make: (r, size) => {
      const passes = 5 + Math.floor(r() * 5);
      const h = size * uniform(r, 0.15, 0.35);
      return polyline(
        Array.from({ length: passes + 1 }, (_, i) => ({
          x: (i % 2) * size + uniform(r, -3, 3),
          y: (h * i) / passes,
        })),
      );
    },
  },
  {
    name: 'checkmark',
    make: (r, size) =>
      polyline([
        { x: 0, y: size * 0.5 },
        { x: size * uniform(r, 0.25, 0.4), y: size * 0.85 },
        { x: size, y: 0 },
      ]),
  },
  {
    name: 'figure eight',
    make: (r, size) => {
      const tall = r() < 0.5;
      return curve(
        Array.from({ length: 301 }, (_, k) => {
          const a = (2 * Math.PI * k) / 300;
          const p = { x: (size / 2) * Math.sin(a), y: (size / 4) * Math.sin(2 * a) };
          return tall ? { x: p.y, y: p.x } : p;
        }),
      );
    },
  },
  {
    name: 'cursive loops',
    make: (r, size) => {
      const loops = 3 + Math.floor(r() * 4);
      const h = size / loops;
      return curve(
        Array.from({ length: loops * 60 + 1 }, (_, k) => {
          const a = (2 * Math.PI * k) / 60;
          return { x: h * 0.5 * a - h * 0.8 * Math.sin(a), y: -h * 0.8 * Math.cos(a) };
        }),
      );
    },
  },
];

export const NOT_SHAPES: readonly InkSpec[] = [
  ...Object.keys(LETTERS).map((ch) => ({
    name: `letter ${ch}`,
    liftOnly: LIFT_ONLY_LETTERS.includes(ch),
    make: (r: Rand, size: number) => written(r, ch, size),
  })),
  ...WORDS.map((word) => ({ name: `word ${word}`, make: (r: Rand, size: number) => written(r, word, size) })),
  ...SCRIBBLES,
];
