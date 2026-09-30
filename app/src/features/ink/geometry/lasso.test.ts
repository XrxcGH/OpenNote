import { describe, expect, it } from 'vitest';
import { lineStroke, generatePage, seededRandom } from './fixtures';
import { lassoSelect, rectanglePath } from './lasso';
import { buildMask, classifyBox } from './lassoMask';
import { distance, lerp, pointInPolygon } from './primitives';
import { createStrokeIndex, pagePoints } from './strokeIndex';
import { moveStrokes } from './transform';
import type { Stroke, Vec } from './types';

const square = rectanglePath({ x: 0, y: 0 }, { x: 100, y: 100 });

describe('lasso selection', () => {
  const inside = lineStroke('inside', { x: 10, y: 10 }, { x: 90, y: 10 });
  const outside = lineStroke('outside', { x: 200, y: 10 }, { x: 280, y: 10 });
  // 100 units long, with 70 of them inside the square.
  const mostly = lineStroke('mostly', { x: 30, y: 50 }, { x: 130, y: 50 }, 50);
  const half = lineStroke('half', { x: 50, y: 70 }, { x: 150, y: 70 }, 50);
  const index = createStrokeIndex([inside, outside, mostly, half]);

  it('selects strokes that are mostly inside, with the default threshold of 60%', () => {
    expect(lassoSelect(index, square).sort()).toEqual(['inside', 'mostly']);
  });

  it('can select any part inside, or only whole strokes', () => {
    expect(lassoSelect(index, square, { mode: 'any' }).sort()).toEqual(['half', 'inside', 'mostly']);
    expect(lassoSelect(index, square, { mode: 'all' })).toEqual(['inside']);
    expect(lassoSelect(index, square, { threshold: 0.4 }).sort()).toEqual(['half', 'inside', 'mostly']);
  });

  it('skips strokes the caller excludes and needs at least three points', () => {
    expect(lassoSelect(index, square, { skip: (s) => s.id === 'inside' })).toEqual(['mostly']);
    expect(
      lassoSelect(index, [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
      ]),
    ).toEqual([]);
  });
});

describe('lasso selection on moved and unusual shapes', () => {
  const outside = lineStroke('outside', { x: 200, y: 10 }, { x: 280, y: 10 });

  it('follows a stroke that has been moved', () => {
    const moved = moveStrokes([outside], -190, 0)[0];
    const after = createStrokeIndex([moved]);
    expect(lassoSelect(after, square)).toEqual(['outside']);
  });

  it('forgives a loop that crosses itself, by the nonzero rule', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const left = lineStroke('left', { x: 5, y: 45 }, { x: 5, y: 55 });
    const top = lineStroke('top', { x: 45, y: 5 }, { x: 55, y: 5 });
    const picked = lassoSelect(createStrokeIndex([left, top]), bowtie);
    expect(picked).toEqual(['left']);
  });

  it('agrees with an exact point-by-point count on random lassos', () => {
    const random = seededRandom(11);
    const { strokes } = generatePage(150, 5, 300, 300);
    const all = createStrokeIndex(strokes);
    for (let run = 0; run < 25; run++) {
      const polygon = randomPolygon(random);
      const expected = strokes
        .filter((s) => exactShare(s, polygon) >= 0.6)
        .map((s) => s.id)
        .sort();
      expect(lassoSelect(all, polygon).sort()).toEqual(expected);
    }
  });
});

describe('the lasso mask', () => {
  it('classifies boxes as inside, outside, or crossing the edge', () => {
    const mask = buildMask(square);
    expect(classifyBox(mask, { minX: 20, minY: 20, maxX: 60, maxY: 60 })).toBe('inside');
    expect(classifyBox(mask, { minX: 200, minY: 200, maxX: 260, maxY: 260 })).toBe('outside');
    expect(classifyBox(mask, { minX: 80, minY: 80, maxX: 140, maxY: 140 })).toBe('mixed');
    expect(classifyBox(mask, { minX: -40, minY: 20, maxX: 60, maxY: 60 })).toBe('mixed');
  });
});

function randomPolygon(random: () => number): Vec[] {
  const center = { x: 100 + random() * 100, y: 100 + random() * 100 };
  const count = 5 + Math.floor(random() * 6);
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const radius = 40 + random() * 90;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

/** The share of a stroke's samples inside the polygon, sampled as the lasso samples them. */
function exactShare(stroke: Stroke, polygon: readonly Vec[]): number {
  const points = pagePoints(stroke);
  let inside = 0;
  let total = 0;
  const visit = (p: Vec) => {
    total++;
    if (pointInPolygon(p, polygon)) inside++;
  };
  visit(points[0]);
  for (let i = 1; i < points.length; i++) {
    const pieces = Math.max(1, Math.ceil(distance(points[i - 1], points[i]) / 2));
    for (let k = 1; k <= pieces; k++) visit(k === pieces ? points[i] : lerp(points[i - 1], points[i], k / pieces));
  }
  return inside / total;
}
