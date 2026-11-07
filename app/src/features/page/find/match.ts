// Finding text on a page. Matching is on the text of one textblock at a time, so a match never spans two paragraphs;
// the paragraph mark counts as one extra character at the end of each textblock, so ^p and \n find it. This file has
// the matching and the replacing in a document; how a query becomes a pattern is in pattern.ts, formats are in
// format.ts, the page-wide search is in search.ts, and the highlights are in highlights.ts.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { applyFormats, formatRuns, rangeFits } from './format';
import type { FormatCriterion } from './format';
import { compilePattern, expandReplacement, LEAF, LINE_BREAK, PARAGRAPH_MARK } from './pattern';
import type { PatternOptions } from './pattern';

export { LEAF } from './pattern';

export type FindOptions = PatternOptions;

export interface TextRange {
  start: number;
  end: number;
  /** The text found, and what the parenthesized parts of the pattern found (index 0 is the whole match). */
  groups?: string[];
}

/** A match in a document: which textblock (in document order), where in its text, and its positions. */
export interface DocMatch extends TextRange {
  textblock: number;
  from: number;
  to: number;
}

/** What a replacement does: the text (null keeps the matched text) and the formats to set on it. */
export interface ReplaceSpec {
  text: string | null;
  formats?: readonly FormatCriterion[];
  options?: PatternOptions;
}

const PLAIN: PatternOptions = { caseSensitive: false, wholeWord: false };

/** The matches of `query` in `text`, left to right, never overlapping. A bad pattern has no matches. */
export function findInText(text: string, query: string, options: FindOptions): TextRange[] {
  const compiled = compilePattern(query, options);
  if (!compiled?.pattern || text === '') return [];
  const found: TextRange[] = [];
  for (const match of (text + PARAGRAPH_MARK).matchAll(compiled.pattern)) {
    const start = match.index;
    const end = Math.min(text.length, start + match[0].length);
    const tookMark = start + match[0].length > text.length;
    if (end > start || (tookMark && start >= text.length)) {
      found.push({ start, end, groups: Array.from(match, (part) => part ?? '') });
    }
  }
  return found;
}

/** The text of a textblock as it is searched: a hard break is a line break character, other nodes one placeholder. */
export const leafText = (leaf: PMNode): string => (leaf.type.name === 'hardBreak' ? LINE_BREAK : LEAF);

export function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, '', leafText);
}

/** Every match in a document, in order. With formats and no query, the runs that have the formats. */
export function matchesInDoc(
  doc: PMNode,
  query: string,
  options: FindOptions,
  formats: readonly FormatCriterion[] = [],
  until = Infinity,
): DocMatch[] {
  const found: DocMatch[] = [];
  if (query === '' && formats.length === 0) return found;
  let textblock = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (performance.now() > until) return false;
    const text = blockText(node);
    const ranges =
      query === ''
        ? formatRuns(node, formats).map((range) => ({ ...range, groups: [text.slice(range.start, range.end)] }))
        : findInText(text, query, options).filter(
            (range) => formats.length === 0 || rangeFits(node, range.start, range.end, formats),
          );
    for (const range of ranges)
      found.push({ ...range, textblock, from: pos + 1 + range.start, to: pos + 1 + range.end });
    textblock += 1;
    return false;
  });
  return found;
}

/** The nodes of a replacement text: text with the marks at the match start, and a hard break for each line break. */
function replacementNodes(doc: PMNode, at: number, end: number, text: string): Fragment {
  const schema = doc.type.schema;
  const marks = end > at ? (doc.resolve(at).marksAcross(doc.resolve(end)) ?? []) : doc.resolve(at).marks();
  const nodes: PMNode[] = [];
  text.split(LINE_BREAK).forEach((piece, index) => {
    if (index > 0 && schema.nodes.hardBreak) nodes.push(schema.nodes.hardBreak.create());
    if (piece !== '') nodes.push(schema.text(piece, marks));
  });
  return Fragment.from(nodes);
}

/** The document with each match replaced, which keeps the formatting at the start of the match, then the formats set. */
export function replaceInDoc(doc: PMNode, matches: readonly DocMatch[], replacement: string | ReplaceSpec): PMNode {
  const spec: ReplaceSpec = typeof replacement === 'string' ? { text: replacement } : replacement;
  const options = spec.options ?? PLAIN;
  const plain = typeof replacement === 'string' && !options.regex && !options.wildcards;
  const tr = EditorState.create({ doc }).tr;
  // Last match first, so the earlier positions stay where they were.
  for (const match of [...matches].sort((a, b) => b.from - a.from)) {
    if (spec.text === null) {
      applyFormats(tr, match.from, match.to, spec.formats ?? []);
      continue;
    }
    const text = plain ? spec.text : expandReplacement(spec.text, match.groups ?? [''], options);
    const content = replacementNodes(tr.doc, match.from, match.to, text);
    if (content.size === 0) tr.delete(match.from, match.to);
    else tr.replaceWith(match.from, match.to, content);
    applyFormats(tr, match.from, match.from + content.size, spec.formats ?? []);
  }
  return tr.doc;
}
