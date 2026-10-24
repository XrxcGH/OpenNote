import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { chokedMassFlow, criticalRatios, nozzle, type NozzleInput } from './engine';

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);
const base: NozzleInput = { areaRatio: 2, p0: 500e3, T0: 600, pb: 0, gamma: 1.4, R: 287, throat: 1e-4 };
const at = (pbp0: number, extra: Partial<NozzleInput> = {}) => nozzle({ ...base, pb: pbp0 * base.p0, ...extra });

describe('nozzle flow', () => {
  it('finds both exit Mach numbers for Ae/At = 2', () => {
    close(at(0.93716).exitMach, 0.3059, 1e-4);
    close(at(0.05).exitMach, 2.1972, 1e-4);
  });

  it('finds the three critical back pressures', () => {
    const [c1, c2, c3] = criticalRatios(2, 1.4);
    close(c1, 0.93716, 1e-5);
    close(c2, 0.5134, 1e-5);
    close(c3, 0.093933, 1e-5);
  });

  it('places the normal shock for pb/p0 = 0.7', () => {
    const r = at(0.7);
    expect(r.regime).toBe('shockInside');
    close(r.shock?.areaRatio ?? 0, 1.5101, 1e-4);
    close(r.exitMach, 0.40669, 1e-4);
    close(r.exitPressure / base.p0, 0.7, 1e-9);
    expect(r.steps.map((s) => s.key)).toContain('nzShockSolve');
  });

  it('computes the choked mass flow', () => {
    const m = chokedMassFlow(500e3, 600, 1e-4, 1.4, 287);
    expect(Math.abs(m - 0.082504) / 0.082504).toBeLessThan(1e-4);
    // Independent: m = rho* a* A* from the sonic state.
    const Ts = 600 / 1.2;
    const ps = 500e3 * Math.pow(1.2, -3.5);
    const independent = (ps / (287 * Ts)) * Math.sqrt(1.4 * 287 * Ts) * 1e-4;
    expect(Math.abs(m - independent) / independent).toBeLessThan(1e-12);
    expect(at(0.7).massFlow).toBeCloseTo(m, 12);
  });

  it('names every regime in order of falling back pressure', () => {
    expect(at(1).regime).toBe('noFlow');
    expect(at(0.97).regime).toBe('subsonic');
    expect(at(0.7).regime).toBe('shockInside');
    expect(at(0.3).regime).toBe('overexpanded');
    expect(at(0.02).regime).toBe('underexpanded');
    expect(at(0).regime).toBe('underexpanded');
    const [c1, c2, c3] = criticalRatios(2, 1.4);
    expect(at(c1).regime).toBe('chokedSubsonic');
    expect(at(c2).regime).toBe('shockAtExit');
    expect(at(c3).regime).toBe('design');
  });

  it('gives a smaller mass flow when the nozzle is not choked', () => {
    const r = at(0.97);
    expect(r.choked).toBe(false);
    expect(r.massFlow).toBeLessThan(chokedMassFlow(500e3, 600, 1e-4, 1.4, 287));
    expect(r.massFlow).toBeGreaterThan(0);
    // Independent: m = rho_e V_e A_e at the exit with pe = pb.
    const Me = r.exitMach;
    const Te = 600 / (1 + 0.2 * Me * Me);
    const rhoE = (0.97 * 500e3) / (287 * Te);
    const independent = rhoE * Me * Math.sqrt(1.4 * 287 * Te) * 2e-4;
    expect(Math.abs(r.massFlow - independent) / independent).toBeLessThan(1e-9);
  });

  it('draws a pressure profile that matches the exit pressure', () => {
    const r = at(0.7);
    const last = r.plot.p[r.plot.p.length - 1];
    close(last?.y ?? 0, 0.7, 1e-6);
    close(r.plot.p.find((p) => p.x === 0)?.y ?? 0, Math.pow(1.2, -3.5), 1e-9);
  });

  it('rejects impossible inputs', () => {
    expect(() => at(1.1)).toThrow(AeroError);
    expect(() => at(0.5, { areaRatio: 0.5 })).toThrow(AeroError);
    expect(() => at(0.5, { p0: 0 })).toThrow(AeroError);
    expect(() => at(0.5, { T0: -10 })).toThrow(AeroError);
    expect(() => at(0.5, { gamma: 1 })).toThrow(AeroError);
    expect(() => nozzle({ ...base, pb: -1 })).toThrow(AeroError);
  });
});
