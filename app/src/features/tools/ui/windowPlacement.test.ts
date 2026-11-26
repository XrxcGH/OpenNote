import { describe, expect, it } from 'vitest';
import { FLOAT_GAP, MIN_FLOAT, placeWindows, SHRINK_FLOOR, TITLE_STEP } from './windowPlacement';

const left = (viewport: number, one: { width: number; right: number }) => viewport - one.right - one.width;

/** The number of pairs of windows whose boxes intersect. */
function overlaps(viewport: number, windows: readonly { width: number; right: number }[]): number {
  let pairs = 0;
  for (let a = 0; a < windows.length; a += 1)
    for (let b = a + 1; b < windows.length; b += 1) {
      const one = windows[a]!;
      const two = windows[b]!;
      if (
        left(viewport, one) < left(viewport, two) + two.width &&
        left(viewport, two) < left(viewport, one) + one.width
      )
        pairs += 1;
    }
  return pairs;
}

describe('placeWindows', () => {
  it('docks side by side when the page keeps its room', () => {
    const placed = placeWindows({ widths: [400, 340], viewport: 2560, room: 1600, edge: 15 });
    expect(placed.overlay).toBe(false);
    expect(placed.docked).toBe(740);
    expect(placed.windows).toEqual([
      { width: 400, right: 340, down: 0 },
      { width: 340, right: 0, down: 0 },
    ]);
  });

  it('floats clear of the page scroll bar by the gap', () => {
    const placed = placeWindows({ widths: [640], viewport: 1280, room: 340, edge: 15 });
    expect(placed.overlay).toBe(true);
    expect(placed.docked).toBe(0);
    expect(placed.windows[0]).toEqual({ width: 640, right: 15 + FLOAT_GAP, down: 0 });
  });

  it('shrinks two windows that do not fit so they sit side by side inside the window', () => {
    const viewport = 820;
    const placed = placeWindows({ widths: [640, 400], viewport, room: 0, edge: 15 });
    for (const one of placed.windows) {
      expect(left(viewport, one)).toBeGreaterThanOrEqual(FLOAT_GAP);
      expect(one.right).toBeGreaterThanOrEqual(15 + FLOAT_GAP);
      expect(one.width).toBeGreaterThanOrEqual(SHRINK_FLOOR);
      expect(one.down).toBe(0);
    }
    expect(overlaps(viewport, placed.windows)).toBe(0);
  });

  it('fits 640 + 400 + 380 in a 1280 window with no two windows overlapping', () => {
    const viewport = 1280;
    const placed = placeWindows({ widths: [640, 400, 380], viewport, room: 340, edge: 15 });
    expect(placed.overlay).toBe(true);
    expect(overlaps(viewport, placed.windows)).toBe(0);
    for (const one of placed.windows) {
      expect(left(viewport, one)).toBeGreaterThanOrEqual(FLOAT_GAP);
      expect(one.down).toBe(0);
    }
  });

  it('cascades windows a title bar apart when even the narrowest do not fit side by side', () => {
    const viewport = 900;
    const placed = placeWindows({ widths: [500, 500, 500], viewport, room: 0, edge: 15 });
    expect(placed.windows.map((one) => one.down)).toEqual([0, TITLE_STEP, 2 * TITLE_STEP]);
    for (const one of placed.windows) {
      expect(left(viewport, one)).toBeGreaterThanOrEqual(FLOAT_GAP);
      expect(one.width).toBeGreaterThanOrEqual(SHRINK_FLOOR);
    }
  });

  it('keeps a usable width when the edge to keep clear takes most of the window', () => {
    const placed = placeWindows({ widths: [340], viewport: 400, room: 0, edge: 415 });
    expect(placed.windows[0]).toEqual({ width: MIN_FLOAT, right: 400 - FLOAT_GAP - MIN_FLOAT, down: 0 });
  });

  it('narrows a window wider than the room between the edges', () => {
    const placed = placeWindows({ widths: [640], viewport: 420, room: 0, edge: 0 });
    expect(placed.windows[0]).toEqual({ width: 420 - 2 * FLOAT_GAP, right: FLOAT_GAP, down: 0 });
  });

  it('floats instead of docking when the page claims room the window does not have', () => {
    const viewport = 375;
    const placed = placeWindows({ widths: [388], viewport, room: 900, edge: 0 });
    expect(placed.overlay).toBe(true);
    expect(left(viewport, placed.windows[0]!)).toBeGreaterThanOrEqual(FLOAT_GAP);
  });
});
