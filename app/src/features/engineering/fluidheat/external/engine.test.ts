import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import { blasius, bodyDrag, flatPlate, sphereCd, terminalVelocity } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('flat plate', () => {
  it('air plate U 10 m/s, L 1 m, nu 1.5e-5 (mixed boundary layer)', () => {
    const r = flatPlate({ speed: 10, length: 1, nu: 1.5e-5, density: 1.2 });
    expect(rel(r.reL, 6.667e5)).toBeLessThan(1e-4);
    expect(r.regime).toBe('mixed');
    expect(r.transitionAt).toBeCloseTo(0.75, 9);
    // laminar numbers at the same Reynolds number
    const lam = flatPlate({ speed: 10, length: 1, nu: 1.5e-5, transitionRe: 1e7 });
    expect(rel(lam.delta, 6.124e-3)).toBeLessThan(1e-3);
    expect(rel(lam.cfAverage, 1.6265e-3)).toBeLessThan(1e-4);
    expect(rel(r.cfAverage, 2.4505e-3)).toBeLessThan(1e-4);
    // independent: the mixed CD is the laminar part over 0.75 m plus the turbulent part, area-weighted
    const rex = 5e5;
    const cdLam = 1.328 / Math.sqrt(rex);
    const cdTurbFull = 0.074 * r.reL ** -0.2; // the mixed formula uses the rounded constant 1742
    const cdTurbPart = 0.074 * rex ** -0.2;
    const mixed = cdTurbFull - (cdTurbPart - cdLam) * (rex / r.reL);
    expect(rel(r.cfAverage, mixed)).toBeLessThan(1e-3);
    expect(r.drag).toBeCloseTo(r.cfAverage * 0.5 * 1.2 * 100, 9);
  });
  it('fully turbulent when tripped', () => {
    const r = flatPlate({ speed: 10, length: 1, nu: 1.5e-5, tripped: true });
    expect(r.regime).toBe('turbulent');
    expect(r.cfAverage).toBeCloseTo(0.074 * (10 / 1.5e-5) ** -0.2, 12);
    expect(r.delta).toBeCloseTo(0.37 * (10 / 1.5e-5) ** -0.2, 12);
  });
  it('Blasius solution gives the textbook thicknesses', () => {
    const { eta, uOverU } = blasius(10, 1000);
    const i99 = uOverU.findIndex((u) => u >= 0.99);
    expect(eta[i99]!).toBeGreaterThan(4.9);
    expect(eta[i99]!).toBeLessThan(5.01);
    // displacement thickness = integral of (1 - u/U) d eta = 1.7208
    let ds = 0;
    let th = 0;
    for (let i = 1; i < eta.length; i++) {
      const h = eta[i]! - eta[i - 1]!;
      ds += (h * (1 - uOverU[i]! + 1 - uOverU[i - 1]!)) / 2;
      th += (h * (uOverU[i]! * (1 - uOverU[i]!) + uOverU[i - 1]! * (1 - uOverU[i - 1]!))) / 2;
    }
    expect(ds).toBeCloseTo(1.7208, 3);
    expect(th).toBeCloseTo(0.664, 3);
    const r = flatPlate({ speed: 1, length: 1, nu: 1e-5 });
    expect(r.displacement / r.delta).toBeCloseTo(1.7208 / 5, 3);
  });
  it('rejects bad input', () => {
    expect(() => flatPlate({ speed: 0, length: 1, nu: 1e-5 })).toThrow(CalcError);
    expect(() => flatPlate({ speed: 1, length: -1, nu: 1e-5 })).toThrow(CalcError);
    expect(() => flatPlate({ speed: 1, length: 1, nu: 0 })).toThrow(CalcError);
  });
  it('warns when the flow is too slow for boundary-layer theory', () => {
    expect(flatPlate({ speed: 1e-4, length: 0.1, nu: 1.5e-5 }).warnings).toContain('fhExtWarnLowRe');
  });
});

describe('sphere drag and settling', () => {
  const sand = { diameter: 1e-4, sphereDensity: 2650, fluidDensity: 998.2, viscosity: 1.0016e-3, g: 9.81 };
  it('Stokes settling of a sand grain', () => {
    const r = terminalVelocity({ ...sand, model: 'stokes' });
    expect(rel(r.velocity, 8.988e-3)).toBeLessThan(1e-3);
    expect(rel(r.re, 0.896)).toBeLessThan(1e-3);
    expect(r.rises).toBe(false);
  });
  it('Schiller-Naumann settling of the same grain', () => {
    const r = terminalVelocity({ ...sand, model: 'schillerNaumann' });
    expect(rel(r.velocity, 7.968e-3)).toBeLessThan(1e-3);
    // the force balance holds
    const area = (Math.PI * sand.diameter ** 2) / 4;
    const drag = r.cd * 0.5 * 998.2 * r.velocity ** 2 * area;
    const net = ((2650 - 998.2) * 9.81 * (Math.PI * sand.diameter ** 3)) / 6;
    expect(rel(drag, net)).toBeLessThan(1e-9);
  });
  it('a bubble rises, a fixed drag coefficient follows the closed form', () => {
    const b = terminalVelocity({ diameter: 1e-3, sphereDensity: 1.2, fluidDensity: 998, viscosity: 1e-3 });
    expect(b.rises).toBe(true);
    const f = terminalVelocity({
      diameter: 0.1,
      sphereDensity: 7800,
      fluidDensity: 1.2,
      viscosity: 1.8e-5,
      model: 'fixed',
      fixedCd: 0.47,
      g: 9.81,
    });
    const area = (Math.PI * 0.1 ** 2) / 4;
    expect(f.velocity).toBeCloseTo(
      Math.sqrt((2 * (7800 - 1.2) * 9.81 * (Math.PI * 0.1 ** 3)) / 6 / (0.47 * 1.2 * area)),
      9,
    );
  });
  it('the drag coefficient is continuous enough across the correlation switch', () => {
    expect(Math.abs(sphereCd(799, 'schillerNaumann') - sphereCd(801, 'schillerNaumann'))).toBeLessThan(0.1);
    expect(sphereCd(0.1, 'stokes')).toBeCloseTo(240, 9);
  });
  it('warns outside Stokes range and rejects a neutrally buoyant sphere', () => {
    expect(
      terminalVelocity({ diameter: 1e-2, sphereDensity: 2650, fluidDensity: 998, viscosity: 1e-3, model: 'stokes' })
        .warnings,
    ).toContain('fhExtWarnStokes');
    expect(() => terminalVelocity({ ...sand, sphereDensity: 998.2 })).toThrow(/neutrally/);
    expect(() => terminalVelocity({ ...sand, diameter: 0 })).toThrow(CalcError);
  });
  it('body drag and power', () => {
    const r = bodyDrag({ cd: 0.3, density: 1.2, speed: 30, area: 2 });
    expect(r.drag).toBeCloseTo(0.3 * 0.5 * 1.2 * 900 * 2, 9);
    expect(r.power).toBeCloseTo(r.drag * 30, 9);
    expect(bodyDrag({ cd: 0.3, density: 1.2, speed: 0, area: 2 }).drag).toBe(0);
    expect(() => bodyDrag({ cd: 0.3, density: 1.2, speed: -1, area: 2 })).toThrow(CalcError);
  });
});
