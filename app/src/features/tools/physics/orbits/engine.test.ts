// The orbital mechanics tool against its validation cases (first principles) and independent working: elements and
// state vectors round trip, propagation agrees with Kepler's equation and keeps energy and angular momentum, and a
// ground track turns with Earth.
import { describe, expect, it } from 'vitest';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import {
  EARTH,
  eccentricFromTrue,
  eclipseFraction,
  elementsToState,
  groundTrack,
  j2Rates,
  meanFromEccentric,
  period,
  propagate,
  radiusForPeriod,
  solveKepler,
  stateToElements,
  sunSynchronous,
  trueFromEccentric,
} from './engine';
import type { Vec } from './engine';
import { ORBITS } from './spec';

const R = 'kitPhysics.orbits.r.';
const MU = EARTH.mu;
const D2R = Math.PI / 180;
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const R0: Vec = [8000e3, 2000e3, 1000e3];
const V0: Vec = [-1e3, 6.5e3, 2e3];
const norm = (v: Vec) => Math.hypot(...v);
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Propagation by Kepler's equation from the elements, as an independent check of universal variables. */
function byKepler(r: Vec, v: Vec, dt: number): { r: Vec; v: Vec } {
  const el = stateToElements(r, v, MU);
  const n = Math.sqrt(MU / Math.abs(el.a) ** 3);
  const M = meanFromEccentric(eccentricFromTrue(el.nu, el.e), el.e) + n * dt;
  const nu = trueFromEccentric(solveKepler(M, el.e).E, el.e);
  return elementsToState(el.a, el.e, el.i, el.raan, el.argp, nu, MU);
}

describe('orbits: elements and state vectors', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(ORBITS)).toEqual([]);
  });

  it('r (8000, 2000, 1000) km, v (-1, 6.5, 2) km/s: the plan’s six elements', () => {
    const el = stateToElements(R0, V0, MU);
    expect(rel(el.a / 1000, 8181.17)).toBeLessThan(1e-5);
    expect(rel(el.e, 0.123536)).toBeLessThan(1e-5);
    expect(rel(el.i / D2R, 17.6511)).toBeLessThan(1e-5);
    expect(rel(el.raan / D2R, 351.6341)).toBeLessThan(1e-5);
    expect(rel(el.argp / D2R, 279.2738)).toBeLessThan(1e-5);
    expect(rel(el.nu / D2R, 104.1185)).toBeLessThan(1e-5);
    const out = runMode(ORBITS, 'state', {});
    expect(value(out, `${R}a`)).toBeCloseTo(el.a, 6);
  });

  it('elements and state vectors round trip, for an ellipse and a hyperbola', () => {
    const el = stateToElements(R0, V0, MU);
    const back = elementsToState(el.a, el.e, el.i, el.raan, el.argp, el.nu, MU);
    back.r.forEach((x, k) => expect(x).toBeCloseTo(R0[k], 5));
    back.v.forEach((x, k) => expect(x).toBeCloseTo(V0[k], 8));
    const hyp = elementsToState(-20000e3, 1.4, 0.6, 1.1, 2.2, 0.3, MU);
    const again = stateToElements(hyp.r, hyp.v, MU);
    expect(again.a).toBeCloseTo(-20000e3, 3);
    expect(again.e).toBeCloseTo(1.4, 12);
    expect(again.argp).toBeCloseTo(2.2, 11);
    expect(again.nu).toBeCloseTo(0.3, 11);
  });

  it('handles circular, equatorial and retrograde orbits with notes', () => {
    const circ = runMode(ORBITS, 'state', { r: '7000 0 0', v: `0 ${Math.sqrt(MU / 7e6) / 1000} 0` });
    expect(circ.ok && circ.notes?.map((note) => note.key)).toEqual([
      'kitPhysics.orbits.notes.twoBody',
      'kitPhysics.orbits.notes.equatorial',
      'kitPhysics.orbits.notes.circular',
    ]);
    const retro = stateToElements([7000e3, 0, 0], [0, -7e3, 1e3], MU);
    expect(retro.i).toBeGreaterThan(Math.PI / 2);
    expect(problem(runMode(ORBITS, 'state', { v: '8 2 1' }))).toBe('kitPhysics.orbits.errors.radial');
    expect(problem(runMode(ORBITS, 'state', { r: '100 0 0' }))).toBe('kitPhysics.orbits.errors.inside');
    expect(problem(runMode(ORBITS, 'elements', { e: '1' }))).toBe('kitPhysics.orbits.errors.parabola');
  });
});

