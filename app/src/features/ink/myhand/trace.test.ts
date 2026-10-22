import { describe, expect, it } from 'vitest';
import { pageInk } from './pdfInk';
import type { PdfOps } from './pdfInk';
import { measureHabits, measureLines, splitLines } from './segment';
import { fillRings, inkOf, outlineToStrokes, thin, traceBitmap } from './trace';
import type { Ring, Traced } from './trace';
import { DEFAULT_METRICS } from './style';

/** The outline a round pen of `width` leaves along a path, as one ring that starts at the path's first point. */
function outlineOf(path: [number, number][], width: number): Ring {
  const r = width / 2;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [ax, ay] = path[Math.max(0, i - 1)];
    const [bx, by] = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    left.push(path[i][0] + nx * r, path[i][1] + ny * r);
    right.unshift(path[i][1] - ny * r);
    right.unshift(path[i][0] - nx * r);
  }
  // Start at the first point's side, go along one side, round the far end, and back along the other.
  return [path[0][0] - (path[1][0] - path[0][0]) * 0.01, path[0][1], ...left, ...right];
}

const distanceToPath = (p: { x: number; y: number }, path: [number, number][]) =>
  Math.min(
    ...path.slice(1).map(([bx, by], i) => {
      const [ax, ay] = path[i];
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy);
    }),
  );

describe('tracing filled outlines', () => {
  const curve: [number, number][] = Array.from({ length: 30 }, (_, i) => [10 + i * 0.5, 20 + Math.sin(i / 5) * 4]);

  it('finds the centre line and the width of a pen stroke’s outline, from where it started', () => {
    const traced = outlineToStrokes([outlineOf(curve, 0.8)]);
    expect(traced).toHaveLength(1);
    const stroke = traced[0];
    for (const p of stroke) expect(distanceToPath(p, curve)).toBeLessThan(0.25);
    const widths = stroke.map((p) => p.width).sort((a, b) => a - b);
    expect(widths[widths.length >> 1]).toBeGreaterThan(0.5);
    expect(widths[widths.length >> 1]).toBeLessThan(1.1);
    // It runs from the start of the path to its end.
    expect(Math.hypot(stroke[0].x - curve[0][0], stroke[0].y - curve[0][1])).toBeLessThan(0.8);
    const end = stroke[stroke.length - 1];
    expect(Math.hypot(end.x - curve[29][0], end.y - curve[29][1])).toBeLessThan(0.8);
  });

  it('goes straight on through a crossing, as the pen did', () => {
    // An X written as one stroke: down the first diagonal, then up the other.
    const loop: [number, number][] = [
      ...Array.from({ length: 20 }, (_, i) => [i, i] as [number, number]),
      ...Array.from({ length: 20 }, (_, i) => [19 - i * 0.05, 19 - i] as [number, number]).slice(1),
    ];
    const traced = outlineToStrokes([outlineOf(loop, 1)]);
    expect(traced.length).toBeGreaterThan(0);
    expect(traced[0].length).toBeGreaterThan(3);
  });

  it('returns nothing, without throwing, for shapes it can’t trace', () => {
    expect(outlineToStrokes([])).toEqual([]);
    expect(outlineToStrokes([[0, 0, 1, 1]])).toEqual([]);
    expect(outlineToStrokes([[Number.NaN, 0, 1, 1, 2, 2, 3, 0]])).toEqual([]);
    expect(fillRings([[0, 0, 1e9, 0, 1e9, 1e9]], 10)).toBeNull();
  });
});

describe('tracing pictures', () => {
  it('finds strokes in a picture of ink and takes out the lines of the paper', () => {
    const w = 200;
    const h = 120;
    const gray = new Uint8Array(w * h).fill(235);
    // A ruled line across the page, and a handwritten upright stroke and a circle.
    for (let x = 0; x < w; x++) gray[80 * w + x] = 120;
    for (let y = 30; y < 90; y++) for (let x = 60; x < 64; x++) gray[y * w + x] = 30;
    for (let a = 0; a < 360; a += 0.5) {
      const cx = Math.round(140 + Math.cos((a * Math.PI) / 180) * 20);
      const cy = Math.round(55 + Math.sin((a * Math.PI) / 180) * 20);
      for (let d = -1; d <= 2; d++) gray[cy * w + cx + d] = 40;
    }
    const ink = inkOf(gray, w, h);
    // The ruled line is gone where nothing crosses it.
    expect(ink.data[80 * w + 10]).toBe(0);
    const strokes = traceBitmap(ink);
    expect(strokes.length).toBeGreaterThanOrEqual(2);
    const upright = strokes.find((s) => s.every((p) => Math.abs(p.x - 62) < 4));
    expect(upright).toBeTruthy();
    expect(Math.max(...upright!.map((p) => p.y)) - Math.min(...upright!.map((p) => p.y))).toBeGreaterThan(45);
    const ring = strokes.find((s) => s.some((p) => p.x > 120));
    expect(ring!.length).toBeGreaterThan(8);
  });

  it('caps what it reads', () => {
    expect(inkOf(new Uint8Array(4), 2, 2).data.length).toBe(4);
    expect(inkOf(new Uint8Array(1), 5000, 5000).data.length).toBe(0);
    expect(traceBitmap({ w: 0, h: 0, data: new Uint8Array(0) })).toEqual([]);
    const solid = { w: 30, h: 30, data: new Uint8Array(900).fill(1) };
    expect(() => thin(solid)).not.toThrow();
  });
});

