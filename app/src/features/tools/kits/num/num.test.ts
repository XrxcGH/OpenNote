// Complex numbers, polynomials, root finding, ODEs, and quadrature against closed forms and SciPy values.
import { describe, expect, it } from 'vitest';
import { cabs, cexp, clog, cpow, csqrt, csub, ctext, cx } from './complex';
import { NumError } from './errors';
import { dopri45, rk4 } from './ode';
import { compose, fromDescending, partialFractions, polyRoots, toDescending } from './poly';
import { gaussIntegrate, gaussLegendre, integrate } from './quad';
import { bracketScan, brent, newtonSystem, scanRoots } from './roots';

describe('complex numbers', () => {
  it('take principal branches', () => {
    expect(cabs(csub(csqrt(cx(-4)), cx(0, 2)))).toBeLessThan(1e-15);
    expect(cabs(csub(csqrt(cx(-4, -0)), cx(0, 2)))).toBeLessThan(1e-15);
    expect(cabs(csub(clog(cx(-1)), cx(0, Math.PI)))).toBeLessThan(1e-15);
    expect(cabs(csub(cexp(cx(0, Math.PI)), cx(-1)))).toBeLessThan(1e-15);
    expect(cabs(csub(cpow(cx(0, 1), cx(0, 1)), cx(Math.exp(-Math.PI / 2))))).toBeLessThan(1e-15);
    expect(cabs(csub(cpow(cx(1, 1), cx(3)), cx(-2, 2)))).toBeLessThan(1e-15);
    expect(ctext(cx(-0.5, -1.25))).toBe('-0.5 - 1.25i');
    expect(ctext(cx(0, 2))).toBe('2i');
  });
});

describe('polynomials', () => {
  it('finds -1, -2, -3 for s³ + 6s² + 11s + 6', () => {
    const roots = polyRoots(fromDescending([1, 6, 11, 6]));
    expect(roots.map((r) => r.z.re)).toEqual([-1, -2, -3].map((x) => expect.closeTo(x, 12)));
    roots.forEach((r) => expect(r.z.im).toBe(0));
  });

  it('finds complex, repeated, and zero roots', () => {
    const pair = polyRoots(fromDescending([1, 2, 5]));
    expect(cabs(csub(pair[0].z, cx(-1, 2)))).toBeLessThan(1e-14);
    const repeated = polyRoots(fromDescending([1, 3, 3, 1]));
    expect(repeated).toHaveLength(1);
    expect(repeated[0].times).toBe(3);
    expect(Math.abs(repeated[0].z.re + 1)).toBeLessThan(1e-9);
    const origin = polyRoots(fromDescending([1, -1, 0, 0]));
    expect(origin.map((r) => [r.z.re, r.times])).toEqual([
      [1, 1],
      [0, 2],
    ]);
    expect(polyRoots(fromDescending([1, -2.001, 1.001])).map((r) => r.times)).toEqual([1, 1]);
    expect(() => polyRoots([0])).toThrow(NumError);
    expect(polyRoots([5])).toEqual([]);
  });

  it('composes and converts coefficient order', () => {
    expect(compose([1, 0, 1], [1, 1])).toEqual([2, 2, 1]);
    expect(toDescending(fromDescending([2, 0, -1]))).toEqual([2, 0, -1]);
  });

  it('expands (s + 3)/((s + 1)(s + 2)) = 2/(s + 1) - 1/(s + 2)', () => {
    const { direct, terms } = partialFractions([3, 1], fromDescending([1, 3, 2]));
    expect(direct).toEqual([0]);
    const byPole = Object.fromEntries(terms.map((t) => [Math.round(t.pole.re), t.residue.re]));
    expect(byPole[-1]).toBeCloseTo(2, 12);
    expect(byPole[-2]).toBeCloseTo(-1, 12);
  });

  it('expands a repeated pole and an improper fraction', () => {
    // 1/((s+1)²(s+2)) = 1/(s+1)² - 1/(s+1) + 1/(s+2)
    const { terms } = partialFractions([1], fromDescending([1, 4, 5, 2]));
    const at = (pole: number, power: number) => terms.find((t) => Math.round(t.pole.re) === pole && t.power === power);
    expect(at(-1, 2)?.residue.re).toBeCloseTo(1, 8);
    expect(at(-1, 1)?.residue.re).toBeCloseTo(-1, 8);
    expect(at(-2, 1)?.residue.re).toBeCloseTo(1, 8);
    // (s² + 1)/(s + 1) = s - 1 + 2/(s + 1)
    const improper = partialFractions([1, 0, 1], [1, 1]);
    expect(improper.direct.map((c) => Math.round(c * 1e12) / 1e12)).toEqual([-1, 1]);
    expect(improper.terms[0].residue.re).toBeCloseTo(2, 12);
  });

  it('keeps poles 1e-6 apart separate: 1/((s-1)(s-1.000001)) = -1e6/(s-1) + 1e6/(s-1.000001)', () => {
    // The residues are ±1/(1.000001 - 1) = ±1e6 by hand; merging the poles gave 1/(s-1.0000005)² instead. Rounding
    // 2.000001 to binary moves the poles by about eps/1e-6 = 2e-10, the conditioning limit.
    const { terms } = partialFractions([1], fromDescending([1, -2.000001, 1.000001]));
    expect(terms.map((t) => t.power)).toEqual([1, 1]);
    const [upper, lower] = [...terms].sort((a, b) => b.pole.re - a.pole.re);
    expect(upper.pole.re).toBeCloseTo(1.000001, 9);
    expect(lower.pole.re).toBeCloseTo(1, 9);
    expect(Math.abs(upper.residue.re / 1e6 - 1)).toBeLessThan(1e-3);
    expect(Math.abs(lower.residue.re / -1e6 - 1)).toBeLessThan(1e-3);
  });

  it('still gathers genuine repeated roots, even from rounded decimal coefficients', () => {
    // (s + 0.1)³ = s³ + 0.3s² + 0.03s + 0.001, whose coefficients are not exact in binary; (s - 2)⁴ is exact.
    const cube = polyRoots(fromDescending([1, 0.3, 0.03, 0.001]));
    expect(cube.map((r) => r.times)).toEqual([3]);
    expect(cube[0].z.re).toBeCloseTo(-0.1, 6);
    const fourth = polyRoots(fromDescending([1, -8, 24, -32, 16]));
    expect(fourth.map((r) => r.times)).toEqual([4]);
    expect(fourth[0].z.re).toBeCloseTo(2, 10);
  });
});

