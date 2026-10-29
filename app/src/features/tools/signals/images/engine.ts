// The image lab's engine. An image is a grayscale Float64Array of width × height values from 0 to 1, row by row
// from the top. It covers histograms, windows, gamma, Otsu thresholds, connected components, convolution kernels, a
// simplified Canny, morphology, frequency masks, measurement, band math, and CT by the Radon transform and filtered
// back-projection. Pure: no DOM.
import { compileNode, standardFunctions, tryParse } from '../../../../core/expr';
import { SignalError } from '../shared/errors';
import { fft, fft2, ifft } from '../shared/fft';
import { fmt } from '../shared/num';
import { step, type Step } from '../shared/steps';

export interface Gray {
  width: number;
  height: number;
  data: Float64Array;
}

export const gray = (width: number, height: number, data?: ArrayLike<number>): Gray => ({
  width,
  height,
  data: data ? Float64Array.from(data) : new Float64Array(width * height),
});

const at = (img: Gray, x: number, y: number) =>
  img.data[Math.min(img.height - 1, Math.max(0, y)) * img.width + Math.min(img.width - 1, Math.max(0, x))]!;

/** Luminance from RGBA bytes by the Rec. 709 weights, and each channel on its own. */
export function fromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
): { luma: Gray; r: Gray; g: Gray; b: Gray } {
  const n = width * height;
  const luma = gray(width, height);
  const r = gray(width, height);
  const g = gray(width, height);
  const b = gray(width, height);
  for (let i = 0; i < n; i += 1) {
    r.data[i] = rgba[4 * i]! / 255;
    g.data[i] = rgba[4 * i + 1]! / 255;
    b.data[i] = rgba[4 * i + 2]! / 255;
    luma.data[i] = 0.2126 * r.data[i]! + 0.7152 * g.data[i]! + 0.0722 * b.data[i]!;
  }
  return { luma, r, g, b };
}

/** A histogram of 256 bins over 0 to 1. */
export function histogram(img: Gray): number[] {
  const bins = Array<number>(256).fill(0);
  for (const v of img.data) bins[Math.min(255, Math.max(0, Math.round(v * 255)))]! += 1;
  return bins;
}

/** Window and level, then gamma: out = ((v − (L − W/2))/W)^γ, clipped to 0 to 1. */
export function adjust(img: Gray, width: number, level: number, gamma: number): Gray {
  if (!(width > 0)) throw new SignalError('positive', { field: 'W' });
  if (!(gamma > 0)) throw new SignalError('positive', { field: 'γ' });
  const low = level - width / 2;
  return gray(
    img.width,
    img.height,
    img.data.map((v) => Math.min(1, Math.max(0, (v - low) / width)) ** gamma),
  );
}

/** A contrast stretch between two percentiles. */
export function stretch(
  img: Gray,
  lowPercent: number,
  highPercent: number,
): { image: Gray; low: number; high: number } {
  if (!(lowPercent >= 0 && highPercent <= 100 && highPercent > lowPercent)) throw new SignalError('percentiles');
  const sorted = Float64Array.from(img.data).sort();
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  const low = pick(lowPercent);
  const high = pick(highPercent);
  const span = high - low || 1;
  return {
    image: gray(
      img.width,
      img.height,
      img.data.map((v) => Math.min(1, Math.max(0, (v - low) / span))),
    ),
    low,
    high,
  };
}

/**
 * Otsu's threshold on whole-number levels: the t (class 0 is at or below t) that maximizes w0 w1 (μ0 − μ1)². Ties go
 * to the lowest t.
 */
