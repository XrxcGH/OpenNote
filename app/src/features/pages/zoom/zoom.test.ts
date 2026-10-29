import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { paperDimensions, sheetGeometry } from '../pagination/geometry';
import { detailLevel, lineEvery, showsPaper, tileScale } from './detail';
import { currentSheet, flipTarget, viewOfSheet, viewOfWholeSheet, visibleSheets } from './sheets';
import {
  boundsFor,
  centerOf,
  clampView,
  pageToScreen,
  screenToPage,
  switchView,
  viewCentered,
  zoomAt,
  type View,
} from './transform';
import {
  ACTUAL_SIZE,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEPS,
  clampZoom,
  fitSheet,
  fitSpread,
  fitWidth,
  openingZoom,
  percent,
  pinchZoom,
  stepZoom,
  wheelZoom,
} from './zoom';

const LETTER = sheetGeometry(paperDimensions('letter', 'portrait'));
const WINDOW = { width: 1200, height: 800 };

describe('zoom steps', () => {
  it('moves one step at a time and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it('steps from a zoom between two steps to the nearest step in that direction', () => {
    expect(stepZoom(0.83, 1)).toBe(0.9);
    expect(stepZoom(0.83, -1)).toBe(0.75);
    expect(stepZoom(1.9, 1)).toBe(2);
  });

  it('has a ladder that rises, holds actual size, and includes the Phase 2 steps', () => {
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
    expect(ZOOM_STEPS).toContain(ACTUAL_SIZE);
    for (const p of [50, 75, 90, 100, 110, 125, 150, 200, 300]) expect(ZOOM_STEPS).toContain(p / 100);
  });

  it('clamps to the limits, and treats a bad number as actual size', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(NaN)).toBe(1);
    expect(percent(1.256)).toBe(126);
  });

  it('zooms with the wheel in the direction of the scroll, and snaps to actual size', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100)).toBeLessThan(1);
    expect(wheelZoom(1.02, 10)).toBe(1);
    expect(wheelZoom(1, -100, 1)).toBeGreaterThan(wheelZoom(1, -100, 0));
    expect(wheelZoom(ZOOM_MAX, -5000)).toBe(ZOOM_MAX);
  });

  it('follows a pinch in proportion to the fingers', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(2, 200, 100)).toBe(1);
    expect(pinchZoom(1, 100, 101)).toBe(1);
    expect(pinchZoom(1.5, 0, 100)).toBe(1.5);
  });
});

describe('fitting', () => {
  it('fits the width with padding, within the limits', () => {
    expect(fitWidth({ width: 912, height: 800 }, 816)).toBeCloseTo((912 - 48) / 816);
    expect(fitWidth({ width: 10, height: 10 }, 816)).toBe(ZOOM_MIN);
  });

  it('fits a whole sheet by the tighter side', () => {
    const zoom = fitSheet(WINDOW, 816, 1056);
    expect(zoom).toBeCloseTo((800 - 48) / 1056);
    expect(zoom * 1056 + 48).toBeLessThanOrEqual(800 + 1e-6);
  });

  it('fits a spread of sheets', () => {
    const zoom = fitSpread({ width: 1800, height: 1000 }, 816, 1056, 2, 24);
    expect(zoom * (2 * 816 + 24) + 48).toBeLessThanOrEqual(1800 + 1e-6);
    expect(zoom * 1056 + 48).toBeLessThanOrEqual(1000 + 1e-6);
  });

  it('opens at actual size when the sheet fits, and at the fit width otherwise, but not below half', () => {
    expect(openingZoom({ width: 1600, height: 900 }, 816)).toBe(1);
    expect(openingZoom({ width: 600, height: 900 }, 816)).toBeCloseTo((600 - 48) / 816);
    expect(openingZoom({ width: 320, height: 900 }, 816)).toBe(0.5);
  });
});

const view = fc.record({
  zoom: fc.double({ min: ZOOM_MIN, max: ZOOM_MAX, noNaN: true }),
  left: fc.double({ min: -500, max: 3000, noNaN: true }),
  top: fc.double({ min: -500, max: 20_000, noNaN: true }),
});
const screen = fc.record({ x: fc.integer({ min: 0, max: 1200 }), y: fc.integer({ min: 0, max: 800 }) });

