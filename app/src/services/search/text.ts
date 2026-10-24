// Text helpers shared by the search panel, the link layer, and the in-memory index: folding, UTF-8 byte offsets
// (the Rust index counts bytes, the page counts UTF-16 units), and reading `[[page links]]` out of Markdown.

import type { ByteRange } from './types';

/** Lowercase, without accents, so "Café" and "cafe" are one word. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const encoder = new TextEncoder();

/** The number of UTF-8 bytes in `text`. */
export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Turns byte ranges of `text` into ranges of string offsets, dropping a range that does not fall on characters.
 * The ranges come in order, as the index gives them.
 */
export function toStringRanges(text: string, ranges: readonly ByteRange[]): { start: number; end: number }[] {
  if (ranges.length === 0) return [];
  // The string offset at each byte, found once for the whole text.
  const at = new Map<number, number>();
  let bytes = 0;
  let units = 0;
  at.set(0, 0);
  for (const char of text) {
    bytes += char.codePointAt(0)! <= 0x7f ? 1 : encoder.encode(char).length;
    units += char.length;
    at.set(bytes, units);
  }
  const out: { start: number; end: number }[] = [];
  for (const { start, end } of ranges) {
    const from = at.get(start);
    const to = at.get(end);
    if (from !== undefined && to !== undefined && to > from) out.push({ start: from, end: to });
  }
  return out;
}

/** The byte range that covers the string offsets `start` to `end` of `text`. */
export function toByteRange(text: string, start: number, end: number): ByteRange {
  return { start: byteLength(text.slice(0, start)), end: byteLength(text.slice(0, end)) };
}

/** A piece of text and whether it is a match to draw in bold. */
export interface Piece {
  text: string;
  match: boolean;
}

/** Cuts `text` at the highlight ranges. */
export function pieces(text: string, ranges: readonly ByteRange[]): Piece[] {
  const marked = toStringRanges(text, ranges);
  const out: Piece[] = [];
  let at = 0;
  for (const { start, end } of marked) {
    if (start < at) continue;
    if (start > at) out.push({ text: text.slice(at, start), match: false });
    out.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out.length ? out : [{ text, match: false }];
}

/** A link to a page in Markdown: `[[Title]]` or `[[Title#Heading]]`. */
export interface TitleLink {
  /** The link as written, brackets included. */
  raw: string;
  title: string;
  heading: string | null;
  /** Where it starts, in string offsets. */
  start: number;
  end: number;
}

// `[[Title]]` as typed, or `\[\[Title\]\]` as the page's Markdown writes it: the serializer escapes every bracket.
const LINK = /(?:\[\[|\\\[\\\[)((?:[^\][\n\\]|\\[^\n]){1,200}?)(?:\]\]|\\\]\\\])/g;

/** Text with the backslash escapes of CommonMark taken out. */
export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * A piece of Markdown shown as words, such as the words around a match: `\#urgent` reads `#urgent`, a backslash
 * that ends a line (a hard break) goes, and so does a callout's `[!note]`.
 */
export function readableMarkdown(text: string): string {
  return unescapeMarkdown(text.replace(/\\$/gm, '').replace(/^(\s*(?:>\s*)*)\[![\w-]*\][+-]?[ \t]*/gm, '$1'));
}

function inCode(markdown: string, at: number): boolean {
  const line = markdown.lastIndexOf('\n', at) + 1;
  const ticks = markdown.slice(line, at).split('`').length - 1;
  return ticks % 2 === 1;
}

/** Every `[[page link]]` in the Markdown, in order, written plain or with escaped brackets. Not inside code. */
export function parseLinks(markdown: string): TitleLink[] {
  const out: TitleLink[] = [];
  for (const match of markdown.matchAll(LINK)) {
    if (inCode(markdown, match.index)) continue;
    const body = match[1];
    // The first bare `#` starts the heading; a `\#` belongs to the title.
    const hash = body.search(/(?<!\\)#/);
    const title = unescapeMarkdown(hash === -1 ? body : body.slice(0, hash)).trim();
    const heading = hash === -1 ? null : unescapeMarkdown(body.slice(hash + 1)).trim() || null;
    if (title === '') continue;
    out.push({ raw: match[0], title, heading, start: match.index, end: match.index + match[0].length });
  }
  return out;
}

/**
 * The link text for a title, with `#` and brackets in the title kept from ending the link early. `like` is a link
 * as it stands in the Markdown, so a rewrite keeps its spelling: plain `[[Title]]`, or escaped `\[\[Title\]\]`.
 */
export function linkFor(title: string, heading?: string | null, like?: string): string {
  const safe = title.replace(/[[\]]/g, '').replace(/#/g, '');
  const body = heading ? `${safe}#${heading}` : safe;
  return like?.startsWith('\\[') ? `\\[\\[${body}\\]\\]` : `[[${body}]]`;
}

/** The plain words of a line of Markdown: links show their titles, and marks and heading signs go. */
export function plainText(markdown: string): string {
  return unescapeMarkdown(markdown)
    .replace(/\[\[([^\][\n]+?)\]\]/g, (_all, body: string) => body.replace(/#.*$/, '').trim() || body)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/[*_~`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
