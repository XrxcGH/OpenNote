// Information measures and channel capacity. From probability tables it finds entropy (alone, joint, or
// conditional), mutual information, and Kullback-Leibler divergence; it also gives textbook channel capacities.
import { SignalError } from '../shared/errors';
import { fmt } from '../shared/num';
import { step, type Step } from '../shared/steps';

const TOLERANCE = 1e-6;
const plogp = (p: number): number => (p > 0 ? -p * Math.log2(p) : 0);

/** Checks a list of probabilities: none negative, and they add to 1 (within 1e-6). */
export function checkProbabilities(p: readonly number[]): number[] {
  if (!p.length) throw new SignalError('empty');
  for (const value of p) if (!Number.isFinite(value) || value < 0) throw new SignalError('probability');
  const total = p.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > TOLERANCE) throw new SignalError('probabilitySum', { total: fmt(total) });
  return [...p];
}

/** H(X) = −Σ p log₂ p, in bits. */
export function entropy(p: readonly number[]): { bits: number; steps: Step[] } {
  const probabilities = checkProbabilities(p);
  const bits = probabilities.reduce((a, value) => a + plogp(value), 0);
  const terms = probabilities.map((value) => `${fmt(value)}·log₂(1/${fmt(value)})`).join(' + ');
  return { bits, steps: [step('commsEntropy', `H = ${terms} = ${fmt(bits)} bits`)] };
}

/** The binary entropy function H₂(p). */
export const binaryEntropy = (p: number): number => plogp(p) + plogp(1 - p);

export interface JointMeasures {
  hx: number;
  hy: number;
  hxy: number;
  hxGivenY: number;
  hyGivenX: number;
  mutual: number;
  px: number[];
  py: number[];
  steps: Step[];
}

/** Every measure of a joint probability table P(x, y), rows x and columns y. */
export function jointMeasures(table: readonly (readonly number[])[]): JointMeasures {
  if (!table.length || !table[0]!.length) throw new SignalError('empty');
  const columns = table[0]!.length;
  if (table.some((row) => row.length !== columns)) throw new SignalError('ragged');
  checkProbabilities(table.flat());
  const px = table.map((row) => row.reduce((a, b) => a + b, 0));
  const py = Array.from({ length: columns }, (_, j) => table.reduce((a, row) => a + row[j]!, 0));
  const hx = px.reduce((a, p) => a + plogp(p), 0);
  const hy = py.reduce((a, p) => a + plogp(p), 0);
  const hxy = table.flat().reduce((a, p) => a + plogp(p), 0);
  const mutual = hx + hy - hxy;
  return {
    hx,
    hy,
    hxy,
    hxGivenY: hxy - hy,
    hyGivenX: hxy - hx,
    mutual,
    px,
    py,
    steps: [
      step('commsMarginals', `P(x) = ${px.map((v) => fmt(v)).join(', ')}; P(y) = ${py.map((v) => fmt(v)).join(', ')}`),
      step('commsJoint', `H(X) = ${fmt(hx)}, H(Y) = ${fmt(hy)}, H(X,Y) = ${fmt(hxy)} bits`),
      step('commsConditional', `H(X|Y) = H(X,Y) − H(Y) = ${fmt(hxy - hy)}; H(Y|X) = ${fmt(hxy - hx)} bits`),
      step('commsMutual', `I(X;Y) = H(X) + H(Y) − H(X,Y) = ${fmt(mutual)} bits`),
    ],
  };
}

/** D(P‖Q) = Σ p log₂(p/q), in bits; infinite when Q is 0 where P is not. */
export function divergence(p: readonly number[], q: readonly number[]): { bits: number; steps: Step[] } {
  checkProbabilities(p);
  checkProbabilities(q);
  if (p.length !== q.length) throw new SignalError('lengthsDiffer');
  let bits = 0;
  for (let i = 0; i < p.length; i += 1) {
    if (p[i]! === 0) continue;
    if (q[i]! === 0) return { bits: Infinity, steps: [step('commsKlInfinite')] };
    bits += p[i]! * Math.log2(p[i]! / q[i]!);
  }
  return { bits, steps: [step('commsKl', `D(P‖Q) = Σ p·log₂(p/q) = ${fmt(bits)} bits`)] };
}

