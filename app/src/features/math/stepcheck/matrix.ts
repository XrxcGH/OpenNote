// Matrices and vectors in a line of worked math: [[1, 2], [3, 4]], [1, 2, 3], sums, products, scalar multiples,
// powers, A^T, A^-1, det, trace, dot and cross products, and the length of a vector. Entries are numbers or
// expressions without letters, such as 1/2 or sqrt(2). A small reader of its own, since the expression engine has no
// matrices. Throws MatrixUnreadable for anything it does not know, and MatrixShape for sizes that do not fit.
import { expression } from '../calculus/read';
import { valueOf } from '../calculus/numeric';

export type Matrix = number[][];
export type MValue = { kind: 'matrix'; m: Matrix } | { kind: 'number'; n: number };

export class MatrixUnreadable extends Error {}
export class MatrixShape extends Error {}

/** True when a part looks like matrix or vector math rather than plain algebra. */
export function looksLikeMatrix(text: string): boolean {
  return /\[\s*-?[\d([]/.test(text) && !/\]\s*_/.test(text);
}

const num = (n: number): MValue => ({ kind: 'number', n });
const mat = (m: Matrix): MValue => ({ kind: 'matrix', m });

function entry(text: string): number {
  const t = text.trim();
  if (t === '') throw new MatrixUnreadable();
  let value: number;
  try {
    value = valueOf(expression(t, 'text'));
  } catch {
    throw new MatrixUnreadable();
  }
  if (!Number.isFinite(value)) throw new MatrixUnreadable();
  return value;
}

function shapeOf(m: Matrix): [number, number] {
  return [m.length, m[0]?.length ?? 0];
}

function add(a: MValue, b: MValue, sign: 1 | -1): MValue {
  if (a.kind === 'number' && b.kind === 'number') return num(a.n + sign * b.n);
  if (a.kind !== 'matrix' || b.kind !== 'matrix') throw new MatrixShape();
  const [r, c] = shapeOf(a.m);
  const [r2, c2] = shapeOf(b.m);
  if (r !== r2 || c !== c2) throw new MatrixShape();
  return mat(a.m.map((row, i) => row.map((x, j) => x + sign * b.m[i][j])));
}

function product(a: Matrix, b: Matrix): Matrix {
  const [r, k] = shapeOf(a);
  const [k2, c] = shapeOf(b);
  if (k !== k2) throw new MatrixShape();
  return Array.from({ length: r }, (_, i) =>
    Array.from({ length: c }, (_, j) => a[i].reduce((sum, x, t) => sum + x * b[t][j], 0)),
  );
}

const isVector = (m: Matrix) => m.length === 1 || m[0].length === 1;
const flat = (m: Matrix) => m.flat();

function times(a: MValue, b: MValue): MValue {
  if (a.kind === 'number' && b.kind === 'number') return num(a.n * b.n);
  if (a.kind === 'number' && b.kind === 'matrix') return mat(b.m.map((row) => row.map((x) => a.n * x)));
  if (b.kind === 'number' && a.kind === 'matrix') return mat(a.m.map((row) => row.map((x) => b.n * x)));
  const [x, y] = [(a as { m: Matrix }).m, (b as { m: Matrix }).m];
  // Two vectors of the same length written side by side with * or a dot: their dot product.
  if (
    isVector(x) &&
    isVector(y) &&
    x.length === 1 &&
    y.length === 1 &&
    x[0].length === y[0].length &&
    x[0].length > 1
  ) {
    return dot(a, b);
  }
  // A row vector given as [1, 2, 3] is a column when a matrix multiplies it.
  if (y.length === 1 && x[0].length === y[0].length && x[0].length > 1 && x.length > 1) {
    return mat(
      product(
        x,
        y[0].map((v) => [v]),
      ),
    );
  }
  return mat(product(x, y));
}

function dot(a: MValue, b: MValue): MValue {
  if (a.kind !== 'matrix' || b.kind !== 'matrix' || !isVector(a.m) || !isVector(b.m)) return times(a, b);
  const [x, y] = [flat(a.m), flat(b.m)];
  if (x.length !== y.length) throw new MatrixShape();
  return num(x.reduce((sum, v, i) => sum + v * y[i], 0));
}

function cross(a: MValue, b: MValue): MValue {
  if (a.kind !== 'matrix' || b.kind !== 'matrix') return times(a, b);
  const [x, y] = [flat(a.m), flat(b.m)];
  if (x.length !== 3 || y.length !== 3) throw new MatrixShape();
  return mat([[x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]]);
}

function determinant(m: Matrix): number {
  const [r, c] = shapeOf(m);
  if (r !== c || r === 0) throw new MatrixShape();
  const a = m.map((row) => [...row]);
  let det = 1;
  for (let i = 0; i < r; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < r; k += 1) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    if (Math.abs(a[pivot][i]) < 1e-14) return 0;
    if (pivot !== i) [a[i], a[pivot], det] = [a[pivot], a[i], -det];
    det *= a[i][i];
    for (let k = i + 1; k < r; k += 1) {
      const f = a[k][i] / a[i][i];
      for (let j = i; j < r; j += 1) a[k][j] -= f * a[i][j];
    }
  }
  return det;
}

function inverse(m: Matrix): Matrix {
  const [r, c] = shapeOf(m);
  if (r !== c) throw new MatrixShape();
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < r; i += 1) {
    let pivot = i;
    for (let k = i + 1; k < r; k += 1) if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
    if (Math.abs(a[pivot][i]) < 1e-12) throw new MatrixShape();
    [a[i], a[pivot]] = [a[pivot], a[i]];
    const p = a[i][i];
    a[i] = a[i].map((x) => x / p);
    for (let k = 0; k < r; k += 1) {
      if (k === i) continue;
      const f = a[k][i];
      a[k] = a[k].map((x, j) => x - f * a[i][j]);
    }
  }
  return a.map((row) => row.slice(r));
}

