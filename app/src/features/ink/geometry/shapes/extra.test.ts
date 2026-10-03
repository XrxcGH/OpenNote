import { describe, expect, it } from 'vitest';
import { seededRandom } from '../fixtures';
import { densify } from '../simplify';
import type { Vec } from '../types';
import { headBarbs } from './arrow';
import { polygonCorners, sampleArc, shapePoints, starCorners } from './generate';
import { recognizeShape } from './recognize';
import type { Shape } from './types';

const C = { x: 300, y: 300 };

/** A hand-drawn version of a path: points every few units, each nudged a little. */
function handDrawn(path: readonly Vec[], seed: number, noise = 0.9): Vec[] {
  const random = seededRandom(seed);
  return densify(path, 3.5).map((p) => ({
    x: p.x + (random() - 0.5) * 2 * noise,
    y: p.y + (random() - 0.5) * 2 * noise,
  }));
}

const kindOf = (path: readonly Vec[], extra = true) => recognizeShape(path, { extra })?.shape.kind;

describe('more shapes, tried when a stroke is held', () => {
  it('finds pentagons and hexagons at any turn', () => {
    for (const seed of [1, 2, 3, 4]) {
      const turn = seed * 0.37;
      expect(kindOf(handDrawn(polygonCorners(C, 90, 5, turn), seed))).toBe('polygon');
      expect(kindOf(handDrawn(polygonCorners(C, 90, 6, turn), seed))).toBe('polygon');
    }
  });

  it('finds a star drawn as an outline, and a pentagram drawn in one stroke', () => {
    for (const seed of [1, 2, 3]) {
      expect(kindOf(handDrawn(starCorners(C, 100, 42, 5, -1.2 + seed), seed))).toBe('star');
    }
    const tips = polygonCorners(C, 100, 5, -Math.PI / 2).slice(0, 5);
    const pentagram = [tips[0], tips[2], tips[4], tips[1], tips[3], tips[0]];
    expect(kindOf(handDrawn(pentagram, 5))).toBe('star');
  });

  it('finds an arc, but only when asked', () => {
    const arc = handDrawn(sampleArc(C, 120, -0.3, 2.2), 6, 0.7);
    expect(kindOf(arc)).toBe('arc');
    expect(kindOf(arc, false)).toBeUndefined();
  });

  it('finds an arrow with a head at each end', () => {
    const from = { x: 100, y: 200 };
    const to = { x: 360, y: 200 };
    const length = 30;
    const double = [
      headBarbs(from, { x: -1, y: 0 }, length)[0],
      from,
      headBarbs(from, { x: -1, y: 0 }, length)[1],
      from,
      to,
      headBarbs(to, { x: 1, y: 0 }, length)[0],
      to,
      headBarbs(to, { x: 1, y: 0 }, length)[1],
    ];
    const match = recognizeShape(handDrawn(double, 7, 0.5), { extra: true });
    expect(match?.shape.kind).toBe('doubleArrow');
  });

  it('finds a curved arrow', () => {
    const body = sampleArc(C, 110, Math.PI, 2.1);
    const tip = body[body.length - 1];
    const before = body[body.length - 4];
    const direction = {
      x: (tip.x - before.x) / Math.hypot(tip.x - before.x, tip.y - before.y),
      y: (tip.y - before.y) / Math.hypot(tip.x - before.x, tip.y - before.y),
    };
    const [a, b] = headBarbs(tip, direction, 28);
    const match = recognizeShape(handDrawn([...body, a, tip, b], 8, 0.5), { extra: true });
    expect(match?.shape.kind).toBe('curvedArrow');
  });

  it('keeps circles, rectangles, and lines what they were', () => {
    const circle: Shape = { kind: 'circle', center: C, radius: 80 };
    expect(kindOf(handDrawn(shapePoints(circle), 9))).toBe('circle');
    const rectangle = [
      { x: 200, y: 200 },
      { x: 400, y: 200 },
      { x: 400, y: 320 },
      { x: 200, y: 320 },
      { x: 200, y: 200 },
    ];
    expect(kindOf(handDrawn(rectangle, 10))).toBe('rectangle');
    const line = [
      { x: 100, y: 100 },
      { x: 320, y: 100 },
    ];
    expect(kindOf(handDrawn(line, 11))).toBe('line');
  });
});