export function otsu(levels: ArrayLike<number>): { threshold: number; steps: Step[] } {
  const values = Array.from(levels, (v) => Math.round(v));
  if (!values.length) throw new SignalError('empty');
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) throw new SignalError('flatImage');
  let best = lo;
  let bestScore = -1;
  const total = values.length;
  const sum = values.reduce((a, b) => a + b, 0);
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let n0 = 0;
  let s0 = 0;
  for (let t = lo; t < hi; t += 1) {
    const c = counts.get(t) ?? 0;
    n0 += c;
    s0 += c * t;
    if (n0 === 0 || n0 === total) continue;
    const w0 = n0 / total;
    const w1 = 1 - w0;
    const mu0 = s0 / n0;
    const mu1 = (sum - s0) / (total - n0);
    const score = w0 * w1 * (mu0 - mu1) ** 2;
    if (score > bestScore + 1e-12) [best, bestScore] = [t, score];
  }
  return { threshold: best, steps: [step('imageOtsu', `t = ${best}; w0·w1·(μ0 − μ1)² = ${fmt(bestScore)}`)] };
}

export const threshold = (img: Gray, t: number): Uint8Array => Uint8Array.from(img.data, (v) => (v > t ? 1 : 0));

export interface Component {
  label: number;
  area: number;
  cx: number;
  cy: number;
}

/** Connected components of a binary mask by two-pass union-find, with 4 or 8 connectivity. */
export function components(
  mask: Uint8Array,
  width: number,
  height: number,
  connectivity: 4 | 8,
): {
  labels: Int32Array;
  parts: Component[];
} {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const neighbors: [number, number][] =
    connectivity === 4
      ? [
          [-1, 0],
          [0, -1],
        ]
      : [
          [-1, 0],
          [0, -1],
          [-1, -1],
          [1, -1],
        ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const seen: number[] = [];
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width) continue;
        const l = labels[ny * width + nx]!;
        if (l) seen.push(l);
      }
      if (!seen.length) {
        parent.push(parent.length);
        labels[i] = parent.length - 1;
      } else {
        labels[i] = Math.min(...seen);
        for (const l of seen) unite(labels[i]!, l);
      }
    }
  }
  const remap = new Map<number, number>();
  const acc = new Map<number, Component>();
  for (let i = 0; i < labels.length; i += 1) {
    if (!labels[i]) continue;
    const root = find(labels[i]!);
    if (!remap.has(root)) remap.set(root, remap.size + 1);
    const label = remap.get(root)!;
    labels[i] = label;
    const part = acc.get(label) ?? { label, area: 0, cx: 0, cy: 0 };
    part.area += 1;
    part.cx += i % width;
    part.cy += Math.floor(i / width);
    acc.set(label, part);
  }
  const parts = [...acc.values()].map((p) => ({ ...p, cx: p.cx / p.area, cy: p.cy / p.area }));
  return { labels, parts };
}

export type KernelName =
  'box' | 'gaussian' | 'sharpen' | 'sobelX' | 'sobelY' | 'prewittX' | 'prewittY' | 'laplacian' | 'custom';
export const KERNELS: readonly KernelName[] = [
  'box',
  'gaussian',
  'sharpen',
  'sobelX',
  'sobelY',
  'prewittX',
  'prewittY',
  'laplacian',
  'custom',
];

export function kernel(name: Exclude<KernelName, 'custom'>, sigma = 1): number[][] {
  switch (name) {
    case 'box':
      return [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ].map((r) => r.map((v) => v / 9));
    case 'gaussian': {
      if (!(sigma > 0 && sigma <= 5)) throw new SignalError('sigma');
      const r = Math.ceil(2 * sigma);
      const k = Array.from({ length: 2 * r + 1 }, (_, y) =>
        Array.from({ length: 2 * r + 1 }, (_, x) => Math.exp(-((x - r) ** 2 + (y - r) ** 2) / (2 * sigma * sigma))),
      );
      const total = k.flat().reduce((a, b) => a + b, 0);
      return k.map((row) => row.map((v) => v / total));
    }
    case 'sharpen':
      return [
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0],
      ];
    case 'sobelX':
      return [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1],
      ];
    case 'sobelY':
      return [
        [-1, -2, -1],
        [0, 0, 0],
        [1, 2, 1],
      ];
    case 'prewittX':
      return [
        [-1, 0, 1],
        [-1, 0, 1],
        [-1, 0, 1],
      ];
    case 'prewittY':
      return [
        [-1, -1, -1],
        [0, 0, 0],
        [1, 1, 1],
      ];
    case 'laplacian':
      return [
        [0, 1, 0],
        [1, -4, 1],
        [0, 1, 0],
      ];
  }
}

