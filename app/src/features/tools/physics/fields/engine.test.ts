// The electric and magnetic fields tool against its validation cases (first principles) and independent working:
// the field as minus the gradient of the potential, Gauss's law against superposition, capacitor limits, a polygon
// that closes in on a circular loop, and the Lorentz force's right-hand rule.
import { describe, expect, it } from 'vitest';
import { EPS0, E_CHARGE, K_E, MU0, M_P } from '../kit/constants';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import {
  capacitance,
  combine,
  fieldLines,
  gauss,
  lorentz,
  potentialAt,
  segmentField,
  sourceField,
  superpose,
  viewBox,
} from './engine';
import type { Charge, Vec } from './engine';
import { FIELDS } from './spec';

const R = 'kitPhysics.fields.r.';
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const DIPOLE: Charge[] = [
  { x: -1, y: 0, q: 1e-9 },
  { x: 1, y: 0, q: -1e-9 },
];
const word = (out: Outcome) => (out.ok ? out.rows.find((row) => row.word)?.word : null);

describe('fields: point charges', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(FIELDS)).toEqual([]);
  });

  it('+1 nC at (-1, 0) m and -1 nC at (1, 0) m: E at the origin is 17.975 N/C along +x', () => {
    const out = superpose(DIPOLE, 0, 0);
    expect(rel(out.E[0], 17.975)).toBeLessThan(1e-5);
    expect(out.E[0]).toBeCloseTo(2 * K_E * 1e-9, 12);
    expect(out.E[1]).toBe(0);
    const run = runMode(FIELDS, 'charges', {});
    expect(value(run, `${R}Ex`)).toBeCloseTo(out.E[0], 12);
  });

  it('the same pair has V = 0 everywhere on x = 0', () => {
    for (const y of [-3, -0.5, 0, 0.25, 2, 40]) expect(Math.abs(superpose(DIPOLE, 0, y).V)).toBeLessThan(1e-12);
  });

  it('the field is minus the gradient of the potential', () => {
    const charges: Charge[] = [
      { x: 0.2, y: -0.4, q: 3e-9 },
      { x: -0.7, y: 0.5, q: -2e-9 },
      { x: 1.1, y: 0.9, q: 1.5e-9 },
    ];
    const h = 1e-6;
    const [x, y] = [0.35, 0.2];
    const out = superpose(charges, x, y);
    const gx = (potentialAt(charges, x + h, y) - potentialAt(charges, x - h, y)) / (2 * h);
    const gy = (potentialAt(charges, x, y + h) - potentialAt(charges, x, y - h)) / (2 * h);
    expect(rel(-gx, out.E[0])).toBeLessThan(1e-7);
    expect(rel(-gy, out.E[1])).toBeLessThan(1e-7);
  });

  it('field lines leave the positive charge, follow the field, and land on the negative one', () => {
    const lines = fieldLines(DIPOLE, viewBox(DIPOLE, [0, 0]));
    expect(lines.length).toBe(12);
    const landed = lines.filter((line) => {
      const [x, y] = line[line.length - 1];
      return Math.hypot(x - 1, y) < 0.1;
    });
    expect(landed.length).toBeGreaterThanOrEqual(6);
    // Each step points along the field.
    const line = lines[0];
    const [a, b] = [line[10], line[11]];
    const E = superpose(DIPOLE, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2).E;
    const cos =
      ((b[0] - a[0]) * E[0] + (b[1] - a[1]) * E[1]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(...E));
    expect(cos).toBeGreaterThan(0.9999);
  });

  it('says what is wrong with a point on a charge or no charge at all', () => {
    expect(problem(runMode(FIELDS, 'charges', { at: '1 0' }))).toBe('kitPhysics.fields.errors.onCharge');
    expect(problem(runMode(FIELDS, 'charges', { charges: '0 0 0' }))).toBe('kitPhysics.fields.errors.noCharge');
    expect(problem(runMode(FIELDS, 'charges', { at: '1' }))).toBe('kitPhysics.errors.count');
  });
});

