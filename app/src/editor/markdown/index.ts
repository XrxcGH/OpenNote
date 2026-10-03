// OpenNote Markdown in the interface (PLAN.md section 3.4). WP0 fixed this API; WP1 owns what is behind it. Other
// packages import only from here.
import type { Node as PMNode } from '@tiptap/pm/model';
import { tableSchema, textSchema } from '../schema/schema';
import type { MarkdownCache } from './cache';
import { parseInlineNodes, parseTextBlock as parseBlock } from './parse';
import { serializeCellParagraph, serializeTextBlock as serializeBlock } from './serialize';

export type { MarkdownCache } from './cache';
export { createMarkdownCache } from './cache';
export { warmCache } from './serialize';
export type { MarkdownSplice } from './splice';
export { diffMarkdown, utf8Offset } from './splice';
export type { Reparse } from './reparse';
export { reparseRange } from './reparse';
export type { PastedPiece } from './paste';
export { looksLikeMarkdown, parsePastedMarkdown } from './paste';
export type { ParseRequest, ParseResponse } from './worker';
export { parseInWorker } from './worker';
export { escapeParagraphText, PARAGRAPH, TITLE } from './escape';
export { serializeInline } from './inline';
export { createMarkdown, buildDoc } from './parse';
export { joinAdjacentLists, joinListsDeep } from './normalize';
export { applyElementData, countElements, emptyElementData, extractElementData } from './elements';
export type { ElementData } from './elements';

/** A textSchema document for a block's Markdown. Never throws: any string gives a valid document. */
export function parseTextBlock(markdown: string): PMNode {
  return parseBlock(markdown);
}

/** The canonical Markdown of a text block (SPEC 7.7). */
export function serializeTextBlock(doc: PMNode, cache: MarkdownCache): string {
  return serializeBlock(doc, cache);
}

/** A table cell's Markdown as a tableSchema paragraph. Never throws. */
export function parseCell(markdown: string): PMNode {
  try {
    const inline = parseInlineNodes(markdown.replace(/\r?\n/g, ' '));
    const paragraph = textSchema.nodes.paragraph.create(null, inline);
    return tableSchema.nodeFromJSON(paragraph.toJSON());
  } catch {
    const text = markdown.trim();
    return tableSchema.nodes.paragraph.create(null, text === '' ? [] : [tableSchema.text(text)]);
  }
}

/** A cell paragraph's Markdown: one line, escaped like paragraph text. */
export function serializeCell(paragraph: PMNode, cache: MarkdownCache): string {
  return serializeCellParagraph(paragraph, cache);
}
