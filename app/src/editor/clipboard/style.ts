// checks-disable-file brand-consistency: colors and sizes here are test inputs or CSS for other apps, not design values.
// The inline CSS that copy writes beside the `data-` attributes (ADR 0084). Word and Google Docs ignore `data-`
// attributes and read `style`, so each run and paragraph formatting also becomes plain CSS in points. Pure
// functions from attributes to declarations; the serializer decides where they go. Clean room: only standard CSS
// properties and the published `mso-highlight` and `mso-line-height-rule` hints.
import { tokens } from '../../theme/tokens';
import { paraFormat } from '../paragraph/attributes';
import type { ParaFormat } from '../paragraph/attributes';

export type Declarations = Record<string, string>;

const PENS = new Map(tokens.ink.pens.map((pen) => [pen.name.toLowerCase(), pen.light.slice(0, 7).toLowerCase()]));

/** A highlighter as it looks over a white page, since CSS backgrounds in other apps are opaque. */
function overWhite(value: string): string {
  const hex = value.replace('#', '');
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
  const channels = [0, 2, 4].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

const HIGHLIGHTERS = new Map(
  tokens.ink.highlighters.map((entry) => [entry.name.toLowerCase(), overWhite(entry.light)] as const),
);

/** Word's highlight names, which are CSS color names, by color. */
const WORD_HIGHLIGHT: Readonly<Record<string, string>> = {
  '#ffff00': 'yellow',
  '#00ff00': 'lime',
  '#00ffff': 'aqua',
  '#ff00ff': 'fuchsia',
  '#0000ff': 'blue',
  '#ff0000': 'red',
  '#000080': 'navy',
  '#008080': 'teal',
  '#008000': 'green',
  '#800080': 'purple',
  '#800000': 'maroon',
  '#808000': 'olive',
  '#808080': 'gray',
  '#c0c0c0': 'silver',
  '#000000': 'black',
};

/** A mark's color value (a pen, a highlighter, or `#rrggbb`) as a CSS color, or null for a theme color. */
export function cssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  return PENS.get(value) ?? HIGHLIGHTERS.get(value) ?? null;
}

/** A number as CSS text: at most two decimals, no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** A font family as CSS: a name with a space or digit is quoted. Theme fonts have no name to write. */
function family(name: string): string | null {
  if (name.startsWith('+')) return null;
  return /^[A-Za-z][A-Za-z-]*$/.test(name) ? name : `'${name.replace(/'/g, '')}'`;
}

const UNDERLINE_CSS: Readonly<Record<string, string>> = {
  double: 'double',
  dotted: 'dotted',
  dottedHeavy: 'dotted',
  dash: 'dashed',
  dashedHeavy: 'dashed',
  dashLong: 'dashed',
  dashLongHeavy: 'dashed',
  wave: 'wavy',
  wavyHeavy: 'wavy',
  wavyDouble: 'wavy',
};

function decoration(line: string, attrs: Record<string, unknown>): Declarations {
  const out: Declarations = { 'text-decoration-line': line };
  const kind = typeof attrs.line === 'string' ? UNDERLINE_CSS[attrs.line] : undefined;
  if (kind) out['text-decoration-style'] = kind;
  const color = cssColor(attrs.color);
  if (color) out['text-decoration-color'] = color;
  return out;
}

/** The CSS declarations for one mark, from its name and attributes. Marks with no CSS give none. */
export function markDeclarations(name: string, attrs: Readonly<Record<string, unknown>>): Declarations {
  switch (name) {
    case 'textColor': {
      const color = cssColor(attrs.color);
      return color ? { color } : {};
    }
    case 'highlight': {
      const color = cssColor(attrs.color ?? 'honey');
      if (!color) return {};
      const word = WORD_HIGHLIGHT[color];
      return word ? { 'background-color': color, 'mso-highlight': word } : { 'background-color': color };
    }
    case 'shade': {
      const color = cssColor(attrs.shade);
      return color ? { 'background-color': color } : {};
    }
    case 'font': {
      const css = typeof attrs.font === 'string' ? family(attrs.font) : null;
      return css ? { 'font-family': css } : {};
    }
    case 'textSize': {
      const size = Number(attrs.size);
      return Number.isFinite(size) ? { 'font-size': `${num(size)}pt` } : {};
    }
    case 'weight':
      return typeof attrs.weight === 'string' ? { 'font-weight': attrs.weight } : {};
    case 'underline':
      return decoration('underline', attrs);
    case 'strike':
      return attrs.line === 'double'
        ? { 'text-decoration-line': 'line-through', 'text-decoration-style': 'double' }
        : {};
    case 'caps':
      return attrs.caps === 'small' ? { 'font-variant': 'small-caps' } : { 'text-transform': 'uppercase' };
    case 'tracking': {
      const value = Number(attrs.tracking);
      return Number.isFinite(value) ? { 'letter-spacing': `${num(value)}pt` } : {};
    }
    case 'shift': {
      const value = Number(attrs.shift);
      return Number.isFinite(value) ? { position: 'relative', top: `${num(-value)}pt` } : {};
    }
    default:
      return {};
  }
}

const ALIGN_CSS: Readonly<Record<string, string>> = {
  start: 'left',
  center: 'center',
  end: 'right',
  justify: 'justify',
  distribute: 'justify',
};

/** The CSS declarations for a paragraph's formatting attributes. */
export function paraDeclarations(format: ParaFormat): Declarations {
  const out: Declarations = {};
  if (format.align) out['text-align'] = ALIGN_CSS[format.align];
  if (format.indent) {
    if (format.indent.start) out['margin-left'] = `${num(format.indent.start)}pt`;
    if (format.indent.end) out['margin-right'] = `${num(format.indent.end)}pt`;
    if (format.indent.first) out['text-indent'] = `${num(format.indent.first)}pt`;
  }
  if (typeof format.before === 'number') out['margin-top'] = `${num(format.before)}pt`;
  if (typeof format.after === 'number') out['margin-bottom'] = `${num(format.after)}pt`;
  if (format.line) {
    if (format.line.rule === 'multiple') out['line-height'] = `${num(format.line.value * 100)}%`;
    else {
      out['line-height'] = `${num(format.line.value)}pt`;
      out['mso-line-height-rule'] = format.line.rule === 'exact' ? 'exactly' : 'at-least';
    }
  }
  if (format.keepNext) out['page-break-after'] = 'avoid';
  if (format.keepLines) out['page-break-inside'] = 'avoid';
  if (format.breakBefore) out['page-break-before'] = 'always';
  const fill = cssColor(format.shade?.fill);
  if (fill) out['background-color'] = fill;
  return out;
}

/** The paragraph keys that go into `data-paste-para`. The list reference stays out: it names data of this page. */
export const PORTABLE_PARA_KEYS = [
  'align',
  'indent',
  'before',
  'after',
  'contextual',
  'line',
  'keepNext',
  'keepLines',
  'breakBefore',
  'widows',
  'tabs',
  'border',
  'shade',
  'dir',
  'lang',
  'outline',
  'hyphenate',
] as const;

/** The checked, portable paragraph formatting in a node's attributes. */
export function portableFormat(attrs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const format = paraFormat(attrs) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of PORTABLE_PARA_KEYS) if (format[key] !== undefined) out[key] = format[key];
  return out;
}

/** `style` text from declarations. */
export function styleText(declarations: Declarations): string {
  return Object.entries(declarations)
    .map(([property, value]) => `${property}:${value}`)
    .join(';');
}
