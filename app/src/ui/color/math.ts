// checks-disable-file brand-consistency: values here are palette data
// Color math for the palette: sRGB bytes, hex, HSL, tints and shades, and WCAG contrast.
// Worked from the published definitions. These are WCAG 2.x relative luminance and contrast ratio, and the
// standard RGB to HSL conversion. There are no lookup tables, so the tests can be worked by hand.

export type Rgb = readonly [number, number, number];
export type Hsl = readonly [number, number, number];

const clampByte = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

/** Reads `#rrggbb` in either case. Null for anything else. */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Lowercase `#rrggbb`, with each byte clamped and rounded. */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Hue 0 to 359, saturation, and lightness 0 to 100, each rounded to a whole number. */
export function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = Math.round(h * 60);
  return [((h % 360) + 360) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export function hslToRgb([h, s, l]: Hsl): Rgb {
  const sn = Math.min(100, Math.max(0, s)) / 100;
  const ln = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = ln - c / 2;
  return [clampByte((r1 + m) * 255), clampByte((g1 + m) * 255), clampByte((b1 + m) * 255)];
}

/** Mixes a color toward white by `percent` (0 to 100). "Lighter 40%" is `lighten(hex, 40)`. */
export function lighten(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const t = percent / 100;
  return rgbToHex(rgb.map((c) => c + (255 - c) * t) as unknown as Rgb);
}

/** Mixes a color toward black by `percent` (0 to 100). "Darker 50%" is `darken(hex, 50)`. */
export function darken(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const t = 1 - percent / 100;
  return rgbToHex(rgb.map((c) => c * t) as unknown as Rgb);
}

/** WCAG 2.x relative luminance of a sRGB color. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Automatic text color: the ink or the paper, whichever has the higher WCAG contrast with the background. On a tie
 * the ink wins. Defaults are black and white.
 */
export function automaticTextColor(background: string, ink = '#000000', paper = '#ffffff'): string {
  const bg = hexToRgb(background);
  const a = hexToRgb(ink);
  const b = hexToRgb(paper);
  if (!bg || !a || !b) return ink;
  return contrastRatio(a, bg) >= contrastRatio(b, bg) ? ink : paper;
}
