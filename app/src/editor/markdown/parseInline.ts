// Inline tokens to ProseMirror nodes: text with marks, hard breaks, images, and math. The allowed HTML tags of SPEC 7.4
// become marks when they nest properly within one paragraph, heading, or title. Any other HTML is literal text.
import type { Token } from 'markdown-it';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { HIGHLIGHT_COLORS, TEXT_COLOR_PATTERN, TEXT_SIZES, isBlockedHref } from '../schema/specs';

const { marks, nodes } = textSchema;

interface OpenTag {
  readonly name: string;
  readonly mark: Mark;
}

interface Live {
  readonly role: 'open' | 'close';
  readonly mark?: Mark;
  readonly id: number;
}

const SIMPLE_TAGS: Readonly<Record<string, [string, string]>> = {
  '<u>': ['u', 'underline'],
  '<sub>': ['sub', 'subscript'],
  '<sup>': ['sup', 'superscript'],
  '<em>': ['em', 'italic'],
  '<strong>': ['strong', 'bold'],
  '<del>': ['del', 'strike'],
  '<mark>': ['mark', 'highlight'],
};
const MARK_COLOR = /^<mark data-color="([a-z]+)">$/;
const SPAN_COLOR = /^<span data-color="([^"]*)">$/;
const SPAN_SIZE = /^<span data-size="([a-z]+)">$/;
const CLOSING = /^<\/(u|sub|sup|em|strong|del|mark|span)>$/;

function openTag(html: string): OpenTag | null {
  const simple = SIMPLE_TAGS[html];
  if (simple) return { name: simple[0], mark: marks[simple[1]].create() };
  const color = MARK_COLOR.exec(html)?.[1];
  if (color && (HIGHLIGHT_COLORS as readonly string[]).includes(color)) {
    return { name: 'mark', mark: marks.highlight.create({ color }) };
  }
  const text = SPAN_COLOR.exec(html)?.[1];
  if (text !== undefined && TEXT_COLOR_PATTERN.test(text)) {
    return { name: 'span', mark: marks.textColor.create({ color: text }) };
  }
  const size = SPAN_SIZE.exec(html)?.[1];
  if (size && (TEXT_SIZES as readonly string[]).includes(size)) {
    return { name: 'span', mark: marks.textSize.create({ size }) };
  }
  return null;
}

/** Pairs the allowed tags. A tag that does not pair stays out of the result, so it becomes literal text. */
function pairTags(tokens: readonly Token[]): Map<number, Live> {
  const live = new Map<number, Live>();
  const stack: { index: number; tag: OpenTag }[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'html_inline') return;
    const tag = openTag(token.content);
    if (tag) {
      stack.push({ index, tag });
      return;
    }
    const name = CLOSING.exec(token.content)?.[1];
    if (name === undefined || stack.at(-1)?.tag.name !== name) return;
    const open = stack.pop() as { index: number; tag: OpenTag };
    live.set(open.index, { role: 'open', mark: open.tag.mark, id: open.index });
    live.set(index, { role: 'close', id: open.index });
  });
  return live;
}

/** The plain text of inline tokens, for an image's description. */
export function plainText(tokens: readonly Token[]): string {
  return tokens
    .map((token) => {
      if (token.type === 'text' || token.type === 'code_inline') return token.content;
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
      if (token.type === 'image') return plainText(token.children ?? []);
      return '';
    })
    .join('');
}

const MARK_OPEN: Readonly<Record<string, string>> = {
  strong_open: 'strong',
  em_open: 'em',
  s_open: 's',
  mark_open: 'mark',
  link_open: 'a',
};

/** Builds inline nodes from tokens, keeping a stack of open marks. */
class InlineBuilder {
  readonly out: PMNode[] = [];
  private readonly open: { key: string; mark: Mark | null }[] = [];

  private active(): readonly Mark[] {
    return this.open.reduce<readonly Mark[]>((set, { mark }) => (mark ? mark.addToSet(set) : set), []);
  }

  push(key: string, mark: Mark | null): void {
    this.open.push({ key, mark });
  }

  close(key: string): void {
    const at = this.open.map((entry) => entry.key).lastIndexOf(key);
    if (at >= 0) this.open.splice(at, 1);
  }

  text(content: string, extra?: Mark): void {
    if (content === '') return;
    const set = extra ? extra.addToSet(this.active()) : this.active();
    this.out.push(textSchema.text(content, set));
  }

  node(type: string, attrs: Record<string, unknown> | null): void {
    this.out.push(nodes[type].create(attrs, null, this.active()));
  }
}

function linkMark(token: Token): Mark | null {
  const href = String(token.attrGet('href') ?? '');
  return href === '' || isBlockedHref(href) ? null : marks.link.create({ href });
}

function markFor(token: Token): Mark | null {
  switch (token.type) {
    case 'strong_open':
      return marks.bold.create();
    case 'em_open':
      return marks.italic.create();
    case 's_open':
      return marks.strike.create();
    case 'mark_open':
      return marks.highlight.create();
    default:
      return linkMark(token);
  }
}

function addToken(builder: InlineBuilder, token: Token, index: number, live: Map<number, Live>): void {
  const tag = token.type === 'html_inline' ? live.get(index) : undefined;
  if (MARK_OPEN[token.type]) return builder.push(MARK_OPEN[token.type], markFor(token));
  if (token.type.endsWith('_close') && token.type !== 'html_inline') {
    return builder.close(token.type === 'link_close' ? 'a' : token.tag);
  }
  switch (token.type) {
    case 'text':
      return builder.text(token.content);
    case 'code_inline':
      return builder.text(token.content, marks.code.create());
    case 'softbreak':
      return builder.text(' ');
    case 'hardbreak':
      return builder.node('hardBreak', null);
    case 'image':
      return builder.node('image', { src: String(token.attrGet('src') ?? ''), alt: plainText(token.children ?? []) });
    case 'math_inline':
      return builder.node('mathInline', { source: token.content });
    case 'html_inline':
      if (!tag) return builder.text(token.content.replace(/\n/g, ' '));
      return tag.role === 'open' ? builder.push(`html${tag.id}`, tag.mark ?? null) : builder.close(`html${tag.id}`);
  }
}

/** The inline nodes of an `inline` token's children. */
export function inlineNodes(tokens: readonly Token[]): PMNode[] {
  const live = pairTags(tokens);
  const builder = new InlineBuilder();
  tokens.forEach((token, index) => addToken(builder, token, index, live));
  return builder.out;
}