/** Reads a typed 3 × 3 or 5 × 5 kernel, one row per line. */
export function readKernel(rows: number[][]): number[][] {
  const n = rows.length;
  if (!(n === 3 || n === 5) || rows.some((r) => r.length !== n || r.some((v) => !Number.isFinite(v)))) {
    throw new SignalError('kernelShape');
  }
  return rows;
}

/** Applies a kernel as written (correlation, not flipped), with the edge pixels repeated outward. */
export function convolve(img: Gray, k: readonly (readonly number[])[]): Gray {
  const r = (k.length - 1) / 2;
  const out = gray(img.width, img.height);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      let total = 0;
      for (let j = -r; j <= r; j += 1)
        for (let i = -r; i <= r; i += 1) total += k[j + r]![i + r]! * at(img, x + i, y + j);
      out.data[y * img.width + x] = total;
    }
  }
  return out;
}

export const edgeMagnitude = (img: Gray): Gray => {
  const gx = convolve(img, kernel('sobelX'));
  const gy = convolve(img, kernel('sobelY'));
  return gray(
    img.width,
    img.height,
    gx.data.map((v, i) => Math.hypot(v, gy.data[i]!)),
  );
};

/** A simplified Canny: Gaussian blur, Sobel gradients, thinning to local maxima along the gradient, and hysteresis. */
export function canny(img: Gray, sigma: number, low: number, high: number): Uint8Array {
  if (!(high > low && low >= 0)) throw new SignalError('cannyThresholds');
  const smooth = convolve(img, kernel('gaussian', sigma));
  const gx = convolve(smooth, kernel('sobelX'));
  const gy = convolve(smooth, kernel('sobelY'));
  const { width, height } = img;
  const mag = gx.data.map((v, i) => Math.hypot(v, gy.data[i]!));
  const peak = Math.max(...mag) || 1;
  const thin = new Float64Array(mag.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const angle = ((Math.atan2(gy.data[i]!, gx.data[i]!) * 180) / Math.PI + 180) % 180;
      const [dx, dy] =
        angle < 22.5 || angle >= 157.5 ? [1, 0] : angle < 67.5 ? [1, 1] : angle < 112.5 ? [0, 1] : [-1, 1];
      const m = mag[i]!;
      if (m >= mag[i + dy * width + dx]! && m >= mag[i - dy * width - dx]!) thin[i] = m / peak;
    }
  }
  const edges = new Uint8Array(mag.length);
  const stack: number[] = [];
  thin.forEach((v, i) => {
    if (v >= high) {
      edges[i] = 1;
      stack.push(i);
    }
  });
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = Math.floor(i / width);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!edges[j] && thin[j]! >= low) {
          edges[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return edges;
}

export type Morphology = 'erode' | 'dilate' | 'open' | 'close';

/** Grayscale morphology with a square of side 2r + 1: erosion is the local minimum, dilation the maximum. */
export function morphology(img: Gray, op: Morphology, r = 1): Gray {
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new SignalError('radius');
  const pass = (src: Gray, pick: (a: number, b: number) => number, start: number) => {
    const out = gray(src.width, src.height);
    for (let y = 0; y < src.height; y += 1) {
      for (let x = 0; x < src.width; x += 1) {
        let v = start;
        for (let j = -r; j <= r; j += 1) for (let i = -r; i <= r; i += 1) v = pick(v, at(src, x + i, y + j));
        out.data[y * src.width + x] = v;
      }
    }
    return out;
  };
  const erode = (src: Gray) => pass(src, Math.min, Infinity);
  const dilate = (src: Gray) => pass(src, Math.max, -Infinity);
  if (op === 'erode') return erode(img);
  if (op === 'dilate') return dilate(img);
  return op === 'open' ? dilate(erode(img)) : erode(dilate(img));
}

/** The 2D spectrum (log magnitude, centered) and the image after a circular low- or high-pass mask. */
export function frequencyFilter(
  img: Gray,
  kind: 'lowpass' | 'highpass',
  radius: number,
): { spectrum: Gray; filtered: Gray } {
  if (!(radius > 0 && radius < 1)) throw new SignalError('keepShare');
  const { width, height } = img;
  const k = fft2(img.data, new Float64Array(width * height), width, height);
  const spectrum = gray(width, height);
  const re = new Float64Array(k.re);
  const im = new Float64Array(k.im);
  const cutoff = (radius * Math.min(width, height)) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const fy = ((y + height / 2) % height) - height / 2;
      const fx = ((x + width / 2) % width) - width / 2;
      const i = y * width + x;
      const sy = Math.floor((y + height / 2) % height);
      const sx = Math.floor((x + width / 2) % width);
      spectrum.data[sy * width + sx] = Math.log10(1 + Math.hypot(re[i]!, im[i]!));
      const inside = Math.hypot(fx, fy) <= cutoff;
      if ((kind === 'lowpass') !== inside) {
        re[i] = 0;
        im[i] = 0;
      }
    }
  }
  const back = fft2(re, im, width, height, true);
  const top = Math.max(...spectrum.data) || 1;
  return {
    spectrum: gray(
      width,
      height,
      spectrum.data.map((v) => v / top),
    ),
    filtered: gray(width, height, back.re),
  };
}

