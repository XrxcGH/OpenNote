// The CSS declarations for a run's version 2 formatting (text DESIGN.md 2.2 and 7). The schema's marks call this with
// the mark's name and attributes while they render, so the static DOM and the editor's DOM carry the same style.
import { loadStandIn } from '../../theme/fonts';
import { fontStack } from './fallbacks';
import { lineFactor } from './lineFactor';

/** Inline style declarations, as property to value. */
export type StyleDeclarations = Readonly<Record<string, string>>;

/** CSS pixels per point. */
export const PX_PER_PT = 4 / 3;

/** A length in points as CSS pixels, rounded to 3 places so 10.5 pt is `14px`. */
export const px = (points: number): string => `${Math.round(points * PX_PER_PT * 1000) / 1000}px`;

const HEX = /^#[0-9a-f]{6}$/;

/** The highlighters' washes: the pens' colors, thinned like a highlighter on paper (BRAND.md section 4). */
const WASH: Readonly<Record<string, string>> = {
  honey: 'var(--color-selection-highlight)',
  mint: 'color-mix(in srgb, var(--ink-fern) 22%, transparent)',
  rose: 'color-mix(in srgb, var(--ink-brick) 20%, transparent)',
  apricot: 'color-mix(in srgb, var(--ink-amber) 24%, transparent)',
  lilac: 'color-mix(in srgb, var(--ink-plum) 20%, transparent)',
};
const PENS = ['ink', 'indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'];

/** A color of the grammar (a pen, a highlighter, `#rrggbb`, or `theme:NAME`) as a CSS color. */
export function colorValue(color: string): string {
  if (HEX.test(color)) return color;
  if (PENS.includes(color)) return `var(--ink-${color})`;
  if (color in WASH) return WASH[color];
  if (color === 'theme:text') return 'var(--color-text-primary)';
  if (color === 'theme:background') return 'var(--color-surface-page)';
  if (color.startsWith('theme:accent')) return `var(--theme-${color.slice(6)}, var(--color-accent-clay))`;
  return 'currentcolor';
}

const num = (value: unknown): number | null => {
  const n = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `text-decoration-style` and heaviness for each underline style (ST_Underline). CSS has fewer dash shapes than
 * Word, so the long dash and dot-dash families share the nearest one. */
const UNDERLINES: Readonly<Record<string, readonly [string, boolean]>> = {
  double: ['double', false],
  words: ['solid', false],
  thick: ['solid', true],
  dotted: ['dotted', false],
  dottedHeavy: ['dotted', true],
  dash: ['dashed', false],
  dashedHeavy: ['dashed', true],
  dashLong: ['dashed', false],
  dashLongHeavy: ['dashed', true],
  dotDash: ['dashed', false],
  dashDotHeavy: ['dashed', true],
  dotDotDash: ['dashed', false],
  dashDotDotHeavy: ['dashed', true],
  wave: ['wavy', false],
  wavyHeavy: ['wavy', true],
  wavyDouble: ['wavy', false],
};

function underline(attrs: Readonly<Record<string, unknown>>): StyleDeclarations {
  const out: Record<string, string> = {};
  const line = UNDERLINES[text(attrs.line)];
  if (line || attrs.color) out['text-decoration-line'] = 'underline';
  if (line) {
    out['text-decoration-style'] = line[0];
    if (line[1]) out['text-decoration-thickness'] = '0.12em';
  }
  if (attrs.color) out['text-decoration-color'] = colorValue(text(attrs.color));
  return out;
}

const OTF: Readonly<Record<string, readonly [string, string]>> = {
  'liga-none': ['font-variant-ligatures', 'no-common-ligatures'],
  'clig-none': ['font-variant-ligatures', 'no-contextual'],
  dlig: ['font-variant-ligatures', 'discretionary-ligatures'],
  hlig: ['font-variant-ligatures', 'historical-ligatures'],
  lnum: ['font-variant-numeric', 'lining-nums'],
  onum: ['font-variant-numeric', 'oldstyle-nums'],
  pnum: ['font-variant-numeric', 'proportional-nums'],
  tnum: ['font-variant-numeric', 'tabular-nums'],
  zero: ['font-variant-numeric', 'slashed-zero'],
};

function otf(tokens: string): StyleDeclarations {
  const groups: Record<string, string[]> = {};
  const features: string[] = [];
  for (const token of tokens.split(' ')) {
    const known = OTF[token];
    if (known) (groups[known[0]] ??= []).push(known[1]);
    else if (/^ss\d\d$/.test(token)) features.push(`"${token}" 1`);
  }
  const out: Record<string, string> = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.join(' ')]));
  if (features.length > 0) out['font-feature-settings'] = features.join(', ');
  return out;
}