describe('roots', () => {
  it("finds cos x = x by Brent's method", () => {
    const { x } = brent((v) => Math.cos(v) - v, 0, 1);
    expect(x).toBeCloseTo(0.7390851332151607, 12);
    expect(() => brent((v) => v * v + 1, -1, 1)).toThrow(/noBracket/);
  });

  it('finds every root on an interval and skips poles', () => {
    const roots = bracketScan(Math.sin, 0.5, 10);
    expect(roots.map((r) => r / Math.PI)).toEqual([1, 2, 3].map((k) => expect.closeTo(k, 10)));
    expect(bracketScan(Math.tan, 1, 2)).toEqual([]);
  });

  it('misses a touching root in bracketScan, and reports it flagged in scanRoots', () => {
    const square = (x: number) => (x - 1) ** 2;
    expect(bracketScan(square, 0, 3)).toEqual([]);
    const touching = scanRoots(square, 0, 3);
    expect(touching).toHaveLength(1);
    expect(touching[0].touching).toBe(true);
    expect(touching[0].x).toBeCloseTo(1, 6);
    // (x - 2)²(x - 0.5) crosses at 0.5 and touches at 2; x² + 0.01 never reaches zero.
    const mixed = scanRoots((x) => (x - 2) ** 2 * (x - 0.5), 0, 3);
    expect(mixed.map((r) => r.touching)).toEqual([false, true]);
    expect(mixed[0].x).toBeCloseTo(0.5, 10);
    expect(mixed[1].x).toBeCloseTo(2, 6);
    expect(scanRoots((x) => x * x + 0.01, -1, 1)).toEqual([]);
  });

  it('solves a nonlinear system and reports its steps', () => {
    // x² + y² = 4 and x y = 1, from (2, 0.5): x = 1.9318516526, y = 0.5176380902.
    const result = newtonSystem(([x, y]) => [x * x + y * y - 4, x * y - 1], [2, 0.5]);
    expect(result.converged).toBe(true);
    expect(result.x[0]).toBeCloseTo(1.9318516525781366, 9);
    expect(result.x[1]).toBeCloseTo(0.5176380902050415, 9);
    expect(result.history.length).toBeGreaterThan(0);
    expect(() => newtonSystem(([x]) => [x, x], [1])).toThrow(/shape/);
  });
});

