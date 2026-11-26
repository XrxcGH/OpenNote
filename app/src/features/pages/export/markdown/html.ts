// The neutral tree to semantic HTML, for the HTML export and the print document. The markup is plain and structural
// (headings, lists, tables, emphasis, code), so a browser's PDF output can tag it for screen readers. Appearance
// comes from classes, which the stylesheet in the print and export modules defines. Nothing is drawn with borders
// (ADR 0006, rule 1).

import { colorValue, runStyle } from '../../../../editor/render/runStyle';
import type { StyleDeclarations } from '../../../../editor/render/runStyle';
import { paraDom } from '../../../../editor/render/paraStyle';
import { attrsFromEntry } from '../../../../editor/paragraph/attributes';
import { HIGHLIGHTER_COLORS, PEN_COLORS } from '../../../../editor/schema/constants';
import { inlineText, type Block, type Document, type Inline, type ListItem, type Mark } from './tree';

export interface HtmlOptions {
  /** The `href` for a link destination, or null to show the link text without a link. Defaults to web and mail links. */
  readonly link?: (destination: string) => string | null;
  /** The source for an image destination, or null to leave the image out. Defaults to none, so assets must be mapped. */
  readonly image?: (destination: string, alt: string) => string | null;
  /** The CSS color for a pen name, or null for the default. Only `#rrggbb` values are written. */
  readonly penColor?: (name: string) => string | null;
  /** Words used in markup, so the caller can translate them. */
  readonly labels?: { readonly done: string; readonly open: string };
  /** The title of a callout without one. Defaults to the capitalized type. */
  readonly calloutTitle?: (type: string) => string;
  /** Shows folded callouts closed in a `details` element. When false, every callout is open text. */
  readonly foldable?: boolean;
  /**
   * Writes XHTML that an XML parser accepts, for HTML embedded in SVG: void elements close themselves and attributes
   * always have values. It reads the same in an HTML parser.
   */
  readonly xml?: boolean;
  /** Markup for some LaTeX, or null to show its source as text. Without it, math shows as the source text. */
  readonly math?: (latex: string, display: boolean) => string | null;
  /** An SVG drawing for the text of a `graph` code block, or null to show it as code. */
  readonly graph?: (source: string) => string | null;
  /**
   * The text block's element IDs and paragraph formatting (`data.ids` and `data.paras`, spec 6.6 and 6.8). Each
   * paragraph, heading, list item, code block, math block, and rule takes the formatting of its ID, so the page
   * looks as it does on screen.
   */
  readonly elements?: {
    readonly ids: readonly (string | null)[];
    readonly paras: Readonly<Record<string, unknown>>;
    /** The named style of each element by ID (`data.styles`), which becomes the class `style-NAME`. */
    readonly styles?: Readonly<Record<string, string>>;
  };
}

/**
 * Text drawn wider or narrower (the scale mark): each word is a box that is stretched from its start, with a margin
 * of the width it gains. The width of a word is taken as one `ch` for each character, since a static page can't
 * measure it. The screen measures instead (render/blocks.ts), so the two can differ by a few percent.
 */
function scaledWords(text: string): string {
  return text
    .split(/( +)/)
    .map((part) =>
      part === '' || part.startsWith(' ')
        ? escapeHtml(part)
        : `<span class="scaled" style="margin-inline-end:calc((var(--scale) - 1) * ${[...part].length}ch)">${escapeHtml(part)}</span>`,
    )
    .join('');
}

const SIZES = ['small', 'large', 'xlarge'];

/** A ` style="..."` attribute for some declarations, or nothing when there are none. */
function styleAttr(declarations: StyleDeclarations): string {
  const text = Object.entries(declarations)
    .map(([property, value]) => `${property}:${value}`)
    .join(';');
  return text === '' ? '' : ` style="${escapeAttr(text)}"`;
}

