// Source and channel codes: Huffman, Shannon-Fano, and LZ78 for sources; Hamming (7,4), linear block codes, CRCs, and
// rate-1/2 convolutional codes with Viterbi decoding for channels. Bits are arrays of 0 and 1. Pure: no DOM.
import { SignalError } from '../shared/errors';
import { fmt } from '../shared/num';
import { step, type Step } from '../shared/steps';
import { checkProbabilities, entropy } from './info';

export type Bit = 0 | 1;
export const bitsText = (bits: readonly number[]): string => bits.join('');

/** Reads a string of 0s and 1s (spaces and commas allowed). */
export function readBits(text: string): Bit[] {
  const clean = text.replace(/[\s,]/g, '');
  if (!/^[01]*$/.test(clean)) throw new SignalError('notBits');
  return [...clean].map((c) => (c === '1' ? 1 : 0));
}

export interface HuffmanNode {
  id: number;
  p: number;
  symbol?: number;
  children?: [HuffmanNode, HuffmanNode];
}

export interface SourceCode {
  codes: string[];
  average: number;
  entropy: number;
  efficiency: number;
  /** The tree, for drawing; Shannon-Fano codes have none. */
  root?: HuffmanNode;
  steps: Step[];
}

function summary(p: readonly number[], codes: string[], steps: Step[], root?: HuffmanNode): SourceCode {
  const average = p.reduce((a, pi, i) => a + pi * codes[i]!.length, 0);
  const h = entropy(p).bits;
  const efficiency = average > 0 ? h / average : 1;
  steps.push(
    step('commsAverage', `L = Σ p·ℓ = ${fmt(average)} bits per symbol; H = ${fmt(h)}; η = H/L = ${fmt(efficiency)}`),
  );
  return { codes, average, entropy: h, efficiency, ...(root ? { root } : {}), steps };
}

/**
 * Binary Huffman code. The two least probable nodes merge each round; ties go to the node made first (symbols in
 * the order given, then merged nodes in the order they were made). The lower-probability node gets bit 0.
 */
export function huffman(p: readonly number[]): SourceCode {
  const probabilities = checkProbabilities(p);
  let next = 0;
  let pool: HuffmanNode[] = probabilities.map((pi, symbol) => ({ id: next++, p: pi, symbol }));
  const steps: Step[] = [step('commsHuffmanTies')];
  if (pool.length === 1) return summary(probabilities, ['0'], steps, pool[0]);
  while (pool.length > 1) {
    pool = [...pool].sort((a, b) => a.p - b.p || a.id - b.id);
    const [a, b] = [pool[0]!, pool[1]!];
    const merged: HuffmanNode = { id: next++, p: a.p + b.p, children: [a, b] };
    steps.push(step('commsHuffmanMerge', `${fmt(a.p)} + ${fmt(b.p)} = ${fmt(merged.p)}`));
    pool = [...pool.slice(2), merged];
  }
  const root = pool[0]!;
  const codes = Array<string>(probabilities.length).fill('');
  const walk = (node: HuffmanNode, prefix: string) => {
    if (node.children) {
      walk(node.children[0], `${prefix}0`);
      walk(node.children[1], `${prefix}1`);
    } else codes[node.symbol!] = prefix;
  };
  walk(root, '');
  return summary(probabilities, codes, steps, root);
}