/** Pixels per unit from a known length between two points, and the statistics of a rectangle of interest. */
export function calibrate(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  length: number,
): { perUnit: number; pixels: number } {
  const pixels = Math.hypot(x2 - x1, y2 - y1);
  if (!(pixels > 0) || !(length > 0)) throw new SignalError('calibration');
  return { perUnit: pixels / length, pixels };
}

export function roiStats(img: Gray, x0: number, y0: number, x1: number, y1: number) {
  const [ax, bx] = [Math.max(0, Math.min(x0, x1)), Math.min(img.width - 1, Math.max(x0, x1))];
  const [ay, by] = [Math.max(0, Math.min(y0, y1)), Math.min(img.height - 1, Math.max(y0, y1))];
  const values: number[] = [];
  for (let y = Math.round(ay); y <= by; y += 1)
    for (let x = Math.round(ax); x <= bx; x += 1) values.push(img.data[y * img.width + x]!);
  if (!values.length) throw new SignalError('roi');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1));
  return { count: values.length, mean, sd, min: Math.min(...values), max: Math.max(...values) };
}

/** Band math: NDVI = (NIR − Red)/(NIR + Red), 0 where both are 0. */
export const ndvi = (nir: number, red: number): number => (nir + red === 0 ? 0 : (nir - red) / (nir + red));

/**
 * A typed expression of b1 to b4 evaluated at every pixel, compiled once through the app's expression engine (it
 * never runs code). Division by zero gives NaN, shown as 0.
 */
