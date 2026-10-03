// Syllable marks for the reading view. The note's text never changes: this finds, in a piece of text, the spans of
// every second syllable of the long words, and the view paints those spans in another color. A reader sees where each
// word divides, and copying text out of the page gives back the words whole.
import { MIN_WORD, syllables } from './syllables';

export interface Span {
  readonly start: number;
  /** One past the last character. */
  readonly end: number;
}

/** A word with a digit, an address, or a path in it is left alone, as `breakText` leaves it. */
const SKIP = /[\d@/\\_#]/;

/** The spans of the second, fourth, and so on syllable of each long English word in `text`, as offsets in `text`. */
export function alternateSpans(text: string, language = 'en', minWord = MIN_WORD): Span[] {
  const out: Span[] = [];
  for (const token of text.matchAll(/\S+/g)) {
    if (SKIP.test(token[0])) continue;
    for (const word of token[0].matchAll(/[A-Za-z]+/g)) {
      if (word[0].length < minWord) continue;
      const parts = syllables(word[0], language);
      if (parts.length < 2) continue;
      let at = token.index + word.index;
      parts.forEach((part, i) => {
        if (i % 2 === 1) out.push({ start: at, end: at + part.length });
        at += part.length;
      });
    }
  }
  return out;
}
