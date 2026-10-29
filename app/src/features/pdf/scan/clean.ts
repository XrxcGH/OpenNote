// Scan cleanup (A3-20): the image work, on plain RGBA pixels, so it runs the same in the app, in a worker, in tests,
// and for a phone's scan when that arrives. This is the API a phone scan calls:
//
//   const result = cleanScan(pixels, { mode: 'blackAndWhite' });
//
// It finds the page's edges, straightens the perspective, evens out the lighting, and gives color, grayscale, or
// black and white. Everything runs on this device. Nothing here touches the DOM.

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, row by row. */
  data: Uint8ClampedArray;
}

export type ScanMode = 'color' | 'grayscale' | 'blackAndWhite';
export type Point = readonly [x: number, y: number];
/** The page's corners: top left, top right, bottom right, bottom left. */
export type Quad = readonly [Point, Point, Point, Point];

export interface CleanOptions {
  mode: ScanMode;
  /** Corners chosen by the person, in the photo's pixels. Found automatically when missing. */
  corners?: Quad;
}

export interface CleanResult extends Pixels {
  /** The corners used, in the photo's pixels. */
  corners: Quad;
  /** Whether the corners were found in the photo, rather than its whole frame. */
  found: boolean;
}

/** The longest side a cleaned page gets, so a big photo stays a sensible size. */
export const MAX_SIDE = 3000;
/** The side the photo is shrunk to for finding the page. */
const DETECT_SIDE = 256;

