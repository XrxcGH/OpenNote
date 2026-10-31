// Two-player games in normal form: best responses, pure equilibria, iterated elimination of dominated strategies,
// every mixed equilibrium of a nondegenerate game by support enumeration, and the value of a zero-sum game by linear
// programming. All in exact fractions, so 3/5 shows as 3/5.
//
// A game is typed one row per line, cells such as 3,1 (row payoff, column payoff). A cell with one number makes the
// game zero-sum: the column player gets its negative.
import { ONE, ZERO, add, cmp, frac, fracText, mul, neg, parseFrac, sign, sub } from '../core/frac';
import type { Frac } from '../core/frac';
import { solveExact } from '../core/linsolve';
import { solveLp } from '../core/simplex';
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines } from '../core/util';

export interface Bimatrix {
  A: Frac[][];
  B: Frac[][];
  zeroSum: boolean;
  rows: string[];
  cols: string[];
}

export const MAX_STRATEGIES = 6;

export function parseGame(text: string, rowNames = '', colNames = ''): Bimatrix {
  const grid = lines(text).map((line) => line.split(/[\s|;]+/).filter(Boolean));
  if (grid.length === 0) fail('gameEmpty');
  const width = grid[0].length;
  if (grid.some((r) => r.length !== width)) fail('gameRagged');
  if (grid.length > MAX_STRATEGIES || width > MAX_STRATEGIES) fail('gameSize', { max: MAX_STRATEGIES });
  const cells = grid.map((r, i) =>
    r.map((cell, j) => {
      const parts = cell.split(',').map((p) => parseFrac(p));
      if (parts.length > 2 || parts.some((p) => p === null)) fail('gameCell', { row: i + 1, col: j + 1 });
      return parts as Frac[];
    }),
  );
  const zeroSum = cells.every((r) => r.every((c) => c.length === 1));
  if (!zeroSum && cells.some((r) => r.some((c) => c.length !== 2))) fail('gameMixedCells');
  const names = (text: string, n: number, base: string) => {
    const given = text.split(/[\s,]+/).filter(Boolean);
    if (given.length && given.length !== n) fail('gameNames', { n });
    return given.length ? given : Array.from({ length: n }, (_, i) => `${base}${i + 1}`);
  };
  return {
    A: cells.map((r) => r.map((c) => c[0])),
    B: cells.map((r) => r.map((c) => (zeroSum ? neg(c[0]) : c[1]))),
    zeroSum,
    rows: names(rowNames, grid.length, 'R'),
    cols: names(colNames, width, 'C'),
  };
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
const maxOf = (xs: readonly Frac[]) => xs.reduce((m, x) => (cmp(x, m) > 0 ? x : m), xs[0]);

/** Rows that are best responses to each column, and columns to each row. */
export function bestResponses(g: Bimatrix): { rowBest: boolean[][]; colBest: boolean[][] } {
  const m = g.A.length;
  const n = g.A[0].length;
  const rowBest = range(m).map(() => range(n).map(() => false));
  const colBest = range(m).map(() => range(n).map(() => false));
  for (let j = 0; j < n; j += 1) {
    const top = maxOf(range(m).map((i) => g.A[i][j]));
    for (let i = 0; i < m; i += 1) rowBest[i][j] = cmp(g.A[i][j], top) === 0;
  }
  for (let i = 0; i < m; i += 1) {
    const top = maxOf(g.B[i]);
    for (let j = 0; j < n; j += 1) colBest[i][j] = cmp(g.B[i][j], top) === 0;
  }
  return { rowBest, colBest };
}

export function pureEquilibria(g: Bimatrix): [number, number][] {
  const { rowBest, colBest } = bestResponses(g);
  return range(g.A.length).flatMap((i) =>
    range(g.A[0].length).flatMap((j): [number, number][] => (rowBest[i][j] && colBest[i][j] ? [[i, j]] : [])),
  );
}

export interface Elimination {
  player: 'row' | 'col';
  removed: number;
  by: number;
}

/** Iterated elimination of strictly (or weakly) dominated pure strategies, row player first in each round. */
export function eliminate(g: Bimatrix, weak: boolean): { rows: number[]; cols: number[]; order: Elimination[] } {
  let rows = range(g.A.length);
  let cols = range(g.A[0].length);
  const order: Elimination[] = [];
  const dominates = (better: Frac[], worse: Frac[]) => {
    const diffs = better.map((b, k) => cmp(b, worse[k]));
    return weak ? diffs.every((d) => d >= 0) && diffs.some((d) => d > 0) : diffs.every((d) => d > 0);
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rows) {
      const by = rows.find(
        (o) =>
          o !== r &&
          dominates(
            cols.map((j) => g.A[o][j]),
            cols.map((j) => g.A[r][j]),
          ),
      );
      if (by !== undefined) {
        order.push({ player: 'row', removed: r, by });
        rows = rows.filter((x) => x !== r);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    for (const c of cols) {
      const by = cols.find(
        (o) =>
          o !== c &&
          dominates(
            rows.map((i) => g.B[i][o]),
            rows.map((i) => g.B[i][c]),
          ),
      );
      if (by !== undefined) {
        order.push({ player: 'col', removed: c, by });
        cols = cols.filter((x) => x !== c);
        changed = true;
        break;
      }
    }
  }
  return { rows, cols, order };
}

export interface MixedEq {
  x: Frac[];
  y: Frac[];
  u: Frac;
  v: Frac;
}

function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < n; i += 1) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
}