/** Shannon-Fano: sort by probability, split where the two halves' totals are closest, and recurse. */
export function shannonFano(p: readonly number[]): SourceCode {
  const probabilities = checkProbabilities(p);
  const order = probabilities.map((_, i) => i).sort((a, b) => probabilities[b]! - probabilities[a]! || a - b);
  const codes = Array<string>(probabilities.length).fill('');
  const steps: Step[] = [step('commsShannonFano')];
  const split = (group: number[]) => {
    if (group.length < 2) return;
    const total = group.reduce((a, i) => a + probabilities[i]!, 0);
    let running = 0;
    let best = 1;
    let bestGap = Infinity;
    for (let k = 1; k < group.length; k += 1) {
      running += probabilities[group[k - 1]!]!;
      const gap = Math.abs(total - 2 * running);
      if (gap < bestGap - 1e-12) [best, bestGap] = [k, gap];
    }
    const left = group.slice(0, best);
    const right = group.slice(best);
    left.forEach((i) => (codes[i] += '0'));
    right.forEach((i) => (codes[i] += '1'));
    split(left);
    split(right);
  };
  if (order.length === 1) codes[0] = '0';
  split(order);
  return summary(probabilities, codes, steps);
}

export interface Lz78Phrase {
  index: number;
  prefix: number;
  next: string;
  phrase: string;
}

/** LZ78 parsing: each phrase is the longest phrase seen before plus one new character. */
export function lz78(text: string): Lz78Phrase[] {
  if (!text.length) throw new SignalError('emptyText');
  const dictionary = new Map<string, number>();
  const phrases: Lz78Phrase[] = [];
  let current = '';
  const chars = [...text];
  chars.forEach((c, i) => {
    const grown = current + c;
    const last = i === chars.length - 1;
    if (dictionary.has(grown) && !last) {
      current = grown;
      return;
    }
    // At the end of the text a known phrase is sent as its prefix plus the last character.
    phrases.push({ index: phrases.length + 1, prefix: dictionary.get(current) ?? 0, next: c, phrase: grown });
    if (!dictionary.has(grown)) dictionary.set(grown, phrases.length);
    current = '';
  });
  return phrases;
}

// Hamming (7,4) in the order p1 p2 d1 p3 d2 d3 d4: parity bit 2^k covers the positions whose index has bit k set.
export function hammingEncode(data: readonly Bit[]): { codeword: Bit[]; steps: Step[] } {
  if (data.length !== 4) throw new SignalError('dataLength', { count: 4 });
  const [d1, d2, d3, d4] = data as [Bit, Bit, Bit, Bit];
  const p1 = (d1 ^ d2 ^ d4) as Bit;
  const p2 = (d1 ^ d3 ^ d4) as Bit;
  const p3 = (d2 ^ d3 ^ d4) as Bit;
  const codeword: Bit[] = [p1, p2, d1, p3, d2, d3, d4];
  return {
    codeword,
    steps: [
      step('commsHammingOrder'),
      step('commsHammingParity', `p1 = d1⊕d2⊕d4 = ${p1}; p2 = d1⊕d3⊕d4 = ${p2}; p3 = d2⊕d3⊕d4 = ${p3}`),
      step('commsHammingWord', `c = ${bitsText(codeword)}`),
    ],
  };
}

export function hammingDecode(received: readonly Bit[]): {
  syndrome: Bit[];
  position: number;
  corrected: Bit[];
  data: Bit[];
  steps: Step[];
} {
  if (received.length !== 7) throw new SignalError('dataLength', { count: 7 });
  const r = received;
  const s1 = (r[0]! ^ r[2]! ^ r[4]! ^ r[6]!) as Bit;
  const s2 = (r[1]! ^ r[2]! ^ r[5]! ^ r[6]!) as Bit;
  const s3 = (r[3]! ^ r[4]! ^ r[5]! ^ r[6]!) as Bit;
  const position = s1 + 2 * s2 + 4 * s3;
  const corrected = [...r];
  if (position) corrected[position - 1] = (1 - corrected[position - 1]!) as Bit;
  const data: Bit[] = [corrected[2]!, corrected[4]!, corrected[5]!, corrected[6]!];
  return {
    syndrome: [s3, s2, s1],
    position,
    corrected,
    data,
    steps: [
      step('commsSyndrome', `s3 s2 s1 = ${s3}${s2}${s1}`, { position }),
      step(position ? 'commsCorrect' : 'commsNoError', `c = ${bitsText(corrected)}; data = ${bitsText(data)}`, {
        position,
      }),
    ],
  };
}

