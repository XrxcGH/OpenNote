// Plain text and Markdown paste (Phase 4 design, 15.6). Text that looks like Markdown is parsed with GFM tables on,
// and a table becomes a table block. Other text becomes one paragraph for each line.
import type { Token } from 'markdown-it';
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { buildDoc, createMarkdown } from './parse';
import { inlineNodes } from './parseInline';
import { serializeCellParagraph } from './serialize';
import { textSchema } from '../schema/schema';
import { newId as makeId } from '../ids';
import { DEFAULT_COLUMN_WIDTH } from '../schema/specs';
import type { TableData } from '../schema/specs';

/** A run of blocks for the text editor, or a table that becomes its own block. */
export type PastedPiece = { kind: 'text'; doc: PMNode } | { kind: 'table'; data: TableData };

const { nodes } = textSchema;
const pasteMarkdown = createMarkdown(true);

const MARKER_LINE = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+]\s|\d{1,9}[.)]\s|>|```|~~~)/m;
const LINK = /\[[^\]\n]+\]\([^)\s]+\)/;
const STRONG_PAIR = /\*\*[^*\n]+\*\*/;
const ONLY_URL = /^\s*(?:https?|ftp):\/\/\S+\s*$/i;
/** A GFM table's head row, then its delimiter row, such as `| --- | :-: |`. */
const TABLE_HEAD = /^[^\n]*\|[^\n]*\n {0,3}\|?(?: *:?-+:? *\|)+(?: *:?-+:? *)?$/m;

/**
 * Text looks like Markdown when at least one line starts with a heading, list, quote, or fence marker, or the text
 * has a Markdown link, a pair of `**`, or a table's head. A single line that holds only a web address is not.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (ONLY_URL.test(text)) return false;
  return MARKER_LINE.test(text) || LINK.test(text) || STRONG_PAIR.test(text) || TABLE_HEAD.test(text);
}

/** A cell's canonical Markdown, as `serializeCell` writes it, so a table block's first edit changes nothing. */
function cellMarkdownFrom(inline: Token | undefined): string {
  return serializeCellParagraph(nodes.paragraph.create(null, inlineNodes(inline?.children ?? [])));
}

/** Table data from the tokens between `table_open` and `table_close`. */
function tableFromTokens(tokens: readonly Token[], newId: () => string): TableData {
  const rows: Record<string, string>[] = [];
  let header = false;
  let current: string[] = [];
  tokens.forEach((token, i) => {
    if (token.type === 'thead_open') header = true;
    if (token.type === 'tr_open') current = [];
    if (token.type === 'th_open' || token.type === 'td_open') current.push(cellMarkdownFrom(tokens[i + 1]));
    if (token.type === 'tr_close') rows.push(Object.fromEntries(current.map((markdown, at) => [String(at), markdown])));
  });
  const count = Math.max(1, ...rows.map((row) => Object.keys(row).length));
  const columns = Array.from({ length: count }, () => ({ id: newId(), width: DEFAULT_COLUMN_WIDTH }));
  return {
    header,
    columns,
    rows: rows.map((row) => ({
      id: newId(),
      cells: Object.fromEntries(columns.map((column, at) => [column.id, { markdown: row[String(at)] ?? '' }])),
    })),
  };
}

function textPiece(tokens: readonly Token[]): PastedPiece[] {
  return tokens.length === 0 ? [] : [{ kind: 'text', doc: buildDoc(tokens, pasteMarkdown) }];
}

/** Pasted Markdown as text pieces, with each GFM table as a table piece. */
export function parsePastedMarkdown(text: string, newId: () => string = makeId): PastedPiece[] {
  const tokens = pasteMarkdown.parse(text, {});
  const pieces: PastedPiece[] = [];
  let start = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'table_open' || tokens[i].level !== 0) continue;
    let end = i;
    while (end < tokens.length && tokens[end].type !== 'table_close') end++;
    pieces.push(...textPiece(tokens.slice(start, i)));
    pieces.push({ kind: 'table', data: tableFromTokens(tokens.slice(i, end + 1), newId) });
    start = end + 1;
    i = end;
  }
  return [...pieces, ...textPiece(tokens.slice(start))];
}

/** Plain text that is not Markdown: each non-empty line is a paragraph. */
export function plainTextPieces(text: string): PastedPiece[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];
  const paragraphs: PMNode[] = lines.map((line) =>
    nodes.paragraph.create(null, textSchema.text(line.replace(/\0/g, '\ufffd').trim().replace(/\t/g, ' '))),
  );
  return [{ kind: 'text', doc: nodes.doc.create(null, Fragment.from(paragraphs)) }];
}
