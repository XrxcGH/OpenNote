// Finding text on a page. Matching is on the text of one textblock at a time, so a match never spans two paragraphs;
// the paragraph mark counts as one extra character at the end of each textblock, so ^p and \n find it. This file has
// the matching and the replacing in a document; how a query becomes a pattern is in pattern.ts, formats are in
// format.ts, the page-wide search is in search.ts, and the highlights are in highlights.ts.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { canJoin } from '@tiptap/pm/transform';
import { EditorState } from '@tiptap/pm/state';
import { applyFormats, formatRuns, rangeFits } from './format';
import type { FormatCriterion } from './format';
import { compilePattern, expandReplacement, LEAF, LINE_BREAK, PARAGRAPH_MARK, usesMark } from './pattern';
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

/** A way to find the matches in the text of one textblock. */
export type TextFinder = (text: string) => TextRange[];

/** The matches of the pattern in each text, one list per text. The pattern is compiled once. */
export function findInTexts(texts: readonly string[], query: string, options: FindOptions): TextRange[][] {
  const compiled = compilePattern(query, options);
  const mark = usesMark(query, options);
  return texts.map((text) => (compiled?.pattern ? scan(text, compiled.pattern, mark) : []));
}

/** The paragraph mark is searched only when the query names it, so \s or [^x] never takes it by accident. */
function scan(text: string, pattern: RegExp, withMark: boolean): TextRange[] {
  if (text === '' && !withMark) return [];
  const found: TextRange[] = [];
  for (const match of (withMark ? text + PARAGRAPH_MARK : text).matchAll(pattern)) {
    const start = match.index;
    // A match starts in the text, or is exactly the paragraph mark at its end. Nothing starts past the mark.
    if (start > text.length) continue;
    const end = Math.min(text.length, start + match[0].length);
    const mark = start === text.length && match[0].startsWith(PARAGRAPH_MARK);
    if (end > start || mark) found.push({ start, end, groups: Array.from(match, (part) => part ?? '') });
  }
  return found;
}

/** The matches of `query` in `text`, left to right, never overlapping. A bad pattern has no matches. */
export function findInText(text: string, query: string, options: FindOptions): TextRange[] {
  return findInTexts([text], query, options)[0];
}

/** The text of a textblock as it is searched: a hard break is a line break character, other nodes one placeholder. */
export const leafText = (leaf: PMNode): string => (leaf.type.name === 'hardBreak' ? LINE_BREAK : LEAF);

export function blockText(node: PMNode): string {
  return node.textBetween(0, node.content.size, '', leafText);
}

/** The searched text of every textblock of a document, in order. */
export function blockTexts(doc: PMNode): string[] {
  const texts: string[] = [];
  doc.descendants((node) => {
    if (!node.isTextblock) return true;
    texts.push(blockText(node));
    return false;
  });
  return texts;
}

/** A finder that compiles the pattern once, for every textblock. */
function compiledFinder(query: string, options: FindOptions): TextFinder {
  const compiled = query === '' ? null : compilePattern(query, options);
  const mark = usesMark(query, options);
  return (text) => (compiled?.pattern ? scan(text, compiled.pattern, mark) : []);
}

/** Every match in a document, in order. With formats and no query, the runs that have the formats. */
export function matchesInDoc(
  doc: PMNode,
  query: string,
  options: FindOptions,
  formats: readonly FormatCriterion[] = [],
  until = Infinity,
  find?: TextFinder,
): DocMatch[] {
  const found: DocMatch[] = [];
  if (query === '' && formats.length === 0) return found;
  const finder = find ?? compiledFinder(query, options);
  let textblock = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (performance.now() > until) return false;
    const text = blockText(node);
    const ranges =
      query === ''
        ? formatRuns(node, formats).map((range) => ({ ...range, groups: [text.slice(range.start, range.end)] }))
        : finder(text).filter((range) => formats.length === 0 || rangeFits(node, range.start, range.end, formats));
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
    const takesMark = !!match.groups?.[0]?.endsWith(PARAGRAPH_MARK);
    // The last paragraph of a box has no mark to replace: a match of only that mark changes nothing.
    if (takesMark && match.from === match.to && !canJoin(tr.doc, match.to + 1)) continue;
    // A ^p in the replacement splits the paragraph there.
    let at = match.from;
    let to = match.to;
    text.split(PARAGRAPH_MARK).forEach((piece, index) => {
      if (index > 0) {
        tr.split(at);
        at += 2;
        to = at;
      }
      const content = replacementNodes(tr.doc, at, to, piece);
      if (content.size === 0) {
        if (to > at) tr.delete(at, to);
      } else tr.replaceWith(at, to, content);
      applyFormats(tr, at, at + content.size, spec.formats ?? []);
      at += content.size;
      to = at;
    });
    // A match that took the paragraph mark joins the paragraph with the next one, as Word does.
    if (takesMark && at + 1 < tr.doc.content.size && canJoin(tr.doc, at + 1)) tr.join(at + 1);
  }
  return tr.doc;
}
