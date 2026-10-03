// OpenNote Markdown to a ProseMirror document (SPEC 7; Phase 4 design, 9.1). markdown-it reads the whole CommonMark
// syntax, because text can come from hand edits and imports. Each construct maps to its canonical equivalent.
// Setext headings become headings, indented code becomes fenced code, reference links become links, and other HTML
// becomes literal text. The parser never throws.
import MarkdownIt from 'markdown-it';
import type { MarkdownIt as Md, Token } from 'markdown-it';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { textSchema } from '../schema/schema';
import { CALLOUT_TYPE_PATTERN, LANGUAGE_PATTERN } from '../schema/specs';
import { inlineNodes } from './parseInline';
import { highlightPlugin, mathPlugin } from './rules';

const { nodes } = textSchema;

/** One markdown-it instance: CommonMark, strikethrough, highlights, and math. The paste parser also turns tables on. */
export function createMarkdown(tables = false): Md {
  const md = new MarkdownIt('commonmark', { html: true, linkify: false, typographer: false });
  md.enable('strikethrough');
  if (tables) md.enable('table');
  md.use(highlightPlugin).use(mathPlugin);
  // Links are kept as written: no percent-encoding, no punycode. The writer and the reader then agree.
  md.normalizeLink = (url) => url;
  md.normalizeLinkText = (text) => text;
  return md;
}

const dialect = createMarkdown();

interface Cursor {
  readonly tokens: readonly Token[];
  readonly md: Md;
  i: number;
}

function make(type: string, attrs: Record<string, unknown> | null, content: readonly PMNode[]): PMNode {
  return (
    nodes[type].createAndFill(attrs, Fragment.from(content as PMNode[])) ??
    nodes[type].create(attrs, Fragment.from(content as PMNode[]))
  );
}

function paragraph(inline: Token | undefined): PMNode {
  return make('paragraph', null, inline ? inlineNodes(inline.children ?? []) : []);
}

function literalLines(text: string): PMNode[] {
  const lines = text.replace(/\n+$/, '').split('\n');
  const content = lines.flatMap((line, i) => {
    const parts: PMNode[] = i > 0 ? [nodes.hardBreak.create()] : [];
    return line === '' ? parts : [...parts, textSchema.text(line)];
  });
  return [make('paragraph', null, content)];
}

function code(text: string, language: string | null): PMNode[] {
  const source = text.replace(/\n$/, '');
  return [make('codeBlock', { language }, source === '' ? [] : [textSchema.text(source)])];
}

function fenceLanguage(info: string): string | null {
  const word = info.trim().split(/\s+/)[0] ?? '';
  return LANGUAGE_PATTERN.test(word) ? word : null;
}

const TASK_MARKER = /^\[([ xX])\](?=[ \t]|$)/;

/** A task item starts with `[ ]` or `[x]`. The marker is cut from the first text, and the state is returned. */
function takeTaskMarker(c: Cursor): boolean | null {
  const open = c.tokens[c.i];
  const inline = c.tokens[c.i + 1];
  if (open?.type !== 'paragraph_open' || inline?.type !== 'inline') return null;
  const match = TASK_MARKER.exec(inline.content);
  const first = inline.children?.[0];
  if (!match || first?.type !== 'text' || !first.content.startsWith(match[0])) return null;
  first.content = first.content.slice(match[0].length).replace(/^[ \t]/, '');
  if (first.content === '') inline.children?.shift();
  return match[1] !== ' ';
}

function readList(c: Cursor, open: Token): PMNode[] {
  const ordered = open.type === 'ordered_list_open';
  c.i++;
  const items: PMNode[] = [];
  while (c.tokens[c.i]?.type === 'list_item_open') {
    c.i++;
    const checked = takeTaskMarker(c);
    items.push(make('listItem', { checked }, readBlocks(c)));
  }
  if (c.tokens[c.i]?.nesting === -1) c.i++;
  const start = Number(open.attrGet('start') ?? 1);
  return [make(ordered ? 'orderedList' : 'bulletList', ordered ? { start } : null, items)];
}

const CALLOUT_LINE = /^\[!([A-Za-z][A-Za-z0-9_-]{0,31})\]([+-])?(?:[ \t]+(.*))?$/;

