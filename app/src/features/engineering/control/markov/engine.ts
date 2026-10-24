// Markov chains and queues: discrete-time chains from a transition matrix and continuous-time chains from a
// generator, with n-step probabilities, communicating classes, stationary distributions, absorption
// probabilities, expected steps, and mean first passage times; and the M/M/1 and M/M/c queues. Entries typed as
// decimals or fractions are kept exact, so 0.9 is 9/10 and the answers come out as fractions.

import { ControlError, matTex, splitMatrixText } from '../lib/errors';
import {
  q0,
  q1,
  qAdd,
  qDiv,
  qIdentity,
  qMatMul,
  qMatPow,
  qMatSub,
  qNeg,
  qNum,
  qSign,
  qSolve,
  qSub,
  qTex,
  qText,
  qTranspose,
  readQ,
  type Q,
  type QMat,
} from '../lib/exact';
import { expm } from '../lib/linalg';
import { fmt, fmtTex } from '../lib/tf';
import { step, type Step } from '../lib/steps';

export type ChainKind = 'discrete' | 'continuous';

export const MAX_STATES = 15;

export interface ChainInput {
  readonly kind: ChainKind;
  /** Rows on lines (or separated by semicolons); entries by spaces or commas; fractions such as 1/3 allowed. */
  readonly matrix: string;
  /** State names separated by commas or spaces; empty gives 1, 2, 3, … */
  readonly names?: string;
  /** Initial distribution, optional. */
  readonly initial?: string;
  /** Steps n for Pⁿ (discrete chains). */
  readonly steps?: number;
  /** Time t for P(t) = e^{Qt} (continuous chains). */
  readonly time?: number;
}

/** A value kept both as a number and as display text (an exact fraction when possible). */
export interface Cell {
  readonly value: number;
  readonly text: string;
  readonly tex: string;
}

export interface ChainClass {
  readonly states: readonly number[];
  readonly closed: boolean;
  /** The period of a closed class (1 is aperiodic). */
  readonly period?: number;
}

export interface ChainResult {
  readonly kind: ChainKind;
  readonly n: number;
  readonly names: readonly string[];
  readonly matrix: readonly (readonly Cell[])[];
  readonly classes: readonly ChainClass[];
  readonly irreducible: boolean;
  readonly absorbing: readonly number[];
  /** One stationary distribution per closed class; unique when there is exactly one closed class. */
  readonly stationary: readonly (readonly Cell[])[];
  readonly power?: { readonly k: number; readonly matrix: readonly (readonly Cell[])[] };
  readonly distribution?: readonly Cell[];
  readonly absorption?: {
    readonly transient: readonly number[];
    readonly absorbing: readonly number[];
    /** N = (I − Q)⁻¹ for discrete chains, (−Q_TT)⁻¹ for continuous ones. */
    readonly fundamental: readonly (readonly Cell[])[];
    /** Rows: transient states; columns: absorbing states. */
    readonly probabilities: readonly (readonly Cell[])[];
    /** Expected steps (discrete) or expected time (continuous) to absorption from each transient state. */
    readonly expected: readonly Cell[];
  };
  /** Mean first passage times m[i][j] (discrete, irreducible chains). */
  readonly passage?: readonly (readonly Cell[])[];
  /** Mean holding time 1/q_i in each state (continuous chains). */
  readonly holding?: readonly Cell[];
  readonly steps: readonly Step[];
}

const cellQ = (x: Q): Cell => ({ value: qNum(x), text: qText(x), tex: qTex(x) });
const cellN = (x: number): Cell => ({ value: x, text: fmt(x), tex: fmtTex(x) });
const texOf = (m: readonly (readonly Cell[])[]): string => matTex(m.map((row) => row.map((c) => c.tex)));

