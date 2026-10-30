// What the console's variables hold: real matrices (a number is a 1 by 1 matrix, text is a row of character codes)
// and function handles. Also indexing and indexed assignment, which grow or shrink a matrix the way MATLAB does.
import { KitError } from '../types';
import type { Expr } from './lang';

export interface M {
  kind: 'mat';
  r: number;
  c: number;
  /** Row-major entries. */
  d: number[];
  logical?: true;
  /** Set when the value is text, so it prints as text. */
  str?: string;
}

export interface Fn {
  kind: 'fn';
  params: string[];
  body: Expr;
  env: ReadonlyMap<string, Value>;
  src: string;
  /** The name of a built-in function a handle such as @sin points at. */
  builtin?: string;
}

export type Value = M | Fn;

export const MAX_ELEMENTS = 1_000_000;

export function mat(r: number, c: number, d: number[]): M {
  if (r * c > MAX_ELEMENTS) throw new KitError('mcTooBig', String(MAX_ELEMENTS));
  return { kind: 'mat', r, c, d };
}
export const scalar = (v: number): M => ({ kind: 'mat', r: 1, c: 1, d: [v] });
export const bool = (b: boolean): M => ({ kind: 'mat', r: 1, c: 1, d: [b ? 1 : 0], logical: true });
export const empty = (): M => ({ kind: 'mat', r: 0, c: 0, d: [] });
export const text = (s: string): M => ({
  kind: 'mat',
  r: s.length ? 1 : 0,
  c: s.length,
  d: Array.from(s, (ch) => ch.charCodeAt(0)),
  str: s,
});
export const rowVec = (d: number[]): M => mat(1, d.length, d);
export const colVec = (d: number[]): M => mat(d.length, 1, d);
export const fromRows = (rows: number[][]): M =>
  rows.length ? mat(rows.length, rows[0].length, rows.flat()) : empty();
export const toRows = (m: M): number[][] => Array.from({ length: m.r }, (_, i) => m.d.slice(i * m.c, (i + 1) * m.c));
export const numel = (m: M): number => m.r * m.c;
export const isScalar = (m: M): boolean => m.r === 1 && m.c === 1;

export function asMat(v: Value, what = 'value'): M {
  if (v.kind !== 'mat') throw new KitError('mcNeedNumber', what);
  return v;
}

/** The single number a value holds, for arguments such as a size. */
export function asNumber(v: Value, what: string): number {
  const m = asMat(v, what);
  if (!isScalar(m)) throw new KitError('mcNeedScalar', what);
  return m.d[0];
}

export function asInt(v: Value, what: string): number {
  const n = asNumber(v, what);
  if (!Number.isInteger(n)) throw new KitError('mcNeedInteger', what);
  return n;
}

/** Whether a condition is true: not empty and every entry nonzero. */
export function truthy(v: Value): boolean {
  const m = asMat(v, 'condition');
  return m.d.length > 0 && m.d.every((x) => x !== 0);
}

/** Entry k (counting from 1) in MATLAB's order: down the first column, then the next. */
export const at = (m: M, k: number): number => m.d[((k - 1) % m.r) * m.c + Math.floor((k - 1) / m.r)];

/** The entries in MATLAB's order, down the columns. */
export const columnMajor = (m: M): number[] => Array.from({ length: numel(m) }, (_, k) => at(m, k + 1));

export const sizeText = (v: Value): string => (v.kind === 'mat' ? `${v.r}x${v.c}` : '1x1');

// ---------------------------------------------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------------------------------------------

/** A subscript: every entry (the colon), or a list of positions counting from 1. */
export type Sub = { all: true } | { all?: false; list: number[]; shape: [number, number] };

export function toSub(v: Value | 'colon', limit: number): Sub {
  if (v === 'colon') return { all: true };
  const m = asMat(v, 'index');
  if (m.logical) {
    if (m.d.length > limit && m.d.slice(limit).some((x) => x !== 0)) throw new KitError('mcIndexRange', String(limit));
    const list: number[] = [];
    for (let j = 0; j < m.c; j++) for (let i = 0; i < m.r; i++) if (m.d[i * m.c + j] !== 0) list.push(j * m.r + i + 1);
    return { list, shape: m.r === 1 ? [1, list.length] : [list.length, 1] };
  }
  for (const x of m.d) {
    if (!Number.isInteger(x) || x < 1) throw new KitError('mcIndexPositive', String(x));
  }
  return { list: m.d.slice(), shape: [m.r, m.c] };
}

const positions = (s: Sub, n: number): number[] => (s.all ? Array.from({ length: n }, (_, i) => i + 1) : s.list);

