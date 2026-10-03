import { describe, expect, it } from 'vitest';
import {
  cropDrag,
  cropLayout,
  cropOf,
  cropToInsets,
  frameForCrop,
  heightFor,
  initialSize,
  insetsToCrop,
  resizeRect,
} from './geometry';

describe('image geometry', () => {
  it('starts at the pixel size over the screen density, capped at the column', () => {
    expect(initialSize({ width: 800, height: 600 }, { dpr: 2, maxWidth: 640 })).toEqual({ w: 400, h: 300 });
    expect(initialSize({ width: 4000, height: 3000 }, { dpr: 1.5, maxWidth: 640 })).toEqual({ w: 640, h: 480 });
  });

  it('reads only crops that are fractions inside the image', () => {
    expect(cropOf({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(cropOf({ crop: { x: 0, y: 0, w: 1, h: 1 } })).toBeNull();
    expect(cropOf({ crop: { x: 0.6, y: 0, w: 0.6, h: 1 } })).toBeNull();
    expect(cropOf({ crop: { x: '0', y: 0, w: 1, h: 1 } })).toBeNull();
    expect(cropOf({})).toBeNull();
  });

  it('lays the whole image out so the crop fills the frame', () => {
    expect(cropLayout({ w: 200, h: 100 }, { x: 0.25, y: 0.5, w: 0.5, h: 0.5 })).toEqual({
      x: -100,
      y: -100,
      w: 400,
      h: 200,
    });
    expect(cropLayout({ w: 200, h: 100 }, null)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("keeps the shown part's aspect ratio", () => {
    expect(heightFor(300, { width: 400, height: 200 }, null)).toBe(150);
    expect(heightFor(300, { width: 400, height: 200 }, { x: 0, y: 0, w: 0.5, h: 1 })).toBe(300);
  });

  it('resizes from corners keeping the ratio, and from sides in one dimension', () => {
    const start = { x: 10, y: 10, w: 200, h: 100 };
    expect(resizeRect(start, 'se', 100, 0)).toEqual({ x: 10, y: 10, w: 300, h: 150 });
    expect(resizeRect(start, 'se', 100, 0, true)).toEqual({ x: 10, y: 10, w: 300, h: 100 });
    expect(resizeRect(start, 'nw', -100, 0)).toEqual({ x: -90, y: -40, w: 300, h: 150 });
    expect(resizeRect(start, 'e', 50, 80)).toEqual({ x: 10, y: 10, w: 250, h: 100 });
    expect(resizeRect(start, 'n', 50, 30)).toEqual({ x: 10, y: 40, w: 200, h: 70 });
    expect(resizeRect(start, 'w', 500, 0).w).toBe(16);
  });

  it('crops by dragging handles, inside the image', () => {
    expect(cropDrag(null, 'w', 0.2, 0)).toEqual({ x: 0.2, y: 0, w: 0.8, h: 1 });
    expect(cropDrag({ x: 0.2, y: 0, w: 0.8, h: 1 }, 'se', -0.3, -0.5)).toEqual({ x: 0.2, y: 0, w: 0.5, h: 0.5 });
    expect(cropDrag(null, 'n', 0, -1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(cropDrag(null, 'e', -2, 0).w).toBeCloseTo(0.02);
  });

  it('converts crops to the percent fields and back', () => {
    expect(cropToInsets({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })).toEqual({ left: 10, top: 20, right: 40, bottom: 20 });
    expect(insetsToCrop({ left: 10, top: 20, right: 40, bottom: 20 })).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 });
    expect(insetsToCrop({ left: 0, top: 0, right: 0, bottom: 0 })).toBeNull();
    expect(insetsToCrop({ left: 70, top: 0, right: 70, bottom: 0 })?.w).toBeCloseTo(0.02);
  });

  it("keeps the image's scale when the crop changes", () => {
    const frame = { x: 100, y: 100, w: 200, h: 100 };
    expect(frameForCrop(frame, null, { x: 0.25, y: 0, w: 0.5, h: 1 })).toEqual({ x: 150, y: 100, w: 100, h: 100 });
    expect(frameForCrop({ x: 150, y: 100, w: 100, h: 100 }, { x: 0.25, y: 0, w: 0.5, h: 1 }, null)).toEqual(frame);
  });
});
