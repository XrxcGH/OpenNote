import { describe, expect, it } from 'vitest';
import {
  cameraToClient,
  cameraToWorld,
  clampZoom,
  fitWidthZoom,
  scrollForZoom,
  snapToDevice,
  stepZoom,
  worldSize,
} from './camera';
import type { Camera } from './camera';

const camera = (zoom: number, scrollX: number, scrollY: number): Camera => ({
  zoom,
  scrollX,
  scrollY,
  dpr: 1.5,
  viewport: { x: 100, y: 50, w: 800, h: 600 },
  gesture: null,
  seq: 0,
});

describe('the camera', () => {
  it('maps client points to page units and back', () => {
    const at = camera(2, 300, 40);
    const world = cameraToWorld(at, 400, 250);
    expect(world).toEqual({ x: 300, y: 120 });
    expect(cameraToClient(at, world.x, world.y)).toEqual({ x: 400, y: 250 });
  });

  it('keeps the focus point still when the zoom changes', () => {
    const before = camera(1, 120, 80);
    const focus = { x: 500, y: 300 };
    const under = cameraToWorld(before, focus.x, focus.y);
    for (const zoom of [0.25, 0.5, 1.37, 4]) {
      const scrollX = scrollForZoom(before.scrollX, focus.x - before.viewport.x, before.zoom, zoom);
      const scrollY = scrollForZoom(before.scrollY, focus.y - before.viewport.y, before.zoom, zoom);
      const after = cameraToWorld(camera(zoom, scrollX, scrollY), focus.x, focus.y);
      expect(after.x).toBeCloseTo(under.x, 9);
      expect(after.y).toBeCloseTo(under.y, 9);
    }
  });

  it('steps through the command zooms from any zoom, and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.37, 1)).toBe(1.5);
    expect(stepZoom(1.37, -1)).toBe(1.25);
    expect(stepZoom(0.333, 1)).toBe(0.5);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it('clamps zooms to 25% and 400%', () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(9)).toBe(4);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('snaps offsets to whole device pixels', () => {
    expect(snapToDevice(10.4, 1.5)).toBeCloseTo(10.6667, 3);
    expect(snapToDevice(10.2, 1)).toBe(10);
    expect(snapToDevice(7.3, 2) * 2).toBe(15);
  });

  it('grows the world past the content and never shrinks it', () => {
    const first = worldSize({ w: 1000, h: 3000 }, { w: 800, h: 600 }, 1, null);
    expect(first).toEqual({ w: 1480, h: 3300 });
    expect(worldSize({ w: 10, h: 10 }, { w: 800, h: 600 }, 1, first)).toEqual(first);
    expect(worldSize({ w: 0, h: 0 }, { w: 800, h: 600 }, 0.5, null)).toEqual({ w: 1600, h: 1200 });
  });

  it('fits the content width to the viewport', () => {
    expect(fitWidthZoom(1600, 800)).toBe(0.5);
    expect(fitWidthZoom(100, 800)).toBe(4);
    expect(fitWidthZoom(0, 800)).toBe(1);
  });
});
