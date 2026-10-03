// The marks of a text block, in SPEC 7.7's nesting order (Phase 4 design, 8.1). A mark's rank in the schema is its
// position in that order, which the priorities below fix. Parse rules read tags and data attributes only, so a
// pasted `style` never reaches the page; the paste normalizers turn styles into these tags first.
import { Mark } from '@tiptap/core';
import type { TagParseRule } from '@tiptap/pm/model';
import { HIGHLIGHT_COLORS, TEXT_COLOR_PATTERN, TEXT_SIZES, isBlockedHref, schemeOf } from './constants';

/** Mark priorities: higher comes first in the schema, so it is outermost in the canonical order. */
const RANK = {
  link: 1100,
  bold: 1090,
  italic: 1080,
  strike: 1070,
  underline: 1060,
  highlight: 1050,
  textColor: 1040,
  textSize: 1030,
  subscript: 1020,
  superscript: 1010,
  code: 1000,
} as const;

function isOneOf<T extends string>(list: readonly T[], value: string | null): value is T {
  return value !== null && (list as readonly string[]).includes(value);
}

/** `<b style="font-weight:normal">` is how Google Docs wraps a whole paste, not bold text. */
function notNormalWeight(element: HTMLElement): false | null {
  return /^(normal|400)$/.test(element.style.fontWeight) ? false : null;
}

export const Link = Mark.create({
  name: 'link',
  priority: RANK.link,
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
  priority: RANK.bold,
  parseHTML: () => [{ tag: 'strong' }, { tag: 'b', getAttrs: notNormalWeight }],
  renderHTML: () => ['strong', 0],
});

export const Italic = Mark.create({
  name: 'italic',
  priority: RANK.italic,
  parseHTML: () => [{ tag: 'em' }, { tag: 'i' }],
  renderHTML: () => ['em', 0],
});

export const Strike = Mark.create({
  name: 'strike',
  priority: RANK.strike,
  parseHTML: () => [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }],
  renderHTML: () => ['del', 0],
});

export const Underline = Mark.create({
  name: 'underline',
  priority: RANK.underline,
  parseHTML: () => [{ tag: 'u' }],
  renderHTML: () => ['u', 0],
});

/** Honey is the default color and has no name, so `color` is null for it. */
export const Highlight = Mark.create({
  name: 'highlight',
  priority: RANK.highlight,
  addAttributes: () => ({
    color: {
      default: null,
      rendered: false,
      parseHTML: (element: HTMLElement) => {
        const color = element.getAttribute('data-color');
        return isOneOf(HIGHLIGHT_COLORS, color) ? color : null;
      },
    },
  }),
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ mark }) => {
    const color = mark.attrs.color as string | null;
    return ['mark', color ? { 'data-color': color } : {}, 0];
  },
});

function textColorOf(element: HTMLElement): string | null {
  const color = element.getAttribute('data-color') ?? '';
  return TEXT_COLOR_PATTERN.test(color) ? color : null;
}

function textSizeOf(element: HTMLElement): string | null {
  const size = element.getAttribute('data-size');
  return isOneOf(TEXT_SIZES, size) ? size : null;
}

export const TextColor = Mark.create({
  name: 'textColor',
  priority: RANK.textColor,
  addAttributes: () => ({ color: { default: '', rendered: false, parseHTML: textColorOf } }),
  parseHTML: () => [
    {
      tag: 'span[data-color]',
      getAttrs: (element: HTMLElement) => (textColorOf(element) === null ? false : null),
    } satisfies TagParseRule,
  ],
  renderHTML: ({ mark }) => ['span', { 'data-color': mark.attrs.color as string }, 0],
});

export const TextSize = Mark.create({
  name: 'textSize',
  priority: RANK.textSize,
  addAttributes: () => ({ size: { default: 'large', rendered: false, parseHTML: textSizeOf } }),
  parseHTML: () => [
    {
      tag: 'span[data-size]',
      getAttrs: (element: HTMLElement) => (textSizeOf(element) === null ? false : null),
    } satisfies TagParseRule,
  ],
  renderHTML: ({ mark }) => ['span', { 'data-size': mark.attrs.size as string }, 0],
});

export const Subscript = Mark.create({
  name: 'subscript',
  priority: RANK.subscript,
  excludes: 'subscript superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});

export const Superscript = Mark.create({
  name: 'superscript',
  priority: RANK.superscript,
  excludes: 'subscript superscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});

/** Other marks can wrap code, so this mark excludes only itself. */
export const Code = Mark.create({
  name: 'code',
  priority: RANK.code,
  parseHTML: () => [{ tag: 'code' }],
  renderHTML: () => ['code', 0],
});
