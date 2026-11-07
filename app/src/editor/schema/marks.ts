// The marks of a text block, in SPEC 7.10's nesting order (R-MRK-24). A mark's rank in the schema is its position in
// that order, which the priorities below fix. Parse rules read tags, data attributes, `lang`, and `dir` only, each
// checked against its grammar, so a pasted `style` never reaches the page; the paste normalizers turn styles into
// these tags first. Marks render their canonical tag, with CSS from render/runStyle.ts, so the static DOM and the
// editor's DOM are the same.
import { Mark } from '@tiptap/core';
import type { TagParseRule } from '@tiptap/pm/model';
import { SPAN_MARKS, isForeignTag } from '../markdown/tags';
import { runStyle } from '../render/runStyle';
import {
  BOX_STYLES,
  MARK_ORDER,
  isColor,
  isHighlightColor,
  isTextSize,
  isUnderlineLine,
  isBlockedHref,
  schemeOf,
} from './constants';
import type { MarkName } from './constants';

/** A mark's priority: higher comes first in the schema, so it is outermost in the canonical order. */
const rank = (name: MarkName) => 1000 + 4 * (MARK_ORDER.length - 1 - MARK_ORDER.indexOf(name));

type DomAttrs = Record<string, string>;

/** The DOM attributes of a mark: its own, and a `style` with the declarations runStyle gives for it. */
function styled(name: MarkName, attrs: Readonly<Record<string, unknown>>, own: DomAttrs): DomAttrs {
  const declarations = Object.entries(runStyle({ mark: name, ...attrs }));
  if (declarations.length === 0) return own;
  return { ...own, style: declarations.map(([property, value]) => `${property}: ${value}`).join('; ') };
}

/** An attribute read from the DOM when it fits its grammar, else null. */
function checked(name: string, valid: (value: string) => boolean) {
  return (element: HTMLElement): string | null => {
    const value = element.getAttribute(name);
    return value !== null && valid(value) ? value : null;
  };
}

/** A parse rule that matches when the attribute fits its grammar. It doesn't consume the element, so one element
 * can carry several marks. */
function spanRule(name: string, valid: (value: string) => boolean): TagParseRule {
  return {
    tag: `span[${name}]`,
    consuming: false,
    getAttrs: (element: HTMLElement) => (checked(name, valid)(element) === null ? false : null),
  };
}

/** `<b style="font-weight:normal">` is how Google Docs wraps a whole paste, not bold text. */
function notNormalWeight(element: HTMLElement): false | null {
  return /^(normal|400)$/.test(element.style.fontWeight) ? false : null;
}

/** The attributes that are set, so a tag carries only what the mark holds. */
function present(entries: Record<string, unknown>): DomAttrs {
  const out: DomAttrs = {};
  for (const [key, value] of Object.entries(entries)) if (typeof value === 'string' && value !== '') out[key] = value;
  return out;
}

export const Link = Mark.create({
  name: 'link',
  priority: rank('link'),
  inclusive: false,
  addAttributes: () => ({
    href: { default: '', rendered: false, parseHTML: (element: HTMLElement) => element.getAttribute('href') ?? '' },
  }),
  parseHTML: () => [
    {
      tag: 'a[href]',
      getAttrs: (element: HTMLElement) => {
        const href = element.getAttribute('href') ?? '';
        return href !== '' && schemeOf(href) !== null && !isBlockedHref(href) ? null : false;
      },
    } satisfies TagParseRule,
  ],
  renderHTML: ({ mark }) => ['a', { href: mark.attrs.href as string }, 0],
});

export const Bold = Mark.create({
  name: 'bold',
  priority: rank('bold'),
  parseHTML: () => [{ tag: 'strong' }, { tag: 'b', getAttrs: notNormalWeight }],
  renderHTML: () => ['strong', 0],
});

export const Italic = Mark.create({
  name: 'italic',
  priority: rank('italic'),
  parseHTML: () => [{ tag: 'em' }, { tag: 'i' }],
  renderHTML: () => ['em', 0],
});

/** Single or double (R-MRK-4). `line` is null for single. */
export const Strike = Mark.create({
  name: 'strike',
  priority: rank('strike'),
  addAttributes: () => ({
    line: {
      default: null,
      rendered: false,
      parseHTML: checked('data-line', (value) => value === 'double'),
    },
  }),
  parseHTML: () => [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
  renderHTML: ({ mark }) => ['del', styled('strike', mark.attrs, present({ 'data-line': mark.attrs.line })), 0],
});

/** An underline style and color (R-MRK-3). A null `line` is single; a null `color` follows the text. */
export const Underline = Mark.create({
  name: 'underline',
  priority: rank('underline'),
  addAttributes: () => ({
    line: { default: null, rendered: false, parseHTML: checked('data-line', isUnderlineLine) },
    color: { default: null, rendered: false, parseHTML: checked('data-line-color', isColor) },
  }),
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: ({ mark }) => [
    'u',
    styled('underline', mark.attrs, present({ 'data-line': mark.attrs.line, 'data-line-color': mark.attrs.color })),
    0,
  ],
});

/** Honey is the default color and has no name, so `color` is null for it (R-MRK-14). */
export const Highlight = Mark.create({
  name: 'highlight',
  priority: rank('highlight'),
  addAttributes: () => ({
    color: { default: null, rendered: false, parseHTML: checked('data-color', isHighlightColor) },
  }),
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ mark }) => ['mark', styled('highlight', mark.attrs, present({ 'data-color': mark.attrs.color })), 0],
});

