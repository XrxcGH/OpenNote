// Inline tokens to ProseMirror nodes: text with marks, hard breaks, images, math, and footnote references. Tags of
// SPEC 7.4 and 7.9 become marks when they pair within one paragraph, heading, or title (R-INL-5). Pairs nest at most
// 32 deep (R-INL-6). A pair is a known mark, or a foreign mark that keeps its exact tag (R-INL-9). Any other HTML is
// literal text.
import type { Token } from 'markdown-it';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { isBlockedHref } from '../schema/specs';
import { canonicalMarks } from './markOrder';
import { closingName, readOpenTag } from './tags';
import type { TagMark } from './tags';

const { marks, nodes } = textSchema;

/** R-INL-6: a pair inside this many other pairs is literal text. */
const MAX_DEPTH = 32;

interface Live {
  readonly role: 'open' | 'close';
  readonly mark?: Mark;
  readonly id: number;
}

function markOf(tag: TagMark): Mark {
  return marks[tag.type].create(tag.attrs);
}

/** Pairs the tags like brackets. A tag that does not pair stays out of the result, so it becomes literal text. */
function pairTags(tokens: readonly Token[]): Map<number, Live> {
  const live = new Map<number, Live>();
  const stack: { index: number; name: string; mark: TagMark }[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'html_inline') return;
    const open = readOpenTag(token.content);
    if (open) {
      stack.push({ index, name: open.name, mark: open.mark });
      return;
    }
    const name = closingName(token.content);
    const top = stack.at(-1);
    if (name === null || top?.name !== name) return;
    stack.pop();
    live.set(top.index, { role: 'open', mark: markOf(top.mark), id: top.index });
    live.set(index, { role: 'close', id: top.index });
  });
  limitDepth(live);
  return live;
}

/** Pairs nest, so counting the pairs open at each opening tag finds every depth in one pass. */
function limitDepth(live: Map<number, Live>): void {
  let depth = 0;
  const literal = new Set<number>();
  for (const index of [...live.keys()].sort((a, b) => a - b)) {
    const tag = live.get(index) as Live;
    if (tag.role === 'close') {
      depth--;
      continue;
    }
    depth++;
    if (depth > MAX_DEPTH) literal.add(tag.id);
  }
  for (const [index, tag] of live) if (literal.has(tag.id)) live.delete(index);
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

  /** Inner marks of one kind replace outer ones (R-MRK-28), except comments and foreign marks, which stack. */
  private active(): readonly Mark[] {
    return canonicalMarks(this.open.reduce<readonly Mark[]>((set, { mark }) => (mark ? mark.addToSet(set) : set), []));
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
    const set = extra ? canonicalMarks(extra.addToSet(this.active())) : this.active();
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
    case 'footnote_ref':
      return builder.node('footnoteRef', { id: token.content });
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
  // R-WS-2: a hard break with nothing before or after it in its paragraph breaks nothing, so it is dropped.
  const isBreak = (node: PMNode | undefined) => node?.type.name === 'hardBreak';
  let from = 0;
  let to = builder.out.length;
  while (from < to && isBreak(builder.out[from])) from++;
  while (to > from && isBreak(builder.out[to - 1])) to--;
  return builder.out.slice(from, to);
}
