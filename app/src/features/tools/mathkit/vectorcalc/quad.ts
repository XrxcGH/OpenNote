// Integrals of the kind vector calculus needs: along a parameter, over a rectangle, or a region between two curves, and
// over a box by a fixed Gauss-Legendre grid. The tools check each theorem by working out both sides with these.
import { gaussLegendre, integrate } from '../numeric';

export const int1 = (f: (t: number) => number, a: number, b: number): number => integrate(f, a, b, 1e-11);

/** The double integral over u in [u0, u1] and v between v0(u) and v1(u). */
export function int2(
  f: (u: number, v: number) => number,
  u0: number,
  u1: number,
  v0: number | ((u: number) => number),
  v1: number | ((u: number) => number),
): number {
  const lo = typeof v0 === 'number' ? () => v0 : v0;
  const hi = typeof v1 === 'number' ? () => v1 : v1;
  return int1((u) => int1((v) => f(u, v), lo(u), hi(u)), u0, u1);
}

/** The triple integral over a box by an n-point Gauss-Legendre rule in each direction. */
export function glBox(
  f: (a: number, b: number, c: number) => number,
  ranges: readonly [[number, number], [number, number], [number, number]],
  n = 24,
): number {
  const { x, w } = gaussLegendre(n);
  const map = ([lo, hi]: readonly [number, number]) => ({
    half: (hi - lo) / 2,
    mid: (hi + lo) / 2,
  });
  const [A, B, C] = ranges.map(map);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        sum += w[i] * w[j] * w[k] * f(A.mid + A.half * x[i], B.mid + B.half * x[j], C.mid + C.half * x[k]);
      }
    }
  }
  return sum * A.half * B.half * C.half;
}