const transpose = (m: Matrix): Matrix => m[0].map((_, j) => m.map((row) => row[j]));

class Reader {
  private i = 0;
  constructor(private readonly s: string) {}

  read(): MValue {
    const value = this.sum();
    this.space();
    if (this.i < this.s.length) throw new MatrixUnreadable();
    return value;
  }

  private space() {
    while (this.s[this.i] === ' ') this.i += 1;
  }

  private peek(): string {
    this.space();
    return this.s[this.i] ?? '';
  }

  private sum(): MValue {
    let value = this.product();
    for (;;) {
      const c = this.peek();
      if (c !== '+' && c !== '-') return value;
      this.i += 1;
      value = add(value, this.product(), c === '+' ? 1 : -1);
    }
  }

  private product(): MValue {
    let value = this.power();
    for (;;) {
      const c = this.peek();
      if (c === '*' || c === '·') {
        this.i += 1;
        value = c === '·' ? dot(value, this.power()) : times(value, this.power());
      } else if (c === '×') {
        this.i += 1;
        value = cross(value, this.power());
      } else if (c === '/') {
        this.i += 1;
        const by = this.power();
        if (by.kind !== 'number' || by.n === 0) throw new MatrixShape();
        value = times(value, num(1 / by.n));
      } else if (c === '[' || c === '(' || /[a-z\d]/.test(c)) value = times(value, this.power());
      else return value;
    }
  }

  private power(): MValue {
    const base = this.unary();
    if (this.peek() !== '^') return base;
    this.i += 1;
    this.space();
    const rest = this.s.slice(this.i);
    const t = /^(?:\(\s*)?(T|-1|\d+)(?:\s*\))?/.exec(rest);
    if (!t) throw new MatrixUnreadable();
    this.i += t[0].length;
    if (base.kind === 'number') return num(base.n ** Number(t[1] === 'T' ? 1 : t[1]));
    if (t[1] === 'T') return mat(transpose(base.m));
    if (t[1] === '-1') return mat(inverse(base.m));
    let out: MValue = base;
    for (let k = 1; k < Number(t[1]); k += 1) out = times(out, base);
    if (Number(t[1]) > 20) throw new MatrixUnreadable();
    return out;
  }

  private unary(): MValue {
    if (this.peek() === '-') {
      this.i += 1;
      return times(num(-1), this.unary());
    }
    return this.primary();
  }