/** Reads the matrix exactly; "*" on the diagonal of a generator means "fill so the row sums to zero". */
function readChainMatrix(text: string, kind: ChainKind): QMat {
  const cells = splitMatrixText(text);
  if (!cells.length) throw new ControlError('matrixEmpty');
  const n = cells.length;
  if (n > MAX_STATES) throw new ControlError('tooManyStates', { max: String(MAX_STATES) });
  if (cells.some((row) => row.length !== n)) throw new ControlError('notSquare');
  const m: (Q | null)[][] = cells.map((row, i) =>
    row.map((cell, j) => {
      if (cell === '*' && i === j && kind === 'continuous') return null;
      const v = readQ(cell);
      if (!v) throw new ControlError('matrixNumber', { cell });
      return v;
    }),
  );
  return m.map((row, i) => {
    if (row[i] !== null) return row as Q[];
    const off = row.reduce<Q>((s, x, j) => (j === i || !x ? s : qAdd(s, x)), q0);
    return row.map((x, j) => (j === i ? qNeg(off) : (x as Q)));
  });
}

function validate(p: QMat, kind: ChainKind): void {
  p.forEach((row, i) => {
    row.forEach((x, j) => {
      if (qSign(x) < 0 && (kind === 'discrete' || i !== j))
        throw new ControlError(kind === 'discrete' ? 'negativeProbability' : 'negativeRate', {
          row: String(i + 1),
          column: String(j + 1),
        });
    });
    const sum = row.reduce(qAdd, q0);
    const target = kind === 'discrete' ? q1 : q0;
    if (qSign(qSub(sum, target)) !== 0)
      throw new ControlError(kind === 'discrete' ? 'rowSumOne' : 'rowSumZero', {
        row: String(i + 1),
        sum: qText(sum),
      });
  });
}