describe('fields: Gauss and capacitors', () => {
  it('Gauss’s law agrees with Coulomb’s law and is continuous at the surface', () => {
    expect(gauss('point', 1e-9, 0.3, 0).E).toBeCloseTo(superpose([{ x: 0, y: 0, q: 1e-9 }], 0.3, 0).magnitude, 10);
    expect(gauss('solidSphere', 1e-9, 0.05, 0.05).E).toBeCloseTo(gauss('point', 1e-9, 0.05, 0).E, 9);
    expect(gauss('solidSphere', 1e-9, 0.05 - 1e-12, 0.05).E).toBeCloseTo(gauss('point', 1e-9, 0.05, 0).E, 6);
    expect(gauss('shell', 1e-9, 0.01, 0.05).E).toBe(0);
    expect(gauss('sheet', 1e-9, 1, 0).E).toBeCloseTo(1e-9 / (2 * EPS0), 12);
    expect(gauss('solidCylinder', 1e-9, 0.02, 0.02).E).toBeCloseTo(gauss('line', 1e-9, 0.02, 0).E, 9);
    expect(word(runMode(FIELDS, 'gauss', { Q: '-5' }))).toBe('kitPhysics.fields.kind.inward');
  });

  it('parallel plates 0.01 m², 1 mm gap, vacuum: C = 88.542 pF', () => {
    const C = capacitance('plates', 1, { A: 0.01, d: 1e-3 });
    expect(rel(C, 88.542e-12)).toBeLessThan(1e-5);
    expect(value(runMode(FIELDS, 'capacitor', {}), `${R}C`)).toBeCloseTo(C, 20);
  });

  it('coax and spheres approach the plate formula for a thin gap, and spheres an isolated sphere for a far shell', () => {
    const [a, gap, L] = [0.1, 1e-6, 1];
    expect(rel(capacitance('coax', 1, { a, b: a + gap, L }), (EPS0 * 2 * Math.PI * a * L) / gap)).toBeLessThan(1e-5);
    expect(rel(capacitance('spheres', 1, { a, b: a + gap }), (EPS0 * 4 * Math.PI * a * a) / gap)).toBeLessThan(1e-5);
    expect(rel(capacitance('spheres', 2, { a, b: 1e9 }), capacitance('sphere', 2, { a }))).toBeLessThan(1e-9);
    expect(problem(runMode(FIELDS, 'capacitor', { kind: 'coax', b: '0.5' }))).toBe(
      'kitPhysics.fields.errors.outerRadius',
    );
  });

  it('2, 3 and 6 µF: 1 µF in series and 11 µF in parallel', () => {
    expect(combine([2e-6, 3e-6, 6e-6], 'series')).toBeCloseTo(1e-6, 18);
    expect(combine([2e-6, 3e-6, 6e-6], 'parallel')).toBeCloseTo(11e-6, 18);
    const out = runMode(FIELDS, 'combination', { V: '12' });
    expect(value(out, `${R}charge`)).toBeCloseTo(12e-6, 16);
    expect(problem(runMode(FIELDS, 'combination', { parts: '2\n0' }))).toBe('kitPhysics.fields.errors.positiveParts');
  });
});

