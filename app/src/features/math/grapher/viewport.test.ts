import { describe, expect, it } from 'vitest';
import { axisTicks, computeGrid, formatTick, niceSteps } from './ticks';
import type { Size, Viewport } from './types';
import {
  MIN_SPAN,
  defaultViewport,
  panByFraction,
  panByPixels,
  resizeKeepingScale,
  squareCells,
  toPixel,
  toWorld,
  wheelZoomFactor,
  zoomAround,
  zoomAtCenter,
  zoomToBox,
} from './viewport';

const size: Size = { width: 800, height: 400 };
const view: Viewport = { xMin: -10, xMax: 10, yMin: -5, yMax: 5 };

function expectViewClose(actual: Viewport, expected: Viewport): void {
  expect(actual.xMin).toBeCloseTo(expected.xMin, 9);
  expect(actual.xMax).toBeCloseTo(expected.xMax, 9);
  expect(actual.yMin).toBeCloseTo(expected.yMin, 9);
  expect(actual.yMax).toBeCloseTo(expected.yMax, 9);
}

describe('coordinates', () => {
  it('builds a default view of unit squares centered on the origin', () => {
    expect(defaultViewport(size)).toEqual(view);
  });

  it('maps the origin to the middle and flips y', () => {
    expect(toPixel(view, size, { x: 0, y: 0 })).toEqual({ x: 400, y: 200 });
    expect(toPixel(view, size, { x: -10, y: 5 })).toEqual({ x: 0, y: 0 });
    expect(toPixel(view, size, { x: 10, y: -5 })).toEqual({ x: 800, y: 400 });
  });

  it('round-trips between pixels and graph points', () => {
    const point = toWorld(view, size, { x: 123, y: 321 });
    const pixel = toPixel(view, size, point);
    expect(pixel.x).toBeCloseTo(123, 9);
    expect(pixel.y).toBeCloseTo(321, 9);
  });
});

describe('panning', () => {
  it('moves the content with the pointer', () => {
    // 40 px per unit: dragging right by 80 px shows 2 units further left.
    expectViewClose(panByPixels(view, size, 80, 0), { xMin: -12, xMax: 8, yMin: -5, yMax: 5 });
    expectViewClose(panByPixels(view, size, 0, 40), { xMin: -10, xMax: 10, yMin: -4, yMax: 6 });
  });

  it('pans by a fraction of the view from the keyboard', () => {
    expectViewClose(panByFraction(view, 0.25, -0.5), { xMin: -5, xMax: 15, yMin: -10, yMax: 0 });
  });
});

describe('zooming', () => {
  it('keeps the point under the pointer where it is', () => {
    const pixel = { x: 600, y: 100 };
    const anchor = toWorld(view, size, pixel);
    const zoomed = zoomAround(view, anchor, 2);
    expect(zoomed.xMax - zoomed.xMin).toBeCloseTo(10, 9);
    const after = toPixel(zoomed, size, anchor);
    expect(after.x).toBeCloseTo(600, 9);
    expect(after.y).toBeCloseTo(100, 9);
  });

  it('is undone by the inverse factor', () => {
    const anchor = { x: 3, y: -2 };
    expectViewClose(zoomAround(zoomAround(view, anchor, 4), anchor, 0.25), view);
    expectViewClose(zoomAtCenter(zoomAtCenter(view, 3), 1 / 3), view);
  });

  it('can zoom one axis only', () => {
    const zoomed = zoomAround(view, { x: 0, y: 0 }, 2, 'x');
    expectViewClose(zoomed, { xMin: -5, xMax: 5, yMin: -5, yMax: 5 });
  });

  it('opposite wheel turns cancel', () => {
    expect(wheelZoomFactor(100) * wheelZoomFactor(-100)).toBeCloseTo(1, 12);
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
  });

  it('stops at the smallest span and ignores a bad factor', () => {
    const tiny = zoomAround(view, { x: 0, y: 0 }, 1e30);
    expect(tiny.xMax - tiny.xMin).toBeCloseTo(MIN_SPAN, 15);
    expect(zoomAround(view, { x: 0, y: 0 }, NaN)).toBe(view);
    expect(zoomAround(view, { x: 0, y: 0 }, -2)).toBe(view);
  });

  it('zooms to a dragged box and ignores a flat one', () => {
    const box = zoomToBox(view, size, { x: 400, y: 200 }, { x: 600, y: 100 });
    expectViewClose(box, { xMin: 0, xMax: 5, yMin: 0, yMax: 2.5 });
    expect(zoomToBox(view, size, { x: 10, y: 10 }, { x: 10, y: 90 })).toBe(view);
  });
});