/** The mix over `support` that makes the opponent indifferent across `against`, with the opponent's payoff. */
function indifference(
  pay: (own: number, other: number) => Frac,
  support: number[],
  against: number[],
): { p: Frac[]; value: Frac } | null {
  const k = support.length;
  // Unknowns: the k probabilities, then the value.
  const a: Frac[][] = against.map((o) => [...support.map((s) => pay(o, s)), neg(ONE)]);
  a.push([...support.map(() => ONE), ZERO]);
  const b = [...against.map(() => ZERO), ONE];
  const sol = solveExact(a, b);
  if (!sol || sol.slice(0, k).some((p) => sign(p) < 0)) return null;
  return { p: sol.slice(0, k), value: sol[k] };
}

/** Every equilibrium found by enumerating supports of equal size (all of them when the game is nondegenerate). */
export function mixedEquilibria(g: Bimatrix): MixedEq[] {
  const m = g.A.length;
  const n = g.A[0].length;
  const found: MixedEq[] = [];
  const seen = new Set<string>();
  for (let k = 1; k <= Math.min(m, n); k += 1)
    for (const I of subsets(m, k))
      for (const J of subsets(n, k)) {
        // Column mix y on J makes the row player indifferent over I; row mix x on I does the same for columns.
        const yPart = indifference((i, j) => g.A[i][j], J, I);
        const xPart = indifference((j, i) => g.B[i][j], I, J);
        if (!yPart || !xPart) continue;
        const y = range(n).map((j) => (J.includes(j) ? yPart.p[J.indexOf(j)] : ZERO));
        const x = range(m).map((i) => (I.includes(i) ? xPart.p[I.indexOf(i)] : ZERO));
        const rowPay = (i: number) => y.reduce((s, yj, j) => add(s, mul(yj, g.A[i][j])), ZERO);
        const colPay = (j: number) => x.reduce((s, xi, i) => add(s, mul(xi, g.B[i][j])), ZERO);
        if (range(m).some((i) => cmp(rowPay(i), yPart.value) > 0)) continue;
        if (range(n).some((j) => cmp(colPay(j), xPart.value) > 0)) continue;
        const key = [...x, ...y].map(fracText).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ x, y, u: yPart.value, v: xPart.value });
      }
  return found;
}

export interface ZeroSumValue {
  value: Frac;
  x: Frac[];
  y: Frac[];
  steps: Step[];
}

/**
 * The value and optimal strategies of the zero-sum game with row payoffs A. Adding a constant k makes every entry
 * positive; then maximize the sum of y' subject to A' y' <= 1, and the value of A' is 1 over that sum.
 */
export function zeroSumValue(A: readonly (readonly Frac[])[]): ZeroSumValue {
  const least = A.flat().reduce((m, x) => (cmp(x, m) < 0 ? x : m), A[0][0]);
  const shift = sign(least) > 0 ? ZERO : add(neg(least), ONE);
  const shifted = A.map((row) => row.map((x) => add(x, shift)));
  const lp = solveLp({
    sense: 'max',
    c: shifted[0].map(() => ONE),
    rows: shifted.map((row) => ({ a: row, op: '<=' as const, b: ONE })),
  });
  if (lp.status !== 'optimal') fail('lpFailed');
  const total = lp.x.reduce((s, v) => add(s, v), ZERO);
  const shiftedValue = frac(total.d, total.n);
  const y = lp.x.map((v) => mul(v, shiftedValue));
  const x = lp.duals.map((v) => mul(v, shiftedValue));
  const value = sub(shiftedValue, shift);
  const steps = [
    step('shift', { k: fracText(shift) }),
    step('lp', { total: fracText(total), v: fracText(shiftedValue) }),
    step('value', { value: fracText(value) }),
  ];
  return { value, x, y, steps };
}

/** Strategies that strictly dominate every other strategy of the same player. */
export function dominantStrategies(g: Bimatrix): { rows: number[]; cols: number[] } {
  const m = g.A.length;
  const n = g.A[0].length;
  const rowDom = range(m).filter((r) =>
    range(m).every((o) => o === r || range(n).every((j) => cmp(g.A[r][j], g.A[o][j]) > 0)),
  );
  const colDom = range(n).filter((c) =>
    range(n).every((o) => o === c || range(m).every((i) => cmp(g.B[i][c], g.B[i][o]) > 0)),
  );
  return { rows: m > 1 ? rowDom : [], cols: n > 1 ? colDom : [] };
}
