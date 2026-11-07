// Colors and fills (DESIGN 9, "Colors and dark mode"). Palette names resolve through the theme and change with the
// scheme. A custom color is drawn as stored in both schemes. The text color "Automatic" is whichever of the two
// text tokens has the higher WCAG contrast against the fill.

import { automaticTextColor, contrastRatio, hexToRgb, rgbToHex } from '../../../../ui/color/math';
import type { Rgb } from '../../../../ui/color/math';
import { resolveColor, themeColor } from '../../../../ui/color/parse';
import type { Scheme } from '../../../../ui/color/parse';
import type { Fill } from '../model';

export type { Scheme };

/** The dark and the light text token. */
export function textTokens(): { dark: string; light: string } {
  return { dark: themeColor('text', 'light'), light: themeColor('text', 'dark') };
}

/** The text color for a background: the light token on dark fills, the dark token on light ones. */
export function automaticText(background: string): string {
  const { dark, light } = textTokens();
  const pick = automaticTextColor(background, dark, light);
  // A mid gray reaches 4.5 with neither token: pure black or white does.
  return contrast(pick, background) >= 4.5
    ? pick
    : automaticTextColor(background, rgbToHex([0, 0, 0]), rgbToHex([255, 255, 255]));
}

/** The WCAG contrast ratio of two `#rrggbb` colors, or 1 when either is not one. */
export function contrast(a: string, b: string): number {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return x && y ? contrastRatio(x, y) : 1;
}

/** A stored color as `#rrggbb` in a scheme, or undefined for a value outside the grammar. */
export function colorOf(value: string | undefined, scheme: Scheme): string | undefined {
  return value === undefined ? undefined : (resolveColor(value, scheme) ?? undefined);
}

export interface DrawnFill {
  /** `background-color`, when the fill has a flat color. */
  color?: string;
  /** `background-image`, for patterns and gradients. */
  image?: string;
  /** The color text must contrast with, for Automatic text. */
  under?: string;
}

const STRIPE = (angle: number, ink: string, gap: number) =>
  `repeating-linear-gradient(${angle}deg, ${ink} 0 1px, transparent 1px ${gap}px)`;

/** CSS for a pattern name over its back color, in the pattern's own color. */
function pattern(name: string, ink: string): string | undefined {
  const dark = name.startsWith('dark');
  const gap = dark ? 3 : 5;
  switch (name.replace(/^(dark|light)/, '')) {
    case 'Horizontal':
      return STRIPE(0, ink, gap);
    case 'Vertical':
      return STRIPE(90, ink, gap);
    case 'Down':
      return STRIPE(45, ink, gap);
    case 'Up':
      return STRIPE(135, ink, gap);
    case 'Grid':
      return `${STRIPE(0, ink, gap)}, ${STRIPE(90, ink, gap)}`;
    case 'Trellis':
      return `${STRIPE(45, ink, gap)}, ${STRIPE(135, ink, gap)}`;
    default:
      return undefined;
  }
}

const SHADE: Readonly<Record<string, number>> = {
  gray125: 0.125,
  gray0625: 0.0625,
  lightGray: 0.25,
  mediumGray: 0.5,
  darkGray: 0.75,
};

/** `top` at `share` (0 to 1) over `back`, channel by channel in sRGB, as `#rrggbb`; `back` when either is not a hex. */
export function mixHex(top: string, back: string, share: number): string {
  const a = hexToRgb(top);
  const b = hexToRgb(back);
  if (!a || !b) return back;
  return rgbToHex([0, 1, 2].map((i) => Math.round(a[i] * share + b[i] * (1 - share))) as unknown as Rgb);
}

/** The fill of a cell as CSS. Unknown fills draw as no fill. */
export function drawFill(fill: Fill | undefined, scheme: Scheme): DrawnFill {
  if (fill === undefined || fill === 'none') return {};
  if (typeof fill === 'string') {
    const color = colorOf(fill, scheme);
    return color ? { color, under: color } : {};
  }
  if ('gradient' in fill) {
    const g = fill.gradient;
    const stops = g.stops
      .map((s) => ({ at: s.at, color: colorOf(s.color, scheme) }))
      .filter((s): s is { at: number; color: string } => s.color !== undefined);
    if (stops.length < 2) return {};
    const list = stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ');
    return { image: `linear-gradient(${90 + (g.angle ?? 0)}deg, ${list})`, under: stops[0].color };
  }
  const ink = colorOf(fill.color ?? 'theme:text', scheme) ?? themeColor('text', scheme);
  const back = colorOf(fill.back, scheme);
  if (fill.pattern === 'solid') return { color: ink, under: ink };
  const shade = Object.hasOwn(SHADE, fill.pattern) ? SHADE[fill.pattern] : undefined;
  if (shade !== undefined) {
    const mix = `color-mix(in srgb, ${ink} ${shade * 100}%, ${back ?? 'transparent'})`;
    // The shade the person sees is the ink at `shade` over the back (the page, when there is no back color).
    return { color: mix, under: mixHex(ink, back ?? themeColor('background', scheme), shade) };
  }
  const image = pattern(fill.pattern, ink);
  return image ? { ...(back ? { color: back } : {}), image, under: back } : {};
}