/** The end of a version 2 mark. A foreign mark is not drawn, so it has no end either. */
function closeV2(mark: Exclude<Mark, string>): string {
  const kind = Object.keys(mark)[0];
  if (kind === 'foreign') return '';
  if (kind === 'strike' || kind === 'del') return '</del>';
  if (kind === 'underline') return '</u>';
  if (kind === 'ins') return '</ins>';
  return kind === 'highlight' ? '</mark>' : '</span>';
}

const DEFAULT_LABELS = { done: 'Done', open: 'Not done' };

/** The end of a void element's start tag: `/>` in XML, where every element must close, and `>` in HTML. */
export function voidEnd(xml: boolean | undefined): string {
  return xml ? '/>' : '>';
}

// C0 controls other than tab, line feed, and carriage return, and the noncharacters U+FFFE and U+FFFF.
// eslint-disable-next-line no-control-regex
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
/** A high surrogate with no low one after it, or a low surrogate with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** The text without the characters XML 1.0 forbids. An XML parser rejects a document that holds any of them. */
export function xmlSafe(text: string): string {
  return text.replace(XML_FORBIDDEN, '').replace(LONE_SURROGATE, '');
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Web and mail links only. Other schemes are never followed (format spec 7.5). */
export function safeHref(destination: string): string | null {
  return /^(?:https?:\/\/|mailto:)[^\s<>"']*$/i.test(destination) ? destination : null;
}

const DEFAULT_TITLE = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1);

class Renderer {
  /** The place of the next text element among the block's elements, which is its place in `data.ids`. */
  private index = 0;
  /** The next element is a list item's first paragraph, which belongs to the item and takes no entry of its own. */
  private lead = false;

  constructor(private readonly o: HtmlOptions) {}

  /** The attributes of the next element: its paragraph formatting from `paras`, by its ID. */
  private element(type: 'paragraph' | 'heading' | 'listItem' | 'other'): string {
    if (this.lead) {
      this.lead = false;
      return '';
    }
    const at = this.index++;
    const elements = this.o.elements;
    if (!elements || type === 'other') return '';
    const id = elements.ids[at] ?? undefined;
    const entry = id !== undefined && Object.hasOwn(elements.paras, id) ? elements.paras[id] : undefined;
    const style = id !== undefined && elements.styles && Object.hasOwn(elements.styles, id) ? elements.styles[id] : '';
    const attrs = Object.entries(paraDom(attrsFromEntry(entry, type)))
      .map(([name, value]) => ` ${name}="${escapeAttr(value)}"`)
      .join('');
    return style === '' ? attrs : ` class="style-${cssName(style)}"${attrs}`;
  }

  /** The markup of a version 2 mark: the style `runStyle` makes for it, and the attributes that name it. */
  private openV2(mark: Exclude<Mark, string>): string {
    const kind = Object.keys(mark)[0];
    const value = (mark as unknown as Record<string, unknown>)[kind];
    const text = String(typeof value === 'object' ? '' : value);
    switch (kind) {
      case 'foreign':
        return '';
      case 'underline':
        return `<u${styleAttr(runStyle({ mark: 'underline', ...(value as object) }))}>`;
      case 'strike':
        return `<del${styleAttr(runStyle({ mark: 'strike', line: value }))}>`;
      case 'box':
        return `<span data-box=""${styleAttr(runStyle({ mark: 'box', ...(value as object) }))}>`;
      case 'font':
        return `<span data-font="${escapeAttr(text)}"${styleAttr(runStyle({ mark: 'font', font: text }))}>`;
      case 'size':
        return `<span${styleAttr(runStyle({ mark: 'textSize', size: text }))}>`;
      case 'highlight':
        return `<mark class="hl hl-custom"${styleAttr(runStyle({ mark: 'highlight', color: text }))}>`;
      case 'color':
        return `<span${styleAttr({ color: colorValue(text) })}>`;
      case 'lang':
        return `<span lang="${escapeAttr(text)}">`;
      case 'dir':
        return `<span dir="${text === 'rtl' ? 'rtl' : 'ltr'}"${styleAttr(runStyle({ mark: 'dir', dir: text }))}>`;
      case 'float':
        return `<span class="float-${text === 'end' ? 'end' : 'start'}">`;
      case 'ins':
        return `<ins data-ins="${escapeAttr(text)}">`;
      case 'del':
        return `<del data-del="${escapeAttr(text)}">`;
      case 'style':
        return `<span data-style="${escapeAttr(text)}" class="cs-${cssName(text)}">`;
      case 'comment':
      case 'fmt':
        return `<span data-${kind}="${escapeAttr(text)}">`;
      default:
        return `<span${styleAttr(runStyle({ mark: kind, [kind]: text }))}>`;
    }
  }

  private open(mark: Mark): string {
    if (typeof mark === 'string') return OPEN[mark];
    if ('link' in mark) {
      const href = (this.o.link ?? safeHref)(mark.link);
      return href === null ? '<span class="link">' : `<a href="${escapeAttr(href)}">`;
    }
    if ('highlight' in mark && (HIGHLIGHTER_COLORS as readonly string[]).includes(mark.highlight)) {
      return `<mark class="hl hl-${cssName(mark.highlight)}">`;
    }
    if ('size' in mark && SIZES.includes(mark.size)) return `<span class="size-${cssName(mark.size)}">`;
    if ('color' in mark && (PEN_COLORS as readonly string[]).includes(mark.color)) {
      const color = this.o.penColor?.(mark.color) ?? null;
      const safe = color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? ` style="color:${color}"` : '';
      return `<span class="pen pen-${cssName(mark.color)}"${safe}>`;
    }
    return this.openV2(mark);
  }

  private close(mark: Mark): string {
    if (typeof mark === 'string') return CLOSE[mark];
    if ('link' in mark) return (this.o.link ?? safeHref)(mark.link) === null ? '</span>' : '</a>';
    return closeV2(mark);
  }

  inline(content: readonly Inline[]): string {
    return content.map((run) => this.run(run)).join('');
  }

  private run(run: Inline): string {
    if ('hardBreak' in run) return `<br${voidEnd(this.o.xml)}`;
    if ('math' in run) return `<span class="math">${this.o.math?.(run.math, false) ?? escapeHtml(run.math)}</span>`;
    if ('image' in run) {
      const src = this.o.image?.(run.image, run.alt) ?? null;
      if (src === null) return '';
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(run.alt)}"${voidEnd(this.o.xml)}`;
    }
    const marks = run.marks;
    const open = marks.map((m) => this.open(m)).join('');
    const close = [...marks]
      .reverse()
      .map((m) => this.close(m))
      .join('');
    if ('footnote' in run)
      return `${open}<span class="footnote-ref" data-footnote="${escapeAttr(run.footnote)}">[${escapeHtml(run.footnote)}]</span>${close}`;
    const scale = marks.find((m): m is { readonly scale: string } => typeof m !== 'string' && 'scale' in m);
    return open + (scale ? scaledWords(run.text) : escapeHtml(run.text)) + close;
  }

  blocks(blocks: Document): string {
    return blocks.map((b) => this.block(b)).join('\n');
  }

  private block(b: Block): string {
    switch (b.type) {
      case 'paragraph':
        return `<p${this.element('paragraph')}>${this.inline(b.content)}</p>`;
      case 'heading':
        return `<h${b.level}${this.element('heading')}>${this.inline(b.content)}</h${b.level}>`;
      case 'break':
        this.element('other');
        return `<hr${voidEnd(this.o.xml)}`;
      case 'math':
        this.element('other');
        return `<div class="math">${this.o.math?.(b.source, true) ?? escapeHtml(b.source)}</div>`;
      case 'code': {
        this.element('other');
        if (b.language === 'graph') {
          const drawing = this.o.graph?.(b.text);
          if (drawing) return `<figure class="graph">${drawing}</figure>`;
        }
        const cls = b.language === '' ? '' : ` class="language-${cssName(b.language)}"`;
        return `<pre><code${cls}>${escapeHtml(b.text)}</code></pre>`;
      }
      case 'quote':
        return `<blockquote>\n${this.blocks(b.blocks)}\n</blockquote>`;
      case 'list':
        return this.list(b);
      case 'callout':
        return this.callout(b);
    }
  }

  private list(b: Block & { type: 'list' }): string {
    const tag = b.ordered ? 'ol' : 'ul';
    const start = b.ordered && b.start !== undefined && b.start !== 1 ? ` start="${b.start}"` : '';
    const tasks = b.items.some((i) => i.task !== null) ? ' class="tasks"' : '';
    return `<${tag}${start}${tasks}>\n${b.items.map((i) => this.item(i)).join('\n')}\n</${tag}>`;
  }

  private item(item: ListItem): string {
    const labels = this.o.labels ?? DEFAULT_LABELS;
    const tight = item.blocks.every((b, i) => (i === 0 ? b.type === 'paragraph' : b.type === 'list'));
    const attrs = this.element('listItem');
    const body = item.blocks
      .map((b, i) => {
        if (tight && b.type === 'paragraph') return this.inline(b.content);
        this.lead = i === 0 && b.type !== 'list' && b.type !== 'quote' && b.type !== 'callout';
        return this.block(b);
      })
      .join('\n');
    if (item.task === null) return `<li${attrs}>${body}</li>`;
    // One class attribute: the task classes first, then the named style's, which `element` writes first.
    const taskClass = `task${item.task === 'done' ? ' task-done' : ''}`;
    const named = /^ class="([^"]*)"/.exec(attrs);
    const rest = named ? attrs.slice(named[0].length) : attrs;
    const classes = named ? `${taskClass} ${named[1]}` : taskClass;
    const done = item.task === 'done';
    const label = escapeAttr(done ? labels.done : labels.open);
    const box = `<span class="box${done ? ' box-done' : ''}" role="img" aria-label="${label}"></span>`;
    return `<li class="${classes}"${rest}>${box} ${body}</li>`;
  }

  private callout(b: Block & { type: 'callout' }): string {
    const title =
      b.title.length > 0 ? this.inline(b.title) : escapeHtml((this.o.calloutTitle ?? DEFAULT_TITLE)(b.callout));
    const cls = `callout callout-${cssName(b.callout)}`;
    const body = this.blocks(b.blocks);
    if (this.o.foldable && b.fold !== null) {
      const open = b.fold !== 'open' ? '' : this.o.xml ? ' open="open"' : ' open';
      return `<details class="${cls}"${open}><summary>${title}</summary>\n${body}\n</details>`;
    }
    return `<aside class="${cls}" role="note"><p class="callout-title">${title}</p>\n${body}\n</aside>`;
  }
}

