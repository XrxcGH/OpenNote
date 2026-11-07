// Plain data that the editor schema, the Markdown layer, and the paste pipeline share (SPEC 6.6, 7.2 to 7.5).

/** SPEC 7.2: the callout types. A reader keeps an unknown type and shows it as "note". */
export const CALLOUT_TYPES = [
  'note',
  'tip',
  'important',
  'warning',
  'caution',
  'info',
  'question',
  'success',
  'danger',
  'example',
  'quote',
] as const;

/** SPEC 7.4: the highlighter colors besides Honey, which is the default and has no name. */
export const HIGHLIGHT_COLORS = ['mint', 'rose', 'apricot', 'lilac'] as const;
export const TEXT_SIZES = ['small', 'large', 'xlarge'] as const;
/** SPEC 7.2: a callout is folded with "-", open with "+", or neither. */
export const FOLDS = ['', '-', '+'] as const;

/** SPEC 7.2: the info string of a code fence. */
export const LANGUAGE_PATTERN = /^[A-Za-z0-9_+#.-]{1,32}$/;
/** SPEC 7.4: a text color is a pen name or `#rrggbb`. */
export const TEXT_COLOR_PATTERN = /^(#[0-9A-Fa-f]{6}|[a-z][a-z0-9-]{0,31})$/;
/** A callout type as typed after `[!`. */
export const CALLOUT_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** SPEC 7.10 (R-MRK-24): the marks, outermost first. Version 1's order (SPEC 7.7) is a subsequence of it. */
export const MARK_ORDER = [
  'float',
  'link',
  'comment',
  'insertion',
  'deletion',
  'formatChange',
  'dir',
  'lang',
  'charStyle',
  'bold',
  'weight',
  'italic',
  'strike',
  'underline',
  'highlight',
  'shade',
  'textColor',
  'font',
  'textSize',
  'caps',
  'tracking',
  'scale',
  'shift',
  'kern',
  'otf',
  'effect',
  'box',
  'subscript',
  'superscript',
  'foreign',
  'code',
] as const;
export type MarkName = (typeof MARK_ORDER)[number];

/** R-MRK-26 and R-INL-10: the marks of which several may cover the same text. */
export const REPEATABLE_MARKS: ReadonlySet<string> = new Set(['comment', 'foreign']);

// SPEC Appendix D: the value grammars that text marks, named styles, and cell styles share. Each check takes the
// exact text of a value, as a tag or a JSON key holds it.

/** D.7: the pen names (SPEC 2.7). */
export const PEN_COLORS = ['ink', 'indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'] as const;
/** D.7: the highlighter names, Honey first. */
export const HIGHLIGHTER_COLORS = ['honey', 'mint', 'rose', 'apricot', 'lilac'] as const;
/** D.7: the theme colors, written `theme:NAME`. */
export const THEME_COLORS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'text', 'background'];
/** D.2: the theme font tokens. */
export const THEME_FONTS = ['+body', '+heading', '+mono'] as const;
/** D.5: the 17 underline styles of text, `single` first. Cells add the two accounting styles. */
export const UNDERLINE_STYLES = [
  'single',
  'double',
  'words',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
] as const;
export const ACCOUNTING_UNDERLINES = ['singleAccounting', 'doubleAccounting'] as const;
/** R-MRK-11: the OpenType feature tokens. */
export const OTF_FEATURES: readonly string[] = [
  'clig-none',
  'dlig',
  'hlig',
  'liga-none',
  'lnum',
  'onum',
  'pnum',
  'tnum',
  'zero',
  ...Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, '0')}`),
];
/** R-MRK-12: the text effects. `emboss` and `engrave` exclude each other. */
export const TEXT_EFFECTS = ['emboss', 'engrave', 'outline', 'shadow'] as const;
/** R-MRK-13: the box styles. */
export const BOX_STYLES = ['single', 'double', 'dotted', 'dashed', 'thick'] as const;
/** R-MRK-6, R-MRK-18, R-MRK-29. */
export const CAPS_VALUES = ['small', 'all'] as const;
export const DIRECTIONS = ['rtl', 'ltr'] as const;
export const FLOAT_EDGES = ['start', 'end'] as const;
/** R-STY-3: the built-in style names of versions 1 and 2. */
export const BUILT_IN_STYLES = [
  'normal',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'title',
  'quote',
  'code',
  'subtitle',
  'citation',
  'h7',
  'h8',
  'h9',
  'quote2',
] as const;

const NUMBER_TEXT = /^-?(0|[1-9][0-9]{0,5})(\.[0-9]?[1-9])?$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;
const ELEMENT_ID = /^[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const USER_STYLE = /^u-[a-z0-9-]{1,32}$/;
const FONT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._+-]*$/u;

/** A number range for R-VAL-1, in hundredths so every step is a whole number. */
interface NumberRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly not?: readonly number[];
}

/** R-VAL-1: a number written as text: the shortest decimal form, in range, on the step, and not excluded. */
export function isNumberText(text: string, range: NumberRange): boolean {
  const match = NUMBER_TEXT.exec(text);
  if (!match || text === '-0') return false;
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const hundredths = (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (text.startsWith('-') ? -1 : 1);
  const scaled = (value: number) => Math.round(value * 100);
  return (
    hundredths >= scaled(range.min) &&
    hundredths <= scaled(range.max) &&
    hundredths % scaled(range.step) === 0 &&
    !(range.not ?? []).some((value) => scaled(value) === hundredths)
  );
}

/** D.3: a size in points, 1 to 1638 in steps of 0.5. */
export const SIZE_POINTS: NumberRange = { min: 1, max: 1638, step: 0.5 };
/** D.4 and R-MRK-5: a weight mark, 100 to 900 in steps of 100, without 400 (no mark) and 700 (`**`). */
export const WEIGHT_MARK: NumberRange = { min: 100, max: 900, step: 100, not: [400, 700] };
export const TRACKING_POINTS: NumberRange = { min: -1584, max: 1584, step: 0.05, not: [0] };
export const SCALE_PERCENT: NumberRange = { min: 1, max: 600, step: 1, not: [100] };
export const SHIFT_POINTS: NumberRange = { min: -1584, max: 1584, step: 0.5, not: [0] };

/** D.7: a color of any kind: a pen or highlighter name, `#rrggbb` in lowercase, or `theme:NAME`. */
export function isColor(text: string): boolean {
  return (
    (PEN_COLORS as readonly string[]).includes(text) ||
    (HIGHLIGHTER_COLORS as readonly string[]).includes(text) ||
    HEX_COLOR.test(text) ||
    (text.startsWith('theme:') && THEME_COLORS.includes(text.slice(6)))
  );
}

