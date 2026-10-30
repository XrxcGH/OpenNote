// Small numerical methods the tools share: a bracketed root finder (Brent), a maximum finder (golden section),
// the eigenvalues of a symmetric matrix (Jacobi rotations), and Gauss-Legendre points. Each is exact enough that a
// tool's answer is limited by its inputs, not by these.

/** A root of f in the bracket [a, b], where f(a) and f(b) differ in sign. Null when they do not. */
export function brent(f: (x: number) => number, a: number, b: number, tolerance = 1e-12): number | null {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (!(fa * fb < 0)) return null;
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  for (let i = 0; i < 200; i += 1) {
    if (fb * fc > 0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      [a, b, c] = [b, c, b];
      [fa, fb, fc] = [fb, fc, fb];
    }
    const tol = 2 * Number.EPSILON * Math.abs(b) + tolerance / 2;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let qq: number;
      if (a === c) {
        p = 2 * m * s;
        qq = 1 - s;
      } else {
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * m * t * (t - r) - (b - a) * (r - 1));
        qq = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) qq = -qq;
      else p = -p;
      if (2 * p < Math.min(3 * m * qq - Math.abs(tol * qq), Math.abs(e * qq))) {
        e = d;
        d = p / qq;
      } else {
        d = m;
        e = m;
      }
    } else {
      d = m;
      e = m;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

/** Where f is largest in [a, b], when it has one peak there (golden-section search). */
export function argMax(f: (x: number) => number, a: number, b: number, tolerance = 1e-12): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < 300 && Math.abs(b - a) > tolerance * (1 + Math.abs(a) + Math.abs(b)); i += 1) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    }
  }
  return (a + b) / 2;
}

/** The eigenvalues (largest first) and unit eigenvectors (as columns) of a symmetric matrix, by Jacobi rotations. */
export function symmetricEigen(input: readonly (readonly number[])[]): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) off += a[i][j] ** 2;
    const scale = a.reduce((sum, row, i) => sum + row[i] ** 2, 0) + off;
    if (off <= 1e-30 * scale || off === 0) break;
    for (let p = 0; p < n; p += 1) for (let r = p + 1; r < n; r += 1) rotate(a, v, p, r);
  }
  const order = a.map((_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return { values: order.map((i) => a[i][i]), vectors: v.map((row) => order.map((i) => row[i])) };
}

function rotate(a: number[][], v: number[][], p: number, r: number): void {
  if (a[p][r] === 0) return;
  const theta = (a[r][r] - a[p][p]) / (2 * a[p][r]);
  const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
  const c = 1 / Math.sqrt(t * t + 1);
  const s = t * c;
  for (let k = 0; k < a.length; k += 1) {
    const akp = a[k][p];
    const akr = a[k][r];
    a[k][p] = c * akp - s * akr;
    a[k][r] = s * akp + c * akr;
  }
  for (let k = 0; k < a.length; k += 1) {
    const apk = a[p][k];
    const ark = a[r][k];
    a[p][k] = c * apk - s * ark;
    a[r][k] = s * apk + c * ark;
  }
  for (let k = 0; k < a.length; k += 1) {
    const vkp = v[k][p];
    const vkr = v[k][r];
    v[k][p] = c * vkp - s * vkr;
    v[k][r] = s * vkp + c * vkr;
  }
}

/** Three-point Gauss-Legendre points and weights on [-1, 1]: exact for polynomials up to degree 5. */
export const GAUSS3: readonly (readonly [number, number])[] = [
  [-Math.sqrt(3 / 5), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(3 / 5), 5 / 9],
];

/** The integral of f from a to b by three-point Gauss-Legendre. */
export function gauss3(f: (x: number) => number, a: number, b: number): number {
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  return GAUSS3.reduce((sum, [x, w]) => sum + w * f(mid + half * x), 0) * half;
}

/** Rounds away the last bits of a value next to a much larger scale, so 1e-17 next to 100 reads as 0. */
export const tidy = (value: number, scale: number): number => (Math.abs(value) < 1e-12 * Math.abs(scale) ? 0 : value);
