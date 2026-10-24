// Pairwise alignment by dynamic programming: Needleman-Wunsch (global), Smith-Waterman (local) and semi-global
// (free end gaps), with a linear gap score or affine gaps by Gotoh's three matrices. Gap scores are negative numbers
// added to the score. Ties are broken diagonal first, then up (a gap in the second sequence), then left.
import { fail } from '../shared';

export type Scorer = (a: string, b: string) => number;
export type AlignMode = 'global' | 'local' | 'semi';

export interface Gaps {
  /** Score of the first position of a gap. */
  open: number;
  /** Score of each further position; equal to `open` for linear gaps. */
  extend: number;
}

export const DIAG = 1;
export const UP = 2;
export const LEFT = 4;

export interface Alignment {
  score: number;
  top: string;
  bottom: string;
  /** Matrix cells on the traceback, from its first cell to its last. */
  path: [number, number][];
  /** The best score in each cell: F for linear gaps, the best of M, X, and Y for affine gaps. */
  matrix: number[][];
  /** For linear gaps, each cell's arrows as DIAG | UP | LEFT bits, with every tie kept. */
  arrows?: number[][];
  /** 1-based first and last aligned positions in each sequence. */
  span: { a: [number, number]; b: [number, number] };
}

export const MAX_CELLS = 4_000_000;
const EPS = 1e-9;
const same = (x: number, y: number) => Math.abs(x - y) < EPS;

function checkSize(a: string, b: string): void {
  if (a.length === 0 || b.length === 0) fail('align.e.empty');
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) fail('align.e.tooBig', { cells: String(MAX_CELLS) });
}

function bestCell(f: number[][], mode: AlignMode): [number, number] {
  const n = f.length - 1;
  const m = f[0]!.length - 1;
  if (mode === 'global') return [n, m];
  let best: [number, number] = [n, m];
  const consider = (i: number, j: number) => {
    if (f[i]![j]! > f[best[0]]![best[1]]! + EPS) best = [i, j];
  };
  if (mode === 'local') {
    best = [0, 0];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) consider(i, j);
  } else {
    for (let j = 0; j <= m; j++) consider(n, j);
    for (let i = 0; i <= n; i++) consider(i, m);
  }
  return best;
}

/** Adds the free end gaps of a semi-global alignment before and after the traced part. */
function endGaps(
  a: string,
  b: string,
  start: [number, number],
  end: [number, number],
  core: { top: string; bottom: string },
) {
  const lead = { top: a.slice(0, start[0]), bottom: b.slice(0, start[1]) };
  const tail = { top: a.slice(end[0]), bottom: b.slice(end[1]) };
  const pad = (x: string, y: string) => [
    x.padStart(Math.max(x.length, y.length), '-'),
    y.padStart(Math.max(x.length, y.length), '-'),
  ];
  const padEnd = (x: string, y: string) => [
    x.padEnd(Math.max(x.length, y.length), '-'),
    y.padEnd(Math.max(x.length, y.length), '-'),
  ];
  const [lt, lb] = pad(lead.top, lead.bottom);
  const [tt, tb] = padEnd(tail.top, tail.bottom);
  return { top: lt! + core.top + tt!, bottom: lb! + core.bottom + tb! };
}

function linearMatrix(a: string, b: string, s: Scorer, g: number, mode: AlignMode) {
  const n = a.length;
  const m = b.length;
  const f = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const arrows = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) [f[i]![0], arrows[i]![0]] = [mode === 'global' ? i * g : 0, mode === 'global' ? UP : 0];
  for (let j = 1; j <= m; j++)
    [f[0]![j], arrows[0]![j]] = [mode === 'global' ? j * g : 0, mode === 'global' ? LEFT : 0];
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = f[i - 1]![j - 1]! + s(a[i - 1]!, b[j - 1]!);
      const u = f[i - 1]![j]! + g;
      const l = f[i]![j - 1]! + g;
      let best = Math.max(d, u, l);
      if (mode === 'local' && best <= 0) best = 0;
      f[i]![j] = best;
      if (mode === 'local' && best === 0) continue;
      arrows[i]![j] = (same(d, best) ? DIAG : 0) | (same(u, best) ? UP : 0) | (same(l, best) ? LEFT : 0);
    }
  }
  return { f, arrows };
}