export interface LinearCode {
  n: number;
  k: number;
  codewords: Bit[][];
  dMin: number;
  detects: number;
  corrects: number;
  /** The coset leaders (the standard array's first column), for codes up to length 10. */
  leaders: Bit[][] | null;
  steps: Step[];
}

/** A linear block code from its generator matrix G (k rows of n bits): every codeword, d_min, and the coset leaders. */
export function linearCode(g: readonly (readonly Bit[])[]): LinearCode {
  const k = g.length;
  if (!k) throw new SignalError('empty');
  const n = g[0]!.length;
  if (g.some((row) => row.length !== n)) throw new SignalError('ragged');
  if (k > 12 || n > 24 || k > n) throw new SignalError('codeSize');
  const toInt = (bits: readonly Bit[]) => bits.reduce<number>((a, b) => a * 2 + b, 0);
  const toBits = (value: number): Bit[] => Array.from({ length: n }, (_, i) => ((value >> (n - 1 - i)) & 1) as Bit);
  const weight = (value: number) => {
    let w = 0;
    for (let v = value; v; v &= v - 1) w += 1;
    return w;
  };
  const rows = g.map(toInt);
  const words = new Set<number>();
  for (let m = 0; m < 2 ** k; m += 1) {
    let c = 0;
    for (let i = 0; i < k; i += 1) if ((m >> (k - 1 - i)) & 1) c ^= rows[i]!;
    words.add(c);
  }
  if (words.size !== 2 ** k) throw new SignalError('dependentRows');
  const dMin = Math.min(...[...words].filter((c) => c !== 0).map(weight));
  let leaders: Bit[][] | null = null;
  if (n <= 10) {
    // The coset of e is e + C; its leader is its lightest member, the first one met when vectors go by weight.
    const seen = new Set<number>();
    const byWeight = Array.from({ length: 2 ** n }, (_, v) => v).sort((a, b) => weight(a) - weight(b) || a - b);
    leaders = [];
    for (const e of byWeight) {
      if (seen.has(e)) continue;
      for (const c of words) seen.add(e ^ c);
      leaders.push(toBits(e));
    }
  }
  const corrects = Math.floor((dMin - 1) / 2);
  return {
    n,
    k,
    codewords: [...words].sort((a, b) => a - b).map(toBits),
    dMin,
    detects: dMin - 1,
    corrects,
    leaders,
    steps: [
      step('commsCodewords', `2^${k} = ${2 ** k}`, { k, n }),
      step('commsDmin', `d_min = ${dMin}; t = ⌊(d_min − 1)/2⌋ = ${corrects}`, { detect: dMin - 1, correct: corrects }),
    ],
  };
}

export interface CrcPreset {
  readonly width: number;
  readonly poly: number;
  readonly init: number;
  readonly reflect: boolean;
  readonly xorOut: number;
}

/** Parameters from the CRC catalog by Greg Cook (reveng.sourceforge.io); check values on "123456789". */
export const CRC_PRESETS = {
  crc8: { width: 8, poly: 0x07, init: 0x00, reflect: false, xorOut: 0x00 },
  crc16: { width: 16, poly: 0x1021, init: 0xffff, reflect: false, xorOut: 0x0000 },
  crc32: { width: 32, poly: 0x04c11db7, init: 0xffffffff, reflect: true, xorOut: 0xffffffff },
} as const satisfies Record<string, CrcPreset>;
export type CrcName = keyof typeof CRC_PRESETS;
export const CRC_NAMES = Object.keys(CRC_PRESETS) as CrcName[];

const reflectBits = (value: number, width: number): number => {
  let out = 0;
  for (let i = 0; i < width; i += 1) out = out * 2 + (Math.floor(value / 2 ** i) % 2);
  return out;
};

