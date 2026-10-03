// The neutral tree to semantic HTML, for the HTML export and the print document. The markup is plain and structural
// (headings, lists, tables, emphasis, code), so a browser's PDF output can tag it for screen readers. Appearance
// comes from classes, which the stylesheet in the print and export modules defines. Nothing is drawn with borders
// (ADR 0006, rule 1).

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
  constructor(private readonly o: HtmlOptions) {}

  private open(mark: Mark): string {
    if (typeof mark === 'string') return OPEN[mark];
    if ('link' in mark) {
      const href = (this.o.link ?? safeHref)(mark.link);
      return href === null ? '<span class="link">' : `<a href="${escapeAttr(href)}">`;
    }
    if ('highlight' in mark) return `<mark class="hl hl-${cssName(mark.highlight)}">`;
    if ('size' in mark) return `<span class="size-${cssName(mark.size)}">`;
    const color = this.o.penColor?.(mark.color) ?? (/^#[0-9a-fA-F]{6}$/.test(mark.color) ? mark.color : null);
    const safe = color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? ` style="color:${color}"` : '';
    return `<span class="pen pen-${cssName(mark.color)}"${safe}>`;
  }

  private close(mark: Mark): string {
    if (typeof mark === 'string') return CLOSE[mark];
    if ('link' in mark) return (this.o.link ?? safeHref)(mark.link) === null ? '</span>' : '</a>';
    return 'highlight' in mark ? '</mark>' : '</span>';
  }

  inline(content: readonly Inline[]): string {
    return content.map((run) => this.run(run)).join('');
  }

  private run(run: Inline): string {
    if ('hardBreak' in run) return `<br${voidEnd(this.o.xml)}`;
    if ('image' in run) {
      const src = this.o.image?.(run.image, run.alt) ?? null;
      if (src === null) return '';
      return `<img src="${escapeAttr(src)}" alt="${escapeAttr(run.alt)}"${voidEnd(this.o.xml)}`;
    }
    const open = run.marks.map((m) => this.open(m)).join('');
    const close = [...run.marks]
      .reverse()
      .map((m) => this.close(m))
      .join('');
    return open + escapeHtml(run.text) + close;
  }

  blocks(blocks: Document): string {
    return blocks.map((b) => this.block(b)).join('\n');
  }

  private block(b: Block): string {
    switch (b.type) {
      case 'paragraph':
        return `<p>${this.inline(b.content)}</p>`;
      case 'heading':
        return `<h${b.level}>${this.inline(b.content)}</h${b.level}>`;
      case 'break':
        return `<hr${voidEnd(this.o.xml)}`;
      case 'code': {
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
    const body = item.blocks
      .map((b) => (tight && b.type === 'paragraph' ? this.inline(b.content) : this.block(b)))
      .join('\n');
    if (item.task === null) return `<li>${body}</li>`;
    const done = item.task === 'done';
    const label = escapeAttr(done ? labels.done : labels.open);
    const box = `<span class="box${done ? ' box-done' : ''}" role="img" aria-label="${label}"></span>`;
    return `<li class="task${done ? ' task-done' : ''}">${box} ${body}</li>`;
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

export function renderInlineHtml(content: readonly Inline[], options: HtmlOptions = {}): string {
  return new Renderer(options).inline(content);
}

/** The description to give an element, taken from inline content. */
export function altText(content: readonly Inline[]): string {
  return inlineText(content);
}