describe('fitting the view', () => {
  it('makes cells square and keeps the center', () => {
    const squared = squareCells({ xMin: -1, xMax: 1, yMin: -10, yMax: 10 }, size);
    const scaleX = size.width / (squared.xMax - squared.xMin);
    const scaleY = size.height / (squared.yMax - squared.yMin);
    expect(scaleX).toBeCloseTo(scaleY, 9);
    expect((squared.xMin + squared.xMax) / 2).toBeCloseTo(0, 9);
  });

  it('keeps the scale when the area resizes', () => {
    const resized = resizeKeepingScale(view, size, { width: 400, height: 400 });
    expectViewClose(resized, { xMin: -10, xMax: 0, yMin: -5, yMax: 5 });
  });
});

describe('ticks', () => {
  it('picks steps of 1, 2, or 5 times a power of ten', () => {
    expect(niceSteps(0.13).step).toBe(0.1);
    expect(niceSteps(0.3).step).toBe(0.2);
    expect(niceSteps(0.6).step).toBe(0.5);
    expect(niceSteps(0.9).step).toBe(1);
    expect(niceSteps(1234).step).toBe(1000);
  });

  it('puts major ticks on the steps and labels only those', () => {
    // 20 units over 800 px with 80 px between ticks: step 2, minor ticks every 0.5.
    const ticks = axisTicks(-10, 10, 800, 80);
    const major = ticks.filter((t) => t.major);
    expect(major.map((t) => t.value)).toEqual([-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10]);
    expect(major.map((t) => t.label).slice(0, 2)).toEqual(['-10', '-8']);
    expect(ticks).toHaveLength(41);
    expect(ticks.find((t) => t.value === 0)?.position).toBe(400);
    expect(ticks.filter((t) => !t.major).every((t) => t.label === '')).toBe(true);
  });

  it('flips positions for the y axis', () => {
    const ticks = axisTicks(-5, 5, 400, 56, true);
    expect(ticks.find((t) => t.value === 5)?.position).toBe(0);
    expect(ticks.find((t) => t.value === -5)?.position).toBe(400);
  });

  it('has no rounding noise in its values', () => {
    const ticks = axisTicks(0, 1, 400, 50);
    expect(ticks.map((t) => t.value)).toContain(0.3);
    expect(ticks.every((t) => Number(t.value.toFixed(10)) === t.value)).toBe(true);
  });

  it('formats labels with just enough decimals, and exponents when huge or tiny', () => {
    expect(formatTick(0.5, 0.5)).toBe('0.5');
    expect(formatTick(-2, 2)).toBe('-2');
    expect(formatTick(0.04, 0.02)).toBe('0.04');
    expect(formatTick(-0, 1)).toBe('0');
    expect(formatTick(1.5e8, 5e7)).toBe('1.5e8');
    expect(formatTick(3e-5, 1e-5)).toBe('3e-5');
  });

  it('stays bounded at extreme zoom levels', () => {
    expect(axisTicks(0, 1e9, 800, 80).length).toBeLessThan(2000);
    expect(axisTicks(0, 0, 800, 80)).toEqual([]);
  });

  it('stops when the view is too narrow for its place, where a tick index cannot count by one', () => {
    expect(axisTicks(1e15, 1e15 + 1, 800, 88)).toEqual([]);
    const far = zoomAtCenter(panByFraction(defaultViewport(size), 2e5 / 20, 0), 1e12);
    expect(computeGrid(far, size).x.length).toBeLessThan(2000);
  });
});

describe('axis lines', () => {
  it('draws the axes at zero, or pins them to an edge when zero is out of view', () => {
    const centered = computeGrid(view, size);
    expect(centered.xAxis).toEqual({ pixel: 200, edge: null });
    expect(centered.yAxis).toEqual({ pixel: 400, edge: null });
    const shifted = computeGrid({ xMin: 5, xMax: 25, yMin: 2, yMax: 12 }, size);
    expect(shifted.yAxis).toEqual({ pixel: 0, edge: 'min' });
    expect(shifted.xAxis).toEqual({ pixel: 400, edge: 'max' });
  });
});
