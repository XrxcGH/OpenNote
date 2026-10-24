// Solving an equation written on a page line, such as `2x + 3 = 11`, for its one unknown letter. The page's own
// variables and constants keep their values, and units carry through: after `d = 100 m` and `t = 9.58 s`, the line
// `d = v t` solves for v in meters per second. The unknown's unit is worked out first, from the two sides, and then
// the root finder looks for where the sides meet. Nothing here throws: a line it cannot solve gives null.
import { freeNames, type Node } from './ast';
import type { Dialect } from './dialect';
import { tokenize, type Token } from './lexer';
import { parseTokens } from './parser';
import { addDims, NO_DIMENSION, sameDim, type Dimension, type Quantity } from './quantity';
import { evaluateQuantity, type QuantityEnv } from './quantityEval';
import { findRoots, tidyRoot } from './solve';

export interface LineSolution {
  /** The unknown letter. */
  name: string;
  /** Its values, smallest first. At most four. */
  values: Quantity[];
}

/** The two sides of a line with exactly one equals sign, or null. */
function sides(source: string, dialect: Dialect): { left: Node; right: Node } | null {
  let tokens: Token[];
  try {
    tokens = tokenize(source, dialect.lex);
  } catch {
    return null;
  }
  const equals = tokens.flatMap((token, i) => (token.kind === 'op' && token.text === '=' ? [i] : []));
  if (equals.length !== 1) return null;
  const at = equals[0];
  if (at === 0 || tokens[at + 1]?.kind === 'eof') return null;
  const end: Token = { kind: 'eof', text: '', value: 0, start: tokens[at].start, end: tokens[at].start };
  try {
    return {
      left: parseTokens([...tokens.slice(0, at), end], source, dialect),
      right: parseTokens(tokens.slice(at + 1), source, dialect),
    };
  } catch {
    return null;
  }
}

/** The lowercase letters of the line that are written as names, as tokens, other than e. */
function letters(source: string, dialect: Dialect): { text: string; unit: boolean }[] {
  let tokens: Token[];
  try {
    tokens = tokenize(source, dialect.lex);
  } catch {
    return [];
  }
  return tokens.flatMap((token, i) => {
    if (token.kind !== 'name' || !/^[a-df-z]$/.test(token.text)) return [];
    const before = tokens[i - 1];
    // A letter after a number and a space, as in 5 m, is the unit; 2m and 2 * m may be a letter.
    const unit = before?.kind === 'num' && before.end < token.start && dialect.units?.has(token.text) === true;
    return [{ text: token.text, unit }];
  });
}

/**
 * The one unknown of the line and its sides, read so that the unknown is a letter and not a unit. When every name
 * has a value, a lone letter that is a constant or a unit is taken for the unknown instead, such as the h in
 * `rate * h = 12` (Planck's constant, or hours) or the y in `2y = 10` (years).
 */
function read(
  source: string,
  dialectFor: (letters: readonly string[]) => Dialect,
  env: QuantityEnv,
  owned: (name: string) => boolean,
) {
  const plain = sides(source, dialectFor([]));
  const free = plain ? [...new Set([...freeNames(plain.left), ...freeNames(plain.right)])] : [];
  const unknowns = free.filter((name) => env.name(name) === undefined);
  let name: string | null = null;
  if (unknowns.length === 1) name = unknowns[0];
  else if (unknowns.length === 0) {
    const found = new Set(
      letters(source, dialectFor([]))
        .filter((letter) => !letter.unit && !owned(letter.text))
        .map((letter) => letter.text),
    );
    if (found.size === 1) name = [...found][0];
  }
  if (name === null) return null;
  const again = sides(source, dialectFor([name]));
  return again && { ...again, name };
}

/**
 * Solves the line for its one unknown, or returns null when it has none, several, or no solution in range.
 * `dialectFor` gives the grammar with some letters read as letters rather than units, and `owned` says which names
 * the page itself defined, which are never the unknown.
 */
export function solveLine(
  source: string,
  dialectFor: (letters: readonly string[]) => Dialect,
  env: QuantityEnv,
  owned: (name: string) => boolean = () => false,
): LineSolution | null {
  const found = read(source, dialectFor, env, owned);
  if (!found) return null;
  const { left, right, name } = found;
  const at = (node: Node, x: Quantity) =>
    evaluateQuantity(node, { ...env, name: (other) => (other === name ? x : env.name(other)) });
  const amount = (si: number, dim: Dimension): Quantity => ({ si, dim, display: null });

  // The unknown's dimension: none, or what makes the two sides measure the same thing.
  const probe = (node: Node): Dimension | null => {
    try {
      return at(node, amount(1, NO_DIMENSION)).dim;
    } catch {
      return null;
    }
  };
  const uses = (node: Node) => freeNames(node).includes(name);
  const [l, r] = [probe(left), probe(right)];
  const candidates: Dimension[] = [NO_DIMENSION];
  if (l && r) candidates.push(addDims(r, l, -1), addDims(l, r, -1));
  if (uses(left) !== uses(right)) {
    const other = uses(left) ? r : l;
    if (other) candidates.push(other);
  }
  const fits = (dim: Dimension) => {
    try {
      return sameDim(at(left, amount(1, dim)).dim, at(right, amount(1, dim)).dim);
    } catch {
      return false;
    }
  };
  const dim = candidates.find(fits);
  if (!dim) return null;
  const gap = (v: number) => {
    const x = amount(v, dim);
    return at(left, x).si - at(right, x).si;
  };
  // A line is solved again as it is typed, so the scan is coarser than Solve's; halving makes each root exact.
  const roots = findRoots(gap, { steps: 4000, limit: 4 });
  if (roots.length === 0) return null;
  return { name, values: roots.map((root) => amount(tidyRoot(root), dim)) };
}