/** A(index) with one subscript, or A(i, j) with two. */
export function indexValue(m: M, subs: Sub[]): M {
  if (subs.length === 1) {
    const s = subs[0];
    const list = positions(s, numel(m));
    for (const k of list) if (k > numel(m)) throw new KitError('mcIndexRange', `${k} > ${numel(m)}`);
    const d = list.map((k) => at(m, k));
    if (s.all) return mat(d.length, 1, d);
    // A vector indexed by a vector keeps its own orientation; otherwise the result takes the index's shape.
    if ((m.r === 1 || m.c === 1) && (s.shape[0] === 1 || s.shape[1] === 1) && numel(m) !== 1) {
      return m.r === 1 ? mat(1, d.length, d) : mat(d.length, 1, d);
    }
    return mat(s.shape[0], s.shape[1], d);
  }
  if (subs.length !== 2) throw new KitError('mcNotSupported', 'more than two subscripts');
  const rows = positions(subs[0], m.r);
  const cols = positions(subs[1], m.c);
  for (const i of rows) if (i > m.r) throw new KitError('mcIndexRange', `row ${i} > ${m.r}`);
  for (const j of cols) if (j > m.c) throw new KitError('mcIndexRange', `column ${j} > ${m.c}`);
  const d: number[] = [];
  for (const i of rows) for (const j of cols) d.push(m.d[(i - 1) * m.c + (j - 1)]);
  const out = mat(rows.length, cols.length, d);
  if (m.logical) out.logical = true;
  return out;
}

function grown(m: M, r: number, c: number): M {
  if (r <= m.r && c <= m.c) return { ...m, d: m.d.slice() };
  const out = mat(Math.max(r, m.r), Math.max(c, m.c), []);
  out.d = new Array<number>(out.r * out.c).fill(0);
  for (let i = 0; i < m.r; i++) for (let j = 0; j < m.c; j++) out.d[i * out.c + j] = m.d[i * m.c + j];
  return out;
}

/** The matrix with the rows or columns in the list taken out: A(2, :) = [] or A(3) = []. */
function deleteSub(m: M, subs: Sub[]): M {
  if (subs.length === 1) {
    const drop = new Set(positions(subs[0], numel(m)));
    const d = columnMajor(m).filter((_, i) => !drop.has(i + 1));
    if (m.c === 1) return mat(d.length, 1, d);
    return mat(1, d.length, d);
  }
  const [rs, cs] = subs;
  if (rs.all && !cs.all) {
    const drop = new Set(cs.list);
    const keep = Array.from({ length: m.c }, (_, j) => j + 1).filter((j) => !drop.has(j));
    return indexValue(m, [{ all: true }, { list: keep, shape: [1, keep.length] }]);
  }
  if (cs.all && !rs.all) {
    const drop = new Set(rs.list);
    const keep = Array.from({ length: m.r }, (_, i) => i + 1).filter((i) => !drop.has(i));
    return indexValue(m, [{ list: keep, shape: [1, keep.length] }, { all: true }]);
  }
  throw new KitError('mcNotSupported', 'deleting part of a row and a column');
}

/** A(subs) = rhs. An empty right side deletes. A scalar fills. The matrix grows to hold new positions. */
export function assignIndex(m: M, subs: Sub[], rhs: M): M {
  if (rhs.r === 0 && rhs.c === 0 && !rhs.str) return deleteSub(m, subs);
  if (subs.length === 1) {
    const list = positions(subs[0], numel(m));
    if (!isScalar(rhs) && numel(rhs) !== list.length) throw new KitError('mcAssignCount', `${list.length}`);
    const need = Math.max(0, ...list);
    let out = m;
    if (need > numel(m)) {
      if (numel(m) === 0 || m.r === 1) out = grown(m, 1, need);
      else if (m.c === 1) out = grown(m, need, 1);
      else throw new KitError('mcGrow');
    } else out = { ...m, d: m.d.slice() };
    list.forEach((k, i) => {
      const value = isScalar(rhs) ? rhs.d[0] : rhs.d[i];
      out.d[((k - 1) % out.r) * out.c + Math.floor((k - 1) / out.r)] = value;
    });
    return out;
  }
  const rows = positions(subs[0], m.r || (subs[0].all ? rhs.r : 0));
  const cols = positions(subs[1], m.c || (subs[1].all ? rhs.c : 0));
  if (!isScalar(rhs) && (rhs.r !== rows.length || rhs.c !== cols.length)) {
    if (!(numel(rhs) === rows.length * cols.length && (rows.length === 1 || cols.length === 1))) {
      throw new KitError('mcAssignCount', `${rows.length}x${cols.length}`);
    }
  }
  const out = grown(m, Math.max(0, ...rows), Math.max(0, ...cols));
  let k = 0;
  rows.forEach((i) =>
    cols.forEach((j) => {
      out.d[(i - 1) * out.c + (j - 1)] = isScalar(rhs) ? rhs.d[0] : rhs.d[k];
      k++;
    }),
  );
  return out;
}
