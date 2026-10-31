// Digital modulation: constellations with seeded noise, theoretical bit-error rates against Eb/N0, conversions between
// Eb/N0 and SNR, and eye diagrams of raised-cosine pulses. Pure: no DOM.
import { erfc } from '../../kits/num/special';
import { SignalError } from '../shared/errors';
import { fmt, gaussian, seededRandom } from '../shared/num';
import { step, type Step } from '../shared/steps';

export type Scheme = 'bpsk' | 'qpsk' | 'psk' | 'qam' | 'fsk' | 'fskNoncoherent';
export const SCHEMES: readonly Scheme[] = ['bpsk', 'qpsk', 'psk', 'qam', 'fsk', 'fskNoncoherent'];

/** The Gaussian tail probability Q(x) = ½ erfc(x/√2). */
export const qfunc = (x: number): number => 0.5 * erfc(x / Math.SQRT2);

const fromDb = (db: number) => 10 ** (db / 10);

/** Bits per symbol for a scheme of order M (BPSK 1, QPSK 2, binary FSK 1). */
export function bitsPerSymbol(scheme: Scheme, order: number): number {
  if (scheme === 'bpsk' || scheme === 'fsk' || scheme === 'fskNoncoherent') return 1;
  if (scheme === 'qpsk') return 2;
  return Math.log2(order);
}

export function checkOrder(scheme: Scheme, order: number): number {
  if (scheme === 'psk' && !(Number.isInteger(Math.log2(order)) && order >= 4 && order <= 64)) {
    throw new SignalError('order', { min: 4, max: 64 });
  }
  if (scheme === 'qam') {
    const side = Math.sqrt(order);
    if (!(Number.isInteger(side) && Number.isInteger(Math.log2(order)) && order >= 4 && order <= 256)) {
      throw new SignalError('qamOrder');
    }
  }
  return order;
}

/**
 * The bit-error rate at Eb/N0 (a power ratio). BPSK and QPSK are exact with Gray coding; M-PSK and square M-QAM
 * use the usual nearest-neighbor approximations with Gray coding; binary FSK is orthogonal, with or without a phase reference.
 */
export function bitErrorRate(scheme: Scheme, order: number, ebN0: number): number {
  if (!(ebN0 >= 0)) throw new SignalError('snr');
  const k = bitsPerSymbol(scheme, order);
  switch (scheme) {
    case 'bpsk':
    case 'qpsk':
      return qfunc(Math.sqrt(2 * ebN0));
    case 'psk':
      return Math.min(0.5, (2 / k) * qfunc(Math.sqrt(2 * k * ebN0) * Math.sin(Math.PI / order)));
    case 'qam':
      return Math.min(0.5, (4 / k) * (1 - 1 / Math.sqrt(order)) * qfunc(Math.sqrt((3 * k * ebN0) / (order - 1))));
    case 'fsk':
      return qfunc(Math.sqrt(ebN0));
    case 'fskNoncoherent':
      return 0.5 * Math.exp(-ebN0 / 2);
  }
}

export const isApproximate = (scheme: Scheme): boolean => scheme === 'psk' || scheme === 'qam';

export function berSteps(scheme: Scheme, order: number, ebN0Db: number): { ber: number; steps: Step[] } {
  const ebN0 = fromDb(ebN0Db);
  const ber = bitErrorRate(scheme, order, ebN0);
  const k = bitsPerSymbol(scheme, order);
  const formula: Record<Scheme, string> = {
    bpsk: 'P_b = Q(√(2·Eb/N0))',
    qpsk: 'P_b = Q(√(2·Eb/N0))',
    psk: `P_b ≈ (2/k)·Q(√(2k·Eb/N0)·sin(π/M)), k = ${k}`,
    qam: `P_b ≈ (4/k)(1 − 1/√M)·Q(√(3k·Eb/N0/(M − 1))), k = ${k}`,
    fsk: 'P_b = Q(√(Eb/N0))',
    fskNoncoherent: 'P_b = ½·exp(−Eb/N0 / 2)',
  };
  return {
    ber,
    steps: [
      step('commsEbN0', `Eb/N0 = 10^(${fmt(ebN0Db)}/10) = ${fmt(ebN0)}`),
      step(isApproximate(scheme) ? 'commsBerApprox' : 'commsBer', `${formula[scheme]} = ${ber.toExponential(4)}`),
    ],
  };
}

/** Converts Eb/N0 to the SNR in the bandwidth: SNR = Eb/N0 · Rb/B, in decibels. Es/N0 adds 10 log₁₀ k. */
export function snrFromEbN0(
  ebN0Db: number,
  bitRate: number,
  bandwidth: number,
  k: number,
): {
  snrDb: number;
  esN0Db: number;
  steps: Step[];
} {
  if (!(bitRate > 0) || !(bandwidth > 0)) throw new SignalError('bandwidth');
  if (!Number.isFinite(ebN0Db)) throw new SignalError('snr');
  const snrDb = ebN0Db + 10 * Math.log10(bitRate / bandwidth);
  const esN0Db = ebN0Db + 10 * Math.log10(k);
  return {
    snrDb,
    esN0Db,
    steps: [
      step(
        'commsSnr',
        `SNR = Eb/N0 + 10·log₁₀(Rb/B) = ${fmt(ebN0Db)} + ${fmt(10 * Math.log10(bitRate / bandwidth))} = ${fmt(snrDb)} dB`,
      ),
      step('commsEsN0', `Es/N0 = Eb/N0 + 10·log₁₀(${k}) = ${fmt(esN0Db)} dB`),
    ],
  };
}

export interface Constellation {
  /** The ideal points, scaled to an average symbol energy of 1. */
  points: { i: number; q: number; label: string }[];
  /** Received points with noise at the chosen Eb/N0. */
  noisy: { i: number[]; q: number[] };
  /** The share of noisy symbols closer to another point (a measured symbol error rate). */
  symbolErrors: number;
}

