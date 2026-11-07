// Keep source formatting (ADR 0084): Word, Google Docs, and OneNote write formatting as CSS in `style` attributes.
// This pass reads the CSS properties that the page can hold and writes them as the schema's own tags and
// attributes: `data-font`, `data-size`, `data-color`, `<mark data-color>`, and so on for runs, and one
// `data-paste-para` JSON attribute for paragraphs (read by ../paraRules.ts). It removes each declaration it uses,
// so the merge steps that follow see only what is left. Nothing here lets a `style` or a class reach the page:
// every value is checked against the same grammar as the file format.
import { PARA_DATA } from '../../../../editor/clipboard/paraData';
import { paraFormat } from '../../../../editor/paragraph/attributes';
import { isFontName, isNumberText, SIZE_POINTS } from '../../../../editor/schema/constants';
import { wrapChildren } from '../dom';
import { parseColor } from './colors';

const BLOCKS = /^(?:P|DIV|H[1-6]|LI|UL|OL|TABLE|THEAD|TBODY|TR|TD|TH|BODY|BLOCKQUOTE|PRE)$/;
const PARAGRAPHS = /^(?:P|H[1-6])$/;
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial']);
const TO_POINTS: Readonly<Record<string, number>> = { pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75, pc: 12 };
const PARA_PROPERTIES = [
  'text-align',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'text-indent',
  'line-height',
  'mso-line-height-rule',
  'page-break-before',
  'page-break-after',
  'page-break-inside',
];

type Declarations = Map<string, string>;
type Sides = { top?: number; right?: number; bottom?: number; left?: number };

function readStyle(element: Element): Declarations {
  const out: Declarations = new Map();
  for (const part of (element.getAttribute('style') ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0)
      out.set(
        part.slice(0, at).trim().toLowerCase(),
        part
          .slice(at + 1)
          .replace(/!important/i, '')
          .trim(),
      );
  }
  return out;
}

function writeStyle(element: Element, declarations: Declarations): void {
  if (declarations.size === 0) element.removeAttribute('style');
  else element.setAttribute('style', [...declarations].map(([name, value]) => `${name}:${value}`).join(';'));
}

/** A CSS length in points, or null when it is not one this reads (percentages, `auto`, and keywords). */
export function points(text: string | undefined): number | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))\s*(pt|in|cm|mm|px|pc)?$/i.exec((text ?? '').trim());
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  if (!unit) return Number(match[1]) === 0 ? 0 : null;
  return Number(match[1]) * TO_POINTS[unit];
}

const onGrid = (value: number, step: number) => Math.round(value / step) * step;

