// Golden-image tests of scan cleanup on photos drawn here: a white page with black lines, seen at an angle on a gray
// desk, with a shadow across it. The cleaned pages are compared by their measured shape and by a fingerprint of the
// black and white result, which a deliberate change updates.
import { describe, expect, it } from 'vitest';
import { cleanScan, findPage, finish, homography, pageSize, warp } from './clean';
import type { Pixels, Quad } from './clean';

const TRUE_CORNERS: Quad = [
  [70, 40],
  [330, 60],
  [350, 420],
  [50, 400],
];

/** Whether a point is inside the quad, by the sign of each edge's cross product. */
function inside(quad: Quad, x: number, y: number): boolean {
  return quad.every(([ax, ay], i) => {
    const [bx, by] = quad[(i + 1) % 4];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
  });
}

/** A 400 by 460 photo of a tilted page with 5 lines of "text", lit from the left. */
function photo(): Pixels {
  const width = 400;
  const height = 460;
  const data = new Uint8ClampedArray(width * height * 4);
  const [a, b, c, d, e, f, g, h] = homography(260, 360, TRUE_CORNERS);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      let value = 95;
      if (inside(TRUE_CORNERS, x, y)) {
        // Map back to the page's own coordinates to draw the lines in the page.
        const det = (px: number, py: number) => {
          const z = g * px + h * py + 1;
          return [(a * px + b * py + c) / z - x, (d * px + e * py + f) / z - y];
        };
        let px = 130;
        let py = 180;
        for (let step = 0; step < 12; step += 1) {
          const [dx, dy] = det(px, py);
          px -= dx * 0.9;
          py -= dy * 0.9;
        }
        const line = py > 60 && py < 320 && Math.round(py) % 52 < 5 && px > 30 && px < 230;
        value = line ? 30 : 235;
      }
      const shade = 0.75 + 0.25 * (x / width);
      data[i] = value * shade;
      data[i + 1] = value * shade;
      data[i + 2] = value * shade * 0.97;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function fingerprint(pixels: Pixels): string {
  let hash = 2166136261;
  for (let i = 0; i < pixels.data.length; i += 4) {
    hash ^= pixels.data[i];
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

describe('scan cleanup', () => {
  const source = photo();

  it('finds the corners of the page within a few pixels', () => {
    const { corners, found } = findPage(source);
    expect(found).toBe(true);
    corners.forEach(([x, y], i) => {
      expect(Math.abs(x - TRUE_CORNERS[i][0])).toBeLessThan(6);
      expect(Math.abs(y - TRUE_CORNERS[i][1])).toBeLessThan(6);
    });
  });

  it('falls back to the whole photo when no page stands out', () => {
    const flat = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4).fill(128) };
    expect(findPage(flat)).toEqual({
      corners: [
        [0, 0],
        [40, 0],
        [40, 30],
        [0, 30],
      ],
      found: false,
    });
  });

  it('straightens the page to the size of its edges', () => {
    const size = pageSize(TRUE_CORNERS);
    expect(size.width).toBeGreaterThan(255);
    expect(size.height).toBeGreaterThan(350);
    const straight = warp(source, TRUE_CORNERS, size);
    // The middle of the straightened page is paper, and its corners are not the gray desk.
    const at = (x: number, y: number) => straight.data[(y * straight.width + x) * 4];
    expect(at(Math.round(straight.width / 2), 30)).toBeGreaterThan(150);
    expect(at(4, 4)).toBeGreaterThan(150);
  });

  it('evens out the lighting so the paper is white across the page', () => {
    const straight = warp(source, TRUE_CORNERS);
    const even = finish(straight, 'grayscale');
    const at = (x: number) => even.data[(30 * even.width + x) * 4];
    expect(Math.abs(at(10) - at(even.width - 10))).toBeLessThan(20);
    expect(at(10)).toBeGreaterThan(225);
  });

  it('makes a black and white page with the lines kept, matching its golden fingerprint', () => {
    const result = cleanScan(source, { mode: 'blackAndWhite' });
    const values = new Set<number>();
    for (let i = 0; i < result.data.length; i += 4) values.add(result.data[i]);
    expect([...values].sort()).toEqual([0, 255]);
    let black = 0;
    for (let i = 0; i < result.data.length; i += 4) if (result.data[i] === 0) black += 1;
    const share = black / (result.width * result.height);
    expect(share).toBeGreaterThan(0.01);
    expect(share).toBeLessThan(0.15);
    expect(fingerprint(result)).toBe(GOLDEN_BLACK_AND_WHITE);
  });

  it('keeps the colors in color mode', () => {
    const result = cleanScan(source, { mode: 'color', corners: TRUE_CORNERS });
    const i = (40 * result.width + 40) * 4;
    expect(result.data[2]).toBeLessThanOrEqual(result.data[0]);
    expect(result.data[i + 3]).toBe(255);
  });
});

const GOLDEN_BLACK_AND_WHITE = '5994485e';
