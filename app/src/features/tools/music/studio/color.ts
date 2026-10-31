// Color arithmetic: sRGB, hex, HSL, HSV, CMYK, CIE XYZ, CIELAB, and LCh (D65), CIEDE2000 color difference,
// WCAG 2 contrast, color-vision simulation, and palettes. Pure functions on numbers.

export type Rgb = readonly [number, number, number];

/** sRGB with channels 0 to 255 (not rounded). */
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

const hex2 = (n: number): string =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');

export const toHex = (rgb: Rgb): string => `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;

/**
 * Reads a color the way people type it: #rgb, #rrggbb, rgb(r, g, b), hsl(h, s%, l%), or three numbers.
 * Returns null when the text is none of these or a channel is out of range.
 */
export function parseColor(text: string): Rgb | null {
  const t = text.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join('') : hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const hsl = /^hsl\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*\)$/.exec(t);
  if (hsl) {
    const [h, s, l] = [Number(hsl[1]), Number(hsl[2]), Number(hsl[3])];
    return s > 100 || l > 100 ? null : hslToRgb(h, s / 100, l / 100);
  }
  const nums = /^(?:rgb\()?\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*\)?$/.exec(t);
  if (nums) {
    const rgb: Rgb = [Number(nums[1]), Number(nums[2]), Number(nums[3])];
    return rgb.some((c) => c > 255) ? null : rgb;
  }
  return null;
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r! + m) * 255, (g! + m) * 255, (b! + m) * 255];
}

export function rgbToHsl(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  return [hueOf(r, g, b, max, d), s, l];
}

function hueOf(r: number, g: number, b: number, max: number, d: number): number {
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function rgbToHsv(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  return [d === 0 ? 0 : hueOf(r, g, b, max, d), max === 0 ? 0 : d / max, max];
}

/** The simple device-independent CMYK formula (no ink profile): K = 1 - max(R, G, B). */
export function rgbToCmyk(rgb: Rgb): [number, number, number, number] {
  const [r, g, b] = rgb.map((c) => c / 255) as [number, number, number];
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}

const linear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

const gamma = (x: number): number => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

export const toLinear = (rgb: Rgb): [number, number, number] => [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
export const fromLinear = (lin: readonly number[]): Rgb => [
  clamp(gamma(clamp(lin[0]!, 0, 1)), 0, 255),
  clamp(gamma(clamp(lin[1]!, 0, 1)), 0, 255),
  clamp(gamma(clamp(lin[2]!, 0, 1)), 0, 255),
];

export type Xyz = readonly [number, number, number];

export const WHITE_D65: Xyz = [0.95047, 1, 1.08883];

export function rgbToXyz(rgb: Rgb): Xyz {
  const [r, g, b] = toLinear(rgb);
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

const EPS = 216 / 24389;
const KAPPA = 24389 / 27;
const f = (t: number): number => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);

export function xyzToLab(xyz: Xyz): [number, number, number] {
  const fx = f(xyz[0] / WHITE_D65[0]);
  const fy = f(xyz[1] / WHITE_D65[1]);
  const fz = f(xyz[2] / WHITE_D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const rgbToLab = (rgb: Rgb): [number, number, number] => xyzToLab(rgbToXyz(rgb));

export function labToLch(lab: readonly [number, number, number]): [number, number, number] {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  return [lab[0], Math.hypot(lab[1], lab[2]), (h + 360) % 360];
}

/** Relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B of linearized sRGB. */
export function luminance(rgb: Rgb): number {
  const [r, g, b] = toLinear(rgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, from 1 to 21: (L1 + 0.05) / (L2 + 0.05) with L1 the lighter. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Wcag {
  /** Normal text (under 18 pt, or 14 pt bold). */
  aaNormal: boolean;
  aaaNormal: boolean;
  /** Large text and user-interface parts. */
  aaLarge: boolean;
  aaaLarge: boolean;
}

export const wcag = (ratio: number): Wcag => ({
  aaNormal: ratio >= 4.5,
  aaaNormal: ratio >= 7,
  aaLarge: ratio >= 3,
  aaaLarge: ratio >= 4.5,
});

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** CIEDE2000 color difference of two CIELAB colors (Sharma, Wu, and Dalal, 2005). */
export function deltaE2000(lab1: readonly [number, number, number], lab2: readonly [number, number, number]): number {
  const [l1, a1, b1] = lab1;
  const [l2, a2, b2] = lab2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cBar7 = ((c1 + c2) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + 25 ** 7)));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => (b === 0 && a === 0 ? 0 : (deg(Math.atan2(b, a)) + 360) % 360);
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dL = l2 - l1;
  const dC = c2p - c1p;
  let dh = 0;
  if (c1p * c2p !== 0) {
    dh = h2p - h1p;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dh / 2));
  const lBar = (l1 + l2) / 2;
  const cBar = (c1p + c2p) / 2;
  let hBar = h1p + h2p;
  if (c1p * c2p !== 0) {
    hBar = Math.abs(h1p - h2p) <= 180 ? hBar / 2 : (hBar + (hBar < 360 ? 360 : -360)) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBar - 30)) +
    0.24 * Math.cos(rad(2 * hBar)) +
    0.32 * Math.cos(rad(3 * hBar + 6)) -
    0.2 * Math.cos(rad(4 * hBar - 63));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cBar;
  const sh = 1 + 0.015 * cBar * t;
  const rt = -Math.sin(rad(2 * dTheta)) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

export type Deficiency = 'protan' | 'deutan' | 'tritan';

/** Machado, Oliveira, and Fernandes (2009) matrices for full severity, applied to linear RGB. */
export const MACHADO: Record<Deficiency, readonly (readonly number[])[]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** How a color looks to someone with the deficiency; severity runs from 0 (typical) to 1 (full). */
export function simulate(rgb: Rgb, kind: Deficiency, severity = 1): Rgb {
  const lin = toLinear(rgb);
  const m = MACHADO[kind];
  const out = m.map((row) => row[0]! * lin[0] + row[1]! * lin[1] + row[2]! * lin[2]);
  return fromLinear(out.map((v, i) => lin[i]! + severity * (v - lin[i]!)));
}

export type Harmony = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'tints' | 'shades';

/** Colors related to a base by hue rotation in HSL, or by mixing with white (tints) or black (shades). */
export function palette(base: Rgb, kind: Harmony, count = 5): Rgb[] {
  const [h, s, l] = rgbToHsl(base);
  const rotate = (degrees: number[]): Rgb[] => degrees.map((d) => hslToRgb(h + d, s, l));
  switch (kind) {
    case 'complementary':
      return rotate([0, 180]);
    case 'analogous':
      return rotate([-30, 0, 30]);
    case 'triadic':
      return rotate([0, 120, 240]);
    case 'split':
      return rotate([0, 150, 210]);
    case 'tetradic':
      return rotate([0, 90, 180, 270]);
    case 'tints':
      return Array.from({ length: count }, (_, i) => mix(base, [255, 255, 255], i / count));
    case 'shades':
      return Array.from({ length: count }, (_, i) => mix(base, [0, 0, 0], i / count));
  }
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export interface Confusable {
  a: number;
  b: number;
  kind: Deficiency;
  difference: number;
}

/** Pairs of palette colors whose CIEDE2000 difference falls below `threshold` for a color-vision deficiency. */
export function confusablePairs(colors: readonly Rgb[], threshold = 8): Confusable[] {
  const found: Confusable[] = [];
  for (const kind of ['protan', 'deutan', 'tritan'] as const) {
    const labs = colors.map((c) => rgbToLab(simulate(c, kind)));
    for (let a = 0; a < labs.length; a++) {
      for (let b = a + 1; b < labs.length; b++) {
        const difference = deltaE2000(labs[a]!, labs[b]!);
        if (difference < threshold) found.push({ a, b, kind, difference });
      }
    }
  }
  return found;
}

/** A modular type scale: base × ratio^step for each step from `from` to `to`. */
export const typeScale = (base: number, ratio: number, from: number, to: number): { step: number; size: number }[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ step: from + i, size: base * ratio ** (from + i) }));