const OPS: PdfOps = {
  save: 10,
  restore: 11,
  transform: 12,
  setLineWidth: 2,
  constructPath: 91,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  stroke: 20,
  closeStroke: 21,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
  paintImageMaskXObject: 83,
};

/** A constructPath argument in pdf.js's form: [paint, [path data], bounds]. */
const path = (paint: number, ring: number[], close = true) => {
  const data: number[] = [0, ring[0], ring[1]];
  for (let i = 2; i < ring.length; i += 2) data.push(1, ring[i], ring[i + 1]);
  if (close) data.push(4);
  return [paint, [new Float32Array(data)], null];
};

describe('ink in a PDF’s drawing', () => {
  it('turns filled outlines into strokes in drawing order, sets the paper’s rules apart, and notes pictures', () => {
    const word: [number, number][] = Array.from({ length: 20 }, (_, i) => [100 + i, 700 - Math.sin(i / 3) * 3]);
    const second: [number, number][] = word.map(([x, y]) => [x + 40, y]);
    const ink = pageInk(
      {
        fnArray: [
          OPS.setLineWidth,
          OPS.constructPath,
          OPS.constructPath,
          OPS.constructPath,
          OPS.constructPath,
          OPS.paintImageXObject,
        ],
        argsArray: [
          [0.5],
          path(OPS.stroke, [0, 750, 600, 750], false),
          path(OPS.fill, outlineOf(word, 0.8)),
          path(OPS.fill, outlineOf(second, 0.8)),
          path(OPS.fill, [0, 0, 600, 0, 600, 800, 0, 800]),
          ['img'],
        ],
      },
      OPS,
      [0, 0, 612, 792],
    );
    expect(ink.rules).toEqual([42]);
    expect(ink.hasPictures).toBe(true);
    // The page-sized fill is a background, not ink.
    expect(ink.strokes).toHaveLength(2);
    // Page coordinates run down from the top.
    expect(ink.strokes[0][0].y).toBeGreaterThan(80);
    expect(ink.strokes[0][0].y).toBeLessThan(100);
    expect(ink.strokes[0][0].x).toBeLessThan(ink.strokes[1][0].x);
  });

  it('keeps a stroked pen line as it is, applying the page’s transform', () => {
    const ink = pageInk(
      {
        fnArray: [OPS.save, OPS.transform, OPS.setLineWidth, OPS.constructPath, OPS.restore],
        argsArray: [null, [2, 0, 0, 2, 10, 0], [1], path(OPS.stroke, [10, 300, 20, 310, 30, 300], false), null],
      },
      OPS,
      [0, 0, 612, 792],
    );
    expect(ink.strokes).toHaveLength(1);
    expect(ink.strokes[0][0].x).toBeCloseTo(30, 3);
    expect(ink.strokes[0][0].width).toBeCloseTo(2, 3);
  });

  it('skips operators that are not the shape expected', () => {
    const ink = pageInk(
      {
        fnArray: [OPS.constructPath, OPS.transform, OPS.constructPath],
        argsArray: [['x'], [Number.NaN], [OPS.fill, 'nope']],
      },
      OPS,
      [0, 0, 10, 10],
    );
    expect(ink.strokes).toEqual([]);
  });
});

describe('lines and symbols on an upload', () => {
  const stroke = (x: number, y: number, h: number): Traced => [
    { x, y, width: 1 },
    { x: x + h * 0.3, y: y - h, width: 1 },
  ];

  it('splits strokes into lines and reads each line’s size from the letters the person named', () => {
    const strokes = [stroke(0, 100, 10), stroke(10, 100, 10), stroke(0, 140, 10), stroke(12, 140, 14.5)];
    const lines = splitLines(strokes);
    expect(lines).toHaveLength(2);
    const labelled = [
      { label: 'a', rect: { x0: 0, y0: 90, x1: 3, y1: 100 }, line: 0 },
      { label: 'n', rect: { x0: 10, y0: 90, x1: 13, y1: 100 }, line: 0 },
      { label: 'H', rect: { x0: 12, y0: 125.5, x1: 16, y1: 140 }, line: 1 },
    ];
    const measures = measureLines(labelled, 2, DEFAULT_METRICS);
    expect(measures[0]).toEqual({ baseline: 100, xHeight: 10 });
    expect(measures[1].xHeight).toBeCloseTo(14.5 / DEFAULT_METRICS.capHeight, 5);
  });

  it('learns how high and how small the person writes superscripts', () => {
    const symbols = [
      { label: 'x', rect: { x0: 0, y0: 90, x1: 8, y1: 100 }, line: 0 },
      { label: '2', rect: { x0: 9, y0: 80, x1: 13, y1: 88 }, line: 0 },
    ];
    const habits = measureHabits(symbols, [{ baseline: 100, xHeight: 10 }]);
    expect(habits.supRaise).toBeGreaterThan(0.95);
    expect(habits.scriptScale).toBeLessThan(0.68);
  });
});
