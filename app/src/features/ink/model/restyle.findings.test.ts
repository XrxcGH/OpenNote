// Review finding: a selection resized until its box has no width gave a matrix with no area. Strokes then drew with
// width 0, Thicker made the width Infinity, and the record encoded a width the codec refuses at the next load.
import { describe, expect, it } from 'vitest';
import { boxToBox } from '../geometry/transform';
import { recordFromStroke } from './convert';
import { inkStroke } from './fixtures';
import { scaleWidths, setDrawnWidth } from './restyle';

describe('widths and records for a resize with no area', () => {
  const box = { minX: 0, minY: 0, maxX: 100, maxY: 50 };

  it('gives no matrix for a target box with no width or no height', () => {
    expect(boxToBox(box, { minX: 10, minY: 0, maxX: 10, maxY: 50 })).toBeNull();
    expect(boxToBox(box, { minX: 0, minY: 5, maxX: 100, maxY: 5 })).toBeNull();
  });

  it('leaves the width alone when a transform has no area, and never writes a width that is not finite', () => {
    const flat = inkStroke(1, 20, { transform: [0, 0, 0, 1, 0, 0] });
    for (const next of [...scaleWidths([flat], 1.25), ...setDrawnWidth([flat], 4)]) {
      expect(Number.isFinite(next.width)).toBe(true);
      expect(next.width).toBe(flat.width);
    }
  });

  it('refuses to encode a width or a transform that is not finite', () => {
    expect(() => recordFromStroke(inkStroke(2, 20, { width: Infinity }))).toThrow();
    expect(() => recordFromStroke(inkStroke(3, 20, { transform: [1, 0, 0, 1, NaN, 0] }))).toThrow();
  });
});
