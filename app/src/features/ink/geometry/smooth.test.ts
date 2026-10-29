// Smooth ink: a fast hand's samples are far apart, and straight lines between them drew corners (Beta 6 bug 7). These
// tests draw fast circles, cursive loops, and a cursive word as a 60 Hz and a 120 Hz digitizer samples them. They
// measure the sharpest turn of the outline a renderer fills. The live stroke and the tiles fill it, and export draws
// the same curve (pages/export/ink.test.ts). A turn the pen really made (the point of a V) stays sharp, and the ends
// stay on the pen.
import { describe, expect, it } from 'vitest';
import { turnAt } from '../../../core/ink/path';
import { seededRandom } from './fixtures';
import { smoothInk, strokeShapes } from './outline';
import type { InkPoint, Vec } from './types';

const DEG = 180 / Math.PI;
/**
 * No turn of a smooth stroke's outline may be sharper than this, in degrees, away from its round ends. Straight lines
 * between the samples turned 10 to 85 degrees at each sample.
 */
const SMOOTH_LIMIT = 12;
/**
 * Nor may any vertex stand out from the chord across it by more than this, in page units: 0.4 pixels at 4x. Between
 * the samples of a 60 Hz circle the straight lines stood out 3 units.
 */
const FACET_LIMIT = 0.1;

type Path = (t: number) => Vec;

/** A path drawn over `ms` milliseconds, as a digitizer at `hz` samples it, with a little sensor noise and pressure. */
function sampled(path: Path, ms: number, hz: number, seed = 1): InkPoint[] {
  const random = seededRandom(seed);
  const count = Math.floor((ms / 1000) * hz);
  return Array.from({ length: count + 1 }, (_, k) => {
    const t = k / count;
    const p = path(t);
    return {
      x: p.x + (random() - 0.5) * 0.06,
      y: p.y + (random() - 0.5) * 0.06,
      pressure: 0.5 + 0.2 * Math.sin(Math.PI * t),
      time: (k * 1000) / hz,
    };
  });
}

/** A fast circle, radius 40, a little more than one turn in 0.28 s. */
const circle: Path = (t) => ({ x: 40 * Math.cos(2.24 * Math.PI * t), y: 40 * Math.sin(2.24 * Math.PI * t) });
/** Five cursive loops (a prolate cycloid) in 0.8 s, a fast hand. */
const loops: Path = (t) => {
  const a = 10 * Math.PI * t;
  return { x: 9 * a - 22 * Math.sin(a), y: -22 * Math.cos(a) };
};
/** A cursive word: eight loops that grow and shrink, in 1.6 s. Its tightest turn has a radius of 5 units. */
const cursive: Path = (t) => {
  const a = 16 * Math.PI * t;
  return { x: 7 * a - 16 * Math.sin(a), y: -16 * Math.cos(a) * (1 + 0.3 * Math.sin(a / 3)) };
};

const CASES: { name: string; path: Path; ms: number }[] = [
  { name: 'fast circle', path: circle, ms: 280 },
  { name: 'cursive loops', path: loops, ms: 800 },
  { name: 'cursive word', path: cursive, ms: 1600 },
];

/** Outline edges at least this long, in page units, show a turn between them as a corner. */
const VISIBLE_EDGE = 0.75;

/**
 * How cornered a closed ring is, away from the ends of its line: the sharpest turn between two edges long enough to
 * see, in degrees, and the deepest facet, the farthest a vertex stands out from the chord across it, in page units.
 */
function corners(ring: readonly Vec[], ends: readonly Vec[], keepOut = 6): { turn: number; facet: number } {
  const pts = ring.filter((p, i) => i === 0 || Math.hypot(p.x - ring[i - 1].x, p.y - ring[i - 1].y) > 0.02);
  let turn = 0;
  let facet = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i + pts.length - 1) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    if (ends.some((e) => Math.hypot(b.x - e.x, b.y - e.y) < keepOut)) continue;
    const angle = turnAt(a, b, c);
    const edge = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y));
    if (edge >= VISIBLE_EDGE) turn = Math.max(turn, angle * DEG);
    facet = Math.max(facet, edge * Math.sin(angle / 2));
  }
  return { turn, facet };
}

/** The sharpest turn of an open line, in degrees. */
function sharpestOpen(line: readonly Vec[]): number {
  let worst = 0;
  for (let i = 1; i + 1 < line.length; i++) worst = Math.max(worst, turnAt(line[i - 1], line[i], line[i + 1]) * DEG);
  return worst;
}

describe('smooth ink', () => {
  for (const { name, path, ms } of CASES) {
    for (const hz of [60, 120]) {
      it(`draws a ${name} at ${hz} Hz with no corner sharper than ${SMOOTH_LIMIT} degrees`, () => {
        const points = sampled(path, ms, hz);
        const ends = [points[0], points[points.length - 1]];
        // The samples themselves turn sharply: this is the input that drew corners.
        expect(sharpestOpen(points)).toBeGreaterThan(10);
        for (const tool of ['pen', 'pencil', 'fountain', 'marker'] as const) {
          const [ring] = strokeShapes(points, { tool, width: 2 });
          const { turn, facet } = corners(ring, ends);
          expect(turn, `${tool} outline turn`).toBeLessThan(SMOOTH_LIMIT);
          expect(facet, `${tool} outline facet`).toBeLessThan(FACET_LIMIT);
        }
      });
    }
  }

  it('keeps the ends on the first and the newest sample, so the ink never lags the pen', () => {
    const points = sampled(loops, 800, 60);
    for (let n = 3; n <= points.length; n += 5) {
      const line = smoothInk(points.slice(0, n));
      expect(line[0]).toEqual(points[0]);
      expect(line[line.length - 1]).toEqual(points[n - 1]);
    }
  });

  it('passes through every sample of a fast stroke, and interpolates pressure and time between them', () => {
    const points = sampled(circle, 280, 60);
    const line = smoothInk(points);
    for (const p of points) expect(line.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9)).toBe(true);
    for (let i = 1; i < line.length; i++) expect(line[i].time!).toBeGreaterThanOrEqual(line[i - 1].time!);
    expect(line.every((p) => p.pressure! >= 0.5 && p.pressure! <= 0.7)).toBe(true);
  });

  it('keeps a corner the pen made: the point of a V stays sharp', () => {
    const v: Path = (t) => (t < 0.5 ? { x: 60 * t, y: 120 * t } : { x: 60 * t, y: 120 * (1 - t) });
    const points = sampled(v, 200, 60);
    const line = smoothInk(points);
    const tip = line.reduce((best, p) => (p.y > best.y ? p : best));
    expect(tip.y).toBeGreaterThan(55);
    const i = line.indexOf(tip);
    expect(turnAt(line[i - 1], tip, line[i + 1]) * DEG).toBeGreaterThan(90);
  });

  it('does not round a circle of samples inward: the curve stays on the circle', () => {
    const points = sampled(circle, 280, 60).map((p) => ({ x: p.x, y: p.y, time: p.time }));
    for (const p of smoothInk(points)) expect(Math.abs(Math.hypot(p.x, p.y) - 40)).toBeLessThan(0.15);
  });

  it('adds no points to a dense, slow stroke', () => {
    const slow = sampled(circle, 4000, 240);
    expect(smoothInk(slow).length).toBeLessThan(slow.length * 1.05);
  });
});
