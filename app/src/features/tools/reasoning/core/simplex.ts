// Linear programs by the simplex tableau in exact fractions: slack, surplus, and artificial columns, a first phase
// that finds a feasible start when one is needed, and a second phase that optimizes. The entering column has the
// most negative reduced cost; the leaving row has the least ratio, ties going to the larger pivot. After a run of
// degenerate pivots it switches to Bland's rule, so it cannot cycle. Every tableau is kept for the steps.
import { ONE, ZERO, add, cmp, div, frac, isZero, mul, neg, sign, sub } from './frac';
import type { Frac } from './frac';

export type Op = '<=' | '>=' | '=';

export interface LpRow {
  a: readonly Frac[];
  op: Op;
  b: Frac;
}

export interface Lp {
  sense: 'max' | 'min';
  c: readonly Frac[];
  rows: readonly LpRow[];
}

export interface Tableau {
  phase: 1 | 2;
  names: readonly string[];
  basis: readonly number[];
  rows: readonly (readonly Frac[])[];
  /** The objective row: reduced costs z_j - c_j of the maximized objective, then its value. */
  obj: readonly Frac[];
  entering?: number;
  leaving?: number;
}

export type LpStatus = 'optimal' | 'infeasible' | 'unbounded' | 'limit';

export interface LpResult {
  status: LpStatus;
  x: Frac[];
  z: Frac;
  /** Shadow prices: the change in the optimal objective per unit increase of each constraint's right side. */
  duals: Frac[];
  /** Reduced costs c_j - z_j of the decision variables, in the problem's own sense. */
  reduced: Frac[];
  log: Tableau[];
  /** True when a basic variable is zero at the optimum, so other shadow prices may also be valid. */
  degenerate: boolean;
  /** For each constraint: the tableau column that holds B^-1 e_i up to `sign`, and whether the row was negated. */
  units: { col: number; sign: 1 | -1; flipped: boolean }[];
}

interface Work {
  names: string[];
  rows: Frac[][];
  obj: Frac[];
  basis: number[];
  /** Columns that may not enter: the artificials in the second phase. */
  barred: Set<number>;
}

const snapshot = (w: Work, phase: 1 | 2, entering?: number, leaving?: number): Tableau => ({
  phase,
  names: [...w.names],
  basis: [...w.basis],
  rows: w.rows.map((r) => [...r]),
  obj: [...w.obj],
  ...(entering !== undefined ? { entering } : {}),
  ...(leaving !== undefined ? { leaving } : {}),
});

function pivot(w: Work, r: number, col: number): void {
  const p = w.rows[r][col];
  w.rows[r] = w.rows[r].map((v) => div(v, p));
  for (let i = 0; i < w.rows.length; i += 1)
    if (i !== r && !isZero(w.rows[i][col])) {
      const f = w.rows[i][col];
      w.rows[i] = w.rows[i].map((v, j) => sub(v, mul(f, w.rows[r][j])));
    }
  if (!isZero(w.obj[col])) {
    const f = w.obj[col];
    w.obj = w.obj.map((v, j) => sub(v, mul(f, w.rows[r][j])));
  }
  w.basis[r] = col;
}

function choose(w: Work, bland: boolean): { col: number; row: number } | 'optimal' | 'unbounded' {
  const width = w.obj.length - 1;
  let col = -1;
  for (let j = 0; j < width; j += 1) {
    if (w.barred.has(j) || sign(w.obj[j]) >= 0) continue;
    if (col < 0 || (!bland && cmp(w.obj[j], w.obj[col]) < 0)) col = j;
    if (bland) break;
  }
  if (col < 0) return 'optimal';
  let row = -1;
  let best: Frac | null = null;
  for (let i = 0; i < w.rows.length; i += 1) {
    const a = w.rows[i][col];
    if (sign(a) <= 0) continue;
    const ratio = div(w.rows[i][width], a);
    const order = best === null ? -1 : cmp(ratio, best);
    const better = order === 0 && (bland ? w.basis[i] < w.basis[row] : cmp(a, w.rows[row][col]) > 0);
    if (order < 0 || better) {
      row = i;
      best = ratio;
    }
  }
  return row < 0 ? 'unbounded' : { col, row };
}

function optimize(w: Work, phase: 1 | 2, log: Tableau[]): LpStatus {
  let degenerateRun = 0;
  for (let iter = 0; iter < 200; iter += 1) {
    const next = choose(w, degenerateRun > 25);
    if (next === 'optimal' || next === 'unbounded') {
      log.push(snapshot(w, phase));
      return next;
    }
    log.push(snapshot(w, phase, next.col, next.row));
    const width = w.obj.length - 1;
    degenerateRun = isZero(w.rows[next.row][width]) ? degenerateRun + 1 : 0;
    pivot(w, next.row, next.col);
  }
  return 'limit';
}

