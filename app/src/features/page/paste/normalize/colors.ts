// checks-disable-file brand-consistency: Office's and the web's own colors, matched to the pens, never shown.
// Colors from document sources (Phase 4 ARCHITECTURE.md section 15.3). For Word, OneNote, and Google Docs, a
// background color becomes the nearest of the five highlighters, and a text color becomes the nearest pen when it is
// within a CIEDE2000 distance of 10 of that pen's light value, or a hexadecimal color otherwise. Web pastes drop
// every color, so they never call this.
import { tokens } from '../../../../theme/tokens';
import { wrapChildren } from '../dom';

type Rgb = readonly [number, number, number];
type Lab = readonly [number, number, number];

/** The highlighter names a highlight mark takes; Honey, the default, has none. */
const HIGHLIGHTERS = tokens.ink.highlighters.map((entry) => ({
  name: entry.name === 'Honey' ? null : entry.name.toLowerCase(),
  rgb: overWhite(entry.light),
}));
const PENS = tokens.ink.pens.map((entry) => ({ name: entry.name.toLowerCase(), rgb: hexRgb(entry.light)! }));
/** The pen text has without a color: a text color near it is no color at all. */
const DEFAULT_PEN = 'ink';
export const PEN_DISTANCE = 10;

const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  windowtext: '#000000',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  olive: '#808000',
  purple: '#800080',
  teal: '#008080',
  orange: '#ffa500',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  // Word's highlighter names (mso-highlight).
  darkblue: '#000080',
  darkcyan: '#008080',
  darkgreen: '#008000',
  darkmagenta: '#800080',
  darkred: '#800000',
  darkyellow: '#808000',
  darkgray: '#808080',
  lightgray: '#c0c0c0',
};

function hexRgb(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(hex)) return [0, 1, 2].map((i) => parseInt(hex[i] + hex[i], 16)) as unknown as Rgb;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex))
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as Rgb;
  return null;
}

/** A translucent highlighter as it looks over a white page. */
function overWhite(value: string): Rgb {
  const rgb = hexRgb(value)!;
  const hex = value.replace(/^#/, '');
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  return rgb.map((channel) => Math.round(channel * alpha + 255 * (1 - alpha))) as unknown as Rgb;
}

/** A CSS color as RGB, or null for transparent, `auto`, and what this doesn't read. */
export function parseColor(value: string): Rgb | null {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/\s*!important$/, '');
  if (text === '' || text === 'transparent' || text === 'auto' || text === 'none' || text === 'inherit') return null;
  if (text.startsWith('#')) return hexRgb(text);
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (alpha === 0) return null;
    return [rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part))) as unknown as Rgb;
  }
  return NAMED[text] ? hexRgb(NAMED[text]) : null;
}

function toLab([r, g, b]: Rgb): Lab {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t) / 116 + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** The CIEDE2000 color difference. */
export function deltaE2000(first: Rgb, second: Rgb): number {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  const rad = Math.PI / 180;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const cMean = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const hp1 = hue(b1, ap1);
  const hp2 = hue(b2, ap2);
  const dL = l2 - l1;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0)
    dh = Math.abs(hp2 - hp1) <= 180 ? hp2 - hp1 : hp2 - hp1 > 180 ? hp2 - hp1 - 360 : hp2 - hp1 + 360;
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh * rad) / 2);
  const lMean = (l1 + l2) / 2;
  const cpMean = (cp1 + cp2) / 2;
  let hMean = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    hMean =
      Math.abs(hp1 - hp2) <= 180 ? (hp1 + hp2) / 2 : hp1 + hp2 < 360 ? (hp1 + hp2 + 360) / 2 : (hp1 + hp2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hMean - 30) * rad) +
    0.24 * Math.cos(2 * hMean * rad) +
    0.32 * Math.cos((3 * hMean + 6) * rad) -
    0.2 * Math.cos((4 * hMean - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpMean ** 7 / (cpMean ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sc = 1 + 0.045 * cpMean;
  const sh = 1 + 0.015 * cpMean * t;
  const rt = -Math.sin(2 * dTheta * rad) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

function nearest<T extends { rgb: Rgb }>(rgb: Rgb, choices: readonly T[]): { choice: T; distance: number } {
  let best = { choice: choices[0], distance: Number.POSITIVE_INFINITY };
  for (const choice of choices) {
    const distance = deltaE2000(rgb, choice.rgb);
    if (distance < best.distance) best = { choice, distance };
  }
  return best;
}

/** The highlighter for a background color: always the nearest one. Null names Honey, the default. */
export function highlighterFor(value: string): { color: string | null } | null {
  const rgb = parseColor(value);
  if (!rgb || (rgb[0] > 250 && rgb[1] > 250 && rgb[2] > 250)) return null;
  return { color: nearest(rgb, HIGHLIGHTERS).choice.name };
}

/** The text color for a CSS color: a pen's name when it is near that pen, a hex color otherwise, or null for ink. */
export function penFor(value: string): string | null {
  const rgb = parseColor(value);
  // Documents write their default black text as a color; it is no color here.
  if (!rgb || deltaE2000(rgb, [0, 0, 0]) <= PEN_DISTANCE) return null;
  const { choice, distance } = nearest(rgb, PENS);
  if (distance <= PEN_DISTANCE) return choice.name === DEFAULT_PEN ? null : choice.name;
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

const BACKGROUND = /(?:^|;)\s*(?:mso-highlight|background-color|background)\s*:\s*([^;]+)/i;
const TEXT = /(?:^|;)\s*color\s*:\s*([^;]+)/i;

/** Turns background and text colors in `style` attributes into highlight and text color tags. */
export function mapColors(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    if (element.closest('table, pre, code') && /^(?:TABLE|TD|TH|TR)$/.test(element.tagName)) return;
    const style = element.getAttribute('style') ?? '';
    const background = BACKGROUND.exec(style)?.[1];
    const highlight = background ? highlighterFor(background.split(/\s+/)[0]) : null;
    if (highlight && !element.closest('mark')) {
      const mark = wrapChildren(element, 'mark');
      if (highlight.color) mark.setAttribute('data-color', highlight.color);
    }
    const text = TEXT.exec(style)?.[1];
    const pen = text ? penFor(text) : null;
    if (pen && !element.closest('a')) wrapChildren(element, 'span').setAttribute('data-color', pen);
  });
}
