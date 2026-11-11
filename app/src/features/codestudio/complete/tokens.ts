// Small text helpers for completion without a model: a line tokenizer that keeps every character, so a line can be
// rebuilt from its tokens, and the word before the caret.

export type TokenKind = 'word' | 'number' | 'space' | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
}

// A run of letters (with `_` and `$`), a run of ASCII digits, white space, or any single other character, which
// includes digits outside ASCII such as `²`. A name such as `a1` splits into `a` and `1`, so a numeric step inside a
// name can be extrapolated.
const TOKEN = /[\p{L}_$]+|\d+(?:\.\d+)?|\s+|[^\p{L}\d_$\s]/gu;

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  for (const match of line.matchAll(TOKEN)) {
    const text = match[0];
    const kind: TokenKind = /^\d/.test(text)
      ? 'number'
      : /^\s/.test(text)
        ? 'space'
        : /^[\p{L}_$]/u.test(text)
          ? 'word'
          : 'punct';
    tokens.push({ kind, text });
  }
  return tokens;
}

/** Identifier characters, as the completion list's word match reads them. */
export const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/** The identifier that ends at `pos`. */
export function wordBefore(text: string, pos: number): { from: number; to: number; text: string } {
  let from = pos;
  while (from > 0 && WORD_CHAR.test(text[from - 1] ?? '')) from--;
  return { from, to: pos, text: text.slice(from, pos) };
}

/** The line around `pos`: its start, the text before the caret, and the text after it. */
export function lineAt(text: string, pos: number): { start: number; before: string; after: string } {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const endIndex = text.indexOf('\n', pos);
  const end = endIndex < 0 ? text.length : endIndex;
  return { start, before: text.slice(start, pos), after: text.slice(pos, end) };
}

/** Identifiers in a text with their counts. Names inside strings and comments count too; that is fine for words. */
export function countWords(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  return counts;
}
