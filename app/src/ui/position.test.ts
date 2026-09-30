import { describe, expect, it } from 'vitest';
import { EDGE_MARGIN, placeAtPoint, placeBelow, placeBeside } from './position';

const view = { width: 800, height: 600 };
const size = { width: 200, height: 150 };
const rect = (left: number, top: number, width = 100, height = 32) =>
  ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top }) as DOMRectReadOnly;

describe('placeAtPoint', () => {
  it('opens at the point when it fits', () => {
    expect(placeAtPoint({ x: 100, y: 120 }, size, view)).toEqual({ x: 100, y: 120 });
  });

  it('flips to the other side of the point near the end and bottom edges', () => {
    expect(placeAtPoint({ x: 700, y: 550 }, size, view)).toEqual({ x: 500, y: 400 });
  });

  it('clamps inside the margin when neither side fits', () => {
    const tall = { width: 200, height: 700 };
    expect(placeAtPoint({ x: 10, y: 300 }, tall, view)).toEqual({ x: 10, y: EDGE_MARGIN });
    expect(placeAtPoint({ x: 0, y: 0 }, size, view)).toEqual({ x: EDGE_MARGIN, y: EDGE_MARGIN });
  });
});

describe('placeBelow', () => {
  it('opens below the element, aligned with its start edge', () => {
    expect(placeBelow(rect(40, 100), size, view)).toEqual({ x: 40, y: 132 });
  });

  it('opens above the element when there is no room below', () => {
    expect(placeBelow(rect(40, 500), size, view)).toEqual({ x: 40, y: 350 });
  });

  it('keeps the menu inside the window at the end edge', () => {
    expect(placeBelow(rect(700, 100), size, view).x).toBe(800 - 200 - EDGE_MARGIN);
  });
});

describe('placeBeside', () => {
  it('opens on the end side, aligned with the item top', () => {
    expect(placeBeside(rect(100, 80, 200), size, view)).toEqual({ x: 300, y: 80 });
  });

  it('opens on the start side when the end side has no room', () => {
    expect(placeBeside(rect(500, 80, 200), size, view)).toEqual({ x: 300, y: 80 });
  });
});