describe('zoom about a point', () => {
  it('keeps the page position under the anchor where it was', () => {
    fc.assert(
      fc.property(view, fc.double({ min: ZOOM_MIN, max: ZOOM_MAX, noNaN: true }), screen, (v, zoom, anchor) => {
        const before = screenToPage(v, anchor);
        const next = zoomAt(v, zoom, anchor);
        const after = screenToPage(next, anchor);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
        const back = pageToScreen(next, before);
        expect(back.x).toBeCloseTo(anchor.x, 6);
        expect(back.y).toBeCloseTo(anchor.y, 6);
      }),
    );
  });

  it('zooms about the window center for a command', () => {
    const next = zoomAt({ zoom: 1, left: 0, top: 0 }, 2, centerOf(WINDOW));
    expect(next).toEqual({ zoom: 2, left: 300, top: 200 });
  });
});

describe('view limits', () => {
  const bounds = boundsFor('paginated', LETTER, 3);

  it('centers a sheet narrower than the window and stops the page at its ends', () => {
    const v = clampView({ zoom: 1, left: 0, top: -9999 }, WINDOW, bounds);
    expect(v.left).toBeCloseTo((816 - 1200) / 2);
    expect(v.top).toBeCloseTo(-24);
    expect(clampView({ zoom: 1, left: 0, top: 99_999 }, WINDOW, bounds).top).toBeCloseTo(3 * 1056 + 24 - 800);
  });

  it('shows the same horizontal range in both modes, and a sheet of blank space below in infinite view', () => {
    const infinite = boundsFor('infinite', LETTER, 3);
    expect([infinite.left, infinite.right]).toEqual([bounds.left, bounds.right]);
    expect(infinite.bottom).toBe(bounds.bottom + 1056);
  });

  it('takes in content off the paper', () => {
    const wide = boundsFor('paginated', LETTER, 1, { x: -100, y: 0, w: 1200, h: 400 });
    expect([wide.left, wide.right]).toEqual([-100, 1100]);
  });

  it('switching view moves nothing when the position is within both limits', () => {
    const inBoth: View = { zoom: 2, left: 100, top: 600 };
    const toPaginated = switchView(inBoth, WINDOW, bounds);
    expect(toPaginated.view).toEqual(inBoth);
    expect(toPaginated.moved).toBe(0);
    const toInfinite = switchView(toPaginated.view, WINDOW, boundsFor('infinite', LETTER, 3));
    expect(toInfinite.view).toEqual(inBoth);
  });

  it('switching view keeps the content under the pointer at every zoom while the position is in range', () => {
    fc.assert(
      fc.property(view, screen, (v, pointer) => {
        const infinite = boundsFor('infinite', LETTER, 3);
        const paginated = boundsFor('paginated', LETTER, 3);
        // Start from a view that the infinite limits allow, as a person's own scrolling would.
        const start = clampView(v, WINDOW, infinite);
        const page = screenToPage(start, pointer);
        const { view: next, moved } = switchView(start, WINDOW, paginated);
        const now = pageToScreen(next, page);
        // Only the end of the page (the extra blank sheet of infinite view) may move content.
        const inRange = start.top + WINDOW.height / start.zoom <= paginated.bottom + 24 / start.zoom;
        if (inRange) {
          expect(moved).toBeCloseTo(0, 6);
          expect(now.x).toBeCloseTo(pointer.x, 5);
          expect(now.y).toBeCloseTo(pointer.y, 5);
        }
      }),
    );
  });

  it('centers a rectangle', () => {
    const v = viewCentered({ x: 100, y: 200, w: 200, h: 100 }, 2, { width: 400, height: 300 });
    expect(pageToScreen(v, { x: 200, y: 250 })).toEqual({ x: 200, y: 150 });
  });
});

