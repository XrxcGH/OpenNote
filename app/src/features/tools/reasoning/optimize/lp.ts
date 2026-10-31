// Sensitivity, duality, and integer programs on top of the exact simplex (core/simplex.ts). It finds the range of
// each right side over which its shadow price holds, and the range of each objective coefficient that keeps the
// basis optimal. It also writes the dual program and runs branch and bound on the LP relaxations.
import { ZERO, add, cmp, div, frac, isZero, mul, neg, sign } from '../core/frac';
import type { Frac } from '../core/frac';
import { solveLp } from '../core/simplex';
import type { Lp, LpResult, LpRow, Op } from '../core/simplex';

/** A closed range; null stands for an infinite end. */
export interface Range {
  lo: Frac | null;
  hi: Frac | null;
}

const lower = (a: Frac | null, b: Frac): Frac => (a === null || cmp(b, a) > 0 ? b : a);
const upper = (a: Frac | null, b: Frac): Frac => (a === null || cmp(b, a) < 0 ? b : a);

/** For each constraint, the right sides over which the optimal basis, and so the shadow price, stays the same. */
export function rhsRanges(lp: Lp, res: LpResult): Range[] {
  const last = res.log[res.log.length - 1];
  if (res.status !== 'optimal' || !last) return [];
  const width = last.obj.length - 1;
  return lp.rows.map((row, i) => {
    const u = res.units[i];
    let lo: Frac | null = null;
    let hi: Frac | null = null;
    last.rows.forEach((r) => {
      // x_B + delta * s * col >= 0, where s is -1 when the row was negated before the tableau was built.
      const a = u.flipped ? neg(r[u.col]) : r[u.col];
      if (isZero(a)) return;
      const bound = div(neg(r[width]), a);
      if (sign(a) > 0) lo = lower(lo, bound);
      else hi = upper(hi, bound);
    });
    return { lo: lo === null ? null : add(row.b, lo), hi: hi === null ? null : add(row.b, hi) };
  });
}

/** For each decision variable, the objective coefficients for which the optimal solution stays the same. */
export function costRanges(lp: Lp, res: LpResult): Range[] {
  const last = res.log[res.log.length - 1];
  if (res.status !== 'optimal' || !last) return [];
  const width = last.obj.length - 1;
  const barred = new Set(last.names.flatMap((name, j) => (name.startsWith('a') ? [j] : [])));
  const max = lp.sense === 'max';
  return lp.c.map((c, k) => {
    const cMax = max ? c : neg(c);
    const at = last.basis.indexOf(k);
    let lo: Frac | null = null;
    let hi: Frac | null = null;
    if (at < 0) {
      // A nonbasic variable enters once its coefficient (as maximized) rises by its reduced cost.
      hi = add(cMax, last.obj[k]);
    } else {
      for (let j = 0; j < width; j += 1) {
        if (j === k || barred.has(j) || last.basis.includes(j)) continue;
        const a = last.rows[at][j];
        if (isZero(a)) continue;
        // The reduced cost d_j + delta * a must stay at or above zero.
        const bound = div(neg(last.obj[j]), a);
        if (sign(a) > 0) lo = lower(lo, bound);
        else hi = upper(hi, bound);
      }
      lo = lo === null ? null : add(cMax, lo);
      hi = hi === null ? null : add(cMax, hi);
    }
    if (max) return { lo, hi };
    return { lo: hi === null ? null : neg(hi), hi: lo === null ? null : neg(lo) };
  });
}

export interface DualVar {
  /** '>= 0', '<= 0', or 'free'. */
  sign: '>=' | '<=' | 'free';
}

export interface Dual {
  sense: 'max' | 'min';
  c: Frac[];
  rows: LpRow[];
  signs: DualVar['sign'][];
}

/**
 * The dual program. For a maximum, a <= row has a dual variable at least 0, a >= row one at most 0, and an = row a
 * free one; each primal variable (at least 0) gives a >= row. A minimum is the mirror image.
 */
export function dual(lp: Lp): Dual {
  const max = lp.sense === 'max';
  const signs = lp.rows.map((r): DualVar['sign'] => (r.op === '=' ? 'free' : (r.op === '<=') === max ? '>=' : '<='));
  const op: Op = max ? '>=' : '<=';
  const rows = lp.c.map((cj, j) => ({ a: lp.rows.map((r) => r.a[j]), op, b: cj }));
  return { sense: max ? 'min' : 'max', c: lp.rows.map((r) => r.b), rows, signs };
}

const floorFrac = (x: Frac): bigint => {
  const q = x.n / x.d;
  return x.n < 0n && q * x.d !== x.n ? q - 1n : q;
};

export interface BbNode {
  /** The bounds added on the way to this node, such as "x ≤ 3". */
  bounds: { j: number; op: '<=' | '>='; v: bigint }[];
  status: LpResult['status'];
  x: Frac[];
  z: Frac;
  /** pruned: bound no better than the incumbent; integer: a new incumbent or a worse one; branch: split on `on`. */
  fate: 'infeasible' | 'bound' | 'integer' | 'branch' | 'limit' | 'unbounded';
  on?: number;
  children: BbNode[];
}

export interface BbResult {
  root: BbNode;
  best: { x: Frac[]; z: Frac } | null;
  nodes: number;
  hitLimit: boolean;
}

/** Branch and bound, depth first, on the first fractional variable among those that must be whole. */
export function branchAndBound(lp: Lp, whole: readonly boolean[], limit = 63): BbResult {
  const max = lp.sense === 'max';
  const better = (a: Frac, b: Frac) => (max ? cmp(a, b) > 0 : cmp(a, b) < 0);
  let best: BbResult['best'] = null;
  let nodes = 0;
  let hitLimit = false;
  const visit = (bounds: BbNode['bounds']): BbNode => {
    nodes += 1;
    const extra: LpRow[] = bounds.map((b) => ({
      a: lp.c.map((_, j) => (j === b.j ? frac(1) : ZERO)),
      op: b.op,
      b: frac(b.v),
    }));
    const res = solveLp({ ...lp, rows: [...lp.rows, ...extra] });
    const node: BbNode = { bounds, status: res.status, x: res.x, z: res.z, fate: 'branch', children: [] };
    if (res.status === 'infeasible') return { ...node, fate: 'infeasible' };
    if (res.status === 'unbounded') return { ...node, fate: 'unbounded' };
    if (res.status === 'limit') return { ...node, fate: 'limit' };
    if (best && !better(res.z, best.z)) return { ...node, fate: 'bound' };
    const on = res.x.findIndex((v, j) => whole[j] && v.d !== 1n);
    if (on < 0) {
      best = { x: res.x, z: res.z };
      return { ...node, fate: 'integer' };
    }
    if (nodes >= limit) {
      hitLimit = true;
      return { ...node, fate: 'limit' };
    }
    const f = floorFrac(res.x[on]);
    const down = visit([...bounds, { j: on, op: '<=', v: f }]);
    const up = visit([...bounds, { j: on, op: '>=', v: f + 1n }]);
    return { ...node, on, children: [down, up] };
  };
  const root = visit([]);
  return { root, best, nodes, hitLimit };
}

/** The objective's value at a point, for checks. */
export const objectiveAt = (lp: Lp, x: readonly Frac[]): Frac =>
  lp.c.reduce((s, c, j) => add(s, mul(c, x[j] ?? ZERO)), ZERO);
