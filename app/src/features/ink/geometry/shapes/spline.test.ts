import { describe, expect, it } from 'vitest';
import type { Vec } from '../types';
import { dragHandle, handlesOf } from './edit';
import { endsOf, isConnector, moveEnd } from './connect';
import { shapePoints } from './generate';
import {
  bezierAt,
  insertNode,
  isSmooth,
  nearestOnSpline,
  nodeCount,
  nodeOf,
  readSpline,
  removeNode,
  sampleSpline,
  segmentCount,
  setSmooth,
} from './spline';
import type { Spline } from './spline';
import { splineFromInk, toSpline } from './toSpline';
import type { Shape } from './types';

/** Points as a stroke record stores them: rounded to 1/64 of a page unit. */
const stored = (points: readonly Vec[]) =>
  points.map((p) => ({ x: Math.round(p.x * 64) / 64, y: Math.round(p.y * 64) / 64 }));

const close = (a: Vec, b: Vec, within = 0.1) => Math.hypot(a.x - b.x, a.y - b.y) <= within;

const wave: Spline = {
  kind: 'spline',
  controls: [
    { x: 0, y: 0 },
    { x: 30, y: -40 },
    { x: 70, y: -40 },
    { x: 100, y: 0 },
    { x: 130, y: 40 },
    { x: 170, y: 40 },
    { x: 200, y: 0 },
  ],
  closed: false,
};

describe('storing curves', () => {
  it('stores as exact samples and reads back with its handles, smooth where they line up', () => {
    const back = readSpline(stored(shapePoints(wave)));
    expect(back).not.toBeNull();
    expect(back!.controls).toHaveLength(7);
    back!.controls.forEach((c, i) => expect(close(c, wave.controls[i]), `control ${i}`).toBe(true));
    expect(isSmooth(back!, 1)).toBe(true);
    expect(nodeCount(back!)).toBe(3);
  });

  it('is never read from other shapes or from freehand ink', () => {
    const shapes: Shape[] = [
      { kind: 'line', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } },
      { kind: 'circle', center: { x: 0, y: 0 }, radius: 80 },
      { kind: 'arc', center: { x: 0, y: 0 }, radius: 100, start: 0, sweep: 2.15 },
      {
        kind: 'rectangle',
        corners: [
          { x: 0, y: 0 },
          { x: 9, y: 0 },
          { x: 9, y: 9 },
          { x: 0, y: 9 },
        ],
        square: true,
      },
    ];
    for (const shape of shapes) expect(readSpline(stored(shapePoints(shape))), shape.kind).toBeNull();
    const ink = Array.from({ length: 50 }, (_, i) => ({ x: i * 3, y: Math.sin(i / 4) * 20 + (i % 3) }));
    expect(readSpline(stored(ink))).toBeNull();
  });

  it('reads back after a move and a resize, within the grown steps', () => {
    const big = stored(shapePoints(wave)).map((p) => ({ x: p.x * 3 + 40, y: p.y * 3 - 7 }));
    const back = readSpline(big, 0.06 * 3);
    expect(back).not.toBeNull();
    expect(close(back!.controls[1], { x: 130, y: -127 }, 0.3)).toBe(true);
  });
});

describe('dragging curves', () => {
  it('drags a point with its handles, and a handle of a smooth point turns the other one with it', () => {
    const moved = dragHandle(wave, 'n1', { x: 100, y: 50 });
    if (moved.kind !== 'spline') throw new Error('not a curve');
    expect(moved.controls[2]).toEqual({ x: 70, y: 10 });
    expect(moved.controls[4]).toEqual({ x: 130, y: 90 });
    const turned = dragHandle(wave, 'o1', { x: 100, y: 50 });
    if (turned.kind !== 'spline') throw new Error('not a curve');
    // The in handle turns to stay on the line through the point, keeping its length.
    expect(turned.controls[2].x).toBeCloseTo(100, 6);
    expect(turned.controls[2].y).toBeCloseTo(-50, 6);
    expect(isSmooth(turned, 1)).toBe(true);
  });

  it('shows a handle for each point and each handle that is out', () => {
    const ids = handlesOf(wave).map((h) => h.id);
    expect(ids).toEqual(['n0', 'n1', 'n2', 'o0', 'i1', 'o1', 'i2']);
    const corner = setSmooth(wave, 1, false);
    expect(handlesOf(corner).map((h) => h.id)).toEqual(['n0', 'n1', 'n2', 'o0', 'i2']);
    expect(isSmooth(corner, 1)).toBe(false);
  });
});

