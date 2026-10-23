import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import {
  CORRELATIONS,
  correlate,
  filmTemperature,
  massCoefficient,
  rayleigh,
  suggestPlate,
  tubeFlow,
  type CorrelationId,
  type Fluid,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
// choose a fluid with the stated Pr and unit nu so Re = V L; k = 1 so h = Nu / L
const fluid = (pr: number, extra: Partial<Fluid> = {}): Fluid => ({ k: 1, nu: 1, pr, ...extra });

describe('forced convection, planned cases', () => {
  it('Churchill-Bernstein Re 1e4, Pr 0.7: Nu = 53.328', () => {
    expect(rel(correlate('cylinderCross', fluid(0.7), { length: 1, velocity: 1e4 }).nusselt, 53.328)).toBeLessThan(
      1e-4,
    );
  });
  it('Dittus-Boelter Re 5e4, Pr 5, heating: Nu = 251.47', () => {
    expect(
      rel(correlate('dittusBoelter', fluid(5), { length: 1, velocity: 5e4, heating: true }).nusselt, 251.47),
    ).toBeLessThan(1e-4);
  });
  it('Gnielinski Re 5e4, Pr 5: Nu = 285.17', () => {
    const r = correlate('gnielinski', fluid(5), { length: 1, velocity: 5e4 });
    expect(rel(r.nusselt, 285.17)).toBeLessThan(1e-4);
    expect(r.frictionFactor).toBeCloseTo((0.79 * Math.log(5e4) - 1.64) ** -2, 14);
  });
  it('laminar plate average Re 1e5, Pr 0.7: Nu = 186.44', () => {
    expect(rel(correlate('plateLaminar', fluid(0.7), { length: 1, velocity: 1e5 }).nusselt, 186.44)).toBeLessThan(1e-4);
  });
  it('Whitaker sphere Re 1e3, Pr 0.71: Nu = 18.262', () => {
    expect(rel(correlate('sphereWhitaker', fluid(0.71), { length: 1, velocity: 1e3 }).nusselt, 18.262)).toBeLessThan(
      1e-4,
    );
  });
  it('the local laminar value is half the average', () => {
    const a = correlate('plateLocal', fluid(0.7), { length: 1, velocity: 1e5 }).nusselt;
    const b = correlate('plateLaminar', fluid(0.7), { length: 1, velocity: 1e5 }).nusselt;
    expect(b / a).toBeCloseTo(2, 12);
  });
  it('h is Nu k / L', () => {
    const r = correlate('plateLaminar', { k: 0.026, nu: 1.6e-5, pr: 0.71 }, { length: 0.5, velocity: 3 });
    expect(r.h).toBeCloseTo((r.nusselt * 0.026) / 0.5, 12);
    expect(r.re).toBeCloseTo((3 * 0.5) / 1.6e-5, 6);
  });
});

describe('natural convection, planned case', () => {
  it('Churchill-Chu vertical plate Ra 1e9, Pr 0.71: Nu = 122.86', () => {
    // alpha = nu/Pr, so choose g beta dT L^3 = Ra nu alpha
    const nu = 1;
    const pr = 0.71;
    const alpha = nu / pr;
    const betaDt = (1e9 * nu * alpha) / 9.80665;
    const r = correlate('verticalPlateFull', { k: 1, nu, pr }, { length: 1, deltaT: 1, beta: betaDt });
    expect(rel(r.ra!, 1e9)).toBeLessThan(1e-12);
    expect(rel(r.nusselt, 122.86)).toBeLessThan(1e-4);
  });
  it('the laminar and full-range forms agree for modest Ra, and cylinders and spheres give sensible numbers', () => {
    const f = { k: 0.026, nu: 1.6e-5, pr: 0.71 };
    const g = { length: 0.3, deltaT: 20, beta: 1 / 300 };
    const a = correlate('verticalPlateLaminar', f, g).nusselt;
    const b = correlate('verticalPlateFull', f, g).nusselt;
    expect(Math.abs(a - b) / a).toBeLessThan(0.2);
    // sphere with Ra -> 0 tends to the conduction limit Nu = 2
    const s = correlate('sphereNatural', f, { length: 1e-4, deltaT: 1, beta: 1 / 300 });
    expect(s.nusselt).toBeCloseTo(2, 1);
    expect(correlate('horizontalCylinder', f, { length: 0.05, deltaT: 50, beta: 1 / 320 }).nusselt).toBeGreaterThan(2);
  });
  it('McAdams horizontal plate switches at Ra = 1e7', () => {
    const f = fluid(0.71);
    const mk = (ra: number) => ({ length: 1, deltaT: 1, beta: (ra * 1 * (1 / 0.71)) / 9.80665 });
    expect(correlate('horizontalPlateUp', f, mk(1e6)).nusselt).toBeCloseTo(0.54 * 1e6 ** 0.25, 6);
    expect(correlate('horizontalPlateUp', f, mk(1e8)).nusselt).toBeCloseTo(0.15 * 1e8 ** (1 / 3), 5);
    expect(correlate('horizontalPlateDown', f, mk(1e6)).nusselt).toBeCloseTo(0.27 * 1e6 ** 0.25, 6);
  });
  it('rayleigh rejects a missing or non-positive temperature difference and beta', () => {
    expect(() => rayleigh(fluid(0.7), { length: 1, beta: 0.003 })).toThrow(CalcError);
    expect(() => rayleigh(fluid(0.7), { length: 1, deltaT: 0, beta: 0.003 })).toThrow(CalcError);
    expect(() => rayleigh(fluid(0.7), { length: 1, deltaT: 10 })).toThrow(CalcError);
  });
});

describe('validity ranges and errors', () => {
  it('flags values outside the stated range without refusing them', () => {
    expect(correlate('dittusBoelter', fluid(5), { length: 1, velocity: 5e3 }).warnings).toContain('fhConvWarnRange');
    expect(correlate('dittusBoelter', fluid(5), { length: 1, velocity: 5e4 }).warnings).toEqual([]);
    expect(correlate('plateLaminar', fluid(0.7), { length: 1, velocity: 1e6 }).warnings).toContain(
      'fhConvWarnTurbulent',
    );
    expect(correlate('gnielinski', fluid(5), { length: 1, velocity: 2000 }).warnings).toContain('fhConvWarnRange');
    expect(correlate('tubeLaminarTemp', fluid(5), { length: 1, velocity: 5000 }).warnings).toContain(
      'fhConvWarnTurbulent',
    );
  });
  it('rejects non-physical input', () => {
    expect(() => correlate('plateLaminar', fluid(0.7), { length: 1, velocity: 0 })).toThrow(CalcError);
    expect(() => correlate('plateLaminar', fluid(0.7), { length: 1 })).toThrow(CalcError);
    expect(() => correlate('plateLaminar', fluid(-1), { length: 1, velocity: 1 })).toThrow(CalcError);
    expect(() => correlate('plateLaminar', { k: 0, nu: 1, pr: 1 }, { length: 1, velocity: 1 })).toThrow(CalcError);
    expect(() => correlate('tubeEntry', fluid(5), { length: 1, velocity: 100 })).toThrow(CalcError);
    expect(() => correlate('nonsense' as CorrelationId, fluid(5), { length: 1, velocity: 100 })).toThrow(CalcError);
  });
  it('every listed correlation computes with sensible inputs', () => {
    for (const c of CORRELATIONS) {
      const r = correlate(
        c.id,
        { k: 0.6, nu: 1e-6, pr: 7 },
        { length: 0.05, velocity: c.group === 'internal' ? 0.5 : 20, deltaT: 10, beta: 2e-4, tubeLength: 2 },
      );
      expect(r.nusselt).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThan(2);
    }
  });
  it('the entrance-region Nusselt number falls toward 3.66 for a long tube', () => {
    const long = correlate('tubeEntry', fluid(5), { length: 1, velocity: 1000, tubeLength: 1e6 }).nusselt;
    const short = correlate('tubeEntry', fluid(5), { length: 1, velocity: 1000, tubeLength: 10 }).nusselt;
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThan(3.66);
  });
});

describe('tube energy balance and helpers', () => {
  const props = () => ({ fluid: { k: 0.6, nu: 1e-6, pr: 7 }, cp: 4180, density: 1000 });
  it('constant surface temperature obeys the log-mean energy balance', () => {
    const r = tubeFlow({
      diameter: 0.02,
      length: 3,
      massFlow: 0.1,
      tIn: 20,
      wall: { kind: 'temperature', value: 90 },
      correlation: 'dittusBoelter',
      propsAt: props,
    });
    const P = Math.PI * 0.02;
    expect(r.tOut).toBeCloseTo(90 - 70 * Math.exp((-r.h * P * 3) / (0.1 * 4180)), 9);
    expect(r.heat).toBeCloseTo(0.1 * 4180 * (r.tOut - 20), 6);
    // the same heat from h A dT_lm
    const dt1 = 70;
    const dt2 = 90 - r.tOut;
    const lm = (dt1 - dt2) / Math.log(dt1 / dt2);
    expect(rel(r.heat, r.h * P * 3 * lm)).toBeLessThan(1e-9);
  });
  it('constant flux raises the temperature linearly', () => {
    const r = tubeFlow({
      diameter: 0.02,
      length: 3,
      massFlow: 0.1,
      tIn: 20,
      wall: { kind: 'flux', value: 5000 },
      correlation: 'gnielinski',
      propsAt: props,
    });
    expect(r.tOut).toBeCloseTo(20 + (5000 * Math.PI * 0.02 * 3) / (0.1 * 4180), 9);
  });
  it('properties are re-evaluated at the bulk temperature until they settle', () => {
    let calls = 0;
    const r = tubeFlow({
      diameter: 0.02,
      length: 3,
      massFlow: 0.1,
      tIn: 20,
      wall: { kind: 'temperature', value: 90 },
      correlation: 'dittusBoelter',
      propsAt: (tb) => {
        calls++;
        return { fluid: { k: 0.55 + 0.001 * tb, nu: 1e-6 * (1.5 - 0.01 * tb), pr: 7 }, cp: 4180, density: 1000 };
      },
    });
    expect(r.iterations).toBeGreaterThan(1);
    expect(calls).toBe(r.iterations);
    expect(r.tBulk).toBeCloseTo((20 + r.tOut) / 2, 12);
  });
  it('rejects bad tubes and helpers', () => {
    expect(() =>
      tubeFlow({
        diameter: 0,
        length: 3,
        massFlow: 0.1,
        tIn: 20,
        wall: { kind: 'flux', value: 1 },
        correlation: 'gnielinski',
        propsAt: props,
      }),
    ).toThrow(CalcError);
    expect(massCoefficient(100, 2e-5, 0.1)).toBeCloseTo(0.02, 12);
    expect(() => massCoefficient(0, 2e-5, 0.1)).toThrow(CalcError);
    expect(filmTemperature(80, 20)).toBe(50);
    expect(suggestPlate(1e5)).toBe('plateLaminar');
    expect(suggestPlate(1e6)).toBe('plateMixed');
  });
});