/** Alignment with a linear gap score `g` per gap position, keeping the full matrix, and its arrows. */
export function alignLinear(a: string, b: string, s: Scorer, g: number, mode: AlignMode): Alignment {
  checkSize(a, b);
  const { f, arrows } = linearMatrix(a, b, s, g, mode);
  const end = bestCell(f, mode);
  let [i, j] = end;
  let top = '';
  let bottom = '';
  const path: [number, number][] = [[i, j]];
  while (i > 0 || j > 0) {
    if (mode === 'local' && f[i]![j]! <= 0) break;
    if (mode === 'semi' && (i === 0 || j === 0)) break;
    const arrow = arrows[i]![j]!;
    if (arrow & DIAG) [top, bottom, i, j] = [a[i - 1] + top, b[j - 1] + bottom, i - 1, j - 1];
    else if (arrow & UP) [top, bottom, i] = [a[i - 1] + top, '-' + bottom, i - 1];
    else if (arrow & LEFT) [top, bottom, j] = ['-' + top, b[j - 1] + bottom, j - 1];
    else break;
    path.unshift([i, j]);
  }
  if (mode === 'local' && path.length > 1) path.shift();
  const core = { top, bottom };
  const full = mode === 'semi' ? endGaps(a, b, [i, j], end, core) : core;
  return { score: f[end[0]]![end[1]]!, ...full, path, matrix: f, arrows, span: spanOf([i, j], end) };
}

const spanOf = (start: [number, number], end: [number, number]): Alignment['span'] => ({
  a: [start[0] + 1, end[0]],
  b: [start[1] + 1, end[1]],
});

type State = 0 | 1 | 2;

function gotohMatrices(a: string, b: string, s: Scorer, gaps: Gaps, mode: AlignMode) {
  const n = a.length;
  const m = b.length;
  const NEG = -Infinity;
  const grid = (fill: number) => Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(fill));
  const M = grid(NEG);
  const X = grid(NEG);
  const Y = grid(NEG);
  M[0]![0] = 0;
  for (let i = 1; i <= n; i++) {
    if (mode === 'global') X[i]![0] = gaps.open + (i - 1) * gaps.extend;
    else M[i]![0] = 0;
  }
  for (let j = 1; j <= m; j++) {
    if (mode === 'global') Y[0]![j] = gaps.open + (j - 1) * gaps.extend;
    else M[0]![j] = 0;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const before = Math.max(M[i - 1]![j - 1]!, X[i - 1]![j - 1]!, Y[i - 1]![j - 1]!);
      M[i]![j] = before + s(a[i - 1]!, b[j - 1]!);
      if (mode === 'local') M[i]![j] = Math.max(0, M[i]![j]!);
      X[i]![j] = Math.max(M[i - 1]![j]! + gaps.open, X[i - 1]![j]! + gaps.extend, Y[i - 1]![j]! + gaps.open);
      Y[i]![j] = Math.max(M[i]![j - 1]! + gaps.open, Y[i]![j - 1]! + gaps.extend, X[i]![j - 1]! + gaps.open);
    }
  }
  return { M, X, Y };
}