describe('fields: magnetism', () => {
  it('a long wire with 10 A at 5 cm gives 40.000 µT, and a 5 cm loop with 10 A gives 125.66 µT at its center', () => {
    const wire = segmentField([0, 0, -1e4], [0, 0, 1e4], 10, [0.05, 0, 0]);
    expect(rel(wire[1], 40e-6)).toBeLessThan(1e-5);
    expect(Math.abs(wire[0]) + Math.abs(wire[2])).toBeLessThan(1e-18);
    // mu0 is measured (CODATA 2022), a part in 10^10 from 4 pi 10^-7.
    expect(rel(sourceField('wire', { I: 10, r: 0.05, R: 0, N: 1, length: 0, z: 0 }), 40e-6)).toBeLessThan(1e-9);
    const loop = sourceField('loop', { I: 10, r: 0, R: 0.05, N: 1, length: 0, z: 0 });
    // The plan rounds to 5 figures: 125.664 µT.
    expect(Number((loop * 1e6).toPrecision(5))).toBe(125.66);
    expect(loop).toBeCloseTo((MU0 * 10) / (2 * 0.05), 18);
    expect(value(runMode(FIELDS, 'sources', {}), `${R}B`)).toBeCloseTo(loop, 15);
  });

  it('a 720-sided polygon closes in on the circular loop, on and off its axis', () => {
    const N = 720;
    const [Rr, I, z] = [0.05, 10, 0.03];
    let B: Vec = [0, 0, 0];
    for (let k = 0; k < N; k++) {
      const a = (2 * Math.PI * k) / N;
      const b = (2 * Math.PI * (k + 1)) / N;
      const part = segmentField([Rr * Math.cos(a), Rr * Math.sin(a), 0], [Rr * Math.cos(b), Rr * Math.sin(b), 0], I, [
        0,
        0,
        z,
      ]);
      B = [B[0] + part[0], B[1] + part[1], B[2] + part[2]];
    }
    expect(rel(B[2], sourceField('loop', { I, r: 0, R: Rr, N: 1, length: 0, z }))).toBeLessThan(1e-4);
  });

  it('the square loop in the window matches 2√2 μ₀ I / (π a) at its center', () => {
    const out = runMode(FIELDS, 'segments', {});
    expect(value(out, `${R}Bz`)).toBeCloseTo((2 * Math.SQRT2 * MU0 * 2) / (Math.PI * 0.1), 15);
  });

  it('a long solenoid approaches μ₀ n I, a toroid follows μ₀ N I / (2π r), and a solid wire is continuous at its surface', () => {
    const long = sourceField('solenoid', { I: 2, r: 0, R: 0.01, N: 1000, length: 1, z: 0 });
    expect(long).toBeCloseTo(MU0 * 1000 * 2 * (0.5 / Math.hypot(0.5, 0.01)), 15);
    expect(rel(long, MU0 * 1000 * 2)).toBeLessThan(3e-4);
    expect(sourceField('toroid', { I: 2, r: 0.1, R: 0, N: 500, length: 0, z: 0 })).toBeCloseTo(
      (MU0 * 500 * 2) / (2 * Math.PI * 0.1),
      15,
    );
    const atSurface = sourceField('wire', { I: 5, r: 0.002 - 1e-12, R: 0.002, N: 1, length: 0, z: 0 });
    expect(rel(atSurface, (MU0 * 5) / (2 * Math.PI * 0.002))).toBeLessThan(1e-8);
  });

  it('a proton at 10⁵ m/s across 0.5 T: F = qvB along -y, r = 2.0879 mm', () => {
    const out = lorentz(E_CHARGE, [1e5, 0, 0], [0, 0, 0], [0, 0, 0.5], M_P);
    expect(out.force[1]).toBeCloseTo(-E_CHARGE * 1e5 * 0.5, 25);
    expect(out.radius ?? NaN).toBeCloseTo((M_P * 1e5) / (E_CHARGE * 0.5), 12);
    expect(Number((out.radius ?? NaN).toPrecision(5))).toBe(0.0020879);
    expect(problem(runMode(FIELDS, 'force', { q: '0' }))).toBe('kitPhysics.fields.errors.zeroCharge');
    expect(value(runMode(FIELDS, 'force', { on: 'wire' }), `${R}Fy`)).toBeCloseTo(-5 * 0.5 * 0.5, 12);
  });

  it('induction: Faraday, motional, generator, and solenoid inductance', () => {
    expect(value(runMode(FIELDS, 'induction', {}), `${R}emf`)).toBeCloseTo(-2, 12);
    expect(value(runMode(FIELDS, 'induction', { kind: 'motional' }), `${R}emf`)).toBeCloseTo(0.2, 12);
    expect(value(runMode(FIELDS, 'induction', { kind: 'generator' }), `${R}peak`)).toBeCloseTo(
      100 * 0.5 * 0.002 * 2 * Math.PI * 60,
      10,
    );
    expect(value(runMode(FIELDS, 'induction', { kind: 'inductor' }), `${R}L`)).toBeCloseTo(
      (MU0 * 1e4 * 0.002) / 0.1,
      15,
    );
  });
});
