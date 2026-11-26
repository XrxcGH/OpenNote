// checks-disable-file brand-consistency: colors and sizes here are clipboard CSS for other apps or test inputs, not design values.
// Cell styles from clipboard CSS (ADR 0067). Excel puts a cell's look in classes of a style block (`.xl65 {...}`) over
// a `td` rule, while Google Sheets and LibreOffice write it inline. Both read the same way: each class rule, then the
// inline style, a later declaration winning. The result is a cell style of the sheet model (DESIGN 3.2).
// Properties follow CSS 2.1 and CSS Color 4 (named colors, rgb()). Excel's own properties are `mso-number-format`
// and `text-underline-style`.

import type { BorderSide, Borders, CellStyle } from '../../sheet/model/types';
import { unescapeFormat } from './formatHints';

export type Declarations = Map<string, string>;

/** Reads `a: b; c: d` into a map of lower-case property names. A value keeps its quotes. */
export function readDeclarations(css: string, into: Declarations = new Map()): Declarations {
  for (const m of css.matchAll(/([\w-]+)\s*:\s*((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^;"'])*)/g)) {
    const value = m[2].trim();
    if (value !== '') into.set(m[1].toLowerCase(), value);
  }
  return into;
}

/** The rules of the style blocks: `td` and `.class` selectors with their declarations, in document order. */
/** The rule text kept for one selector; a longer run of rules is hostile, and the rest is not read. */
const RULE_LIMIT = 4_096;

/** The text of each style block. A scan with indexOf, so unclosed tags stay linear. */
function styleBodies(html: string): string[] {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const open = lower.indexOf('<style', at);
    if (open === -1) break;
    const start = lower.indexOf('>', open);
    if (start === -1) break;
    const end = lower.indexOf('</style', start);
    if (end === -1) break;
    out.push(html.slice(start + 1, end));
    at = end + 7;
  }
  return out;
}

/** CSS without comments. An unclosed comment runs to the end, as in CSS. */
function withoutComments(css: string): string {
  let out = '';
  let at = 0;
  for (;;) {
    const open = css.indexOf('/*', at);
    if (open === -1) return out + css.slice(at);
    out += css.slice(at, open);
    const close = css.indexOf('*/', open + 2);
    if (close === -1) return out;
    at = close + 2;
  }
}

/**
 * The rules of the style blocks: `td` and `.class` selectors with their declarations, read once in document order.
 * The scan finds each `{` and the next `}` with indexOf, so an unclosed brace cannot make it quadratic.
 */
export function styleRules(html: string): Map<string, Declarations> {
  const text = new Map<string, string>();
  for (const block of styleBodies(html)) {
    const body = withoutComments(block.replace(/<!--|--!?>/g, ' '));
    let at = 0;
    for (;;) {
      const open = body.indexOf('{', at);
      if (open === -1) break;
      const close = body.indexOf('}', open + 1);
      if (close === -1) break;
      const declarations = body.slice(open + 1, close);
      for (const raw of body.slice(at, open).split(',')) {
        const selector = raw.trim().toLowerCase();
        if (!/^(td|th|td\.[\w-]+|\.[\w-]+)$/.test(selector)) continue;
        const key = selector.startsWith('td.') ? selector.slice(2) : selector;
        const before = text.get(key) ?? '';
        if (before.length + declarations.length <= RULE_LIMIT) text.set(key, `${before};${declarations}`);
      }
      at = close + 1;
    }
  }
  const rules = new Map<string, Declarations>();
  for (const [key, css] of text) rules.set(key, readDeclarations(css));
  return rules;
}

/**
 * A cell's declarations: its classes in order, then its inline style. The `td` rule is the source's default look
 * (Excel's Normal style), not a format someone chose, so it is not read. Each class was read once by styleRules.
 */
export function cellDeclarations(rules: Map<string, Declarations>, classes: string, inline: string): Declarations {
  const out: Declarations = new Map();
  for (const name of classes.split(/\s+/)) {
    const rule = name ? rules.get(`.${name.toLowerCase()}`) : undefined;
    if (rule) for (const [property, value] of rule) out.set(property, value);
  }
  readDeclarations(inline, out);
  return out;
}

/** CSS Color 4 named colors that spreadsheets write; any other name is not kept. */
const NAMED: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  maroon: '#800000',
  olive: '#808000',
  green: '#008000',
  purple: '#800080',
  teal: '#008080',
  navy: '#000080',
  orange: '#ffa500',
};

const hex2 = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');

/** A CSS color as `#rrggbb`, or null for `transparent`, system colors such as `windowtext`, and anything else. */
export function cssColor(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return `#${m[1]}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`;
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
  return `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`;
}

/** A CSS length in points, or null. Pixels are 3/4 of a point (CSS 2.1, 96 px to 72 pt). */
export function cssPoints(value: string | undefined): number | null {
  const m = /^(-?[\d.]+)\s*(pt|px|em|rem)?$/i.exec(value?.trim() ?? '');
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  return unit === 'pt' ? n : unit === 'px' ? n * 0.75 : n * 12;
}

const unquote = (value: string): string => value.replace(/^(["'])([\s\S]*)\1$/, '$2');

/** Excel's built-in format names that it writes as `mso-number-format` (its Format Cells names). */
const NAMED_FORMATS: Readonly<Record<string, string>> = {
  general: 'General',
  'general number': 'General',
  fixed: '0.00',
  standard: '#,##0.00',
  percent: '0.00%',
  scientific: '0.00E+00',
  'short date': 'm/d/yyyy',
  'medium date': 'd-mmm-yy',
  'long date': 'dddd, mmmm d, yyyy',
  'short time': 'h:mm',
  'medium time': 'h:mm AM/PM',
  'long time': 'h:mm:ss AM/PM',
  'general date': 'm/d/yyyy h:mm',
};

/** A number format code from `mso-number-format`, with Excel's escapes read. General gives null. */
export function msoCode(value: string | undefined): string | null {
  if (value === undefined) return null;
  const code = unescapeFormat(unquote(value.trim()));
  const named = NAMED_FORMATS[code.trim().toLowerCase()];
  const out = named ?? code;
  return out === '' || out === 'General' ? null : out;
}

/** A border side from CSS such as `.5pt solid windowtext` or `1px dashed #cc0000`. */
export function cssBorder(value: string | undefined): BorderSide | null {
  if (!value) return null;
  const parts = value
    .trim()
    .toLowerCase()
    .split(/\s+(?![^(]*\))/);
  const line = parts.find((p) => /^(none|hidden|solid|dotted|dashed|double|groove|ridge|inset|outset)$/.test(p));
  if (!line || line === 'none' || line === 'hidden') return null;
  const points = parts.map(cssPoints).find((n) => n !== null) ?? (/thick/.test(value) ? 2 : 0.75);
  if (points <= 0) return null;
  const color = parts.map(cssColor).find((c) => c !== null) ?? undefined;
  let style: string;
  if (line === 'double') style = 'double';
  else if (line === 'dotted') style = points < 0.75 ? 'hair' : 'dotted';
  else if (line === 'dashed') style = points >= 1 ? 'mediumDashed' : 'dashed';
  else style = points <= 0.75 ? 'thin' : points <= 1.5 ? 'medium' : 'thick';
  return color && color !== '#000000' ? { style, color } : { style };
}

const ALIGN_H: Readonly<Record<string, NonNullable<CellStyle['align']>['h']>> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  justify: 'justify',
};
const ALIGN_V: Readonly<Record<string, NonNullable<CellStyle['align']>['v']>> = {
  top: 'top',
  middle: 'middle',
  center: 'middle',
  bottom: 'bottom',
};

function borders(d: Declarations): Borders | undefined {
  const all = cssBorder(d.get('border'));
  const out: Borders = {};
  for (const [edge, key] of [
    ['top', 't'],
    ['right', 'r'],
    ['bottom', 'b'],
    ['left', 'l'],
  ] as const) {
    const side = d.has(`border-${edge}`) ? cssBorder(d.get(`border-${edge}`)) : all;
    if (side) out[key] = side;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function font(d: Declarations): CellStyle['font'] {
  const out: NonNullable<CellStyle['font']> = {};
  const weight = d.get('font-weight')?.toLowerCase();
  if (weight === 'bold' || weight === 'bolder' || (weight !== undefined && parseInt(weight, 10) >= 600))
    out.bold = true;
  if (/italic|oblique/i.test(d.get('font-style') ?? '')) out.italic = true;
  const decoration = `${d.get('text-decoration') ?? ''} ${d.get('text-decoration-line') ?? ''}`.toLowerCase();
  if (decoration.includes('underline')) {
    out.underline = /double/i.test(`${d.get('text-underline-style') ?? ''} ${decoration}`) ? 'double' : 'single';
  }
  if (decoration.includes('line-through')) out.strike = 'single';
  const color = cssColor(d.get('color'));
  if (color && color !== '#000000') out.color = color;
  const size = cssPoints(d.get('font-size'));
  if (size !== null && size >= 1 && size <= 409) out.size = Math.round(size * 2) / 2;
  const family = d.get('font-family')?.split(',')[0];
  if (family) out.family = unquote(family.trim());
  const shift = d.get('vertical-align')?.toLowerCase();
  if (shift === 'super' || shift === 'sub') out.script = shift;
  return Object.keys(out).length > 0 ? out : undefined;
}

function align(d: Declarations, attrAlign: string | undefined): CellStyle['align'] {
  const out: NonNullable<CellStyle['align']> = {};
  const h = ALIGN_H[(d.get('text-align') ?? '').toLowerCase()];
  if (h) out.h = h;
  else if (attrAlign && /^(center|justify)$/i.test(attrAlign)) out.h = ALIGN_H[attrAlign.toLowerCase()];
  const v = ALIGN_V[(d.get('vertical-align') ?? '').toLowerCase()];
  if (v) out.v = v;
  const space = d.get('white-space')?.toLowerCase();
  if (space === 'nowrap') out.wrap = 'overflow';
  else if (space === 'normal' || space === 'pre-wrap') out.wrap = 'wrap';
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The cell style the declarations describe. `attrAlign` is the cell's `align` attribute: Excel writes `align=right`
 * on every number, which is its General alignment, so only center and justify count from it.
 */
export function styleOf(d: Declarations, attrAlign?: string): CellStyle {
  const style: CellStyle = {};
  const fmt = msoCode(d.get('mso-number-format'));
  if (fmt) style.fmt = fmt;
  const f = font(d);
  if (f) style.font = f;
  const background =
    d.get('background-color') ??
    d
      .get('background')
      ?.split(/\s+(?![^(]*\))/)
      .find((p) => cssColor(p));
  const fill = cssColor(background);
  if (fill) style.fill = fill;
  const b = borders(d);
  if (b) style.border = b;
  const a = align(d, attrAlign);
  if (a) style.align = a;
  return style;
}

/**
 * Takes off the body font: a family, size, vertical alignment, and wrap that most cells share is the source's default,
 * not a format someone chose, so only cells that differ keep them.
 */
export function dropShared(styles: CellStyle[]): void {
  const most = <T>(values: (T | undefined)[]): T | undefined => {
    const counts = new Map<T, number>();
    for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: T | undefined;
    let top = 0;
    for (const [v, n] of counts) if (n > top) [best, top] = [v, n];
    return top * 2 > styles.length ? best : undefined;
  };
  const family = most(styles.map((s) => s.font?.family));
  const size = most(styles.map((s) => s.font?.size));
  const v = most(styles.map((s) => s.align?.v));
  const wrap = most(styles.map((s) => s.align?.wrap));
  for (const s of styles) {
    if (s.font) {
      if (s.font.family === family) delete s.font.family;
      if (s.font.size === size) delete s.font.size;
      if (Object.keys(s.font).length === 0) delete s.font;
    }
    if (s.align) {
      if (s.align.v === v) delete s.align.v;
      if (s.align.wrap === wrap) delete s.align.wrap;
      if (Object.keys(s.align).length === 0) delete s.align;
    }
  }
}