describe('sheet navigation', () => {
  const bounds = boundsFor('paginated', LETTER, 5);

  it('finds the sheet at the middle of the window', () => {
    expect(currentSheet(LETTER, { zoom: 1, left: 0, top: 0 }, WINDOW, 5)).toBe(0);
    expect(currentSheet(LETTER, { zoom: 1, left: 0, top: 1056 * 2 - 400 + 10 }, WINDOW, 5)).toBe(2);
    expect(currentSheet(LETTER, { zoom: 1, left: 0, top: 99_999 }, WINDOW, 5)).toBe(4);
  });

  it('lists the sheets the window touches, with overscan, within the page', () => {
    expect(visibleSheets(LETTER, { zoom: 1, left: 0, top: 900 }, WINDOW, 5)).toEqual({ first: 0, last: 1 });
    expect(visibleSheets(LETTER, { zoom: 1, left: 0, top: 900 }, WINDOW, 5, 1)).toEqual({ first: 0, last: 2 });
    expect(visibleSheets(LETTER, { zoom: 1, left: 0, top: 4000 }, WINDOW, 5, 3)).toEqual({ first: 0, last: 4 });
    expect(visibleSheets(LETTER, { zoom: 1, left: 0, top: 1056 }, WINDOW, 5)).toEqual({ first: 1, last: 1 });
  });

  it('goes to a sheet, keeping zoom and the sideways position', () => {
    const v = viewOfSheet(LETTER, { zoom: 1, left: 0, top: 0 }, WINDOW, 3, bounds);
    expect(v.top).toBeCloseTo(3 * 1056 - 24);
    expect(v.zoom).toBe(1);
    expect(currentSheet(LETTER, v, WINDOW, 5)).toBe(3);
    const centered = viewOfSheet(LETTER, { zoom: 1, left: 0, top: 0 }, WINDOW, 3, bounds, 'center');
    expect(centered.top).toBeCloseTo(3 * 1056 + 528 - 400);
  });

  it('shows one sheet whole for flipping, and flips within the page', () => {
    const zoom = fitSheet(WINDOW, 816, 1056);
    const v = viewOfWholeSheet(LETTER, WINDOW, 2, zoom);
    const mid = pageToScreen(v, { x: 408, y: 2 * 1056 + 528 });
    expect(mid.x).toBeCloseTo(600);
    expect(mid.y).toBeCloseTo(400);
    expect([flipTarget(0, -1, 5), flipTarget(0, 1, 5), flipTarget(4, 1, 5)]).toEqual([0, 1, 4]);
  });
});

describe('level of detail', () => {
  it('draws everything from half size, less below, and thumbnails under a quarter', () => {
    expect([1, 0.5, 0.4, 0.25, 0.2].map(detailLevel)).toEqual([
      'full',
      'full',
      'simplified',
      'simplified',
      'thumbnail',
    ]);
  });

  it('thins ruled lines so they stay six pixels apart, and hides them when too fine', () => {
    expect(lineEvery(26.46, 1)).toBe(1);
    expect(lineEvery(26.46, 0.1)).toBe(3);
    expect(lineEvery(18.9, 0.02)).toBe(0);
    expect(lineEvery(0, 1)).toBe(0);
    for (const zoom of [0.3, 0.5, 1, 2]) {
      const n = lineEvery(22.68, zoom);
      if (n > 0) expect(22.68 * zoom * n).toBeGreaterThanOrEqual(6);
    }
  });

  it('shows paper only when it can be read', () => {
    expect(showsPaper(26.46, 1)).toBe(true);
    expect(showsPaper(26.46, 0.2)).toBe(false);
  });

  it('rasterizes tiles in power-of-two steps that cover the zoom', () => {
    fc.assert(
      fc.property(
        fc.double({ min: ZOOM_MIN, max: ZOOM_MAX, noNaN: true }),
        fc.constantFrom(1, 1.25, 1.5, 2),
        (zoom, dpr) => {
          const scale = tileScale(zoom, dpr);
          expect(Number.isInteger(Math.log2(scale))).toBe(true);
          expect(scale).toBeGreaterThanOrEqual(zoom * dpr - 1e-9);
          expect(scale).toBeLessThan(zoom * dpr * 2 + 1e-9);
        },
      ),
    );
  });
});