export const crcHex = (value: number, width: number): string =>
  `0x${value
    .toString(16)
    .toUpperCase()
    .padStart(Math.ceil(width / 4), '0')}`;

/**
 * A CRC of bytes, bit by bit through the register (no lookup table). Reflected presets reflect each byte going in
 * and the register coming out. Arithmetic stays in doubles below 2^33, so a 32-bit register is exact.
 */
export function crc(bytes: readonly number[], preset: CrcPreset): { value: number; rows: [string, string][] } {
  const { width, poly, init, reflect, xorOut } = preset;
  const top = 2 ** (width - 1);
  const xor = (a: number, b: number) => {
    // Bitwise XOR of two numbers below 2^32, done in two 16-bit halves so the sign bit never interferes.
    const high = (Math.floor(a / 65536) ^ Math.floor(b / 65536)) * 65536;
    return high + ((a % 65536) ^ (b % 65536));
  };
  let register = init;
  const rows: [string, string][] = [];
  for (const byte of bytes) {
    const b = reflect ? reflectBits(byte, 8) : byte;
    register = xor(register, b * 2 ** (width - 8));
    for (let i = 0; i < 8; i += 1) {
      const carry = register >= top;
      register = (register % top) * 2;
      if (carry) register = xor(register, poly);
    }
    rows.push([String.fromCharCode(byte), crcHex(register, width)]);
  }
  const out = reflect ? reflectBits(register, width) : register;
  return { value: xor(out, xorOut), rows };
}

/** Polynomial long division of message bits by a generator, as on paper: the remainder is the CRC. */
export function crcDivision(
  message: readonly Bit[],
  generator: readonly Bit[],
): {
  remainder: Bit[];
  transmitted: Bit[];
  rows: [string, string][];
  steps: Step[];
} {
  if (!message.length) throw new SignalError('emptyBits');
  if (generator.length < 2 || generator[0] !== 1) throw new SignalError('generator');
  const r = generator.length - 1;
  const work: Bit[] = [...message, ...Array<Bit>(r).fill(0)];
  const rows: [string, string][] = [];
  for (let i = 0; i < message.length; i += 1) {
    if (work[i] !== 1) continue;
    for (let j = 0; j < generator.length; j += 1) work[i + j] = (work[i + j]! ^ generator[j]!) as Bit;
    rows.push([String(i), bitsText(work)]);
  }
  const remainder = work.slice(message.length);
  return {
    remainder,
    transmitted: [...message, ...remainder],
    rows,
    steps: [
      step('commsCrcAppend', `${bitsText(message)}${'0'.repeat(r)}`, { count: r }),
      step('commsCrcDivide', `${bitsText(message)}${'0'.repeat(r)} ÷ ${bitsText(generator)}`),
      step('commsCrcRemainder', `${bitsText(message)} ${bitsText(remainder)}`, { remainder: bitsText(remainder) }),
    ],
  };
}

/** Reads a generator in octal, such as 7 or 133, as taps from the newest input bit to the oldest. */
export function octalTaps(text: string): Bit[] {
  const clean = text.trim();
  if (!/^[0-7]+$/.test(clean)) throw new SignalError('octal');
  const bits = [...clean].flatMap((digit) => {
    const v = Number(digit);
    return [((v >> 2) & 1) as Bit, ((v >> 1) & 1) as Bit, (v & 1) as Bit];
  });
  const first = bits.indexOf(1);
  return first < 0 ? [] : bits.slice(first);
}

export interface Convolutional {
  readonly g: readonly (readonly Bit[])[];
  readonly k: number;
}

/** A rate-1/2 code from two octal generators; the constraint length is the longer generator's (2 to 5). */
export function convolutionalCode(g1: string, g2: string): Convolutional {
  const a = octalTaps(g1);
  const b = octalTaps(g2);
  const k = Math.max(a.length, b.length);
  if (k < 2 || k > 5 || !a.length || !b.length) throw new SignalError('constraint');
  const pad = (taps: Bit[]): Bit[] => [...Array<Bit>(k - taps.length).fill(0), ...taps];
  return { g: [pad(a), pad(b)], k };
}

