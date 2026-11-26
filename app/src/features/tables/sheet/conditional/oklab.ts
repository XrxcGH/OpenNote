// OKLab color interpolation for color scales (DESIGN 13.5). Worked from Bjorn Ottosson's published definition of
// OKLab (2020): sRGB to linear light, to LMS, a cube root, then to L, a, b. No lookup tables.

import { hexToRgb, rgbToHex } from '../../../../ui/color/math';

export type Lab = readonly [number, number, number];

const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (x: number): number => {
  const c = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, c * 255));
};

/** `#rrggbb` as OKLab, or null for another value. */
export function hexToLab(hex: string): Lab | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab as lowercase `#rrggbb`, clamped into the sRGB gamut by channel. */
export function labToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** The color a fraction `t` (0 to 1) of the way from `from` to `to`, mixed in OKLab. Falls back to `from`. */
export function mixLab(from: string, to: string, t: number): string {
  const a = hexToLab(from);
  const b = hexToLab(to);
  if (!a || !b) return from;
  const k = Math.min(1, Math.max(0, t));
  return labToHex([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
}