describe('adding and removing curve points', () => {
  it('adds a point without changing the path, and takes one out', () => {
    const more = insertNode(wave, 0, 0.5);
    expect(nodeCount(more)).toBe(4);
    const [p0, p1, p2, p3] = wave.controls;
    expect(close(more.controls[3], bezierAt(p0, p1, p2, p3, 0.5), 1e-9)).toBe(true);
    // Every sample of the old path lies on the new one.
    for (const q of sampleSpline(wave)) expect(nearestOnSpline(more, q).distance).toBeLessThan(0.5);
    const fewer = removeNode(more, 1);
    expect(nodeCount(fewer)).toBe(3);
    expect(removeNode(removeNode(fewer, 1), 0)).toEqual(removeNode(fewer, 1));
  });

  it('makes a corner smooth again, its handles along its neighbors', () => {
    const corner = setSmooth(wave, 1, false);
    const smooth = setSmooth(corner, 1, true);
    const node = nodeOf(smooth, 1);
    expect(node.in.y).toBeCloseTo(0, 9);
    expect(node.out.y).toBeCloseTo(0, 9);
    expect(isSmooth(smooth, 1)).toBe(true);
  });
});

describe('making curves', () => {
  it('makes lines, arrows, and shapes into curves along the same path', () => {
    const line = toSpline({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 90, y: 0 } })!;
    expect(segmentCount(line)).toBe(1);
    expect(isConnector(line)).toBe(true);
    const bent = dragHandle(line, 'o0', { x: 30, y: 60 });
    expect(shapePoints(bent).some((p) => p.y > 10)).toBe(true);
    const arrow = toSpline({
      kind: 'arrow',
      from: { x: 0, y: 0 },
      tip: { x: 90, y: 0 },
      barbs: [
        { x: 80, y: -6 },
        { x: 80, y: 6 },
      ],
    })!;
    // The head rides along: after a bend it points along the curve's end.
    const curved = dragHandle(arrow, 'i1', { x: 90, y: -40 });
    if (curved.kind !== 'spline') throw new Error('not a curve');
    expect(curved.endBarbs![0].y).toBeLessThan(0);
    expect(curved.endBarbs![1].y).toBeLessThan(0);
    const back = readSpline(stored(shapePoints(curved)))!;
    expect(back.endBarbs).toBeDefined();
    expect(back.startBarbs).toBeUndefined();
    const circle = toSpline({ kind: 'circle', center: { x: 0, y: 0 }, radius: 50 })!;
    expect(circle.closed).toBe(true);
    expect(nodeCount(circle)).toBe(4);
    for (const q of sampleSpline(circle)) expect(Math.abs(Math.hypot(q.x, q.y) - 50)).toBeLessThan(0.02);
    const box = toSpline({
      kind: 'rectangle',
      corners: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 20 },
        { x: 0, y: 20 },
      ],
      square: false,
    })!;
    expect(nodeCount(box)).toBe(4);
    expect(readSpline(stored(shapePoints(box)))!.closed).toBe(true);
  });
});

describe('curve connectors and ink', () => {
  it('moves a curve connector’s ends', () => {
    const line = toSpline({ kind: 'line', from: { x: 0, y: 0 }, to: { x: 90, y: 0 } })!;
    const moved = moveEnd(line, 'end', { x: 120, y: 30 });
    expect(endsOf(moved)!.end).toEqual({ x: 120, y: 30 });
    expect(endsOf(moved)!.start).toEqual({ x: 0, y: 0 });
  });

  it('turns freehand ink into a curve that keeps its path, with a corner where it turns sharply', () => {
    const ink: Vec[] = [];
    for (let i = 0; i <= 40; i++) ink.push({ x: i * 5, y: 30 * Math.sin((i / 40) * Math.PI) });
    for (let i = 1; i <= 20; i++) ink.push({ x: 200, y: i * 5 });
    const curve = splineFromInk(ink)!;
    expect(curve.closed).toBe(false);
    for (const p of ink) expect(nearestOnSpline(curve, p).distance).toBeLessThan(4);
    const corners = Array.from({ length: nodeCount(curve) }, (_, k) => isSmooth(curve, k));
    expect(corners.includes(false)).toBe(true);
    expect(readSpline(stored(shapePoints(curve)))).not.toBeNull();
  });
});