interface CalloutHead {
  readonly type: string;
  readonly fold: string;
  readonly title: string;
  readonly rest: string;
}

/** A block quote whose first paragraph starts with `[!type]` is a callout. Reads the first paragraph if so. */
function takeCalloutHead(c: Cursor): CalloutHead | null {
  const open = c.tokens[c.i];
  const inline = c.tokens[c.i + 1];
  if (open?.type !== 'paragraph_open' || inline?.type !== 'inline') return null;
  const [first, ...more] = inline.content.split('\n');
  const match = CALLOUT_LINE.exec(first);
  if (!match || !CALLOUT_TYPE_PATTERN.test(match[1])) return null;
  c.i += 3;
  const title = (match[3] ?? '').replace(/[ \t]+$/, '');
  return { type: match[1].toLowerCase(), fold: match[2] ?? '', title, rest: more.join('\n') };
}

function inlineOf(c: Cursor, text: string): PMNode[] {
  return inlineNodes(c.md.parseInline(text, {})[0]?.children ?? []);
}

function readQuote(c: Cursor): PMNode[] {
  c.i++;
  const head = takeCalloutHead(c);
  const body = readBlocks(c);
  if (!head) return [make('blockquote', null, body)];
  const title = make('calloutTitle', null, inlineOf(c, head.title));
  const first = head.rest === '' ? [] : [make('paragraph', null, inlineOf(c, head.rest))];
  return [make('callout', { type: head.type, fold: head.fold }, [title, ...first, ...body])];
}

function readBlock(c: Cursor): PMNode[] {
  const token = c.tokens[c.i];
  switch (token.type) {
    case 'paragraph_open':
      c.i += 3;
      return [paragraph(c.tokens[c.i - 2])];
    case 'heading_open':
      c.i += 3;
      return [make('heading', { level: Number(token.tag.slice(1)) }, inlineNodes(c.tokens[c.i - 2].children ?? []))];
    case 'bullet_list_open':
    case 'ordered_list_open':
      return readList(c, token);
    case 'blockquote_open':
      return readQuote(c);
    case 'fence':
      c.i++;
      return code(token.content, fenceLanguage(token.info));
    case 'code_block':
      c.i++;
      return code(token.content, null);
    case 'hr':
      c.i++;
      return [nodes.horizontalRule.create()];
    case 'math_block':
      c.i++;
      return [nodes.mathBlock.create({ source: token.content })];
    case 'html_block':
      c.i++;
      return literalLines(token.content);
    default:
      c.i++;
      return token.nesting === 1 ? readBlocks(c) : [];
  }
}

/** Reads blocks up to the close token of the container the cursor is in, and steps past that token. */
function readBlocks(c: Cursor): PMNode[] {
  const out: PMNode[] = [];
  while (c.i < c.tokens.length) {
    if (c.tokens[c.i].nesting === -1) {
      c.i++;
      break;
    }
    out.push(...readBlock(c));
  }
  return out;
}

/** A document from block tokens. The caller says which markdown-it instance made them. */
export function buildDoc(tokens: readonly Token[], md: Md): PMNode {
  const blocks = readBlocks({ tokens, md, i: 0 });
  return nodes.doc.createAndFill(null, Fragment.from(blocks)) ?? (nodes.doc.createAndFill() as PMNode);
}

/** The blocks of a piece of Markdown, with no empty paragraph added when there are none. Throws on parser errors. */
export function parseBlocks(markdown: string): PMNode[] {
  return readBlocks({ tokens: dialect.parse(markdown, {}), md: dialect, i: 0 });
}

/** The inline nodes of a line of Markdown, for checking what the writer produced. */
export function parseInlineNodes(text: string): PMNode[] {
  return inlineNodes(dialect.parseInline(text, {})[0]?.children ?? []);
}

/** The text block document for a block's `markdown` string. Any string gives a valid document. */
export function parseTextBlock(markdown: string): PMNode {
  try {
    return buildDoc(dialect.parse(markdown, {}), dialect);
  } catch {
    const lines = markdown
      .split(/\n{2,}/)
      .map((chunk) =>
        make('paragraph', null, chunk.trim() === '' ? [] : [textSchema.text(chunk.trim().replace(/\n/g, ' '))]),
      );
    return make('doc', null, lines);
  }
}