export const TextColor = Mark.create({
  name: 'textColor',
  priority: rank('textColor'),
  addAttributes: () => ({ color: { default: '', rendered: false, parseHTML: checked('data-color', isColor) } }),
  parseHTML: () => [spanRule('data-color', isColor)],
  renderHTML: ({ mark }) => ['span', styled('textColor', mark.attrs, { 'data-color': String(mark.attrs.color) }), 0],
});

/** A version 1 size name or points (R-MRK-2), as the tag writes it. */
export const TextSize = Mark.create({
  name: 'textSize',
  priority: rank('textSize'),
  addAttributes: () => ({ size: { default: 'large', rendered: false, parseHTML: checked('data-size', isTextSize) } }),
  parseHTML: () => [spanRule('data-size', isTextSize)],
  renderHTML: ({ mark }) => ['span', styled('textSize', mark.attrs, { 'data-size': String(mark.attrs.size) }), 0],
});

const isBoxStyle = (value: string) => (BOX_STYLES as readonly string[]).includes(value);

/** A box around the text (R-MRK-13): its style, and a color or null. */
export const Box = Mark.create({
  name: 'box',
  priority: rank('box'),
  addAttributes: () => ({
    style: { default: 'single', rendered: false, parseHTML: checked('data-box', isBoxStyle) },
    color: { default: null, rendered: false, parseHTML: checked('data-box-color', isColor) },
  }),
  parseHTML: () => [spanRule('data-box', isBoxStyle)],
  renderHTML: ({ mark }) => [
    'span',
    styled('box', mark.attrs, present({ 'data-box': mark.attrs.style, 'data-box-color': mark.attrs.color })),
    0,
  ],
});

interface SpanOptions {
  /** False for marks that typing at their end should not extend. */
  readonly inclusive?: boolean;
  /** '' for marks of which several may cover the same text (R-MRK-26). */
  readonly excludes?: string;
}

/** A mark that is a `<span>` with one attribute (SPEC 7.10). Its one mark attribute holds the value as written. */
function spanMark(attribute: string, options: SpanOptions = {}) {
  const { type, key, valid } = SPAN_MARKS[attribute];
  return Mark.create({
    name: type,
    priority: rank(type),
    ...options,
    addAttributes: () => ({ [key]: { default: '', rendered: false, parseHTML: checked(attribute, valid) } }),
    parseHTML: () => [spanRule(attribute, valid)],
    renderHTML: ({ mark }) => ['span', styled(type, mark.attrs, { [attribute]: String(mark.attrs[key]) }), 0],
  });
}

/** R-MRK-29: images inside float to the start or end edge of the paragraph. */
export const Float = spanMark('data-float', { inclusive: false });
export const Comment = spanMark('data-comment', { inclusive: false, excludes: '' });
export const Insertion = spanMark('data-ins', { inclusive: false });
export const Deletion = spanMark('data-del', { inclusive: false });
export const FormatChange = spanMark('data-fmt', { inclusive: false });
export const Dir = spanMark('dir');
export const Lang = spanMark('lang');
export const CharStyle = spanMark('data-style');
/** R-MRK-27: strong emphasis and weight exclude each other in the editor's commands, not in the schema, so a reader
 * that finds both keeps both. */
export const Weight = spanMark('data-weight');
export const Shade = spanMark('data-shade');
export const Font = spanMark('data-font');
export const Caps = spanMark('data-caps');
export const Tracking = spanMark('data-tracking');
export const Scale = spanMark('data-scale');
export const Shift = spanMark('data-shift');
export const Kern = spanMark('data-kern');
export const Otf = spanMark('data-otf');
export const Effect = spanMark('data-effect');

export const Subscript = Mark.create({
  name: 'subscript',
  priority: rank('subscript'),
  excludes: 'subscript superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});

export const Superscript = Mark.create({
  name: 'superscript',
  priority: rank('superscript'),
  excludes: 'subscript superscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});

/**
 * A tag of a later version (R-INL-9): `tag` holds its exact opening tag, which the writer writes back byte for byte.
 * The text inside shows without formatting, so the DOM holds the tag only as data. Several may cover the same text.
 */
export const Foreign = Mark.create({
  name: 'foreign',
  priority: rank('foreign'),
  excludes: '',
  addAttributes: () => ({ tag: { default: '', rendered: false, parseHTML: checked('data-foreign', isForeignTag) } }),
  parseHTML: () => [spanRule('data-foreign', isForeignTag)],
  renderHTML: ({ mark }) => ['span', { 'data-foreign': String(mark.attrs.tag) }, 0],
});

/** Other marks can wrap code, so this mark excludes only itself. */
export const Code = Mark.create({
  name: 'code',
  priority: rank('code'),
  parseHTML: () => [{ tag: 'code' }],
  renderHTML: () => ['code', 0],
});