/** Strips the quotes and takes the first family that is not a generic one. */
function fontOf(value: string): string | null {
  for (const raw of value.split(',')) {
    const name = raw
      .trim()
      .replace(/^["']|["']$/g, '')
      .trim();
    if (name && !GENERIC.has(name.toLowerCase()) && isFontName(name)) return name;
  }
  return null;
}

function hex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function sizeOf(value: string): string | null {
  const pt = points(value);
  if (pt === null || pt <= 0) return null;
  const text = String(onGrid(pt, 0.5));
  return isNumberText(text, SIZE_POINTS) ? text : null;
}

/** A weight that has its own mark: 100 to 900 in steps of 100 except 400 and 700, which are no mark and `**`. */
function weightOf(value: string): string | null {
  return /^[1-9]00$/.test(value) && value !== '400' && value !== '700' ? value : null;
}

function trackingOf(value: string): string | null {
  const pt = points(value);
  if (pt === null || Math.abs(pt) > 1584) return null;
  const text = String(Math.round(pt * 20) / 20);
  return text === '0' || text === '-0' ? null : text;
}

/** Wraps the children of an element in a span that carries these attributes. */
function wrapSpan(element: Element, attributes: Record<string, string>): void {
  const span = wrapChildren(element, 'span');
  for (const [name, value] of Object.entries(attributes)) span.setAttribute(name, value);
}

/** The value of a declaration, removed from the set. */
function take(style: Declarations, name: string): string | undefined {
  const value = style.get(name);
  style.delete(name);
  return value;
}

function spanAttributes(element: HTMLElement, style: Declarations): Record<string, string> {
  const attrs: Record<string, string> = {};
  const family = take(style, 'font-family');
  const font = family ? fontOf(family) : null;
  if (font) attrs['data-font'] = font;
  const size = take(style, 'font-size');
  const sizeText = size ? sizeOf(size) : null;
  if (sizeText) attrs['data-size'] = sizeText;
  const color = take(style, 'color');
  const rgb = color ? parseColor(color) : null;
  if (rgb && !(rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) && !element.closest('a')) attrs['data-color'] = hex(rgb);
  const weight = style.get('font-weight');
  const weightText = weight ? weightOf(weight) : null;
  if (weightText) {
    attrs['data-weight'] = weightText;
    style.delete('font-weight');
  }
  const spacing = take(style, 'letter-spacing');
  const tracking = spacing ? trackingOf(spacing) : null;
  if (tracking) attrs['data-tracking'] = tracking;
  const variant = take(style, 'font-variant');
  const transform = take(style, 'text-transform');
  if (/small-caps/i.test(variant ?? '')) attrs['data-caps'] = 'small';
  else if (/^uppercase$/i.test(transform ?? '')) attrs['data-caps'] = 'all';
  return attrs;
}

function lineMarks(element: HTMLElement, style: Declarations): void {
  const decoration = `${style.get('text-decoration') ?? ''} ${style.get('text-decoration-line') ?? ''}`;
  const double = /double/i.test(`${style.get('text-decoration-style') ?? ''} ${decoration}`);
  style.delete('text-decoration-style');
  if (!double) return;
  const underline = /underline/i.test(decoration);
  const strike = !underline && /line-through/i.test(decoration);
  if (underline && !element.closest('u, a')) wrapChildren(element, 'u').setAttribute('data-line', 'double');
  else if (strike && !element.closest('s, del, strike')) wrapChildren(element, 's').setAttribute('data-line', 'double');
  else return;
  style.delete('text-decoration');
  style.delete('text-decoration-line');
}

function runFormats(element: HTMLElement, style: Declarations): void {
  const attrs = spanAttributes(element, style);
  if (Object.keys(attrs).length > 0) wrapSpan(element, attrs);
  const highlight = take(style, 'mso-highlight') ?? take(style, 'background-color') ?? take(style, 'background');
  style.delete('background-color');
  style.delete('background');
  const fill = highlight ? parseColor(highlight.split(/\s+/)[0]) : null;
  const visible = fill !== null && !(fill[0] > 250 && fill[1] > 250 && fill[2] > 250);
  if (visible && !BLOCKS.test(element.tagName) && !element.closest('mark')) {
    wrapChildren(element, 'mark').setAttribute('data-color', hex(fill));
  }
  lineMarks(element, style);
}

const ALIGN: Readonly<Record<string, string>> = {
  left: 'start',
  start: 'start',
  right: 'end',
  end: 'end',
  center: 'center',
  justify: 'justify',
};

/** The margin shorthand and longhands, in points. A longhand wins over the shorthand. */
function margins(style: Declarations): Sides {
  const out: Sides = {};
  const parts = (style.get('margin') ?? '').split(/\s+/).map(points);
  if (parts.length >= 1 && parts.every((part) => part !== null)) {
    const [top, right = top, bottom = top, left = right] = parts as number[];
    Object.assign(out, { top, right, bottom, left });
  }
  const longhands = { top: 'margin-top', right: 'margin-right', bottom: 'margin-bottom', left: 'margin-left' } as const;
  for (const side of Object.keys(longhands) as (keyof Sides)[]) {
    const value = points(style.get(longhands[side]));
    if (value !== null) out[side] = value;
  }
  return out;
}

function lineSpacing(style: Declarations): Record<string, unknown> | null {
  const height = style.get('line-height') ?? '';
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(height);
  if (percent) return { rule: 'multiple', value: Math.round(Number(percent[1])) / 100 };
  const fixed = points(height);
  if (!fixed) return null;
  const rule = /at-least/i.test(style.get('mso-line-height-rule') ?? '') ? 'atLeast' : 'exact';
  return { rule, value: onGrid(fixed, 0.05) };
}

function paragraphFormats(element: HTMLElement, style: Declarations): void {
  const format: Record<string, unknown> = {};
  const align = ALIGN[(style.get('text-align') ?? '').toLowerCase()];
  if (align) format.align = align;
  const sides = margins(style);
  // A list item's place is the list's: its margins are the marker's room, not an indent.
  if (!element.closest('li') && !style.has('mso-list')) {
    const indent = { start: sides.left ?? 0, end: sides.right ?? 0, first: points(style.get('text-indent')) ?? 0 };
    if (indent.start !== 0 || indent.end !== 0 || indent.first !== 0) {
      format.indent = {
        start: onGrid(indent.start, 0.05),
        end: onGrid(indent.end, 0.05),
        first: onGrid(indent.first, 0.05),
      };
    }
  }
  if (sides.top !== undefined && sides.top >= 0) format.before = onGrid(sides.top, 0.05);
  if (sides.bottom !== undefined && sides.bottom >= 0) format.after = onGrid(sides.bottom, 0.05);
  const line = lineSpacing(style);
  if (line) format.line = line;
  if (/always|left|right/i.test(style.get('page-break-before') ?? '')) format.breakBefore = true;
  if (/avoid/i.test(style.get('page-break-after') ?? '')) format.keepNext = true;
  if (/avoid/i.test(style.get('page-break-inside') ?? '')) format.keepLines = true;
  PARA_PROPERTIES.forEach((name) => style.delete(name));
  const checked = paraFormat(format);
  if (Object.keys(checked).length > 0) element.setAttribute(PARA_DATA, JSON.stringify(checked));
}

/**
 * Reads the run and paragraph CSS of a document source into the page's own attributes. Run formatting goes on the
 * element's children, paragraph formatting on the element, and each used declaration leaves the `style`.
 */
export function keepSourceFormatting(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    if (/^(?:TABLE|TD|TH|TR)$/.test(element.tagName)) return;
    const style = readStyle(element);
    if (PARAGRAPHS.test(element.tagName)) paragraphFormats(element, style);
    runFormats(element, style);
    writeStyle(element, style);
  });
}
