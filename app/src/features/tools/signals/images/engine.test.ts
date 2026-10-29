// The image lab. The plan's validation cases come first, with their independent expected values (by hand or by the
// geometry of the test image); edge cases follow.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import {
  adjust,
  backProject,
  bandMath,
  calibrate,
  canny,
  classify,
  components,
  convolve,
  frequencyFilter,
  gray,
  histogram,
  kernel,
  morphology,
  ndvi,
  otsu,
  radon,
  readKernel,
  roiStats,
} from './engine';

const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('thresholds and components', () => {
  it('puts the Otsu threshold of 0, 0, 0, 0, 10, 10, 200, 200, 210, 210 at 10, the lowest that separates', () => {
    expect(otsu([0, 0, 0, 0, 10, 10, 200, 200, 210, 210]).threshold).toBe(10);
    expect(errorKey(() => otsu([5, 5]))).toBe('flatImage');
  });

  it('counts two diagonal pixels as 2 parts with 4-connectivity and 1 with 8', () => {
    const mask = Uint8Array.from([1, 0, 0, 1]);
    expect(components(mask, 2, 2, 4).parts.length).toBe(2);
    expect(components(mask, 2, 2, 8).parts.length).toBe(1);
  });

  it('gives each part its area and centroid', () => {
    // A 2 × 2 block at the top left and a single pixel at (4, 3).
    const mask = new Uint8Array(25);
    [0, 1, 5, 6, 19].forEach((i) => (mask[i] = 1));
    const { parts } = components(mask, 5, 5, 8);
    expect(parts.map((p) => p.area).sort()).toEqual([1, 4]);
    const block = parts.find((p) => p.area === 4)!;
    expect([block.cx, block.cy]).toEqual([0.5, 0.5]);
  });
});

describe('kernels and morphology', () => {
  it('gives a Sobel x-gradient of 4 just left of a vertical step', () => {
    const img = gray(4, 3, [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]);
    expect(convolve(img, kernel('sobelX')).data[1 * 4 + 1]).toBe(4);
  });

  it('keeps a flat image flat under the box, Gaussian, and sharpen kernels', () => {
    const flat = gray(5, 5, Array<number>(25).fill(0.4));
    for (const name of ['box', 'gaussian', 'sharpen'] as const) {
      for (const v of convolve(flat, kernel(name)).data) expect(v).toBeCloseTo(0.4, 12);
    }
    expect(
      errorKey(() =>
        readKernel([
          [1, 2],
          [3, 4],
        ]),
      ),
    ).toBe('kernelShape');
  });

  it('removes a lone bright pixel by opening and fills a lone dark pixel by closing', () => {
    const spot = gray(5, 5);
    spot.data[12] = 1;
    expect(Math.max(...morphology(spot, 'open').data)).toBe(0);
    const hole = gray(5, 5, Array<number>(25).fill(1));
    hole.data[12] = 0;
    expect(Math.min(...morphology(hole, 'close').data)).toBe(1);
  });

  it('finds the outline of a square with the simplified Canny detector', () => {
    const img = gray(20, 20);
    for (let y = 5; y < 15; y += 1) for (let x = 5; x < 15; x += 1) img.data[y * 20 + x] = 1;
    const edges = canny(img, 1, 0.1, 0.3);
    expect(edges[10 * 20 + 10]).toBe(0);
    expect(edges.reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });
});

describe('frequency, measurement, and bands', () => {
  it('splits an image into a low-pass and a high-pass part that add back to it', () => {
    const img = gray(
      8,
      8,
      Array.from({ length: 64 }, (_, i) => (i % 3) / 2),
    );
    const low = frequencyFilter(img, 'lowpass', 0.4).filtered;
    const high = frequencyFilter(img, 'highpass', 0.4).filtered;
    img.data.forEach((v, i) => expect(low.data[i]! + high.data[i]!).toBeCloseTo(v, 9));
    // The low-pass part keeps the mean (the zero frequency).
    expect(low.data.reduce((a, b) => a + b, 0)).toBeCloseTo(
      img.data.reduce((a, b) => a + b, 0),
      9,
    );
  });

  it('calibrates 100 pixels to 10 mm and gives a rectangle’s statistics', () => {
    expect(calibrate(0, 0, 60, 80, 10).perUnit).toBe(10);
    const img = gray(3, 1, [0, 0.5, 1]);
    const stats = roiStats(img, 0, 0, 2, 0);
    expect(stats.mean).toBeCloseTo(0.5, 12);
    expect(stats.sd).toBeCloseTo(0.5, 12);
  });

  it('gives NDVI 0.666667 for NIR 0.5 and red 0.1, the same through a typed expression', () => {
    expect(Math.abs(ndvi(0.5, 0.1) - 0.666667)).toBeLessThan(1e-6);
    const nir = gray(1, 1, [0.5]);
    const red = gray(1, 1, [0.1]);
    expect(bandMath('(b1 - b2)/(b1 + b2)', [nir, red]).data[0]).toBeCloseTo(2 / 3, 12);
    expect(errorKey(() => bandMath('b1 +', [nir]))).toBe('expression');
  });

  it('classifies each pixel to the nearest training mean', () => {
    const band = gray(4, 1, [0.1, 0.2, 0.8, 0.9]);
    const labels = classify(
      [band],
      [
        { label: 1, pixels: [0] },
        { label: 2, pixels: [3] },
      ],
    );
    expect(Array.from(labels)).toEqual([1, 1, 2, 2]);
  });

  it('spreads the histogram and stretches with window, level, and gamma', () => {
    const img = gray(2, 1, [0, 1]);
    expect(histogram(img)[0]).toBe(1);
    expect(histogram(img)[255]).toBe(1);
    expect(adjust(gray(1, 1, [0.5]), 0.5, 0.5, 1).data[0]).toBeCloseTo(0.5, 12);
  });
});

describe('CT reconstruction', () => {
  it('rebuilds a centered point with its peak at the center and nothing else above 20% of it', () => {
    const size = 41;
    const point = gray(size, size);
    const centre = 20 * size + 20;
    point.data[centre] = 1;
    const { sinogram } = radon(point, 180);
    const image = backProject(sinogram, size, 'ramLak');
    const peak = image.data[centre]!;
    image.data.forEach((v, i) => {
      if (i !== centre) expect(v).toBeLessThan(0.2 * peak);
    });
    expect(errorKey(() => radon(point, 1))).toBe('angles');
  });
});