describe('orbits: Kepler and propagation', () => {
  it('Kepler M = 1 rad, e = 0.5: E = 1.498701 rad', () => {
    const { E } = solveKepler(1, 0.5);
    expect(Math.abs(E - 1.498701)).toBeLessThan(1e-6);
    expect(E - 0.5 * Math.sin(E)).toBeCloseTo(1, 15);
    expect(value(runMode(ORBITS, 'kepler', {}), `${R}E`)).toBeCloseTo(E, 14);
    // High eccentricities and hyperbolas converge too.
    for (const e of [0.9, 0.99, 0.999])
      for (const M of [0.01, 1, 3.1]) {
        const out = solveKepler(M, e).E;
        expect(out - e * Math.sin(out)).toBeCloseTo(M, 12);
      }
    const F = solveKepler(5, 2.5).E;
    expect(2.5 * Math.sinh(F) - F).toBeCloseTo(5, 12);
  });

  it('propagating that state 3000 s gives the plan’s r and v', () => {
    const out = propagate(R0, V0, 3000, MU);
    const r: Vec = [-6461.51e3, 5797.03e3, 1525.85e3];
    const v: Vec = [-3.90596e3, -4.8529e3, -1.7086e3];
    // The plan gives km to 2 decimals and km/s to 5, so compare at those digits.
    r.forEach((x, k) => expect(Number((out.r[k] / 1000).toFixed(2))).toBe(x / 1000));
    v.forEach((x, k) => expect(Number((out.v[k] / 1000).toFixed(5))).toBe(x / 1000));
    const kepler = byKepler(R0, V0, 3000);
    out.r.forEach((x, k) => expect(x).toBeCloseTo(kepler.r[k], 3));
    out.v.forEach((x, k) => expect(x).toBeCloseTo(kepler.v[k], 6));
    // Energy and angular momentum stay put.
    const energy = (rr: Vec, vv: Vec) => norm(vv) ** 2 / 2 - MU / norm(rr);
    expect(rel(energy(out.r, out.v), energy(R0, V0))).toBeLessThan(1e-12);
    expect(rel(norm(cross(out.r, out.v)), norm(cross(R0, V0)))).toBeLessThan(1e-12);
  });

  it('propagates many periods, backward, and on a hyperbola', () => {
    const T = period(stateToElements(R0, V0, MU).a, MU);
    const later = propagate(R0, V0, 1000 * T + 3000, MU);
    const once = propagate(R0, V0, 3000, MU);
    later.r.forEach((x, k) => expect(x).toBeCloseTo(once.r[k], -1));
    const back = propagate(once.r, once.v, -3000, MU);
    back.r.forEach((x, k) => expect(x).toBeCloseTo(R0[k], 3));
    const hyp = elementsToState(-20000e3, 1.4, 0.6, 1.1, 2.2, -0.5, MU);
    const out = propagate(hyp.r, hyp.v, 7200, MU);
    const kepler = byKepler(hyp.r, hyp.v, 7200);
    out.r.forEach((x, k) => expect(rel(x, kepler.r[k])).toBeLessThan(1e-9));
  });
});

describe('orbits: periods, J2, ground tracks and eclipses', () => {
  it('period at a = 7000 km is 5828.52 s; one sidereal day gives the geostationary radius 42164.17 km', () => {
    expect(rel(period(7000e3, MU), 5828.52)).toBeLessThan(1e-6);
    expect(rel(radiusForPeriod(86164.0905, MU) / 1000, 42164.17)).toBeLessThan(1e-6);
    expect(rel(value(runMode(ORBITS, 'basics', { given: 'period' }), `${R}a`) / 1000, 42164.17)).toBeLessThan(1e-6);
    expect(value(runMode(ORBITS, 'basics', { given: 'axis' }), `${R}period`)).toBeCloseTo(period(7000e3, MU), 9);
    expect(problem(runMode(ORBITS, 'basics', { hp: '500', ha: '300' }))).toBe('kitPhysics.orbits.errors.apsesOrder');
  });

  it('a circular orbit at 700 km is Sun-synchronous at 98.188°', () => {
    const i = sunSynchronous(EARTH.radius + 700e3, 0, EARTH) ?? NaN;
    expect(Math.abs(i / D2R - 98.188)).toBeLessThan(1e-3);
    // At that inclination the node turns once a year, eastward.
    const { raanRate } = j2Rates(EARTH.radius + 700e3, 0, i, EARTH);
    expect((raanRate * 365.2421897 * 86400) / (2 * Math.PI)).toBeCloseTo(1, 9);
    expect(j2Rates(EARTH.radius + 400e3, 0, 51.6 * D2R, EARTH).raanRate).toBeLessThan(0);
    expect(sunSynchronous(EARTH.radius + 20000e3, 0, EARTH)).toBeNull();
  });

  it('a ground track starts on the equator, peaks at the inclination, and shifts west by Earth’s turn', () => {
    const a = EARTH.radius + 700e3;
    const el = { a, e: 0, i: 51.6 * D2R, raan: 0, argp: 0, nu: 0 };
    const T = period(a, MU);
    const points = groundTrack(el, T, EARTH, 0, false, 720);
    expect(points[0][0]).toBeCloseTo(0, 12);
    expect(Math.max(...points.map(([lat]) => lat))).toBeCloseTo(51.6 * D2R, 4);
    const shift = points[720][1] - points[0][1];
    expect(shift).toBeCloseTo(-EARTH.rotation * T, 10);
  });

  it('eclipses at 700 km: the cylindrical-shadow fraction, none past the beta limit', () => {
    const r = EARTH.radius + 700e3;
    const h = 700e3;
    expect(eclipseFraction(r, 0, EARTH.radius)).toBeCloseTo(
      Math.acos(Math.sqrt(h * h + 2 * EARTH.radius * h) / r) / Math.PI,
      15,
    );
    // At beta = 0 the shadow's half-angle is where the line of sight grazes Earth: sin = R / r.
    expect(eclipseFraction(r, 0, EARTH.radius) * Math.PI).toBeCloseTo(Math.asin(EARTH.radius / r), 12);
    expect(eclipseFraction(r, 70 * D2R, EARTH.radius)).toBe(0);
    expect(value(runMode(ORBITS, 'eclipse', {}), `${R}eclipseTime`)).toBeCloseTo(
      eclipseFraction(r, 0, EARTH.radius) * period(r, MU),
      9,
    );
  });
});
