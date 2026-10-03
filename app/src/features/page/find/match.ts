// Finding text on a page (FEATURES.md, Find and replace on a page). Matching is on the text of one textblock at a
// time, so a match never spans two paragraphs. This file has the matching and the replacing in a document; the
// page-wide search is in search.ts, and the highlights are in highlights.ts.
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface TextRange {
  start: number;
  end: number;
}

/** A match in a document: which textblock (in document order), where in its text, and its positions. */
export interface DocMatch extends TextRange {
  textblock: number;
  from: number;
  to: number;
}

/** What stands for a node that is not text, such as a hard break or an equation, in the text that is searched. */
export const LEAF = '￼';

const WORD_CHAR = '[\\p{L}\\p{N}_]';

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The matches of `query` in `text`, left to right, never overlapping. */
export function findInText(text: string, query: string, options: FindOptions): TextRange[] {
  if (query === '' || text === '') return [];
  const body = escapePattern(query);
  const source = options.wholeWord ? `(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})` : body;
  const pattern = new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
  const found: TextRange[] = [];
  for (const match of text.matchAll(pattern)) {
    if (match[0].length > 0) found.push({ start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/** The text of a textblock as it is searched. */
export function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, '', LEAF);
}

/** Every match in a document, in order. */
export function matchesInDoc(doc: PMNode, query: string, options: FindOptions): DocMatch[] {
  const found: DocMatch[] = [];
  let textblock = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const range of findInText(blockText(node), query, options)) {
      found.push({ ...range, textblock, from: pos + 1 + range.start, to: pos + 1 + range.end });
    }
    textblock += 1;
    return false;
  });
  return found;
}

/** The document with each match replaced by `replacement`, which keeps the formatting at the start of the match. */
export function replaceInDoc(doc: PMNode, matches: readonly DocMatch[], replacement: string): PMNode {
  const tr = EditorState.create({ doc }).tr;
  // Last match first, so the earlier positions stay where they were.
  for (const match of [...matches].sort((a, b) => b.from - a.from)) tr.insertText(replacement, match.from, match.to);
  return tr.doc;
}