/** Alignment with affine gaps: a gap of length k scores open + (k - 1) x extend. */
export function alignAffine(a: string, b: string, s: Scorer, gaps: Gaps, mode: AlignMode): Alignment {
  checkSize(a, b);
  const { M, X, Y } = gotohMatrices(a, b, s, gaps, mode);
  const best = M.map((row, i) => row.map((v, j) => Math.max(v, X[i]![j]!, Y[i]![j]!)));
  const end = bestCell(best, mode);
  let [i, j] = end;
  const at = (st: State, p: number, q: number) => [M, X, Y][st]![p]![q]!;
  let state: State = same(M[i]![j]!, best[i]![j]!) ? 0 : same(X[i]![j]!, best[i]![j]!) ? 1 : 2;
  let top = '';
  let bottom = '';
  const path: [number, number][] = [[i, j]];
  while (i > 0 || j > 0) {
    if (mode === 'semi' && (i === 0 || j === 0)) break;
    if (mode === 'local' && state === 0 && M[i]![j]! <= 0) break;
    const value = at(state, i, j);
    if (state === 0) {
      const prev = value - s(a[i - 1]!, b[j - 1]!);
      [top, bottom, i, j] = [a[i - 1] + top, b[j - 1] + bottom, i - 1, j - 1];
      state = same(M[i]![j]!, prev) ? 0 : same(X[i]![j]!, prev) ? 1 : 2;
    } else if (state === 1) {
      [top, bottom, i] = [a[i - 1] + top, '-' + bottom, i - 1];
      state = same(M[i]![j]! + gaps.open, value) ? 0 : same(X[i]![j]! + gaps.extend, value) ? 1 : 2;
    } else {
      [top, bottom, j] = ['-' + top, b[j - 1] + bottom, j - 1];
      state = same(M[i]![j]! + gaps.open, value) ? 0 : same(Y[i]![j]! + gaps.extend, value) ? 2 : 1;
    }
    path.unshift([i, j]);
  }
  if (mode === 'local' && path.length > 1) path.shift();
  const core = { top, bottom };
  const full = mode === 'semi' ? endGaps(a, b, [i, j], end, core) : core;
  return { score: best[end[0]]![end[1]]!, ...full, path, matrix: best, span: spanOf([i, j], end) };
}

export interface AlignStats {
  length: number;
  identical: number;
  similar: number;
  gaps: number;
}

/** Identity, similarity (columns with a positive score) and gap columns of an alignment. */
export function stats(top: string, bottom: string, s: Scorer): AlignStats {
  let identical = 0;
  let similar = 0;
  let gaps = 0;
  for (let k = 0; k < top.length; k++) {
    const x = top[k]!;
    const y = bottom[k]!;
    if (x === '-' || y === '-') gaps += 1;
    else {
      if (x === y) identical += 1;
      if (s(x, y) > 0) similar += 1;
    }
  }
  return { length: top.length, identical, similar, gaps };
}

/** The match line under an alignment: | identical, : positive score, space otherwise. */
export const matchLine = (top: string, bottom: string, s: Scorer): string =>
  [...top]
    .map((x, k) => {
      const y = bottom[k]!;
      if (x === '-' || y === '-') return ' ';
      return x === y ? '|' : s(x, y) > 0 ? ':' : ' ';
    })
    .join('');

/** Window starts (0-based) where at least `threshold` of `window` letters agree, for a dot plot. */
export function dotPlot(a: string, b: string, window: number, threshold: number): [number, number][] {
  if (a.length * b.length > 1_000_000) return fail('align.e.dotTooBig');
  const dots: [number, number][] = [];
  for (let i = 0; i + window <= a.length; i++) {
    for (let j = 0; j + window <= b.length; j++) {
      let hits = 0;
      for (let k = 0; k < window; k++) if (a[i + k] === b[j + k]) hits += 1;
      if (hits >= threshold) dots.push([i, j]);
    }
  }
  return dots;
}

/** Simple DNA scores: match and mismatch, or match, transition (A-G, C-T) and transversion. */
export function dnaScorer(match: number, mismatch: number, transversion?: number): Scorer {
  const purine = (x: string) => x === 'A' || x === 'G';
  return (x, y) => {
    if (x === y) return match;
    if (transversion === undefined) return mismatch;
    const pyrimidine = (z: string) => z === 'C' || z === 'T' || z === 'U';
    const transition = (purine(x) && purine(y)) || (pyrimidine(x) && pyrimidine(y));
    return transition ? mismatch : transversion;
  };
}
