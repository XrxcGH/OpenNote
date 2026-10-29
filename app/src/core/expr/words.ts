// Splits a run of letters into the names it is made of, so that "pix" means pi times x and "xsin(x)" means x times
// sin(x). The longest known name wins at each step. Digits after letters stay whole, so "atan2" and "log10" can be
// names, and when they are not names they split into their letters and a number.

import { ExprError } from './errors';
import type { Token } from './lexer';

/** What to do with a letter that starts no known name. */
export type OnUnknown = (letter: string, start: number) => void;

/** The length of the longest name in each set, so a long run of letters tries only as many prefixes as can match. */
const longest = new WeakMap<ReadonlySet<string>, number>();

function longestLength(known: ReadonlySet<string>): number {
  let length = longest.get(known);
  if (length === undefined) {
    length = 0;
    for (const name of known) length = Math.max(length, name.length);
    longest.set(known, length);
  }
  return length;
}

/** The longest known name that starts at `offset` in `text`, or null. */
function longestName(text: string, offset: number, known: ReadonlySet<string>): string | null {
  for (let end = Math.min(text.length, offset + longestLength(known)); end > offset; end -= 1) {
    const candidate = text.slice(offset, end);
    if (known.has(candidate)) return candidate;
  }
  return null;
}

function numberPart(word: Token, offset: number, digits: string): Token {
  const start = word.start + offset;
  return { kind: 'num', text: digits, value: Number(digits), start, end: start + digits.length };
}

const DIGITS = /\d+/y;

function splitOne(word: Token, known: ReadonlySet<string>, unknown: OnUnknown): Token[] {
  const parts: Token[] = [];
  const { text } = word;
  let offset = 0;
  while (offset < text.length) {
    DIGITS.lastIndex = offset;
    const digits = DIGITS.exec(text)?.[0];
    if (digits !== undefined) {
      parts.push(numberPart(word, offset, digits));
      offset += digits.length;
      continue;
    }
    const name = longestName(text, offset, known) ?? String.fromCodePoint(text.codePointAt(offset) as number);
    const start = word.start + offset;
    if (!known.has(name)) unknown(name, start);
    parts.push({ kind: 'name', text: name, value: 0, start, end: start + name.length });
    offset += name.length;
  }
  return parts;
}

/**
 * Replaces every 'word' token with the 'name' and 'num' tokens it is made of. `unknown` is called for a letter that
 * starts no known name. It may throw, or it may collect the letters, and the letter then becomes a name of its own.
 */
export function splitWords(tokens: readonly Token[], known: ReadonlySet<string>, unknown: OnUnknown): Token[] {
  return tokens.flatMap((token) => (token.kind === 'word' ? splitOne(token, known, unknown) : [token]));
}

/** An unknown-name error for the letter, for dialects where an unknown letter is a mistake. */
export function rejectUnknown(letter: string, start: number): never {
  throw new ExprError('unknown-name', start, letter, { length: letter.length });
}
