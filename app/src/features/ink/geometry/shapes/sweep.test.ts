// Runs recognition over many seeded, noisy, rotated drawings of each shape, and over strokes that are not shapes.

import { describe, expect, it } from 'vitest';
import { ellipsePoints, seededRandom } from '../fixtures';
import { densify } from '../simplify';
import type { Vec } from '../types';
import { recognizeShape } from './recognize';
import type { ShapeKind } from './types';

const DEG = Math.PI / 180;
const CENTER = { x: 200, y: 200 };
const RUNS = 40;

function rotated(points: readonly Vec[], degrees: number): Vec[] {
  const cos = Math.cos(degrees * DEG);
  const sin = Math.sin(degrees * DEG);
  return points.map((p) => ({
    x: CENTER.x + (p.x - CENTER.x) * cos - (p.y - CENTER.y) * sin,
    y: CENTER.y + (p.x - CENTER.x) * sin + (p.y - CENTER.y) * cos,
  }));
}

/** The kinds recognized across `RUNS` drawings made by `draw`, which gets a random source for its shape. */
function kindsFor(draw: (random: () => number) => readonly Vec[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let seed = 1; seed <= RUNS; seed++) {
    const random = seededRandom(seed * 101);
    const noise = 0.5 + random() * 1.5;
    const step = 2 + random() * 4;
    const jitter = (p: Vec): Vec => ({ x: p.x + (random() - 0.5) * 2 * noise, y: p.y + (random() - 0.5) * 2 * noise });
    const drawn = densify(rotated(draw(random), random() * 180), step).map(jitter);
    const kind: string = recognizeShape(drawn)?.shape.kind ?? 'none';
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

const box = (w: number, h: number): Vec[] => [
  { x: 150, y: 150 },
  { x: 150 + w, y: 150 },
  { x: 150 + w, y: 150 + h },
  { x: 150, y: 150 + h },
  { x: 150, y: 150 },
];

describe('recognition across noisy drawings', () => {
  const expectAll = (kind: ShapeKind, draw: (random: () => number) => readonly Vec[]) =>
    expect(kindsFor(draw)).toEqual(new Map([[kind, RUNS]]));

  it('always finds lines and arrows', () => {
    expectAll('line', (r) => [CENTER, { x: CENTER.x + 80 + r() * 200, y: CENTER.y }]);
    const back = (s: number): Vec => ({ x: 400 - 40 * Math.cos(28 * DEG), y: 200 + s * 40 * Math.sin(28 * DEG) });
    expectAll('arrow', () => [CENTER, { x: 400, y: 200 }, back(1), { x: 400, y: 200 }, back(-1)]);
  });

  it('always finds circles, even with a retraced start, and ellipses', () => {
    expectAll('circle', (r) =>
      ellipsePoints({ center: CENTER, rx: 70, ry: 70, count: 80, start: r() * 6, turns: 1 + r() * 0.1 }),
    );
    expectAll('ellipse', (r) => ellipsePoints({ center: CENTER, rx: 100, ry: 45, count: 80, start: r() * 6 }));
  });

  it('always finds rectangles and triangles', () => {
    expectAll('rectangle', (r) => box(100 + r() * 150, 60 + r() * 100));
    const corner = { x: CENTER.x, y: CENTER.y };
    expectAll('triangle', (r) => [
      corner,
      { x: corner.x + 150 + r() * 100, y: corner.y + r() * 50 },
      { x: corner.x + 40 + r() * 100, y: corner.y + 120 + r() * 80 },
      corner,
    ]);
  });
});

describe('strokes that are not shapes', () => {
  const curve = (n: number, f: (t: number) => Vec): Vec[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
  const none = (draw: () => readonly Vec[]) => expect(kindsFor(draw)).toEqual(new Map([['none', RUNS]]));

  it('leaves letters, waves, spirals, and stars alone', () => {
    none(() => curve(60, (t) => ({ x: 100 * Math.sin(t * 2 * Math.PI), y: 150 + t * 200 })));
    none(() =>
      curve(120, (t) => ({
        x: 200 + 60 * (1 + 3 * t) * Math.cos(t * 6 * Math.PI),
        y: 200 + 60 * (1 + 3 * t) * Math.sin(t * 6 * Math.PI),
      })),
    );
    none(() => [150, 250, 150, 250].map((x, i) => ({ x, y: 150 + i * 40 })));
    none(() =>
      [0, 1, 2, 3, 4, 5].map((k) => ({
        x: 200 + 100 * Math.cos((k * 4 * Math.PI) / 5),
        y: 200 + 100 * Math.sin((k * 4 * Math.PI) / 5),
      })),
    );
  });

  it('leaves an open arc, a hook, and a slanted four-sided shape alone', () => {
    none(() => ellipsePoints({ center: CENTER, rx: 80, ry: 80, count: 60, turns: 0.7 }));
    none(() => [
      { x: 100, y: 200 },
      { x: 300, y: 200 },
      { x: 300, y: 230 },
    ]);
    none(() => [
      { x: 150, y: 150 },
      { x: 300, y: 150 },
      { x: 350, y: 230 },
      { x: 200, y: 230 },
      { x: 150, y: 150 },
    ]);
  });
});