/** D.2: a font name of 1 to 63 code points, or a theme token. */
export function isFontName(text: string): boolean {
  if ((THEME_FONTS as readonly string[]).includes(text)) return true;
  const length = Array.from(text).length;
  return length >= 1 && length <= 63 && !text.endsWith(' ') && FONT_NAME.test(text);
}

/** D.8: a language tag, `zxx` included. */
export const isLanguageTag = (text: string): boolean => LANGUAGE_TAG.test(text);
/** D.9: an ID in a tag or a footnote reference, in the lowercase form of SPEC 2.4 only. */
export const isElementId = (text: string): boolean => ELEMENT_ID.test(text);
/** R-STY-3: a built-in style name or a user style name. */
export function isStyleName(text: string): boolean {
  return (BUILT_IN_STYLES as readonly string[]).includes(text) || USER_STYLE.test(text);
}

/** Space-separated tokens from `allowed`: at least one, each once, in code point order. */
export function isTokenList(text: string, allowed: readonly string[]): boolean {
  const parts = text.split(' ');
  return parts.every((part, i) => allowed.includes(part) && (i === 0 || parts[i - 1] < part));
}

/** R-MRK-2: a text size mark: a version 1 name or points. */
export function isTextSize(text: string): boolean {
  return (TEXT_SIZES as readonly string[]).includes(text) || isNumberText(text, SIZE_POINTS);
}

/** R-MRK-10: `0` turns kerning off; points from 1 to 1638 kern at that size and above. */
export const isKern = (text: string): boolean => text === '0' || isNumberText(text, SIZE_POINTS);
export const isOtfFeatures = (text: string): boolean => isTokenList(text, OTF_FEATURES);
export function isTextEffect(text: string): boolean {
  return isTokenList(text, TEXT_EFFECTS) && !(text.includes('emboss') && text.includes('engrave'));
}
/** R-MRK-14: a highlight color of version 2. Honey has no name: it is written `==`. */
export const isHighlightColor = (text: string): boolean => isColor(text) && text !== 'honey';
/** R-MRK-3: an underline style other than `single`, which `<u>` alone writes. */
export const isUnderlineLine = (text: string): boolean =>
  text !== 'single' && (UNDERLINE_STYLES as readonly string[]).includes(text);

/** SPEC 6.6: the nodes that count as text elements. A list item's first paragraph belongs to the item. */
export const ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'listItem',
  'codeBlock',
  'mathBlock',
  'horizontalRule',
]);

export type LinkKind = 'web' | 'mail' | 'opennote' | 'asset' | 'inert';

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const BLOCKED_SCHEMES = new Set(['javascript', 'vbscript', 'data']);

/** Whether a character code is a C0 control or a space, which a browser trims from both ends of a URL. */
const trimmed = (code: number) => code <= 0x20;

/** A destination as a browser reads it (URL standard): controls and spaces at either end and every tab and line
 * end are removed first. */
function asBrowserReads(href: string): string {
  let start = 0;
  let end = href.length;
  while (start < end && trimmed(href.charCodeAt(start))) start++;
  while (end > start && trimmed(href.charCodeAt(end - 1))) end--;
  return href.slice(start, end).replace(/[\t\n\r]/g, '');
}

/** Whether a destination still holds a control character once a browser has read it. */
function hasControl(href: string): boolean {
  const read = asBrowserReads(href);
  for (let i = 0; i < read.length; i++) {
    const code = read.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The scheme of a link destination in lower case, or null for a relative one. */
export function schemeOf(href: string): string | null {
  const match = SCHEME.exec(asBrowserReads(href));
  return match ? match[1].toLowerCase() : null;
}

/** SPEC 7.5: how the interface treats a destination. "inert" links are kept and never opened. */
export function linkKind(href: string): LinkKind {
  switch (schemeOf(href)) {
    case 'http':
    case 'https':
      return 'web';
    case 'mailto':
      return 'mail';
    case 'opennote':
      return 'opennote';
    case 'asset':
      return 'asset';
    default:
      return 'inert';
  }
}

/** Destinations that never become links, even inert ones (Phase 4 design, 15.9), and any with a control character
 * a browser would keep. */
export function isBlockedHref(href: string): boolean {
  const scheme = schemeOf(href);
  return (scheme !== null && BLOCKED_SCHEMES.has(scheme)) || hasControl(href);
}
