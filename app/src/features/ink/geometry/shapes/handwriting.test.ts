// The handwriting guard on ink-to-shape (handwriting.ts): note-size letters written quickly, and strokes in a line of
// writing, stay ink; shapes drawn larger, slower, or apart from writing do not.
import { describe, expect, it } from 'vitest';
import { besideBox, inLineOfWriting, smallAndQuick } from './handwriting';

/** A round stroke `size` units across, drawn in `ms` milliseconds. */
const loop = (size: number, ms: number) =>
  Array.from({ length: 25 }, (_, k) => ({
    x: 100 + (size / 2) * Math.cos((2 * Math.PI * k) / 24),
    y: 100 + (size / 2) * Math.sin((2 * Math.PI * k) / 24),
    time: (ms * k) / 24,
  }));

describe('small and quick', () => {
  it('holds a note-size o written quickly', () => {
    expect(smallAndQuick(loop(26, 180), 1)).toBe(true);
  });

  it('lets a small circle drawn slowly, or a larger one drawn quickly, through', () => {
    expect(smallAndQuick(loop(26, 400), 1)).toBe(false);
    expect(smallAndQuick(loop(60, 180), 1)).toBe(false);
  });

  it('judges size on the screen: zoomed out, a larger stroke is note-size', () => {
    expect(smallAndQuick(loop(50, 180), 0.5)).toBe(true);
    expect(smallAndQuick(loop(26, 180), 2)).toBe(false);
  });

  it('lets a stroke without sample times through', () => {
    expect(
      smallAndQuick(
        loop(26, 180).map(({ x, y }) => ({ x, y })),
        1,
      ),
    ).toBe(false);
  });
});

describe('in a line of writing', () => {
  const o = { minX: 200, minY: 100, maxX: 240, maxY: 160 };

  it('holds a stroke with writing about as tall just beside it', () => {
    expect(inLineOfWriting(o, [{ minX: 140, minY: 95, maxX: 190, maxY: 165 }])).toBe(true);
    expect(inLineOfWriting(o, [{ minX: 250, minY: 110, maxX: 300, maxY: 150 }])).toBe(true);
  });

  it('lets a stroke through when the ink beside it is far off, much taller or shorter, or on another line', () => {
    expect(inLineOfWriting(o, [{ minX: 400, minY: 100, maxX: 450, maxY: 160 }])).toBe(false);
    expect(inLineOfWriting(o, [{ minX: 140, minY: 120, maxX: 190, maxY: 140 }])).toBe(false);
    expect(inLineOfWriting(o, [{ minX: 100, minY: 0, maxX: 190, maxY: 300 }])).toBe(false);
    expect(inLineOfWriting(o, [{ minX: 140, minY: 150, maxX: 190, maxY: 210 }])).toBe(false);
  });

  it('looks a stroke and a half of its height to either side', () => {
    expect(besideBox(o)).toEqual({ minX: 110, minY: 100, maxX: 330, maxY: 160 });
  });
});
