// The palette's scorer (ARCHITECTURE.md section 14.6). Each query word must match. A word found at the start of a
// word scores highest, then a word found inside a word, then its letters in order with gaps. The whole title
// typed exactly scores above everything else. Text is normalized as type-ahead does it: accents removed, any case.

/** Decomposed, without combining marks, and lowercase, so "é" matches "e" and "Ω" matches "ω". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function atWordStart(text: string, index: number): boolean {
  return index === 0 || !WORD_CHAR.test(text[index - 1]);
}

/** Scores run from 1 to 99 for letters in order, 101 to 200 inside a word, and 201 to 300 at a word start. */
function wordScore(word: string, text: string): number {
  let inside = -1;
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (atWordStart(text, at)) return 300 - Math.min(at, 99);
    if (inside === -1) inside = at;
  }
  if (inside !== -1) return 200 - Math.min(inside, 99);
  let bonus = 0;
  let from = 0;
  for (const letter of word) {
    const at = text.indexOf(letter, from);
    if (at === -1) return 0;
    if (atWordStart(text, at)) bonus += 3;
    else if (at === from && from > 0) bonus += 1;
    from = at + letter.length;
  }
  return 1 + Math.min(bonus, 98);
}

/** How well the query matches the text: 0 for no match, and 1 for an empty query, which matches everything. */
export function score(query: string, text: string): number {
  const wanted = normalize(query).trim();
  const words = wanted.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const target = normalize(text);
  let total = 0;
  for (const word of words) {
    const points = wordScore(word, target);
    if (points === 0) return 0;
    total += points;
  }
  return total / words.length + (wanted === target.trim() ? 100 : 0);
}

/** The best score against a title and, a little lower, its extra search words. */
export function scoreWithKeywords(query: string, title: string, keywords?: string): number {
  const own = score(query, title);
  const extra = keywords ? score(query, keywords) / 2 : 0;
  return Math.max(own, extra);
}
