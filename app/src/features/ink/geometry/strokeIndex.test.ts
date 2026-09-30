import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { intersects } from './bounds';
import { generatePage, lineStroke } from './fixtures';
import { hitCapsules, hitPoint } from './hitTest';
import { createSpatialIndex } from './spatialIndex';
import { createStrokeIndex, drawOrder } from './strokeIndex';
import { moveStrokes } from './transform';
import type { Bounds } from './types';

const box = fc
  .record({
    x: fc.integer({ min: -2000, max: 2000 }),
    y: fc.integer({ min: -2000, max: 2000 }),
    w: fc.integer({ min: 0, max: 900 }),
    h: fc.integer({ min: 0, max: 900 }),
  })
  .map(({ x, y, w, h }): Bounds => ({ minX: x, minY: y, maxX: x + w, maxY: y + h }));

describe('the spatial index', () => {
  it('finds exactly the boxes a brute-force scan finds, after inserts, updates, and removals', () => {
    fc.assert(
      fc.property(fc.array(box, { maxLength: 60 }), box, fc.nat(), (boxes, query, cut) => {
        const index = createSpatialIndex(64);
        boxes.forEach((b, i) => index.insert(`b${i}`, b));
        const dropped = boxes.length === 0 ? -1 : cut % boxes.length;
        if (boxes.length > 1) index.update('b0', boxes[boxes.length - 1]);
        index.remove(`b${dropped}`);
        const expected = boxes
          .map((b, i) => [`b${i}`, i === 0 && boxes.length > 1 ? boxes[boxes.length - 1] : b] as const)
          .filter(([id, b]) => id !== `b${dropped}` && intersects(b, query))
          .map(([id]) => id)
          .sort();
        expect(index.search(query).sort()).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('keeps very large boxes findable and counts its items', () => {
    const index = createSpatialIndex(64);
    index.insert('huge', { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 });
    index.insert('tiny', { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    expect(index.size).toBe(2);
    expect(index.search({ minX: 500, minY: 500, maxX: 501, maxY: 501 })).toEqual(['huge']);
    expect(index.search({ minX: 0, minY: 0, maxX: 0, maxY: 0 }).sort()).toEqual(['huge', 'tiny']);
    expect(index.remove('huge')).toBe(true);
    expect(index.remove('huge')).toBe(false);
  });
});

describe('the stroke index and point hits', () => {
  it('returns the topmost stroke under a point, with highlighters below the rest', () => {
    const under = lineStroke('under', { x: 0, y: 0 }, { x: 100, y: 0 }, 10, { tool: 'highlighter', startTime: 9_000 });
    const older = lineStroke('older', { x: 0, y: 0 }, { x: 100, y: 0 }, 10, { startTime: 1_000 });
    const newer = lineStroke('newer', { x: 0, y: 1 }, { x: 100, y: 1 }, 10, { startTime: 2_000 });
    const index = createStrokeIndex([under, older, newer]);
    expect(hitPoint(index, { x: 50, y: 0.5 }, 1)?.id).toBe('newer');
    expect(hitPoint(index, { x: 50, y: 20 }, 1)).toBeNull();
    expect([under, newer, older].sort(drawOrder).map((s) => s.id)).toEqual(['under', 'older', 'newer']);
  });

  it('follows a stroke that moved, and its width counts toward the reach', () => {
    const stroke = lineStroke('a', { x: 0, y: 0 }, { x: 10, y: 0 }, 10, { width: 10 });
    const index = createStrokeIndex([stroke]);
    expect(hitPoint(index, { x: 5, y: 4 }, 0)?.id).toBe('a');
    index.put(moveStrokes([stroke], 0, 100)[0]);
    expect(hitPoint(index, { x: 5, y: 4 }, 0)).toBeNull();
    expect(hitPoint(index, { x: 5, y: 104 }, 0)?.id).toBe('a');
    expect(index.remove('a')).toBe(true);
    expect(index.size).toBe(0);
  });

  it('matches a brute-force capsule scan on a generated page', () => {
    const { strokes } = generatePage(300, 3, 600, 600);
    const index = createStrokeIndex(strokes, 64);
    const capsule = { from: { x: 100, y: 100 }, to: { x: 400, y: 380 }, radius: 6 };
    const hit = hitCapsules(index, [capsule])
      .map((s) => s.id)
      .sort();
    const expected = strokes
      .filter((s) => hitCapsules(createStrokeIndex([s]), [capsule]).length === 1)
      .map((s) => s.id)
      .sort();
    expect(hit).toEqual(expected);
    expect(hit.length).toBeGreaterThan(0);
  });
});
