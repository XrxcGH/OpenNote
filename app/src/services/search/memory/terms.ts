// Reading the text of the search box into words, and finding those words in a text. Words match whole, except the
// last one the person is typing, which matches as a prefix. Accents and case do not matter.
import { fold, toByteRange } from '../text';
import type { ByteRange } from '../types';

export interface Term {
  words: string[];
  prefix: boolean;
}

export interface ParsedQuery {
  alternatives: Term[][];
  excluded: Term[];
  titleTerms: Term[];
  tags: string[];
}

export interface Span {
  start: number;
  end: number;
}

interface Word extends Span {
  folded: string;
}

const WORD = /[\p{L}\p{N}]+/gu;
const OPERATOR = /^(?:in|notebook|section|type|before|after|on|created-before|created-after|created-on|is):/i;
const MAX_QUERY_CHARS = 1000;

/** Splits on white space, keeping a quoted part whole. */
function chunks(text: string): string[] {
  return [...text.matchAll(/-?"[^"]*"?|\S+/g)].map((match) => match[0]);
}

export function termOf(raw: string, prefix: boolean): Term | null {
  const words = [...fold(raw).matchAll(WORD)].map((match) => match[0]);
  return words.length ? { words, prefix } : null;
}

/** Takes `tag:` and `title:` out of a chunk. Returns whether the chunk was an operator, which has no words. */
function readOperator(parsed: ParsedQuery, chunk: string, prefix: boolean): boolean {
  const tag = /^tag:(.+)$/i.exec(chunk);
  if (tag) {
    parsed.tags.push(fold(tag[1]).replace(/^#/, '').replace(/^"|"$/g, ''));
    return true;
  }
  const title = /^title:(.+)$/i.exec(chunk);
  if (title) {
    const term = termOf(title[1], prefix);
    if (term) parsed.titleTerms.push(term);
    return true;
  }
  return OPERATOR.test(chunk);
}

function readWord(parsed: ParsedQuery, chunk: string, prefix: boolean): void {
  const negated = chunk.startsWith('-') && chunk.length > 1;
  const quoted = /^-?"/.test(chunk);
  const term = termOf(chunk.replace(/^-/, '').replace(/^"|"$/g, ''), prefix && !quoted);
  if (!term) return;
  if (negated) parsed.excluded.push({ ...term, prefix: false });
  else parsed.alternatives[parsed.alternatives.length - 1].push(term);
}

export function parseQuery(text: string): ParsedQuery {
  const parsed: ParsedQuery = { alternatives: [[]], excluded: [], titleTerms: [], tags: [] };
  const list = chunks(text.slice(0, MAX_QUERY_CHARS));
  const last = text.length > 0 && !/\s$/.test(text) ? list.length - 1 : -1;
  list.forEach((chunk, at) => {
    if (chunk === 'OR') parsed.alternatives.push([]);
    else if (!readOperator(parsed, chunk, at === last)) readWord(parsed, chunk, at === last);
  });
  parsed.alternatives = parsed.alternatives.filter((group) => group.length > 0);
  return parsed;
}

export function wordsOf(text: string): Word[] {
  return [...text.matchAll(WORD)].map((match) => ({
    folded: fold(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** The string ranges of `text` where the term matches, in order. */
export function matchRanges(text: string, term: Term, words: Word[] = wordsOf(text)): Span[] {
  const out: Span[] = [];
  const size = term.words.length;
  for (let at = 0; at + size <= words.length; at += 1) {
    const fits = term.words.every((wanted, offset) => {
      const word = words[at + offset].folded;
      return offset === size - 1 && term.prefix ? word.startsWith(wanted) : word === wanted;
    });
    if (fits) out.push({ start: words[at].start, end: words[at + size - 1].end });
  }
  return out;
}

export function matches(text: string, term: Term): boolean {
  return matchRanges(text, term).length > 0;
}

/** A tag in the form the index compares: folded, trimmed, without its hash. */
export function normalTag(tag: string): string {
  return fold(tag).trim().replace(/^#/, '');
}

export function toBytes(text: string, ranges: readonly Span[]): ByteRange[] {
  return ranges.map(({ start, end }) => toByteRange(text, start, end));
}

const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 160;

/** A piece of `plain` around the first range, with … where it was cut. `shift` maps a range of `plain` into it. */
export function excerpt(plain: string, ranges: readonly Span[]): { text: string; shift: number } {
  const first = ranges[0]?.start ?? 0;
  const start = Math.max(0, first - SNIPPET_BEFORE);
  const end = Math.min(plain.length, start + SNIPPET_LENGTH);
  const lead = start > 0 ? '…' : '';
  const tail = end < plain.length ? '…' : '';
  return { text: `${lead}${plain.slice(start, end)}${tail}`, shift: start - lead.length };
}
