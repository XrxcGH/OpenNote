// The Cox proportional hazards model, fitted by Newton-Raphson on the partial likelihood. Tied event times use
// Breslow's approximation, where every tied event sees the whole risk set, or Efron's, where the tied events leave
// the risk set a fraction at a time. The tool reports the Wald, score, and likelihood-ratio tests of all
// covariates together.
import { chiSquareUpper, normalQuantile, normalTwoSided } from '../kit/dist';
import { inverse, zeros, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';

export type Ties = 'breslow' | 'efron';

interface Partial {
  readonly ll: number;
  readonly grad: number[];
  /** The information matrix, minus the Hessian. */
  readonly info: Matrix;
}

/** The log partial likelihood with its gradient and information at beta. */
export function partialLikelihood(
  time: readonly number[],
  event: readonly number[],
  x: Matrix,
  beta: readonly number[],
  ties: Ties,
): Partial {
  const p = beta.length;
  const order = time.map((_, i) => i).sort((a, b) => time[b] - time[a]);
  const risk = (i: number) => Math.exp(x[i].reduce((s, v, j) => s + v * beta[j], 0));
  let ll = 0;
  const grad = new Array<number>(p).fill(0);
  const info = zeros(p, p);
  const s1 = new Array<number>(p).fill(0);
  const s2 = zeros(p, p);
  let s0 = 0;
  for (let k = 0; k < order.length;) {
    const t = time[order[k]];
    const dead: number[] = [];
    while (k < order.length && time[order[k]] === t) {
      const i = order[k];
      const r = risk(i);
      s0 += r;
      for (let a = 0; a < p; a += 1) {
        s1[a] += r * x[i][a];
        for (let b = 0; b < p; b += 1) s2[a][b] += r * x[i][a] * x[i][b];
      }
      if (event[i] === 1) dead.push(i);
      k += 1;
    }
    if (dead.length > 0) addTime(dead, { s0, s1, s2 }, { x, beta, ties, risk }, { grad, info, add: (v) => (ll += v) });
  }
  return { ll, grad, info };
}

function addTime(
  dead: readonly number[],
  sums: { s0: number; s1: number[]; s2: Matrix },
  model: { x: Matrix; beta: readonly number[]; ties: Ties; risk: (i: number) => number },
  out: { grad: number[]; info: Matrix; add: (v: number) => void },
): void {
  const { x, beta } = model;
  const p = beta.length;
  const d = dead.length;
  let a0 = 0;
  const a1 = new Array<number>(p).fill(0);
  const a2 = zeros(p, p);
  for (const i of dead) {
    const r = model.risk(i);
    out.add(x[i].reduce((s, v, j) => s + v * beta[j], 0));
    a0 += r;
    for (let a = 0; a < p; a += 1) {
      out.grad[a] += x[i][a];
      a1[a] += r * x[i][a];
      for (let b = 0; b < p; b += 1) a2[a][b] += r * x[i][a] * x[i][b];
    }
  }
  for (let l = 0; l < d; l += 1) {
    const f = model.ties === 'efron' ? l / d : 0;
    const t0 = sums.s0 - f * a0;
    const t1 = sums.s1.map((v, a) => v - f * a1[a]);
    out.add(-Math.log(t0));
    for (let a = 0; a < p; a += 1) {
      out.grad[a] -= t1[a] / t0;
      for (let b = 0; b < p; b += 1) out.info[a][b] += (sums.s2[a][b] - f * a2[a][b]) / t0 - (t1[a] * t1[b]) / t0 ** 2;
    }
  }
}

export interface CoxResult {
  readonly names: readonly string[];
  readonly coef: readonly number[];
  readonly se: readonly number[];
  readonly z: readonly number[];
  readonly p: readonly number[];
  readonly low: readonly number[];
  readonly high: readonly number[];
  readonly ll: number;
  readonly ll0: number;
  readonly lr: number;
  readonly wald: number;
  readonly score: number;
  readonly df: number;
  readonly lrP: number;
  readonly waldP: number;
  readonly scoreP: number;
  /** The log partial likelihood after each Newton step. */
  readonly history: readonly number[];
}

const quad = (v: readonly number[], m: Matrix) =>
  v.reduce((s, va, a) => s + va * m[a].reduce((t, x, b) => t + x * v[b], 0), 0);

export function fitCox(
  time: readonly number[],
  event: readonly number[],
  x: Matrix,
  names: readonly string[],
  ties: Ties,
  level = 0.95,
): CoxResult {
  const p = names.length;
  if (p === 0) fail('pickColumns');
  if (!event.some((e) => e === 1)) fail('noEvents');
  let beta = new Array<number>(p).fill(0);
  const start = partialLikelihood(time, event, x, beta, ties);
  const startInv = inverse(start.info);
  if (!startInv) fail('collinear', names.join(', '));
  let current = start;
  const history = [start.ll];
  for (let iter = 0; iter < 60; iter += 1) {
    const inv = inverse(current.info);
    if (!inv) fail('collinear', names.join(', '));
    const stepDir = inv.map((row) => row.reduce((s, v, b) => s + v * current.grad[b], 0));
    let scale = 1;
    let next = partialLikelihood(
      time,
      event,
      x,
      beta.map((b, a) => b + stepDir[a]),
      ties,
    );
    while (next.ll < current.ll - 1e-12 && scale > 1e-6) {
      scale /= 2;
      next = partialLikelihood(
        time,
        event,
        x,
        beta.map((b, a) => b + scale * stepDir[a]),
        ties,
      );
    }
    beta = beta.map((b, a) => b + scale * stepDir[a]);
    const done = Math.abs(next.ll - current.ll) < 1e-11 * (Math.abs(next.ll) + 1);
    current = next;
    history.push(current.ll);
    if (beta.some((b) => Math.abs(b) > 30)) fail('coxDiverges');
    if (done) break;
    if (iter === 59) fail('noConvergence');
  }
  const cov = inverse(current.info);
  if (!cov) fail('collinear', names.join(', '));
  const z0 = normalQuantile(1 - (1 - level) / 2);
  const se = beta.map((_, a) => Math.sqrt(cov[a][a]));
  const lr = 2 * (current.ll - start.ll);
  const wald = quad(beta, current.info);
  const score = quad(start.grad, startInv);
  return {
    names,
    coef: beta,
    se,
    z: beta.map((b, a) => b / se[a]),
    p: beta.map((b, a) => normalTwoSided(b / se[a])),
    low: beta.map((b, a) => b - z0 * se[a]),
    high: beta.map((b, a) => b + z0 * se[a]),
    ll: current.ll,
    ll0: start.ll,
    lr,
    wald,
    score,
    df: p,
    lrP: chiSquareUpper(lr, p),
    waldP: chiSquareUpper(wald, p),
    scoreP: chiSquareUpper(score, p),
    history,
  };
}
