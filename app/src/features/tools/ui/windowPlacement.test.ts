import { describe, expect, it } from 'vitest';
import { FLOAT_GAP, placeWindows } from './windowPlacement';

const left = (viewport: number, one: { width: number; right: number }) => viewport - one.right - one.width;

describe('placeWindows', () => {
  it('docks side by side when the page keeps its room', () => {
    const placed = placeWindows({ widths: [400, 340], viewport: 2560, room: 1600, edge: 15 });
    expect(placed.overlay).toBe(false);
    expect(placed.docked).toBe(740);
    expect(placed.windows).toEqual([
      { width: 400, right: 340 },
      { width: 340, right: 0 },
    ]);
  });

  it('floats clear of the page scroll bar by the gap', () => {
    const placed = placeWindows({ widths: [640], viewport: 1280, room: 340, edge: 15 });
    expect(placed.overlay).toBe(true);
    expect(placed.docked).toBe(0);
    expect(placed.windows[0]).toEqual({ width: 640, right: 15 + FLOAT_GAP });
  });

  it('never puts a window past the left edge: two that do not fit overlap inside the window', () => {
    const viewport = 820;
    const placed = placeWindows({ widths: [640, 400], viewport, room: 0, edge: 15 });
    for (const one of placed.windows) {
      expect(left(viewport, one)).toBeGreaterThanOrEqual(FLOAT_GAP);
      expect(one.right).toBeGreaterThanOrEqual(15 + FLOAT_GAP);
    }
    // The newer window keeps the place at the right; the older one stops at the left edge.
    expect(placed.windows[1]).toEqual({ width: 400, right: 23 });
    expect(left(viewport, placed.windows[0]!)).toBe(FLOAT_GAP);
  });

  it('narrows a window wider than the room between the edges', () => {
    const placed = placeWindows({ widths: [640], viewport: 420, room: 0, edge: 0 });
    expect(placed.windows[0]).toEqual({ width: 420 - 2 * FLOAT_GAP, right: FLOAT_GAP });
  });
});