export function bandMath(expression: string, bands: readonly Gray[]): Gray {
  if (!bands.length) throw new SignalError('empty');
  const parsed = tryParse(expression);
  if (!parsed.ok) throw new SignalError('expression', { text: expression });
  const index = { i: 0 };
  const table = standardFunctions('strict');
  const run = compileNode<typeof index>(parsed.value, {
    strict: false,
    table,
    bind: (name) => {
      const k = /^b([1-4])$/.exec(name);
      const band = k ? bands[Number(k[1]) - 1] : undefined;
      return band ? (ctx) => band.data[ctx.i]! : undefined;
    },
  });
  const { width, height } = bands[0]!;
  if (bands.some((b) => b.width !== width || b.height !== height)) throw new SignalError('bandSize');
  const out = gray(width, height);
  for (let i = 0; i < out.data.length; i += 1) {
    index.i = i;
    let v: number;
    try {
      v = run(index);
    } catch {
      throw new SignalError('expression', { text: expression });
    }
    out.data[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

/** Minimum-distance classification: each pixel goes to the class whose mean (over its training pixels) is nearest. */
export function classify(bands: readonly Gray[], training: readonly { label: number; pixels: number[] }[]): Int32Array {
  if (!bands.length || !training.length) throw new SignalError('training');
  const means = training.map((t) => {
    if (!t.pixels.length) throw new SignalError('training');
    return bands.map((b) => t.pixels.reduce((a, p) => a + b.data[p]!, 0) / t.pixels.length);
  });
  const out = new Int32Array(bands[0]!.data.length);
  for (let i = 0; i < out.length; i += 1) {
    let best = 0;
    let bestD = Infinity;
    means.forEach((m, c) => {
      const d = m.reduce((a, v, k) => a + (bands[k]!.data[i]! - v) ** 2, 0);
      if (d < bestD) [best, bestD] = [c, d];
    });
    out[i] = training[best]!.label;
  }
  return out;
}

/** The Radon transform: line integrals through the image at each angle (degrees), by rotating and summing columns. */
export function radon(img: Gray, angles: number): { sinogram: Gray; detectors: number } {
  if (!Number.isInteger(angles) || angles < 2 || angles > 360) throw new SignalError('angles');
  const n = Math.max(img.width, img.height);
  const detectors = Math.ceil(n * Math.SQRT2) | 1;
  const sino = gray(detectors, angles);
  const cx = (img.width - 1) / 2;
  const cy = (img.height - 1) / 2;
  const mid = (detectors - 1) / 2;
  for (let a = 0; a < angles; a += 1) {
    const th = (Math.PI * a) / angles;
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const v = img.data[y * img.width + x]!;
        if (!v) continue;
        const t = (x - cx) * c + (y - cy) * s + mid;
        const k = Math.floor(t);
        const f = t - k;
        if (k >= 0 && k < detectors) sino.data[a * detectors + k]! += v * (1 - f);
        if (k + 1 >= 0 && k + 1 < detectors) sino.data[a * detectors + k + 1]! += v * f;
      }
    }
  }
  return { sinogram: sino, detectors };
}

export type ReconFilter = 'ramLak' | 'sheppLogan' | 'none';

/** Filtered back-projection: ramp-filter each projection in frequency, then smear it back across the image. */
export function backProject(sino: Gray, size: number, filter: ReconFilter): Gray {
  const detectors = sino.width;
  const angles = sino.height;
  const padded = 2 ** Math.ceil(Math.log2(2 * detectors));
  const filtered: Float64Array[] = [];
  for (let a = 0; a < angles; a += 1) {
    const row = new Float64Array(padded);
    row.set(sino.data.subarray(a * detectors, (a + 1) * detectors));
    if (filter === 'none') {
      filtered.push(row.subarray(0, detectors));
      continue;
    }
    const f = fft(row);
    for (let k = 0; k < padded; k += 1) {
      const nu = Math.min(k, padded - k) / padded;
      const ramp = 2 * nu;
      const shape = filter === 'sheppLogan' && nu > 0 ? Math.sin(Math.PI * nu) / (Math.PI * nu) : 1;
      f.re[k] = f.re[k]! * ramp * shape;
      f.im[k] = f.im[k]! * ramp * shape;
    }
    filtered.push(ifft(f.re, f.im).re.subarray(0, detectors));
  }
  const out = gray(size, size);
  const c = (size - 1) / 2;
  const mid = (detectors - 1) / 2;
  for (let a = 0; a < angles; a += 1) {
    const th = (Math.PI * a) / angles;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const row = filtered[a]!;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const t = (x - c) * cs + (y - c) * sn + mid;
        const k = Math.floor(t);
        const f = t - k;
        if (k >= 0 && k + 1 < detectors) out.data[y * size + x]! += row[k]! * (1 - f) + row[k + 1]! * f;
      }
    }
  }
  const scale = Math.PI / angles;
  return gray(
    size,
    size,
    out.data.map((v) => v * scale),
  );
}
