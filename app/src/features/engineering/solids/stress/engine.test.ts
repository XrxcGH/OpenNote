import '../text';
import { describe, expect, it } from 'vitest';
import { SolidsError } from '../kit/types';
import { criteria, hookePlane, planeStress, rosette, rotate, tensorStress } from './engine';

const rel = (a: number | undefined, b: number, tol: number) =>
  expect(Math.abs((a ?? NaN) - b) / Math.max(Math.abs(b), 1e-30), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const MPa = 1e6;
const deg = Math.PI / 180;

describe('plane stress', () => {
  it('finds the principal stresses, angles, and the largest shear', () => {
    const r = planeStress({ sx: 80 * MPa, sy: -40 * MPa, txy: 25 * MPa });
    rel(r.s1, 85 * MPa, 1e-6);
    rel(r.s2, -45 * MPa, 1e-6);
    rel(r.thetaP / deg, 11.31, 1e-4);
    rel(r.R, 65 * MPa, 1e-6);
    // Independently: tan 2θp = 2τ/(σx − σy) = 50/120.
    rel(Math.tan(2 * r.thetaP), 50 / 120, 1e-12);
    // Turning by θp gives σ1 and no shear; turning by θs gives the average stress and the largest shear.
    const at = rotate({ sx: 80, sy: -40, txy: 25 }, r.thetaP);
    rel(at.sx, 85, 1e-12);
    expect(Math.abs(at.txy)).toBeLessThan(1e-12);
    const shear = rotate({ sx: 80, sy: -40, txy: 25 }, r.thetaS);
    rel(shear.txy, 65, 1e-12);
    rel(shear.sx, 20, 1e-12);
  });

  it('gives the von Mises stress of the validation case', () => {
    const c = criteria([85 * MPa, -45 * MPa, 0], { Sy: 250 * MPa });
    rel(c.vonMises, 114.346 * MPa, 1e-6);
    // σ' for plane stress, written out: sqrt(σ1² − σ1σ2 + σ2²).
    rel(c.vonMises, Math.sqrt(85 ** 2 + 85 * 45 + 45 ** 2) * MPa, 1e-12);
    rel(c.nVonMises, 250 / Math.sqrt(13075), 1e-12);
    rel(c.nTresca, 250 / 130, 1e-12);
    rel(c.tauMax, 65 * MPa, 1e-12);
  });

  it('turns an element and keeps the sum of normal stresses', () => {
    const r = planeStress({ sx: 80 * MPa, sy: -40 * MPa, txy: 25 * MPa }, 30 * deg);
    // By hand: 20 + 60 cos 60° + 25 sin 60° = 71.651; −60 sin 60° + 25 cos 60° = −39.462.
    rel(r.rotated?.sx, (20 + 60 * 0.5 + (25 * Math.sqrt(3)) / 2) * MPa, 1e-12);
    rel(r.rotated?.txy, (-60 * (Math.sqrt(3) / 2) + 25 * 0.5) * MPa, 1e-12);
    rel((r.rotated?.sx ?? 0) + (r.rotated?.sy ?? 0), 40 * MPa, 1e-12);
  });

  it('handles zero stress and pure shear', () => {
    const zero = planeStress({ sx: 0, sy: 0, txy: 0 });
    expect([zero.s1, zero.s2, zero.R, zero.thetaP]).toEqual([0, 0, 0, 0]);
    expect(criteria([0, 0, 0], { Sy: 250 * MPa }).nVonMises).toBe(Infinity);
    const shear = planeStress({ sx: 0, sy: 0, txy: 50 * MPa });
    rel(shear.s1, 50 * MPa, 1e-12);
    rel(shear.s2, -50 * MPa, 1e-12);
    rel(shear.thetaP / deg, 45, 1e-12);
  });

  it('works at very large and negative stresses', () => {
    const big = planeStress({ sx: -3e12, sy: -1e12, txy: 0 });
    rel(big.s1, -1e12, 1e-12);
    rel(big.s2, -3e12, 1e-12);
    rel(big.thetaP / deg, 90, 1e-12);
  });

  it('stops on a value that is not a number', () => {
    expect(() => planeStress({ sx: NaN, sy: 0, txy: 0 })).toThrow(SolidsError);
  });
});

describe('3D stress', () => {
  const t = [
    [50, 30, 20],
    [30, -20, -10],
    [20, -10, 10],
  ].map((row) => row.map((v) => v * MPa)) as unknown as Parameters<typeof tensorStress>[0];

  it('finds the principal stresses and the criteria of the validation case', () => {
    const r = tensorStress(t);
    // The stated values have five figures, so they agree to half a unit in their last place.
    rel(r.values[0], 65.527 * MPa, 1e-5);
    expect(Math.abs(r.values[1] / MPa - 11.531)).toBeLessThanOrEqual(5e-4);
    rel(r.values[2], -37.058 * MPa, 1e-5);
    // Independently, the roots of the characteristic cubic by the trigonometric (Viete) formula.
    const [I1, I2, I3] = [40, -2100, -28000];
    const p = I2 - I1 ** 2 / 3;
    const qq = (-2 * I1 ** 3) / 27 + (I1 * I2) / 3 - I3;
    const m = 2 * Math.sqrt(-p / 3);
    const phi = Math.acos((3 * qq) / (p * m)) / 3;
    const roots = [0, 1, 2].map((k) => I1 / 3 + m * Math.cos(phi - (2 * Math.PI * k) / 3)).sort((a, b) => b - a);
    roots.forEach((root, i) => rel(r.values[i], root * MPa, 1e-10));
    const c = criteria(r.values, {});
    rel(c.vonMises, 88.882 * MPa, 1e-5);
    rel(c.tauMax, 51.292 * MPa, 1e-5);
  });

  it('agrees with the invariants and gives unit, orthogonal directions', () => {
    const r = tensorStress(t);
    const [a, b, c] = r.values;
    // The roots of σ³ − I1σ² + I2σ − I3 match the invariants: their sum, pair products, and product.
    rel(a + b + c, r.invariants[0], 1e-12);
    rel(a * b + b * c + c * a, r.invariants[1], 1e-9);
    rel(a * b * c, r.invariants[2], 1e-9);
    // In MPa: I1 = 40, I2 = −1000 − 200 + 500 − 900 − 100 − 400 = −2100, and I3 is the determinant, −28000.
    rel(r.invariants[0], 40 * MPa, 1e-12);
    rel(r.invariants[1], -2100 * MPa ** 2, 1e-12);
    const det = 50 * (-20 * 10 - 100) - 30 * (30 * 10 - -10 * 20) + 20 * (30 * -10 - -20 * 20);
    rel(r.invariants[2], det * MPa ** 3, 1e-12);
    for (const [i, d] of r.directions.entries()) {
      rel(Math.hypot(...d), 1, 1e-12);
      // Each direction is an eigenvector: T d = σ d.
      const Td = t.map((row) => row.reduce((sum, v, j) => sum + v * d[j], 0));
      Td.forEach((v, k) => expect(Math.abs(v - r.values[i] * d[k])).toBeLessThan(1e-6 * MPa));
    }
  });

  it('stops on an unsymmetric tensor', () => {
    expect(() =>
      tensorStress([
        [1, 2, 0],
        [3, 1, 0],
        [0, 0, 1],
      ]),
    ).toThrow(SolidsError);
  });
});

describe('strain rosettes', () => {
  it('reads a rectangular rosette', () => {
    const r = rosette('rect', 500e-6, 300e-6, -100e-6);
    rel(r.ex, 500e-6, 1e-12);
    rel(r.ey, -100e-6, 1e-12);
    rel(r.gxy, 200e-6, 1e-12);
    rel(r.e1, 516.23e-6, 1e-5);
    expect(Math.abs(r.e2 * 1e6 + 116.23)).toBeLessThanOrEqual(5e-3);
    // By hand: 200 ± sqrt(300² + 100²) microstrain.
    rel(r.e1, (200 + Math.sqrt(1e5)) * 1e-6, 1e-12);
    rel(r.e2, (200 - Math.sqrt(1e5)) * 1e-6, 1e-12);
    rel(r.thetaP / deg, 9.217, 1e-4);
  });

  it('reads a delta rosette that agrees with the strain transformation', () => {
    // A known strain state, read at 0, 60, and 120 degrees, then recovered.
    const [ex, ey, g] = [400e-6, -150e-6, 220e-6];
    const at = (a: number) => (ex + ey) / 2 + ((ex - ey) / 2) * Math.cos(2 * a) + (g / 2) * Math.sin(2 * a);
    const r = rosette('delta', at(0), at(60 * deg), at(120 * deg));
    rel(r.ex, ex, 1e-12);
    rel(r.ey, ey, 1e-10);
    rel(r.gxy, g, 1e-10);
  });

  it("turns strains into stresses by Hooke's law", () => {
    const h = hookePlane(500e-6, -100e-6, 200e-6, 200e9, 0.3);
    rel(h.sx, (200e9 / 0.91) * (500e-6 - 30e-6), 1e-12);
    rel(h.sy, (200e9 / 0.91) * (-100e-6 + 150e-6), 1e-12);
    rel(h.txy, (200e9 / 2.6) * 200e-6, 1e-12);
    expect(() => hookePlane(0, 0, 0, 200e9, 0.5)).toThrow(SolidsError);
    expect(() => hookePlane(0, 0, 0, -1, 0.3)).toThrow(SolidsError);
  });
});

describe('brittle criteria', () => {
  it('uses the Coulomb-Mohr line in the second quadrant and the strengths elsewhere', () => {
    const mixed = criteria([30 * MPa, 0, -70 * MPa], { Sut: 200 * MPa, Suc: 700 * MPa });
    rel(mixed.nMohr, 1 / (30 / 200 + 70 / 700), 1e-12);
    rel(mixed.nNormal, Math.min(200 / 30, 700 / 70), 1e-12);
    rel(criteria([50 * MPa, 20 * MPa, 0], { Sut: 200 * MPa }).nMohr, 4, 1e-12);
    rel(criteria([0, -20 * MPa, -100 * MPa], { Sut: 200 * MPa, Suc: 700 * MPa }).nMohr, 7, 1e-12);
    expect(() => criteria([1, 0, 0], { Sut: -5 })).toThrow(SolidsError);
  });
});