  private primary(): MValue {
    const c = this.peek();
    if (c === '[') return this.literal();
    if (c === '(') {
      this.i += 1;
      const inside = this.sum();
      if (this.peek() !== ')') throw new MatrixUnreadable();
      this.i += 1;
      return inside;
    }
    if (c === '|') {
      this.i += 1;
      const inside = this.sum();
      if (this.peek() !== '|') throw new MatrixUnreadable();
      this.i += 1;
      return inside.kind === 'number'
        ? num(Math.abs(inside.n))
        : isVector(inside.m)
          ? num(Math.hypot(...flat(inside.m)))
          : num(determinant(inside.m));
    }
    const word = /^(det|tr|trace|dot|cross|norm|transpose|inv)\s*\(/.exec(this.s.slice(this.i));
    if (word) {
      this.i += word[0].length;
      const args = [this.sum()];
      while (this.peek() === ',') {
        this.i += 1;
        args.push(this.sum());
      }
      if (this.peek() !== ')') throw new MatrixUnreadable();
      this.i += 1;
      return this.call(word[1], args);
    }
    const number = /^(?:\d+\.?\d*|\.\d+)/.exec(this.s.slice(this.i));
    if (number) {
      this.i += number[0].length;
      return num(Number(number[0]));
    }
    const constant = /^(pi|sqrt\([^()]*\))/.exec(this.s.slice(this.i));
    if (constant) {
      this.i += constant[0].length;
      return num(entry(constant[0]));
    }
    throw new MatrixUnreadable();
  }

  private call(name: string, args: MValue[]): MValue {
    const [a, b] = args;
    const m = (v: MValue | undefined) => {
      if (!v || v.kind !== 'matrix') throw new MatrixShape();
      return v.m;
    };
    if (name === 'dot' && args.length === 2) return dot(a, b);
    if (name === 'cross' && args.length === 2) return cross(a, b);
    if (args.length !== 1) throw new MatrixUnreadable();
    if (name === 'det') return num(determinant(m(a)));
    if (name === 'tr' || name === 'trace') return num(m(a).reduce((s, row, i) => s + (row[i] ?? 0), 0));
    if (name === 'norm') return num(Math.hypot(...flat(m(a))));
    if (name === 'transpose') return mat(transpose(m(a)));
    return mat(inverse(m(a)));
  }

  /** [[1, 2], [3, 4]] or [1, 2, 3]. Rows are split at commas outside brackets. */
  private literal(): MValue {
    const start = this.i;
    let depth = 0;
    let end = -1;
    for (let j = start; j < this.s.length; j += 1) {
      if (this.s[j] === '[' || this.s[j] === '(') depth += 1;
      else if ((this.s[j] === ']' || this.s[j] === ')') && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) throw new MatrixUnreadable();
    this.i = end + 1;
    const inner = this.s.slice(start + 1, end);
    const items = splitTopCommas(inner);
    if (items.every((item) => item.trim().startsWith('['))) {
      const rows = items.map((item) => {
        const row = item.trim();
        if (!row.endsWith(']')) throw new MatrixUnreadable();
        return splitTopCommas(row.slice(1, -1)).map(entry);
      });
      // [[1, 2], [3]]: a row short, most often an entry missed in reading the line, so not a size slip.
      if (rows.length === 0 || rows.some((row) => row.length !== rows[0].length || row.length === 0)) {
        throw new MatrixUnreadable();
      }
      return mat(rows);
    }
    return mat([items.map(entry)]);
  }
}

function splitTopCommas(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '[' || c === '(') depth += 1;
    else if (c === ']' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** Works out a matrix or vector expression. Throws MatrixUnreadable or MatrixShape. */
export function evaluateMatrix(text: string): MValue {
  if (text.length > 2000) throw new MatrixUnreadable();
  return new Reader(text.replace(/\s+/g, ' ')).read();
}

/** A matrix as line text, such as [[1, 2], [3, 4]], with tidy numbers. */
export function matrixText(m: Matrix): string {
  const tidy = (x: number) => String(Math.round(x * 1e9) / 1e9);
  const rows = m.map((row) => `[${row.map(tidy).join(', ')}]`);
  return m.length === 1 ? rows[0] : `[${rows.join(', ')}]`;
}
