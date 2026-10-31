// Dynamic programming that keeps the whole table for display. It covers edit distance with an alignment, longest
// common subsequence, and 0/1 knapsack with the items chosen. Also coin change (fewest coins and number of ways),
// matrix-chain order with its parenthesization, and the forward and Viterbi algorithms for a hidden Markov model.
import { fail } from '../core/util';

export const MAX_DP = 400;

export function editDistance(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  if (x.length > MAX_DP || y.length > MAX_DP) fail('dpLong', { max: MAX_DP });
  const d = Array.from({ length: x.length + 1 }, (_, i) =>
    Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= x.length; i += 1)
    for (let j = 1; j <= y.length; j += 1)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  const ops: string[] = [];
  for (let i = x.length, j = y.length; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)) {
      ops.unshift(x[i - 1] === y[j - 1] ? `=${x[i - 1]}` : `~${x[i - 1]}${y[j - 1]}`);
      i -= 1;
      j -= 1;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.unshift(`-${x[i - 1]}`);
      i -= 1;
    } else {
      ops.unshift(`+${y[j - 1]}`);
      j -= 1;
    }
  }
  return { distance: d[x.length][y.length], table: d, ops };
}

export function lcs(a: string, b: string) {
  const x = [...a];
  const y = [...b];
  if (x.length > MAX_DP || y.length > MAX_DP) fail('dpLong', { max: MAX_DP });
  const c = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i += 1)
    for (let j = 1; j <= y.length; j += 1)
      c[i][j] = x[i - 1] === y[j - 1] ? c[i - 1][j - 1] + 1 : Math.max(c[i - 1][j], c[i][j - 1]);
  const out: string[] = [];
  for (let i = x.length, j = y.length; i > 0 && j > 0;)
    if (x[i - 1] === y[j - 1]) {
      out.unshift(x[i - 1]);
      i -= 1;
      j -= 1;
    } else if (c[i - 1][j] >= c[i][j - 1]) i -= 1;
    else j -= 1;
  return { length: c[x.length][y.length], table: c, sequence: out.join('') };
}

export function knapsack(weights: readonly number[], values: readonly number[], capacity: number) {
  if (weights.length !== values.length) fail('sameLength');
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 10_000) fail('capacity', { max: 10_000 });
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) fail('wholeWeights');
  const n = weights.length;
  const t = Array.from({ length: n + 1 }, () => new Array<number>(capacity + 1).fill(0));
  for (let i = 1; i <= n; i += 1)
    for (let c = 0; c <= capacity; c += 1)
      t[i][c] = Math.max(t[i - 1][c], weights[i - 1] <= c ? t[i - 1][c - weights[i - 1]] + values[i - 1] : -Infinity);
  const chosen: number[] = [];
  for (let i = n, c = capacity; i > 0; i -= 1)
    if (t[i][c] !== t[i - 1][c]) {
      chosen.unshift(i - 1);
      c -= weights[i - 1];
    }
  return { best: t[n][capacity], table: t, chosen };
}

export function coinChange(coins: readonly number[], amount: number) {
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000) fail('amount', { max: 100_000 });
  if (!coins.length || coins.some((c) => !Number.isInteger(c) || c <= 0)) fail('coins');
  const fewest = new Array<number>(amount + 1).fill(Infinity);
  const last = new Array<number>(amount + 1).fill(-1);
  const ways = new Array<number>(amount + 1).fill(0);
  fewest[0] = 0;
  ways[0] = 1;
  for (const c of coins) for (let x = c; x <= amount; x += 1) ways[x] += ways[x - c];
  for (let x = 1; x <= amount; x += 1)
    for (const c of coins)
      if (c <= x && fewest[x - c] + 1 < fewest[x]) {
        fewest[x] = fewest[x - c] + 1;
        last[x] = c;
      }
  const used: number[] = [];
  if (fewest[amount] < Infinity) for (let x = amount; x > 0; x -= last[x]) used.push(last[x]);
  return { fewest: fewest[amount], used, ways: ways[amount], table: fewest, waysTable: ways };
}

export function matrixChain(dims: readonly number[]) {
  const n = dims.length - 1;
  if (n < 1) fail('dims');
  if (n > 60) fail('dpLong', { max: 60 });
  if (dims.some((d) => !Number.isInteger(d) || d <= 0)) fail('dims');
  const m = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const s = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let len = 2; len <= n; len += 1)
    for (let i = 0; i + len - 1 < n; i += 1) {
      const j = i + len - 1;
      m[i][j] = Infinity;
      for (let k = i; k < j; k += 1) {
        const cost = m[i][k] + m[k + 1][j] + dims[i] * dims[k + 1] * dims[j + 1];
        if (cost < m[i][j]) {
          m[i][j] = cost;
          s[i][j] = k;
        }
      }
    }
  const paren = (i: number, j: number): string =>
    i === j ? `A${i + 1}` : `(${paren(i, s[i][j])}${paren(s[i][j] + 1, j)})`;
  return { cost: m[0][n - 1], m, s, order: paren(0, n - 1) };
}

export interface Hmm {
  states: string[];
  symbols: string[];
  start: number[];
  trans: number[][];
  emit: number[][];
}

export function checkHmm(h: Hmm): void {
  const n = h.states.length;
  if (h.start.length !== n || h.trans.length !== n || h.emit.length !== n) fail('hmmShape');
  if (h.trans.some((r) => r.length !== n) || h.emit.some((r) => r.length !== h.symbols.length)) fail('hmmShape');
  const rows = [h.start, ...h.trans, ...h.emit];
  if (rows.some((r) => r.some((p) => p < 0) || Math.abs(r.reduce((a, b) => a + b, 0) - 1) > 1e-6)) fail('hmmRows');
}

/** The forward probabilities, the sequence's probability, and the Viterbi path with its probability. */
export function hmm(h: Hmm, obs: readonly string[]) {
  checkHmm(h);
  if (!obs.length) fail('noObservations');
  const idx = obs.map((o) => {
    const i = h.symbols.indexOf(o);
    return i < 0 ? fail('unknownSymbol', { symbol: o }) : i;
  });
  const n = h.states.length;
  const alpha: number[][] = [h.start.map((p, i) => p * h.emit[i][idx[0]])];
  const delta: number[][] = [alpha[0].slice()];
  const back: number[][] = [new Array<number>(n).fill(-1)];
  for (let t = 1; t < idx.length; t += 1) {
    alpha.push(h.states.map((_, j) => alpha[t - 1].reduce((a, p, i) => a + p * h.trans[i][j], 0) * h.emit[j][idx[t]]));
    const row: number[] = [];
    const b: number[] = [];
    for (let j = 0; j < n; j += 1) {
      let best = -1;
      let arg = 0;
      for (let i = 0; i < n; i += 1) {
        const v = delta[t - 1][i] * h.trans[i][j];
        if (v > best) {
          best = v;
          arg = i;
        }
      }
      row.push(best * h.emit[j][idx[t]]);
      b.push(arg);
    }
    delta.push(row);
    back.push(b);
  }
  const last = delta[delta.length - 1];
  let k = last.indexOf(Math.max(...last));
  const path = [k];
  for (let t = idx.length - 1; t > 0; t -= 1) path.unshift((k = back[t][k]));
  return {
    alpha,
    delta,
    probability: alpha[alpha.length - 1].reduce((a, b) => a + b, 0),
    path: path.map((i) => h.states[i]),
    pathProbability: Math.max(...last),
  };
}
