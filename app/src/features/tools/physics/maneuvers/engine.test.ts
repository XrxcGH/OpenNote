// The orbital maneuvers tool against its validation cases (first principles) and independent working: energy
// bookkeeping on the transfer ellipse, the bi-elliptic crossover ratio, a phasing orbit that meets its target, and
// Lambert solutions checked by propagation.
import '../text';
import { describe, expect, it } from 'vitest';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import { EARTH, propagate } from '../orbits/engine';
import type { Vec } from '../orbits/engine';
import { biElliptic, hohmann, lambert, phasing, planeChange } from './engine';
import { MANEUVERS } from './spec';

const R = 'kitPhysics.maneuvers.r.';
const MU = EARTH.mu;
const D2R = Math.PI / 180;
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const word = (out: Outcome) => (out.ok ? out.rows.find((row) => row.word)?.word : null);

describe('maneuvers: transfers', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(MANEUVERS)).toEqual([]);
  });

  it('Hohmann 6678 km to 42164 km: 2.42577 + 1.46684 = 3.89261 km/s in 5.2750 h', () => {
    const out = hohmann(6678e3, 42164e3, MU);
    expect(rel(out.dv1 / 1000, 2.42577)).toBeLessThan(1e-5);
    expect(rel(out.dv2 / 1000, 1.46684)).toBeLessThan(1e-5);
    expect(rel(out.total / 1000, 3.89261)).toBeLessThan(1e-5);
    expect(rel(out.time / 3600, 5.275)).toBeLessThan(1e-5);
    // Energy on the transfer ellipse is the same at both ends: v²/2 - mu/r = -mu/(2a).
    expect(out.vt1 ** 2 / 2 - MU / 6678e3).toBeCloseTo(-MU / (2 * out.a), 3);
    expect(out.vt2 ** 2 / 2 - MU / 42164e3).toBeCloseTo(-MU / (2 * out.a), 3);
    expect(value(runMode(MANEUVERS, 'hohmann', {}), `${R}total`)).toBeCloseTo(out.total, 9);
  });

  it('with a 28.5° plane change at apogee: 1.83023 km/s there, 4.25600 km/s in all', () => {
    const out = hohmann(6678e3, 42164e3, MU, 28.5 * D2R);
    expect(rel(out.dv2 / 1000, 1.83023)).toBeLessThan(1e-5);
    expect(rel(out.total / 1000, 4.256)).toBeLessThan(1e-5);
    // Cheaper than the same plane change made separately in low orbit.
    expect(out.total).toBeLessThan(
      hohmann(6678e3, 42164e3, MU).total + planeChange(Math.sqrt(MU / 6678e3), 28.5 * D2R),
    );
  });

  it('ratio 15 in circular-speed units: Hohmann 0.53622; bi-elliptic 0.53386 (rb 30) and 0.52925 (rb 60)', () => {
    expect(rel(hohmann(1, 15, 1).total, 0.53622)).toBeLessThan(1e-4);
    expect(Math.abs(hohmann(1, 15, 1).total - 0.53622)).toBeLessThan(1e-5);
    expect(Math.abs(biElliptic(1, 15, 30, 1).total - 0.53386)).toBeLessThan(1e-5);
    expect(Math.abs(biElliptic(1, 15, 60, 1).total - 0.52925)).toBeLessThan(1e-5);
    // With rb = r2 the bi-elliptic transfer is the Hohmann transfer.
    expect(biElliptic(1, 15, 15, 1).total).toBeCloseTo(hohmann(1, 15, 1).total, 14);
    // Below a ratio of 11.94 Hohmann wins for every rb.
    for (const rb of [12, 50, 1e4]) expect(biElliptic(1, 11, rb, 1).total).toBeGreaterThan(hohmann(1, 11, 1).total);
    const run = runMode(MANEUVERS, 'bielliptic', {});
    expect(word(run)).toBe('kitPhysics.maneuvers.kind.biBetter');
    expect(problem(runMode(MANEUVERS, 'bielliptic', { rb: '50000' }))).toBe('kitPhysics.maneuvers.errors.rbSmall');
  });

  it('plane changes and phasing orbits', () => {
    expect(planeChange(7000, 60 * D2R)).toBeCloseTo(7000, 9);
    const out = phasing(6778e3, 30 * D2R, 5, MU, EARTH.radius);
    // After 5 phasing orbits the target has gone 5 turns less the 30° it was ahead.
    const n = Math.sqrt(MU / 6778e3 ** 3);
    expect(n * out.wait).toBeCloseTo(10 * Math.PI - 30 * D2R, 10);
    expect(out.other).toBeLessThan(6778e3);
    expect(problem(runMode(MANEUVERS, 'phasing', { phase: '300' }))).toBe('kitPhysics.maneuvers.errors.phasingLow');
    expect(problem(runMode(MANEUVERS, 'phasing', { revs: '1.5' }))).toBe('kitPhysics.maneuvers.errors.wholeRevs');
  });
});

describe('maneuvers: Lambert', () => {
  it('positions at t = 0 and 3000 s of the orbits-tool state recover v1 = (-1, 6.5, 2) km/s', () => {
    const r1: Vec = [8000e3, 2000e3, 1000e3];
    const v1: Vec = [-1e3, 6.5e3, 2e3];
    const end = propagate(r1, v1, 3000, MU);
    const out = lambert(r1, end.r, 3000, MU);
    out.v1.forEach((x, k) => expect(rel(x, v1[k])).toBeLessThan(1e-6));
    out.v2.forEach((x, k) => expect(rel(x, end.v[k])).toBeLessThan(1e-6));
    const run = runMode(MANEUVERS, 'lambert', {});
    expect(value(run, `${R}v1y`)).toBeCloseTo(6500, 2);
    expect(value(run, `${R}miss`)).toBeLessThan(1);
  });

  it('solves a hyperbolic transfer and a long-way retrograde one, each landing on r2', () => {
    const r1: Vec = [7000e3, 0, 0];
    const r2: Vec = [0, 9000e3, 1000e3];
    for (const [dt, prograde] of [
      [600, true],
      [5000, false],
      // A long time of flight still has a single-revolution answer, on a very eccentric orbit.
      [200000, true],
    ] as const) {
      const out = lambert(r1, r2, dt, MU, prograde);
      const land = propagate(r1, out.v1, dt, MU).r;
      expect(Math.hypot(land[0] - r2[0], land[1] - r2[1], land[2] - r2[2])).toBeLessThan(1e-3);
    }
    expect(problem(runMode(MANEUVERS, 'lambert', { r2: '-8000 -2000 -1000' }))).toBe(
      'kitPhysics.maneuvers.errors.collinear',
    );
  });
});