/** The output pair for input u from a state (the last k − 1 inputs, newest in the high bit). */
export function branch(code: Convolutional, state: number, u: Bit): { out: Bit[]; next: number } {
  const m = code.k - 1;
  const register: Bit[] = [u, ...Array.from({ length: m }, (_, i) => ((state >> (m - 1 - i)) & 1) as Bit)];
  const out = code.g.map((taps) => taps.reduce<number>((a, tap, i) => a ^ (tap & register[i]!), 0) as Bit);
  return { out, next: (u << (m - 1)) | (state >> 1) };
}

/** Encodes, then flushes with k − 1 zeros so the encoder ends in state 0. */
export function convEncode(
  code: Convolutional,
  input: readonly Bit[],
): { output: Bit[]; pairs: string[]; steps: Step[] } {
  if (!input.length) throw new SignalError('emptyBits');
  const bits: Bit[] = [...input, ...Array<Bit>(code.k - 1).fill(0)];
  let state = 0;
  const pairs: string[] = [];
  const output: Bit[] = [];
  for (const u of bits) {
    const { out, next } = branch(code, state, u);
    output.push(...out);
    pairs.push(bitsText(out));
    state = next;
  }
  return {
    output,
    pairs,
    steps: [
      step('commsConvFlush', `${bitsText(input)} ${'0'.repeat(code.k - 1)}`, { count: code.k - 1 }),
      step('commsConvOut', pairs.join(' ')),
    ],
  };
}

export interface ViterbiResult {
  decoded: Bit[];
  metric: number;
  /** Each state's path metric after each step; Infinity where no path reaches the state yet. */
  metrics: number[][];
  /** The states along the chosen path, from time 0. */
  path: number[];
  steps: Step[];
}

/** Hard-decision Viterbi: Hamming branch metrics, one survivor per state, traced back from state 0 (flushed). */
export function viterbi(code: Convolutional, received: readonly Bit[]): ViterbiResult {
  if (!received.length || received.length % 2) throw new SignalError('pairs');
  const states = 2 ** (code.k - 1);
  const T = received.length / 2;
  let metric = Array<number>(states).fill(Infinity);
  metric[0] = 0;
  const back: { from: number; u: Bit }[][] = [];
  const metrics: number[][] = [[...metric]];
  for (let t = 0; t < T; t += 1) {
    const r = received.slice(2 * t, 2 * t + 2);
    const next = Array<number>(states).fill(Infinity);
    const choice = Array.from({ length: states }, () => ({ from: -1, u: 0 as Bit }));
    for (let s = 0; s < states; s += 1) {
      if (!Number.isFinite(metric[s]!)) continue;
      for (const u of [0, 1] as Bit[]) {
        const { out, next: to } = branch(code, s, u);
        const cost = metric[s]! + (out[0] !== r[0] ? 1 : 0) + (out[1] !== r[1] ? 1 : 0);
        // A tie keeps the survivor from the lower state, so the answer does not depend on loop order.
        if (cost < next[to]!) {
          next[to] = cost;
          choice[to] = { from: s, u };
        }
      }
    }
    metric = next;
    back.push(choice);
    metrics.push([...metric]);
  }
  let state = 0;
  const errors = metric[0]!;
  const decoded: Bit[] = [];
  const path = [state];
  for (let t = T - 1; t >= 0; t -= 1) {
    const { from, u } = back[t]![state]!;
    decoded.unshift(u);
    state = from;
    path.unshift(state);
  }
  return {
    decoded,
    metric: errors,
    metrics,
    path,
    steps: [
      step('commsViterbiMetric', `${states} states × ${T} steps`, { states, steps: T }),
      step('commsViterbiTrace', `${bitsText(decoded)}`, { errors }),
    ],
  };
}
