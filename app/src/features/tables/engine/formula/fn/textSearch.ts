import { mapCase } from './textKit';

// SEARCH with wildcards (? and *, with ~ to escape them). Owner: tables:fn-text.
//
// The pattern behaves as if a star followed it, so a match need only start at a position. It is cut at its stars into
// pieces. The first piece must match exactly where the match starts. Every later piece only has to be found, in order,
// anywhere after it. If they are missing after one start, they are missing after any later start. So one pass
// settles the whole search and the time stays near the length of the text times the length of the pattern.

const STAR = 0;
const ONE = 1;
type Token = string | typeof STAR | typeof ONE;

function tokenize(find: string): Token[] {
  // UTF-16 units, as LEN, FIND, and MID count, so "?" is one unit and positions stay in the original text.
  const chars = mapCase(find, false).split('');
  const tokens: Token[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '~' && i + 1 < chars.length && '*?~'.includes(chars[i + 1])) tokens.push(chars[++i]);
    else if (c === '*') tokens.push(STAR);
    else if (c === '?') tokens.push(ONE);
    else tokens.push(c);
  }
  return tokens;
}

function pieceAt(piece: readonly Token[], text: readonly string[], at: number): boolean {
  if (at + piece.length > text.length) return false;
  for (let k = 0; k < piece.length; k++) if (piece[k] !== ONE && piece[k] !== text[at + k]) return false;
  return true;
}

function foundInOrder(pieces: readonly (readonly Token[])[], text: readonly string[], from: number): boolean {
  let q = from;
  for (const piece of pieces) {
    let j = q;
    while (j + piece.length <= text.length && !pieceAt(piece, text, j)) j++;
    if (j + piece.length > text.length) return false;
    q = j + piece.length;
  }
  return true;
}

/** The index (in UTF-16 units) of the first match of a wildcard pattern at or after `from`, or -1. */
export function wildcardSearch(find: string, within: string, from: number): number {
  const text = mapCase(within, false).split('');
  const pieces: Token[][] = [[]];
  for (const t of tokenize(find)) {
    if (t === STAR) pieces.push([]);
    else pieces[pieces.length - 1].push(t);
  }
  const head = pieces[0];
  const rest = pieces.slice(1).filter((p) => p.length > 0);
  const start = Math.max(from, 0);
  for (let i = start; i <= text.length; i++) {
    if (!pieceAt(head, text, i)) continue;
    return foundInOrder(rest, text, i + head.length) ? i : -1;
  }
  return -1;
}