describe('ODEs', () => {
  it("integrates y' = -2y to y(1) = e^-2 within 1e-8", () => {
    const sol = dopri45((_t, y) => [-2 * y[0]], [0, 1], [1], { rtol: 1e-9 });
    const end = sol.y[sol.y.length - 1][0];
    expect(Math.abs(end - 0.1353352832366127) / 0.1353352832366127).toBeLessThan(1e-8);
    expect(Math.abs(sol.at(0.5)[0] - Math.exp(-1))).toBeLessThan(1e-8);
  });

  it('stops a falling body at the ground, t = 1.4278431 s', () => {
    const sol = dopri45((_t, [, v]) => [v, -9.81], [0, 5], [10, 0], {
      rtol: 1e-10,
      events: [{ g: (_t, [height]) => height, direction: -1, terminal: true }],
    });
    expect(sol.status).toBe('event');
    expect(Math.abs(sol.events[0].t - 1.4278431229270645)).toBeLessThan(1e-7);
    expect(Math.abs(sol.events[0].y[0])).toBeLessThan(1e-7);
  });

  it('integrates backward and an oscillator, and RK4 matches by hand', () => {
    const back = dopri45((_t, y) => [y[0]], [1, 0], [Math.E], { rtol: 1e-10 });
    expect(back.y[back.y.length - 1][0]).toBeCloseTo(1, 8);
    const spring = dopri45((_t, [x, v]) => [v, -x], [0, 2 * Math.PI], [1, 0], { rtol: 1e-10 });
    const last = spring.y[spring.y.length - 1];
    expect(last[0]).toBeCloseTo(1, 8);
    expect(last[1]).toBeCloseTo(0, 8);
    // One RK4 step of y' = y with h = 0.1: 1 + h + h²/2 + h³/6 + h⁴/24.
    expect(rk4((_t, y) => [y[0]], [0, 0.1], [1], 1).y[1][0]).toBeCloseTo(1.1051708333333334, 15);
    expect(() => rk4((_t, y) => [...y], [0, 1], [1], 0)).toThrow(/domain/);
  });
});

describe('quadrature', () => {
  it('integrates smooth, infinite, and peaked integrands', () => {
    expect(integrate(Math.sin, 0, Math.PI).value).toBeCloseTo(2, 13);
    expect(integrate((x) => Math.exp(-x * x), -Infinity, Infinity).value).toBeCloseTo(Math.sqrt(Math.PI), 10);
    expect(integrate((x) => 1 / (1 + x * x), 0, Infinity).value).toBeCloseTo(Math.PI / 2, 10);
    expect(integrate((x) => Math.sqrt(x), 0, 1).value).toBeCloseTo(2 / 3, 10);
    expect(integrate((x) => 1 / (1e-4 + (x - 0.3) ** 2), 0, 1).value).toBeCloseTo(
      100 * (Math.atan(70) + Math.atan(30)),
      8,
    );
    expect(integrate(Math.cos, 1, 0).value).toBeCloseTo(-Math.sin(1), 14);
    expect(() => integrate(() => NaN, 0, 1)).toThrow(NumError);
  });

  it('gives Gauss-Legendre nodes that integrate degree 2n - 1 exactly', () => {
    const two = gaussLegendre(2);
    expect(two.nodes[1]).toBeCloseTo(1 / Math.sqrt(3), 15);
    for (const n of [1, 5, 10, 20]) {
      const { weights } = gaussLegendre(n);
      expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(2, 13);
      expect(gaussIntegrate((x) => x ** (2 * n - 2), -1, 1, n)).toBeCloseTo(2 / (2 * n - 1), 13);
    }
    expect(() => gaussLegendre(21)).toThrow(/domain/);
  });
});