const luma = (data: Uint8ClampedArray, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/** The photo's brightness, shrunk so its longest side is `side`, by averaging. */
export function shrinkGray(
  pixels: Pixels,
  side: number,
): { gray: Float32Array; width: number; height: number; scale: number } {
  const scale = Math.min(1, side / Math.max(pixels.width, pixels.height));
  const width = Math.max(1, Math.round(pixels.width * scale));
  const height = Math.max(1, Math.round(pixels.height * scale));
  const gray = new Float32Array(width * height);
  const count = new Float32Array(width * height);
  for (let y = 0; y < pixels.height; y += 1) {
    const ty = Math.min(height - 1, Math.floor(y * scale));
    for (let x = 0; x < pixels.width; x += 1) {
      const tx = Math.min(width - 1, Math.floor(x * scale));
      gray[ty * width + tx] += luma(pixels.data, (y * pixels.width + x) * 4);
      count[ty * width + tx] += 1;
    }
  }
  for (let i = 0; i < gray.length; i += 1) gray[i] /= count[i] || 1;
  return { gray, width, height, scale };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Finds the page in a photo: the biggest connected area that differs from the photo's border, and its four extreme
 * corners. Falls back to the whole photo when no area covers at least a fifth of it.
 */
export function findPage(pixels: Pixels): { corners: Quad; found: boolean } {
  const whole: Quad = [
    [0, 0],
    [pixels.width, 0],
    [pixels.width, pixels.height],
    [0, pixels.height],
  ];
  const { gray, width, height, scale } = shrinkGray(pixels, DETECT_SIDE);
  const border: number[] = [];
  for (let x = 0; x < width; x += 1) border.push(gray[x], gray[(height - 1) * width + x]);
  for (let y = 0; y < height; y += 1) border.push(gray[y * width], gray[y * width + width - 1]);
  const back = median(border);
  const spread = median(border.map((v) => Math.abs(v - back)));
  const threshold = Math.max(28, spread * 3);
  const inside = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i += 1) inside[i] = Math.abs(gray[i] - back) > threshold ? 1 : 0;
  // The biggest connected area, by a flood fill that never recurses.
  const label = new Int32Array(width * height);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < inside.length; start += 1) {
    if (!inside[start] || label[start]) continue;
    next += 1;
    let size = 0;
    stack.push(start);
    label[start] = next;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      size += 1;
      const x = at % width;
      const neighbors = [x > 0 ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width];
      for (const n of neighbors) {
        if (n >= 0 && n < inside.length && inside[n] && !label[n]) {
          label[n] = next;
          stack.push(n);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  if (bestSize < inside.length / 5) return { corners: whole, found: false };
  let tl = [Infinity, 0, 0];
  let tr = [-Infinity, 0, 0];
  let br = [-Infinity, 0, 0];
  let bl = [Infinity, 0, 0];
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] !== best) continue;
    const x = (i % width) + 0.5;
    const y = Math.floor(i / width) + 0.5;
    if (x + y < tl[0]) tl = [x + y, x, y];
    if (x - y > tr[0]) tr = [x - y, x, y];
    if (x + y > br[0]) br = [x + y, x, y];
    if (x - y < bl[0]) bl = [x - y, x, y];
  }
  const up = (p: number[]): Point => [p[1] / scale, p[2] / scale];
  return { corners: [up(tl), up(tr), up(br), up(bl)], found: true };
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The size of the straightened page: the average length of opposite edges, at most `MAX_SIDE`. */
export function pageSize(quad: Quad): { width: number; height: number } {
  const width = (distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2;
  const height = (distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Solves a small linear system by Gaussian elimination with partial pivoting. */
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col] || 1e-12;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const f = a[row][col] / p;
      for (let k = col; k <= n; k += 1) a[row][k] -= f * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / (row[i] || 1e-12));
}

/** The projective map from the output rectangle's corners to the quad, as 8 coefficients. */
export function homography(width: number, height: number, quad: Quad): number[] {
  const from: Point[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const rows: number[][] = [];
  const values: number[] = [];
  from.forEach(([x, y], i) => {
    const [u, v] = quad[i];
    rows.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    values.push(v);
  });
  return solve(rows, values);
}

/** Straightens the quad of the photo into a rectangle, with bilinear sampling. */
export function warp(pixels: Pixels, quad: Quad, size = pageSize(quad)): Pixels {
  const [a, b, c, d, e, f, g, h] = homography(size.width, size.height, quad);
  const out = new Uint8ClampedArray(size.width * size.height * 4);
  const { width: w, height: hh, data } = pixels;
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const z = g * px + h * py + 1;
      const u = Math.min(w - 1.001, Math.max(0, (a * px + b * py + c) / z - 0.5));
      const v = Math.min(hh - 1.001, Math.max(0, (d * px + e * py + f) / z - 0.5));
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * w + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + w * 4;
      const i11 = i01 + 4;
      const o = (y * size.width + x) * 4;
      for (let k = 0; k < 4; k += 1) {
        const top = data[i00 + k] * (1 - fx) + data[i10 + k] * fx;
        const bottom = data[i01 + k] * (1 - fx) + data[i11 + k] * fx;
        out[o + k] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { width: size.width, height: size.height, data: out };
}

/** A box blur of a gray image with radius `r`, by running sums along rows and then columns. */
function boxBlur(gray: Float32Array, width: number, height: number, r: number): Float32Array {
  const pass = (input: Float32Array, horizontal: boolean) => {
    const output = new Float32Array(input.length);
    const lines = horizontal ? height : width;
    const length = horizontal ? width : height;
    const at = (line: number, i: number) => (horizontal ? line * width + i : i * width + line);
    for (let line = 0; line < lines; line += 1) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < Math.min(r, length); i += 1) {
        sum += input[at(line, i)];
        count += 1;
      }
      for (let i = 0; i < length; i += 1) {
        if (i + r < length) {
          sum += input[at(line, i + r)];
          count += 1;
        }
        if (i - r - 1 >= 0) {
          sum -= input[at(line, i - r - 1)];
          count -= 1;
        }
        output[at(line, i)] = sum / count;
      }
    }
    return output;
  };
  return pass(pass(gray, true), false);
}

/**
 * The paper's brightness at each pixel: the page's brightness with the ink taken out. A local maximum drops the
 * dark strokes, and a wide blur smooths the shading that is left.
 */
export function paperLevel(pixels: Pixels): Float32Array {
  const { width, height } = pixels;
  const small = shrinkGray(pixels, 128);
  const lifted = new Float32Array(small.gray.length);
  const r = 2;
  for (let y = 0; y < small.height; y += 1) {
    for (let x = 0; x < small.width; x += 1) {
      let max = 0;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const sx = Math.min(small.width - 1, Math.max(0, x + dx));
          const sy = Math.min(small.height - 1, Math.max(0, y + dy));
          max = Math.max(max, small.gray[sy * small.width + sx]);
        }
      }
      lifted[y * small.width + x] = max;
    }
  }
  const smooth = boxBlur(lifted, small.width, small.height, 6);
  const level = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(small.height - 1, Math.floor(y * small.scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(small.width - 1, Math.floor(x * small.scale));
      level[y * width + x] = Math.max(32, smooth[sy * small.width + sx]);
    }
  }
  return level;
}

/** Evens out the lighting and gives the chosen mode: color, grayscale, or black and white. */
export function finish(pixels: Pixels, mode: ScanMode): Pixels {
  const level = paperLevel(pixels);
  const out = new Uint8ClampedArray(pixels.data.length);
  const { data } = pixels;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const gain = 255 / level[p];
    if (mode === 'color') {
      out[i] = data[i] * gain;
      out[i + 1] = data[i + 1] * gain;
      out[i + 2] = data[i + 2] * gain;
    } else {
      const value = luma(data, i) * gain;
      const shade = mode === 'grayscale' ? value : value < 170 ? 0 : 255;
      out[i] = shade;
      out[i + 1] = shade;
      out[i + 2] = shade;
    }
    out[i + 3] = 255;
  }
  return { width: pixels.width, height: pixels.height, data: out };
}

/** Cleans up a photo of a page: finds its edges, straightens it, evens the lighting, and applies the mode. */
export function cleanScan(pixels: Pixels, options: CleanOptions): CleanResult {
  const located = options.corners ? { corners: options.corners, found: true } : findPage(pixels);
  const straight = warp(pixels, located.corners);
  return { ...finish(straight, options.mode), corners: located.corners, found: located.found };
}