function gray(value: number): number {
  return value ^ (value >> 1);
}

/** The ideal points of a scheme, Gray labeled, with unit average energy. FSK shows its two orthogonal tones. */
export function constellationPoints(scheme: Scheme, order: number): { i: number; q: number; label: string }[] {
  const k = bitsPerSymbol(scheme, order);
  const label = (v: number) => v.toString(2).padStart(k, '0');
  if (scheme === 'bpsk')
    return [
      { i: -1, q: 0, label: '0' },
      { i: 1, q: 0, label: '1' },
    ];
  if (scheme === 'fsk' || scheme === 'fskNoncoherent')
    return [
      { i: 1, q: 0, label: '0' },
      { i: 0, q: 1, label: '1' },
    ];
  if (scheme === 'qpsk' || scheme === 'psk') {
    const m = scheme === 'qpsk' ? 4 : order;
    const offset = scheme === 'qpsk' ? Math.PI / 4 : 0;
    return Array.from({ length: m }, (_, n) => ({
      i: Math.cos(offset + (2 * Math.PI * n) / m),
      q: Math.sin(offset + (2 * Math.PI * n) / m),
      label: label(gray(n)),
    }));
  }
  const side = Math.sqrt(order);
  const levels = Array.from({ length: side }, (_, n) => 2 * n - side + 1);
  // Average energy of square M-QAM with levels ±1, ±3, …: 2(M − 1)/3.
  const scale = 1 / Math.sqrt((2 * (order - 1)) / 3);
  const half = Math.log2(side);
  const points: { i: number; q: number; label: string }[] = [];
  levels.forEach((li, a) =>
    levels.forEach((lq, b) =>
      points.push({
        i: li * scale,
        q: lq * scale,
        label: gray(a).toString(2).padStart(half, '0') + gray(b).toString(2).padStart(half, '0'),
      }),
    ),
  );
  return points;
}

/** Sends random symbols through AWGN at Eb/N0 (dB) with a seed, so the scatter is the same each time. */
export function constellation(scheme: Scheme, order: number, ebN0Db: number, count = 600, seed = 7): Constellation {
  if (!Number.isFinite(ebN0Db) || ebN0Db < -10 || ebN0Db > 40) throw new SignalError('ebN0Range');
  const points = constellationPoints(scheme, order);
  const k = bitsPerSymbol(scheme, order);
  // Es = 1, so N0 = 1/(k Eb/N0) and each of I and Q gets variance N0/2.
  const sigma = Math.sqrt(1 / (2 * k * fromDb(ebN0Db)));
  const random = seededRandom(seed);
  const normal = gaussian(random);
  const i: number[] = [];
  const q: number[] = [];
  let errors = 0;
  for (let n = 0; n < count; n += 1) {
    const sent = Math.floor(random() * points.length);
    const p = points[sent]!;
    const ri = p.i + sigma * normal();
    const rq = p.q + sigma * normal();
    i.push(ri);
    q.push(rq);
    let best = 0;
    let bestDistance = Infinity;
    points.forEach((one, m) => {
      const d = (one.i - ri) ** 2 + (one.q - rq) ** 2;
      if (d < bestDistance) [best, bestDistance] = [m, d];
    });
    if (best !== sent) errors += 1;
  }
  return { points, noisy: { i, q }, symbolErrors: errors / count };
}

/** The raised-cosine pulse at time t (in symbol periods) with roll-off beta. */
export function raisedCosine(t: number, beta: number): number {
  if (Math.abs(t) < 1e-12) return 1;
  const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
  const denominator = 1 - (2 * beta * t) ** 2;
  // At t = ±1/(2β) both parts vanish; the limit is (π/4)·sinc(1/(2β)).
  if (Math.abs(denominator) < 1e-10) return (Math.PI / 4) * sinc;
  return (sinc * Math.cos(Math.PI * beta * t)) / denominator;
}

/**
 * An eye diagram of random bipolar symbols shaped by raised-cosine pulses: two-symbol traces, one after another,
 * separated by NaN so a plot draws each trace on its own. Returns the opening at the sampling instant.
 */
export function eyeDiagram(
  beta: number,
  noise = 0,
  symbols = 80,
  perSymbol = 32,
  seed = 3,
): {
  x: number[];
  y: number[];
  opening: number;
} {
  if (!(beta >= 0 && beta <= 1)) throw new SignalError('rolloff');
  if (!(noise >= 0 && noise <= 1)) throw new SignalError('noiseLevel');
  const random = seededRandom(seed);
  const normal = gaussian(random);
  const data = Array.from({ length: symbols }, () => (random() < 0.5 ? -1 : 1));
  const span = 8;
  const value = (time: number) => {
    let total = 0;
    const centre = Math.round(time);
    for (let n = Math.max(0, centre - span); n <= Math.min(symbols - 1, centre + span); n += 1) {
      total += data[n]! * raisedCosine(time - n, beta);
    }
    return total;
  };
  const x: number[] = [];
  const y: number[] = [];
  let low = Infinity;
  let high = -Infinity;
  for (let start = span; start < symbols - span - 2; start += 1) {
    for (let j = 0; j <= 2 * perSymbol; j += 1) {
      const time = start + j / perSymbol;
      const v = value(time) + noise * normal() * 0.2;
      x.push(j / perSymbol - 1);
      y.push(v);
      if (j === perSymbol) {
        if (v > 0) low = Math.min(low, v);
        else high = Math.max(high, v);
      }
    }
    x.push(Number.NaN);
    y.push(Number.NaN);
  }
  return { x, y, opening: Math.max(0, (low - high) / 2) };
}