const OPEN: Readonly<Record<Extract<Mark, string>, string>> = {
  strong: '<strong>',
  emphasis: '<em>',
  strike: '<del>',
  underline: '<u>',
  highlight: '<mark class="hl hl-honey">',
  sub: '<sub>',
  sup: '<sup>',
  code: '<code>',
};

const CLOSE: Readonly<Record<Extract<Mark, string>, string>> = {
  strong: '</strong>',
  emphasis: '</em>',
  strike: '</del>',
  underline: '</u>',
  highlight: '</mark>',
  sub: '</sub>',
  sup: '</sup>',
  code: '</code>',
};

/** A value as a CSS class suffix: letters, digits, and hyphens only. */
function cssName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

export function renderHtml(blocks: Document, options: HtmlOptions = {}): string {
  return new Renderer(options).blocks(blocks);
}

/**
 * The markup of each top-level block alone, from one pass: the blocks' places among the element IDs run on from one
 * block to the next, so each takes the formatting of its own ID. Print puts each block in its own unit.
 */
export function renderHtmlEach(blocks: Document, options: HtmlOptions = {}): string[] {
  const renderer = new Renderer(options);
  return blocks.map((block) => renderer.blocks([block]));
}

export function renderInlineHtml(content: readonly Inline[], options: HtmlOptions = {}): string {
  return new Renderer(options).inline(content);
}

/** The description to give an element, taken from inline content. */
export function altText(content: readonly Inline[]): string {
  return inlineText(content);
}