const SHADOW = '1px 1px 2px color-mix(in srgb, currentcolor 45%, transparent)';
// checks-disable-next-line brand-consistency: the emboss highlight is white and the shade black, in every theme
const EMBOSS = '-1px -1px 0 rgb(255 255 255 / 0.7), 1px 1px 0 rgb(0 0 0 / 0.45)';
// checks-disable-next-line brand-consistency: the engrave highlight is white and the shade black, in every theme
const ENGRAVE = '1px 1px 0 rgb(255 255 255 / 0.7), -1px -1px 0 rgb(0 0 0 / 0.45)';

function effect(tokens: string): StyleDeclarations {
  const set = new Set(tokens.split(' '));
  const out: Record<string, string> = {};
  if (set.has('outline')) {
    out['-webkit-text-stroke'] = '1px currentcolor';
    out.color = 'transparent';
  }
  const shadows = [set.has('shadow') && SHADOW, set.has('emboss') && EMBOSS, set.has('engrave') && ENGRAVE].filter(
    Boolean,
  );
  if (shadows.length > 0) out['text-shadow'] = shadows.join(', ');
  return out;
}

const BOXES: Readonly<Record<string, string>> = {
  single: '1px solid',
  double: '3px double',
  dotted: '1px dotted',
  dashed: '1px dashed',
  thick: '2px solid',
};

function font(name: string): StyleDeclarations {
  if (typeof document !== 'undefined') void loadStandIn(name).catch(() => undefined);
  // The run's own single-line factor, used when its paragraph sets a line multiple (paraStyle's `--line-mult`).
  const factor = String(Math.round(lineFactor(name) * 10000) / 10000);
  return {
    'font-family': fontStack(name),
    '--line-factor': factor,
    'line-height': 'calc(var(--line-mult) * var(--line-factor))',
  };
}

/** The declarations for one run's formatting attributes: `mark` names the mark, the rest are its attributes. */
export function runStyle(attrs: Readonly<Record<string, unknown>>): StyleDeclarations {
  switch (attrs.mark) {
    case 'font':
      return text(attrs.font) === '' ? {} : font(text(attrs.font));
    case 'textSize':
      return /^[0-9.]+$/.test(text(attrs.size)) ? { 'font-size': px(Number(attrs.size)) } : {};
    case 'underline':
      return underline(attrs);
    case 'strike':
      return attrs.line === 'double'
        ? { 'text-decoration-line': 'line-through', 'text-decoration-style': 'double' }
        : {};
    case 'weight':
      return num(attrs.weight) === null ? {} : { 'font-weight': String(num(attrs.weight)) };
    case 'caps':
      return attrs.caps === 'small' ? { 'font-variant-caps': 'small-caps' } : { 'text-transform': 'uppercase' };
    case 'tracking':
      return num(attrs.tracking) === null ? {} : { 'letter-spacing': px(Number(attrs.tracking)) };
    case 'shift':
      return num(attrs.shift) === null ? {} : { 'vertical-align': px(Number(attrs.shift)) };
    case 'scale':
      return num(attrs.scale) === null ? {} : { '--scale': String(Number(attrs.scale) / 100) };
    case 'kern':
      // A size threshold has no CSS form, so kerning is on at any size once a threshold is set (a deviation noted
      // in the lane notes); 0 turns it off.
      return { 'font-kerning': attrs.kern === '0' ? 'none' : 'normal' };
    case 'otf':
      return otf(text(attrs.otf));
    case 'effect':
      return effect(text(attrs.effect));
    case 'box': {
      const style = BOXES[text(attrs.style)] ?? BOXES.single;
      const color = attrs.color ? colorValue(text(attrs.color)) : 'currentcolor';
      return { outline: `${style} ${color}`, 'outline-offset': '1px' };
    }
    case 'highlight': {
      // The named highlighters are drawn by the style sheet. Any other color rides on a custom property, which the
      // sheet draws opaque in light mode and at 45 percent opacity in dark mode.
      const color = text(attrs.color);
      return color === '' || color in WASH ? {} : { '--run-fill': colorValue(color) };
    }
    case 'shade':
      return text(attrs.shade) === '' ? {} : { 'background-color': colorValue(text(attrs.shade)) };
    case 'dir':
      return { 'unicode-bidi': 'isolate', direction: attrs.dir === 'rtl' ? 'rtl' : 'ltr' };
    default:
      return {};
  }
}
