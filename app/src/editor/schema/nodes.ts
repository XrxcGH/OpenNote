// The nodes of a text block (Phase 4 design, 8.1). Every node here can be written in OpenNote Markdown 1, so every
// canonical string round-trips. Parse rules are the paste allowlist: only what a rule reads survives a paste. Every
// attribute has its own parseHTML: without one, Tiptap reads the pasted element's attribute of the same name and lets
// it override what the rule set.
import { Node } from '@tiptap/core';
import type { TagParseRule } from '@tiptap/pm/model';
import { CALLOUT_TYPE_PATTERN, FOLDS, LANGUAGE_PATTERN } from './constants';

const META_OFF = { rendered: false, parseHTML: () => null };

/** Element metadata (SPEC 6.6). It lives in the block's `ids`, `tags`, `styles`, and `checked`, not in the Markdown. */
function elementAttributes() {
  const noTags: readonly string[] = Object.freeze([]);
  return {
    id: { default: null, ...META_OFF },
    tags: { default: noTags, ...META_OFF },
    style: { default: null, ...META_OFF },
    tagChecked: { default: false, ...META_OFF },
  };
}

/** A heading's tag, from a level clamped to 1 to 6 so no value can name another element. */
export function headingTag(level: unknown): string {
  return `h${Math.min(6, Math.max(1, Math.trunc(Number(level)) || 1))}`;
}

export const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' });
export const TextNode = Node.create({ name: 'text', group: 'inline' });

export const Paragraph = Node.create({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  addAttributes: elementAttributes,
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: () => ['p', 0],
});

export const Heading = Node.create({
  name: 'heading',
  group: 'block',
  content: 'inline*',
  defining: true,
  // The level comes from the tag the rule matched, never from a `level` attribute on the pasted element.
  addAttributes: () => ({ level: { default: 1, rendered: false, parseHTML: () => null }, ...elementAttributes() }),
  parseHTML: () => [1, 2, 3, 4, 5, 6].map((level): TagParseRule => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({ node }) => [headingTag(node.attrs.level), 0],
});

export const HardBreak = Node.create({
  name: 'hardBreak',
  group: 'inline',
  inline: true,
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: () => ['br'],
  renderText: () => '\n',
});

export const HorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  addAttributes: elementAttributes,
  parseHTML: () => [{ tag: 'hr' }],
  renderHTML: () => ['hr'],
});

export const Blockquote = Node.create({
  name: 'blockquote',
  group: 'block',
  content: 'block+',
  defining: true,
  parseHTML: () => [{ tag: 'blockquote' }],
  renderHTML: () => ['blockquote', 0],
});

function taskState(element: HTMLElement): boolean | null {
  const flag = element.getAttribute('data-checked');
  if (flag !== null) return flag === 'true';
  const box = element.firstElementChild;
  if (box instanceof HTMLInputElement && box.type === 'checkbox') return box.checked;
  return null;
}

export const ListItem = Node.create({
  name: 'listItem',
  content: 'paragraph block*',
  defining: true,
  addAttributes: () => ({
    checked: {
      default: null,
      rendered: false,
      parseHTML: (element: HTMLElement) => taskState(element),
    },
    ...elementAttributes(),
  }),
  parseHTML: () => [{ tag: 'li' }],
  renderHTML: ({ node }) => {
    const checked = node.attrs.checked as boolean | null;
    return ['li', checked === null ? {} : { 'data-checked': String(checked) }, 0];
  },
});

export const BulletList = Node.create({
  name: 'bulletList',
  group: 'block',
  content: 'listItem+',
  parseHTML: () => [{ tag: 'ul' }],
  renderHTML: () => ['ul', 0],
});

function listStart(element: HTMLElement): number {
  const start = Number.parseInt(element.getAttribute('start') ?? '1', 10);
  return Number.isInteger(start) && start >= 0 && start <= 999_999_999 ? start : 1;
}

export const OrderedList = Node.create({
  name: 'orderedList',
  group: 'block',
  content: 'listItem+',
  addAttributes: () => ({
    start: { default: 1, rendered: false, parseHTML: listStart },
  }),
  parseHTML: () => [{ tag: 'ol' }],
  renderHTML: ({ node }) => {
    const start = node.attrs.start as number;
    return ['ol', start === 1 ? {} : { start }, 0];
  },
});

export const CalloutTitle = Node.create({
  name: 'calloutTitle',
  content: 'inline*',
  parseHTML: () => [{ tag: 'div[data-callout-title]' }],
  renderHTML: () => ['div', { 'data-callout-title': '' }, 0],
});

function calloutType(element: HTMLElement): string {
  const type = element.getAttribute('data-callout') ?? '';
  return CALLOUT_TYPE_PATTERN.test(type) ? type.toLowerCase() : 'note';
}

function calloutFold(element: HTMLElement): string {
  const fold = element.getAttribute('data-fold') ?? '';
  return (FOLDS as readonly string[]).includes(fold) ? fold : '';
}

/** A block quote whose first line is `[!type]` (SPEC 7.2). Its first child is the title line. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'calloutTitle block*',
  defining: true,
  addAttributes: () => ({
    type: { default: 'note', rendered: false, parseHTML: calloutType },
    fold: { default: '', rendered: false, parseHTML: calloutFold },
  }),
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ node }) => {
    const { type, fold } = node.attrs as { type: string; fold: string };
    return ['div', { 'data-callout': type, ...(fold ? { 'data-fold': fold } : {}), role: 'note' }, 0];
  },
});

/** The language of a pasted `<pre>`: a `language-x` class on it or on its `<code>`, or `data-language`. */
function codeLanguage(element: HTMLElement): string | null {
  const holder = element.querySelector('code') ?? element;
  const named = /(?:^|\s)(?:language|lang)-([^\s]+)/.exec(`${element.className} ${holder.className}`)?.[1];
  const language = named ?? element.getAttribute('data-language') ?? '';
  return LANGUAGE_PATTERN.test(language) ? language : null;
}

export const CodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  addAttributes: () => ({
    language: { default: null, rendered: false, parseHTML: codeLanguage },
    ...elementAttributes(),
  }),
  parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' }],
  renderHTML: ({ node }) => {
    const language = node.attrs.language as string | null;
    return ['pre', ['code', language ? { class: `language-${language}` } : {}, 0]];
  },
});

/** Display math. Phase 10 renders it; until then the source is kept as written. */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    source: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-math-block') ?? '' },
    ...elementAttributes(),
  }),
  parseHTML: () => [{ tag: 'div[data-math-block]' }],
  renderHTML: ({ node }) => ['div', { 'data-math-block': node.attrs.source as string }],
});

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    source: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-math') ?? '' },
  }),
  parseHTML: () => [{ tag: 'span[data-math]' }],
  renderHTML: ({ node }) => ['span', { 'data-math': node.attrs.source as string }],
});

/** An inline image. Sources other than `asset:` are kept and shown as a chip, never loaded (SPEC 7.3). */
export const ImageNode = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('src') ?? '' },
    alt: { default: '', rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('alt') ?? '' },
  }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ node }) => {
    const { src, alt } = node.attrs as { src: string; alt: string };
    return ['img', { src, alt }];
  },
});
