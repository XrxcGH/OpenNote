// The console's operators on matrices: element-wise arithmetic with MATLAB's implicit expansion, matrix product,
// division and backslash, powers, ranges, and the comparisons. `say` reports what an operator did, for the explain
// switch and for warnings.
import { solveSquare, inverseF, lstsq, matPower, transposeF } from '../fmat';
import { KitError } from '../types';
import { fromRows, isScalar, mat, numel, scalar, sizeText, toRows, type M } from './values';

export type Say = (key: string, vars?: Record<string, string>) => void;

const SAME: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '.*': (a, b) => a * b,
  './': (a, b) => a / b,
  '.\\': (a, b) => b / a,
  '==': (a, b) => (a === b ? 1 : 0),
  '~=': (a, b) => (a !== b ? 1 : 0),
  '<': (a, b) => (a < b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
  '&': (a, b) => (a !== 0 && b !== 0 ? 1 : 0),
  '|': (a, b) => (a !== 0 || b !== 0 ? 1 : 0),
};
const LOGICAL = new Set(['==', '~=', '<', '<=', '>', '>=', '&', '|']);

function power(a: number, b: number): number {
  if (a < 0 && !Number.isInteger(b)) throw new KitError('mcComplex');
  return a ** b;
}

function dimension(a: number, b: number): number {
  if (a === b) return a;
  if (a === 1) return b;
  if (b === 1) return a;
  throw new KitError('mcDimsAgree');
}

/** The operator applied entry by entry, expanding a single row, column, or number to match. */
export function elementwise(op: string, a: M, b: M): M {
  const f = op === '.^' ? power : SAME[op];
  const r = dimension(a.r, b.r);
  const c = dimension(a.c, b.c);
  if ((a.r === 0 || a.c === 0 || b.r === 0 || b.c === 0) && (isScalar(a) || isScalar(b))) return mat(0, 0, []);
  const d = new Array<number>(r * c);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      d[i * c + j] = f(
        a.d[(a.r === 1 ? 0 : i) * a.c + (a.c === 1 ? 0 : j)],
        b.d[(b.r === 1 ? 0 : i) * b.c + (b.c === 1 ? 0 : j)],
      );
    }
  }
  const out = mat(r, c, d);
  if (LOGICAL.has(op)) out.logical = true;
  return out;
}

export function matmul(a: M, b: M): M {
  if (a.c !== b.r) throw new KitError('mcInnerDims', `${sizeText(a)} * ${sizeText(b)}`);
  const d = new Array<number>(a.r * b.c).fill(0);
  for (let i = 0; i < a.r; i++) {
    for (let k = 0; k < a.c; k++) {
      const x = a.d[i * a.c + k];
      if (x === 0) continue;
      for (let j = 0; j < b.c; j++) d[i * b.c + j] += x * b.d[k * b.c + j];
    }
  }
  return mat(a.r, b.c, d);
}

export const transpose = (a: M): M => (a.r === 0 || a.c === 0 ? mat(a.c, a.r, []) : fromRows(transposeF(toRows(a))));

const singularWarning = (say: Say, result: M): M => {
  say('warnSingular');
  return mat(
    result.r,
    result.c,
    result.d.map(() => Infinity),
  );
};

/** A \ B: solve A X = B (least squares when A is not square). */
export function leftDivide(a: M, b: M, say: Say): M {
  if (isScalar(a)) return elementwise('.\\', a, b);
  if (a.r !== b.r) throw new KitError('mcInnerDims', `${sizeText(a)} \\ ${sizeText(b)}`);
  if (a.r === a.c) {
    const x = solveSquare(toRows(a), toRows(b));
    say('explainSolve', { size: sizeText(a) });
    return x ? fromRows(x) : singularWarning(say, mat(a.c, b.c, new Array<number>(a.c * b.c).fill(0)));
  }
  say('explainLeastSquares', { size: sizeText(a) });
  return fromRows(lstsq(toRows(a), toRows(b)));
}

/** A / B = (B' \ A')'. */
export function rightDivide(a: M, b: M, say: Say): M {
  if (isScalar(b)) return elementwise('./', a, b);
  if (a.c !== b.c) throw new KitError('mcInnerDims', `${sizeText(a)} / ${sizeText(b)}`);
  return transpose(leftDivide(transpose(b), transpose(a), say));
}

/** A ^ B for a square matrix and a whole-number exponent, or two numbers. */
export function mpower(a: M, b: M, say: Say): M {
  if (isScalar(a) && isScalar(b)) return elementwise('.^', a, b);
  if (isScalar(b)) {
    if (a.r !== a.c) throw new KitError('mcSquare');
    const k = b.d[0];
    if (!Number.isInteger(k)) throw new KitError('mcNotSupported', 'a matrix to a fractional power');
    if (numel(a) > 10_000) throw new KitError('mcTooBig', '10000');
    const p = matPower(toRows(a), k);
    return p ? fromRows(p) : singularWarning(say, a);
  }
  throw new KitError('mcNotSupported', 'a power with a matrix exponent');
}

export function inverse(a: M, say: Say): M {
  if (a.r !== a.c) throw new KitError('mcSquare');
  const inv = inverseF(toRows(a));
  return inv ? fromRows(inv) : singularWarning(say, a);
}

/** a:step:b as a row. */
export function colonRange(a: number, step: number, b: number): M {
  if (step === 0 || (step > 0 && a > b) || (step < 0 && a < b)) return mat(1, 0, []);
  const count = Math.floor((b - a) / step + 1e-10) + 1;
  const d = Array.from({ length: count }, (_, i) => a + i * step);
  return mat(1, count, d);
}

export const negate = (a: M): M => ({
  ...mat(
    a.r,
    a.c,
    a.d.map((v) => -v),
  ),
});
export const not = (a: M): M => ({
  ...mat(
    a.r,
    a.c,
    a.d.map((v) => (v === 0 ? 1 : 0)),
  ),
  logical: true,
});

export function binary(op: string, a: M, b: M, say: Say): M {
  const matrixAB = !isScalar(a) && !isScalar(b);
  if (op === '*') {
    say(matrixAB ? 'explainMatmul' : 'explainScale', { a: sizeText(a), b: sizeText(b) });
    return isScalar(a) || isScalar(b) ? elementwise('.*', a, b) : matmul(a, b);
  }
  if (op === '/') return rightDivide(a, b, say);
  if (op === '\\') return leftDivide(a, b, say);
  if (op === '^') return mpower(a, b, say);
  if (['.*', './', '.^', '.\\'].includes(op)) say('explainElementwise', { op, a: sizeText(a), b: sizeText(b) });
  return elementwise(op, a, b);
}

export { scalar };