/** Builds the starting tableau: rows with a negative right side are multiplied by -1 first. */
function setUp(lp: Lp) {
  const n = lp.c.length;
  const rows = lp.rows.map((r) =>
    sign(r.b) < 0 ? { a: r.a.map(neg), op: flip(r.op), b: neg(r.b), flipped: true } : { ...r, flipped: false },
  );
  const names = lp.c.map((_, j) => `x${j + 1}`);
  const extra: { row: number; coef: Frac; kind: 's' | 'e' | 'a' }[] = [];
  rows.forEach((r, i) => {
    if (r.op === '<=') extra.push({ row: i, coef: ONE, kind: 's' });
    if (r.op === '>=') extra.push({ row: i, coef: neg(ONE), kind: 'e' });
    if (r.op !== '<=') extra.push({ row: i, coef: ONE, kind: 'a' });
  });
  extra.forEach((e) => names.push(`${e.kind}${e.row + 1}`));
  const width = n + extra.length;
  const table = rows.map((r, i) => {
    const line = [...r.a.map((v) => v), ...extra.map((e) => (e.row === i ? e.coef : ZERO)), r.b];
    return line.length === width + 1
      ? line
      : [...line.slice(0, n), ...Array(n - r.a.length).fill(ZERO), ...line.slice(r.a.length)];
  });
  const basis = rows.map((_, i) => n + extra.findIndex((e) => e.row === i && e.kind !== 'e'));
  const artificial = new Set(extra.flatMap((e, k) => (e.kind === 'a' ? [n + k] : [])));
  return { n, rows, names, table, basis, artificial, extra };
}

const flip = (op: Op): Op => (op === '<=' ? '>=' : op === '>=' ? '<=' : '=');

export function solveLp(lp: Lp): LpResult {
  const { n, rows, names, table, basis, artificial, extra } = setUp(lp);
  const width = names.length;
  const log: Tableau[] = [];
  const w: Work = { names, rows: table, obj: Array(width + 1).fill(ZERO), basis, barred: new Set() };
  const cost = lp.c.map((v) => (lp.sense === 'max' ? v : neg(v)));
  const empty = (status: LpStatus): LpResult => ({
    status,
    x: [],
    z: ZERO,
    duals: [],
    reduced: [],
    log,
    degenerate: false,
    units: [],
  });
  if (artificial.size) {
    // Phase 1: maximize minus the sum of the artificials.
    w.obj = Array.from({ length: width + 1 }, (_, j) => (artificial.has(j) ? ONE : ZERO));
    w.rows.forEach((r, i) => {
      if (artificial.has(w.basis[i])) w.obj = w.obj.map((v, j) => sub(v, r[j]));
    });
    const status = optimize(w, 1, log);
    if (status === 'limit') return empty('limit');
    if (sign(w.obj[width]) < 0) return empty('infeasible');
    // Drive artificials still basic at zero out of the basis.
    w.basis.forEach((b, i) => {
      if (!artificial.has(b)) return;
      const col = w.rows[i].findIndex((v, j) => j < width && !artificial.has(j) && !isZero(v));
      if (col >= 0) pivot(w, i, col);
    });
    w.barred = artificial;
  }
  w.obj = [...Array.from({ length: width }, (_, j) => (j < n ? neg(cost[j]) : ZERO)), ZERO];
  w.rows.forEach((r, i) => {
    const cb = w.basis[i] < n ? cost[w.basis[i]] : ZERO;
    if (!isZero(cb)) w.obj = w.obj.map((v, j) => add(v, mul(cb, r[j])));
  });
  const status = optimize(w, 2, log);
  if (status !== 'optimal') return empty(status);
  const x = Array.from({ length: n }, (_, j) => {
    const at = w.basis.indexOf(j);
    return at >= 0 ? w.rows[at][width] : ZERO;
  });
  const zMax = w.obj[width];
  const toSense = (v: Frac) => (lp.sense === 'max' ? v : neg(v));
  const duals = rows.map((r, i) => {
    const k = extra.findIndex((e) => e.row === i && e.kind !== 'e');
    const surplus = extra.findIndex((e) => e.row === i && e.kind === 'e');
    let y = r.op === '>=' && surplus >= 0 ? neg(w.obj[n + surplus]) : w.obj[n + k];
    if (r.flipped) y = neg(y);
    return toSense(y);
  });
  const reduced = Array.from({ length: n }, (_, j) => (lp.sense === 'max' ? neg(w.obj[j]) : w.obj[j]));
  const degenerate = w.rows.some((r) => isZero(r[width]));
  const units = rows.map((r, i) => {
    const k = extra.findIndex((e) => e.row === i && e.kind !== 'e');
    return { col: n + k, sign: 1 as const, flipped: r.flipped };
  });
  return { status, x, z: toSense(zMax), duals, reduced, log, degenerate, units };
}

/** A fraction from a whole number, for building programs in code and tests. */
export const whole = (v: number): Frac => frac(v);