/** Communicating classes by reachability, each marked closed, or not, with the period of closed classes. */
export function classify(p: readonly (readonly number[])[]): ChainClass[] {
  const n = p.length;
  const reach = p.map((row, i) => row.map((x, j) => i === j || x > 0));
  for (let k = 0; k < n; k += 1)
    for (let i = 0; i < n; i += 1) if (reach[i][k]) for (let j = 0; j < n; j += 1) if (reach[k][j]) reach[i][j] = true;
  const seen = new Array<boolean>(n).fill(false);
  const classes: ChainClass[] = [];
  for (let i = 0; i < n; i += 1) {
    if (seen[i]) continue;
    const states = [];
    for (let j = 0; j < n; j += 1)
      if (reach[i][j] && reach[j][i]) {
        states.push(j);
        seen[j] = true;
      }
    const inside = new Set(states);
    const closed = states.every((s) => p[s].every((x, j) => x <= 0 || inside.has(j) || j === s));
    classes.push(closed ? { states, closed, period: period(p, states) } : { states, closed });
  }
  return classes;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function period(p: readonly (readonly number[])[], states: readonly number[]): number {
  const level = new Map<number, number>([[states[0], 0]]);
  const queue = [states[0]];
  const inside = new Set(states);
  let g = 0;
  while (queue.length) {
    const u = queue.shift() as number;
    for (let v = 0; v < p.length; v += 1) {
      if (!(p[u][v] > 0) || !inside.has(v)) continue;
      const lu = level.get(u) as number;
      if (!level.has(v)) {
        level.set(v, lu + 1);
        queue.push(v);
      } else g = gcd(g, lu + 1 - (level.get(v) as number));
    }
  }
  return g === 0 ? 1 : g;
}

function parseNames(text: string | undefined, n: number): string[] {
  const parts = (text ?? '')
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const words = parts.length === n ? parts : (text ?? '').split(/\s+/).filter(Boolean);
  return Array.from({ length: n }, (_, i) => (words.length === n ? words[i] : String(i + 1)));
}

/** Stationary distribution of the chain restricted to a closed class: π P = π (or π Q = 0) with Σ π = 1. */
function stationaryOf(m: QMat, states: readonly number[], kind: ChainKind): Q[] {
  const sub = states.map((i) => states.map((j) => m[i][j]));
  const k = states.length;
  // Rows of the system: (Pᵀ − I) π = 0 (discrete) or Qᵀ π = 0 (continuous), last row replaced by Σ π = 1.
  const base = kind === 'discrete' ? qMatSub(qTranspose(sub), qIdentity(k)) : qTranspose(sub);
  const a = base.map((row, i) => (i === k - 1 ? row.map(() => q1) : row));
  const b = Array.from({ length: k }, (_, i) => [i === k - 1 ? q1 : q0]);
  const x = qSolve(a, b);
  if (!x) throw new ControlError('stationarySingular');
  const out = new Array<Q>(m.length).fill(q0);
  states.forEach((s, i) => {
    out[s] = x[i][0];
  });
  return out;
}

/** What the parts of the analysis share: the chain, its numbers, its names, and the steps so far. */
interface Chain {
  readonly kind: ChainKind;
  readonly m: QMat;
  readonly numbers: number[][];
  readonly names: readonly string[];
  readonly n: number;
  readonly steps: Step[];
}

export function analyzeChain(input: ChainInput): ChainResult {
  const { kind } = input;
  const m = readChainMatrix(input.matrix, kind);
  validate(m, kind);
  const n = m.length;
  const names = parseNames(input.names, n);
  const numbers = m.map((row) => row.map(qNum));
  const steps: Step[] = [];
  const chain: Chain = { kind, m, numbers, names, n, steps };
  steps.push(step(kind === 'discrete' ? 'markov.checkRows' : 'markov.checkGenerator', { n: String(n) }));

  // Classes use the off-diagonal pattern; for a generator the positive off-diagonal rates.
  const pattern = numbers.map((row, i) => row.map((x, j) => (i === j ? 0 : x)));
  const classes = classify(kind === 'discrete' ? numbers : pattern);
  const irreducible = classes.length === 1;
  const absorbing =
    kind === 'discrete'
      ? numbers.map((row, i) => (row[i] === 1 ? i : -1)).filter((i) => i >= 0)
      : numbers.map((row, i) => (row.every((x) => x === 0) ? i : -1)).filter((i) => i >= 0);
  steps.push(
    step('markov.classes', {
      classes: classes.map((c) => `{${c.states.map((s) => names[s]).join(', ')}}${c.closed ? '' : '*'}`).join(' '),
      count: String(classes.length),
    }),
  );
  const stationary = stationaryPart(chain, classes);
  const { power, distribution } = powerPart(chain, input);
  const absorption = absorptionPart(chain, absorbing);
  const passage = kind === 'discrete' && irreducible && n > 1 ? passagePart(chain) : undefined;

  // Holding times for a continuous chain.
  const holding =
    kind === 'continuous'
      ? numbers.map((row, i) => (row[i] < 0 ? cellN(-1 / row[i]) : cellN(Number.POSITIVE_INFINITY)))
      : undefined;
  if (holding) steps.push(step('markov.holding', {}, '\\bar{T}_i = 1 / q_i,\\quad q_i = -Q_{ii}'));

  return {
    kind,
    n,
    names,
    matrix: m.map((row) => row.map(cellQ)),
    classes,
    irreducible,
    absorbing,
    stationary,
    power,
    distribution,
    absorption,
    passage,
    holding,
    steps,
  };
}

/** One stationary distribution per closed class. */
function stationaryPart(chain: Chain, classes: readonly ChainClass[]): Cell[][] {
  const { kind, m, names, steps } = chain;
  const closedClasses = classes.filter((c) => c.closed);
  const stationary = closedClasses.map((c) => stationaryOf(m, c.states, kind).map(cellQ));
  if (stationary.length) {
    steps.push(
      step(
        closedClasses.length === 1 ? 'markov.stationaryUnique' : 'markov.stationaryMany',
        { count: String(closedClasses.length) },
        kind === 'discrete' ? '\\pi P = \\pi,\\quad \\sum_i \\pi_i = 1' : '\\pi Q = 0,\\quad \\sum_i \\pi_i = 1',
      ),
    );
    if (closedClasses.length === 1)
      steps.push(
        step(
          'markov.stationaryValues',
          { values: stationary[0].map((c, i) => `π(${names[i]}) = ${c.text}`).join(', ') },
          `\\pi = \\left(${stationary[0].map((c) => c.tex).join(',\\ ')}\\right)`,
        ),
      );
  }
  return stationary;
}

/** The n-step transition probabilities (discrete) or P(t) (continuous), and the distribution they give. */
function powerPart(chain: Chain, input: ChainInput): { power: ChainResult['power']; distribution?: Cell[] } {
  const { kind, m, numbers, n, steps } = chain;
  let power: ChainResult['power'];
  let distribution: Cell[] | undefined;
  const initial = input.initial?.trim() ? readInitial(input.initial, n) : undefined;
  if (kind === 'discrete') {
    const k = Math.max(0, Math.floor(input.steps ?? 1));
    if (k > 10_000) throw new ControlError('tooManySteps', { max: '10000' });
    let pk: Cell[][];
    try {
      if (k > 200) throw new Error('large');
      pk = qMatPow(m, k).map((row) => row.map(cellQ));
    } catch {
      pk = numberPower(numbers, k).map((row) => row.map(cellN));
    }
    power = { k, matrix: pk };
    steps.push(step('markov.power', { k: String(k) }, `P^{(${k})} = P^{${k}} = ${texOf(pk)}`));
    if (initial) {
      const d = initial.map(qNum);
      distribution = pk[0].map((_, j) => cellN(d.reduce((s, x, i) => s + x * pk[i][j].value, 0)));
      steps.push(step('markov.distribution', { k: String(k) }, `p^{(${k})} = p^{(0)} P^{${k}}`));
    }
  } else {
    const t = input.time ?? 1;
    if (!(t >= 0) || !Number.isFinite(t)) throw new ControlError('badTime');
    const pt = expm(numbers.map((row) => row.map((x) => x * t))).map((row) => row.map(cellN));
    power = { k: t, matrix: pt };
    steps.push(step('markov.transient', { t: fmt(t) }, `P(${fmtTex(t)}) = e^{Q\\,${fmtTex(t)}} = ${texOf(pt)}`));
    if (initial) {
      const d = initial.map(qNum);
      distribution = pt[0].map((_, j) => cellN(d.reduce((s, x, i) => s + x * pt[i][j].value, 0)));
    }
  }
  return { power, distribution };
}

/** The fundamental matrix, absorption probabilities, and expected time to absorption. */
function absorptionPart(chain: Chain, absorbing: readonly number[]): ChainResult['absorption'] {
  const { kind, m, n, steps } = chain;
  let absorption: ChainResult['absorption'];
  if (absorbing.length && absorbing.length < n) {
    const transient = Array.from({ length: n }, (_, i) => i).filter((i) => !absorbing.includes(i));
    const qtt = transient.map((i) => transient.map((j) => m[i][j]));
    const rta = transient.map((i) => absorbing.map((j) => m[i][j]));
    const left = kind === 'discrete' ? qMatSub(qIdentity(transient.length), qtt) : qtt.map((r) => r.map(qNeg));
    const fundamental = qSolve(left, qIdentity(transient.length));
    if (fundamental) {
      const b = qMatMul(fundamental, rta);
      const t = fundamental.map((row) => row.reduce(qAdd, q0));
      absorption = {
        transient,
        absorbing,
        fundamental: fundamental.map((row) => row.map(cellQ)),
        probabilities: b.map((row) => row.map(cellQ)),
        expected: t.map(cellQ),
      };
      const nTex = texOf(absorption.fundamental);
      steps.push(
        step(
          kind === 'discrete' ? 'markov.fundamental' : 'markov.fundamentalContinuous',
          {},
          kind === 'discrete' ? `N = (I - Q)^{-1} = ${nTex}` : `N = (-Q_{TT})^{-1} = ${nTex}`,
        ),
      );
      steps.push(
        step(
          'markov.absorbProbabilities',
          {},
          `B = N ${kind === 'discrete' ? 'R' : 'Q_{TA}'} = ${texOf(absorption.probabilities)}`,
        ),
      );
      steps.push(
        step(
          kind === 'discrete' ? 'markov.expectedSteps' : 'markov.expectedTime',
          {},
          `t = N\\mathbf{1} = ${matTex(absorption.expected.map((c) => [c.tex]))}`,
        ),
      );
    } else steps.push(step('markov.noAbsorption'));
  }
  return absorption;
}

/** Mean first passage times of an irreducible discrete chain. */
function passagePart(chain: Chain): Cell[][] {
  const { kind, m, n, steps } = chain;
  const pi = stationaryOf(m, [...Array(n).keys()], kind);
  const passage: Cell[][] = Array.from({ length: n }, () => new Array<Cell>(n));
  for (let j = 0; j < n; j += 1) {
    const others = [...Array(n).keys()].filter((k) => k !== j);
    const a = others.map((i) => others.map((k) => (i === k ? qSub(q1, m[i][k]) : qNeg(m[i][k]))));
    const x = qSolve(
      a,
      others.map(() => [q1]),
    );
    if (!x) continue;
    others.forEach((i, r) => {
      passage[i][j] = cellQ(x[r][0]);
    });
    passage[j][j] = cellQ(qDiv(q1, pi[j]));
  }
  steps.push(step('markov.passage', {}, 'm_{ij} = 1 + \\sum_{k \\ne j} P_{ik}\\, m_{kj},\\quad m_{jj} = 1/\\pi_j'));
  return passage;
}

function readInitial(text: string, n: number): Q[] {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== n) throw new ControlError('initialLength', { n: String(n) });
  const values = parts.map((cell) => {
    const v = readQ(cell);
    if (!v) throw new ControlError('matrixNumber', { cell });
    if (qSign(v) < 0) throw new ControlError('initialNegative');
    return v;
  });
  const sum = values.reduce(qAdd, q0);
  if (qSign(qSub(sum, q1)) !== 0) throw new ControlError('initialSum', { sum: qText(sum) });
  return values;
}