export type ChannelKind = 'bsc' | 'bec' | 'z' | 'awgn' | 'dmc';

/** Capacity of a binary symmetric channel with crossover probability p: 1 − H₂(p) bits per use. */
export function capacityBsc(p: number): { bits: number; steps: Step[] } {
  if (!(p >= 0 && p <= 1)) throw new SignalError('probability');
  const bits = 1 - binaryEntropy(p);
  return {
    bits,
    steps: [step('commsBsc', `C = 1 − H₂(${fmt(p)}) = 1 − ${fmt(binaryEntropy(p))} = ${fmt(bits)} bits per use`)],
  };
}

/** Capacity of a binary erasure channel with erasure probability e: 1 − e. */
export function capacityBec(e: number): { bits: number; steps: Step[] } {
  if (!(e >= 0 && e <= 1)) throw new SignalError('probability');
  return { bits: 1 - e, steps: [step('commsBec', `C = 1 − ${fmt(e)} = ${fmt(1 - e)} bits per use`)] };
}

/** Capacity of a Z channel (a 1 turns into a 0 with probability p): log₂(1 + (1 − p) p^(p/(1 − p))). */
export function capacityZ(p: number): { bits: number; steps: Step[] } {
  if (!(p >= 0 && p <= 1)) throw new SignalError('probability');
  const bits = p >= 1 ? 0 : Math.log2(1 + (1 - p) * p ** (p / (1 - p)));
  return { bits, steps: [step('commsZ', `C = log₂(1 + (1 − p)·p^(p/(1−p))) = ${fmt(bits)} bits per use`)] };
}

/** Shannon-Hartley: C = B log₂(1 + SNR), with B in hertz and the SNR as a power ratio. */
export function capacityAwgn(bandwidth: number, snr: number): { bitsPerSecond: number; steps: Step[] } {
  if (!(bandwidth > 0) || !Number.isFinite(bandwidth)) throw new SignalError('bandwidth');
  if (!(snr >= 0) || !Number.isFinite(snr)) throw new SignalError('snr');
  const bitsPerSecond = bandwidth * Math.log2(1 + snr);
  return {
    bitsPerSecond,
    steps: [
      step('commsAwgn', `C = B·log₂(1 + SNR) = ${fmt(bandwidth)}·log₂(${fmt(1 + snr)}) = ${fmt(bitsPerSecond)} bit/s`),
    ],
  };
}

/** Blahut-Arimoto for a discrete memoryless channel: rows are inputs, each row P(y|x) adding to 1. */
export function capacityDmc(
  channel: readonly (readonly number[])[],
  iterations = 2000,
): {
  bits: number;
  input: number[];
  steps: Step[];
} {
  if (!channel.length || !channel[0]!.length) throw new SignalError('empty');
  const outputs = channel[0]!.length;
  if (channel.some((row) => row.length !== outputs)) throw new SignalError('ragged');
  channel.forEach((row) => checkProbabilities(row));
  const inputs = channel.length;
  let r = Array<number>(inputs).fill(1 / inputs);
  let lower = 0;
  let upper = Infinity;
  let used = 0;
  for (; used < iterations; used += 1) {
    const q = Array.from({ length: outputs }, (_, j) => r.reduce((a, ri, i) => a + ri * channel[i]![j]!, 0));
    // c_i = exp(Σ_j P(j|i) ln(P(j|i)/q_j)): the divergence of row i from the output distribution.
    const c = channel.map((row) => Math.exp(row.reduce((a, p, j) => (p > 0 ? a + p * Math.log(p / q[j]!) : a), 0)));
    const total = r.reduce((a, ri, i) => a + ri * c[i]!, 0);
    lower = Math.log2(total);
    upper = Math.log2(Math.max(...c));
    r = r.map((ri, i) => (ri * c[i]!) / total);
    if (upper - lower < 1e-10) break;
  }
  return {
    bits: lower,
    input: r,
    steps: [
      step('commsBlahut', `${used + 1} iterations: ${fmt(lower)} ≤ C ≤ ${fmt(upper)} bits per use`, {
        count: used + 1,
      }),
      step('commsBestInput', `P(x) = ${r.map((v) => fmt(v, 4)).join(', ')}`),
    ],
  };
}
