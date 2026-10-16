// Word count and reading time. The text of a page or a selection is
// counted by words as the person reads them, so a hyphenated word or an apostrophe stays one word, and the
// Markdown around the words does not count.

/** Words per minute for silent reading of ordinary prose. */
export const WORDS_PER_MINUTE = 230;

const WORD = /[\p{L}\p{N}]+(?:['’\-‐][\p{L}\p{N}]+)*/gu;

type SegmenterLike = { segment(text: string): Iterable<{ isWordLike?: boolean }> };
type SegmenterCtor = new (locale: string, options: { granularity: 'word' }) => SegmenterLike;

let segmenter: SegmenterLike | null | undefined;

function wordSegmenter(): SegmenterLike | null {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
    segmenter = Ctor ? new Ctor('en', { granularity: 'word' }) : null;
  }
  return segmenter;
}

/** Scripts that write words without spaces between them, which only a dictionary can split. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;

/** How many words the text holds. */
export function countWords(text: string): number {
  if (text.trim() === '') return 0;
  const found = UNSPACED.test(text) ? wordSegmenter() : null;
  if (found) {
    let count = 0;
    for (const part of found.segment(text)) if (part.isWordLike) count += 1;
    return count;
  }
  return text.match(WORD)?.length ?? 0;
}

/** Whole minutes to read `words`, at least 1 for any text at all. */
export function readingMinutes(words: number): number {
  return words <= 0 ? 0 : Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The words of Markdown, without its punctuation: link addresses, image sources, list markers, and fences. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*(```|~~~).*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>+\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/[`*_~=]+/g, ' ');
}

/** A table block's cell text, which is inline Markdown. */
export function tableText(data: Record<string, unknown>): string {
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const parts: string[] = [];
  for (const row of rows) {
    const cells = (row as { cells?: Record<string, { markdown?: unknown }> }).cells ?? {};
    for (const cell of Object.values(cells)) if (typeof cell?.markdown === 'string') parts.push(cell.markdown);
  }
  return parts.join('\n');
}

export interface Counts {
  words: number;
  minutes: number;
}

export function countsOf(text: string): Counts {
  const words = countWords(text);
  return { words, minutes: readingMinutes(words) };
}
