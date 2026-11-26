// Elliptic integrals in the parameter convention m = k², as in Abramowitz and Stegun chapter 17. The complete K(m)
// and E(m) use the arithmetic-geometric mean (17.6). The incomplete F(φ|m) and E(φ|m) use Carlson's symmetric
// integrals R_F and R_D, computed by his duplication algorithm (B. C. Carlson, Numerical Algorithms 10, 1995).
import { NumError } from '../errors';

/** K(m) = π / (2 AGM(1, √(1-m))) for m < 1. */
export function ellipticK(m: number): number {
  if (!(m < 1)) throw new NumError('domain', 'K(m) needs m < 1');
  let a = 1;
  let g = Math.sqrt(1 - m);
  for (let i = 0; i < 60 && Math.abs(a - g) > 1e-16 * a; i += 1) [a, g] = [(a + g) / 2, Math.sqrt(a * g)];
  return Math.PI / (2 * a);
}

/** E(m) = K(m) (1 - Σ 2^(n-1) c_n²) by the same mean, for m ≤ 1. */
export function ellipticE(m: number): number {
  if (!(m <= 1)) throw new NumError('domain', 'E(m) needs m ≤ 1');
  if (m === 1) return 1;
  let a = 1;
  let g = Math.sqrt(1 - m);
  let sum = m / 2;
  let power = 0.5;
  for (let i = 0; i < 60; i += 1) {
    const c = (a - g) / 2;
    [a, g] = [(a + g) / 2, Math.sqrt(a * g)];
    power *= 2;
    sum += power * c * c;
    if (Math.abs(c) <= 1e-16 * a) break;
  }
  return (Math.PI / (2 * a)) * (1 - sum);
}

/** Carlson's R_F(x, y, z), with at most one of x, y, z zero. */
export function carlsonRF(x0: number, y0: number, z0: number): number {
  if (x0 < 0 || y0 < 0 || z0 < 0 || x0 + y0 === 0 || y0 + z0 === 0 || z0 + x0 === 0) {
    throw new NumError('domain', 'R_F needs non-negative arguments, at most one zero');
  }
  let [x, y, z] = [x0, y0, z0];
  let a = (x + y + z) / 3;
  for (let i = 0; i < 100; i += 1) {
    if (Math.max(Math.abs(a - x), Math.abs(a - y), Math.abs(a - z)) < 1e-3 * a) break;
    const lambda = Math.sqrt(x) * Math.sqrt(y) + Math.sqrt(y) * Math.sqrt(z) + Math.sqrt(z) * Math.sqrt(x);
    [x, y, z] = [(x + lambda) / 4, (y + lambda) / 4, (z + lambda) / 4];
    a = (x + y + z) / 3;
  }
  const dx = 1 - x / a;
  const dy = 1 - y / a;
  const dz = -(dx + dy);
  const e2 = dx * dy - dz * dz;
  const e3 = dx * dy * dz;
  return (1 - e2 / 10 + e3 / 14 + (e2 * e2) / 24 - (3 * e2 * e3) / 44) / Math.sqrt(a);
}

/** Carlson's R_D(x, y, z), with z > 0 and at most one of x, y zero. */
export function carlsonRD(x0: number, y0: number, z0: number): number {
  if (x0 < 0 || y0 < 0 || !(z0 > 0) || x0 + y0 === 0) throw new NumError('domain', 'R_D needs x, y ≥ 0 and z > 0');
  let [x, y, z] = [x0, y0, z0];
  let sum = 0;
  let factor = 1;
  let a = (x + y + 3 * z) / 5;
  for (let i = 0; i < 100; i += 1) {
    if (Math.max(Math.abs(a - x), Math.abs(a - y), Math.abs(a - z)) < 1e-3 * a) break;
    const lambda = Math.sqrt(x) * Math.sqrt(y) + Math.sqrt(y) * Math.sqrt(z) + Math.sqrt(z) * Math.sqrt(x);
    sum += factor / (Math.sqrt(z) * (z + lambda));
    factor /= 4;
    [x, y, z] = [(x + lambda) / 4, (y + lambda) / 4, (z + lambda) / 4];
    a = (x + y + 3 * z) / 5;
  }
  const dx = 1 - x / a;
  const dy = 1 - y / a;
  const dz = -(dx + dy) / 3;
  const e2 = dx * dy - 6 * dz * dz;
  const e3 = (3 * dx * dy - 8 * dz * dz) * dz;
  const e4 = 3 * (dx * dy - dz * dz) * dz * dz;
  const e5 = dx * dy * dz * dz * dz;
  const tail = 1 - (3 * e2) / 14 + e3 / 6 + (9 * e2 * e2) / 88 - (3 * e4) / 22 - (9 * e2 * e3) / 52 + (3 * e5) / 26;
  return 3 * sum + (factor * tail) / (a * Math.sqrt(a));
}

/** Splits φ into whole half-turns and a remainder in [-π/2, π/2]: F and E grow by 2K and 2E per half-turn. */
function reduce(phi: number): { turns: number; rest: number } {
  const turns = Math.round(phi / Math.PI);
  return { turns, rest: phi - turns * Math.PI };
}

/** The incomplete integral of the first kind F(φ|m) = ∫₀^φ dθ / √(1 - m sin²θ). */
export function ellipticF(phi: number, m: number): number {
  if (!Number.isFinite(phi)) throw new NumError('notFinite');
  const { turns, rest } = reduce(phi);
  const s = Math.sin(rest);
  const c = Math.cos(rest);
  if (m * s * s >= 1) throw new NumError('domain', 'F(φ|m) needs m sin²φ < 1');
  const part = s * carlsonRF(c * c, 1 - m * s * s, 1);
  return turns === 0 ? part : part + 2 * turns * ellipticK(m);
}

/** The incomplete integral of the second kind E(φ|m) = ∫₀^φ √(1 - m sin²θ) dθ. */
export function ellipticEIncomplete(phi: number, m: number): number {
  if (!Number.isFinite(phi)) throw new NumError('notFinite');
  const { turns, rest } = reduce(phi);
  const s = Math.sin(rest);
  const c = Math.cos(rest);
  if (m * s * s > 1) throw new NumError('domain', 'E(φ|m) needs m sin²φ ≤ 1');
  const q = 1 - m * s * s;
  const part = s === 0 ? 0 : s * carlsonRF(c * c, q, 1) - ((m * s * s * s) / 3) * carlsonRD(c * c, q, 1);
  return turns === 0 ? part : part + 2 * turns * ellipticE(m);
}
