// Small numeric helpers the economics and finance calculators share: formatting, a bracketed root finder, and a
// linear solver. Pure functions with no page or window use.

/** A number in plain words: up to `digits` decimals, trailing zeros dropped, and a real minus sign. */
export function fmt(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.abs(value) < 5 * 10 ** (-digits - 1) ? 0 : value;
  const text = rounded.toLocaleString('en-US', { maximumFractionDigits: digits, useGrouping: true });
  return text.replace('-', '\u2212');
}

/** A fraction as a percent. */
export const pct = (fraction: number, digits = 4): string => `${fmt(fraction * 100, digits)}%`;

/** Brent's method: a root of f in [a, b] where f(a) and f(b) have opposite signs, or null when they do not. */
export function brent(f: (x: number) => number, a: number, b: number, tol = 1e-13, maxIter = 200): number | null {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (Number.isNaN(fa) || Number.isNaN(fb) || fa * fb > 0) return null;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < maxIter; i += 1) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tolerance = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const m = 0.5 * (c - b);
    if (Math.abs(m) <= tolerance || fb === 0) return b;
    if (Math.abs(e) < tolerance || Math.abs(fa) <= Math.abs(fb)) {
      d = m;
      e = m;
    } else {
      let p: number;
      let q: number;
      const s = fb / fa;
      if (a === c) {
        p = 2 * m * s;
        q = 1 - s;
      } else {
        const qa = fa / fc;
        const r = fb / fc;
        p = s * (2 * m * qa * (qa - r) - (b - a) * (r - 1));
        q = (qa - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      if (2 * p < Math.min(3 * m * q - Math.abs(tolerance * q), Math.abs(e * q))) {
        e = d;
        d = p / q;
      } else {
        d = m;
        e = m;
      }
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tolerance ? d : m > 0 ? tolerance : -tolerance;
    fb = f(b);
  }
  return b;
}

/** Every root of f in [lo, hi] that a scan of `steps` cells finds as a sign change. */
export function scanRoots(f: (x: number) => number, lo: number, hi: number, steps = 400): number[] {
  const roots: number[] = [];
  let x0 = lo;
  let f0 = f(x0);
  for (let i = 1; i <= steps; i += 1) {
    const x1 = lo + ((hi - lo) * i) / steps;
    const f1 = f(x1);
    if (f0 === 0) roots.push(x0);
    else if (Number.isFinite(f0) && Number.isFinite(f1) && f0 * f1 < 0) {
      const r = brent(f, x0, x1);
      if (r !== null) roots.push(r);
    }
    x0 = x1;
    f0 = f1;
  }
  if (f0 === 0) roots.push(x0);
  return roots;
}

/** Solve A x = b by Gaussian elimination with partial pivoting; null when A is singular. */
export function solveLinear(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r += 1) {
      const factor = a[r][col] / a[col][col];
      for (let c = col; c <= n; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = a[r][n];
    for (let c = r + 1; c < n; c += 1) sum -= a[r][c] * x[c];
    x[r] = sum / a[r][r];
  }
  return x;
}

/** The inverse of a square matrix, or null when it is singular. */
export function invert(matrix: readonly (readonly number[])[]): number[][] | null {
  const n = matrix.length;
  const columns: number[][] = [];
  for (let j = 0; j < n; j += 1) {
    const column = solveLinear(
      matrix,
      Array.from({ length: n }, (_, i) => (i === j ? 1 : 0)),
    );
    if (!column) return null;
    columns.push(column);
  }
  return Array.from({ length: n }, (_, i) => columns.map((column) => column[i]));
}

/** Parse numbers separated by commas, spaces, semicolons, or new lines; null for an entry that is not a number. */
export function parseList(text: string): number[] | null {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter((part) => part !== '');
  const list = parts.map((part) => (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(part) ? Number(part) : NaN));
  return list.length > 0 && list.every((x) => !Number.isNaN(x)) ? list : null;
}