function numberPower(p: number[][], k: number): number[][] {
  const n = p.length;
  let result: number[][] = p.map((_, i) => p.map((__, j) => (i === j ? 1 : 0)));
  let base = p;
  let e = k;
  const mm = (a: number[][], b: number[][]) =>
    a.map((row) => b[0].map((_, j) => row.reduce((s, x, i) => s + x * b[i][j], 0)));
  while (e > 0) {
    if (e % 2 === 1) result = mm(result, base);
    e = Math.floor(e / 2);
    if (e > 0) base = mm(base, base);
  }
  return result.slice(0, n);
}

// ---------------------------------------------------------------------------------------------------------------
// Templates

/** The gambler's ruin chain on 0 … target: win one with probability p, lose one otherwise; 0 and target absorb. */
export function gamblersRuin(target: number, p: string): string {
  const win = readQ(p);
  if (!win || qSign(win) < 0 || qSign(qSub(win, q1)) > 0) throw new ControlError('probabilityRange');
  if (!Number.isInteger(target) || target < 2 || target + 1 > MAX_STATES)
    throw new ControlError('ruinTarget', { max: String(MAX_STATES - 1) });
  const lose = qText(qSub(q1, win)).replace('−', '-');
  const winText = qText(win).replace('−', '-');
  return Array.from({ length: target + 1 }, (_, i) =>
    Array.from({ length: target + 1 }, (__, j) => {
      if (i === 0 || i === target) return i === j ? '1' : '0';
      if (j === i + 1) return winText;
      if (j === i - 1) return lose;
      return '0';
    }).join(' '),
  ).join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Queues

export interface QueueInput {
  /** Arrival rate λ (per unit time). */
  readonly lambda: number;
  /** Service rate μ per server (per unit time). */
  readonly mu: number;
  /** Number of servers c (1 for M/M/1). */
  readonly servers: number;
}

export interface QueueResult {
  readonly rho: number;
  readonly p0: number;
  /** Probability an arrival waits (Erlang C); ρ for M/M/1. */
  readonly pWait: number;
  readonly l: number;
  readonly lq: number;
  readonly w: number;
  readonly wq: number;
  /** P(n in system) for n = 0 … 10. */
  readonly pn: readonly number[];
  readonly steps: readonly Step[];
}

/** The M/M/c queue in steady state (M/M/1 when c = 1). Throws when ρ ≥ 1, since the queue then grows without bound. */
export function queue(input: QueueInput): QueueResult {
  const { lambda, mu } = input;
  const c = input.servers;
  if (!(lambda > 0) || !(mu > 0) || !Number.isFinite(lambda) || !Number.isFinite(mu))
    throw new ControlError('ratesPositive');
  if (!Number.isInteger(c) || c < 1 || c > 200) throw new ControlError('serversRange');
  const a = lambda / mu; // offered load in erlangs
  const rho = a / c;
  if (rho >= 1) throw new ControlError('queueUnstable', { rho: fmt(rho) });
  const steps: Step[] = [];
  steps.push(
    step(
      'queue.rho',
      { rho: fmt(rho) },
      `\\rho = \\frac{\\lambda}{c\\,\\mu} = \\frac{${fmtTex(lambda)}}{${c} \\cdot ${fmtTex(mu)}} = ${fmtTex(rho)}`,
    ),
  );
  // Σ_{k<c} a^k/k! computed with running terms so large c stays finite.
  let term = 1;
  let sum = 0;
  for (let k = 0; k < c; k += 1) {
    sum += term;
    term *= a / (k + 1);
  }
  const tail = term / (1 - rho); // a^c/c! · 1/(1 − ρ)
  const p0 = 1 / (sum + tail);
  const pWait = tail * p0;
  const lq = (pWait * rho) / (1 - rho);
  const l = lq + a;
  const wq = lq / lambda;
  const w = wq + 1 / mu;
  if (c === 1) {
    steps.push(step('queue.mm1L', { l: fmt(l) }, `L = \\frac{\\rho}{1-\\rho} = ${fmtTex(l)}`));
    steps.push(step('queue.mm1Lq', { lq: fmt(lq) }, `L_q = \\frac{\\rho^2}{1-\\rho} = ${fmtTex(lq)}`));
  } else {
    steps.push(
      step(
        'queue.erlangC',
        { p: fmt(pWait) },
        `P_W = \\frac{a^c}{c!\\,(1-\\rho)} P_0 = ${fmtTex(pWait)},\\quad a = \\lambda/\\mu = ${fmtTex(a)}`,
      ),
    );
    steps.push(
      step(
        'queue.mmcLq',
        { lq: fmt(lq) },
        `L_q = \\frac{P_W\\,\\rho}{1-\\rho} = ${fmtTex(lq)},\\quad L = L_q + a = ${fmtTex(l)}`,
      ),
    );
  }
  steps.push(
    step(
      'queue.little',
      { w: fmt(w), wq: fmt(wq) },
      `W = \\frac{L}{\\lambda} = ${fmtTex(w)},\\quad W_q = \\frac{L_q}{\\lambda} = ${fmtTex(wq)}`,
    ),
  );
  const pn: number[] = [];
  let pk = p0;
  for (let k = 0; k <= 10; k += 1) {
    pn.push(pk);
    // P(n) = P₀ aⁿ/n! up to n = c, then each further customer multiplies by a/c.
    pk *= k + 1 <= c ? a / (k + 1) : a / c;
  }
  return { rho, p0, pWait, l, lq, w, wq, pn, steps };
}
