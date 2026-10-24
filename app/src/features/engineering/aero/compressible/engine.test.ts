import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { compressible, type CompressibleInput, type CompressibleResult, type RowId } from './engine';

const g = 1.4;
const value = (r: CompressibleResult, id: RowId) => {
  const row = r.rows.find((x) => x.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return row.value;
};
const run = (input: Partial<CompressibleInput> & Pick<CompressibleInput, 'family' | 'known' | 'value'>) =>
  compressible({ gamma: g, ...input });
const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThan(tol);

describe('isentropic flow', () => {
  it('matches M = 2', () => {
    const r = run({ family: 'isentropic', known: 'M', value: 2 });
    close(value(r, 'TT0'), 0.55556, 1e-5);
    close(value(r, 'pp0'), 0.1278, 1e-5);
    close(value(r, 'rhorho0'), 0.23005, 1e-5);
    close(value(r, 'AA'), 1.6875, 1e-5);
    // Independent: T0/T = 1.8 exactly, A/A* = (1/2)(1.8/1.2)^3 = 1.6875 exactly.
    close(value(r, 'TT0'), 1 / 1.8, 1e-15);
    close(value(r, 'AA'), 0.5 * Math.pow(1.8 / 1.2, 3), 1e-14);
  });

  it('inverts A/A* on both branches and the ratios on one', () => {
    close(value(run({ family: 'isentropic', known: 'AA', value: 1.6875, branch: 'supersonic' }), 'M'), 2, 1e-9);
    const sub = run({ family: 'isentropic', known: 'AA', value: 1.6875, branch: 'subsonic' });
    close(value(sub, 'M'), 0.372244486, 1e-8);
    close(value(sub, 'AA'), 1.6875, 1e-10);
    close(value(run({ family: 'isentropic', known: 'pp0', value: 0.1278045 }), 'M'), 2, 1e-5);
    close(value(run({ family: 'isentropic', known: 'mu', value: 30 }), 'M'), 2, 1e-9);
    expect(sub.steps[0]?.key).toBe('cfInverse');
  });

  it('rejects values outside the range', () => {
    expect(() => run({ family: 'isentropic', known: 'AA', value: 0.5, branch: 'supersonic' })).toThrow(AeroError);
    expect(() => run({ family: 'isentropic', known: 'TT0', value: 1.2 })).toThrow(AeroError);
    expect(() => run({ family: 'isentropic', known: 'M', value: 0 })).toThrow(AeroError);
    expect(() => run({ family: 'isentropic', known: 'M', value: -1 })).toThrow(AeroError);
    expect(() => run({ family: 'isentropic', known: 'M', value: Number.NaN })).toThrow(AeroError);
    expect(() => run({ family: 'isentropic', known: 'M', value: 1e9 })).toThrow(AeroError);
    expect(() => compressible({ family: 'isentropic', gamma: 1, known: 'M', value: 2 })).toThrow(AeroError);
    expect(() => compressible({ family: 'isentropic', gamma: 0.9, known: 'M', value: 2 })).toThrow(AeroError);
  });
});

describe('normal shock', () => {
  it('matches M1 = 2', () => {
    const r = run({ family: 'normal', known: 'M1', value: 2 });
    close(value(r, 'M2'), 0.57735, 1e-5);
    close(value(r, 'p2p1'), 4.5, 1e-5);
    close(value(r, 'T2T1'), 1.6875, 1e-5);
    close(value(r, 'rho2rho1'), 2.6667, 1e-4);
    close(value(r, 'p02p01'), 0.72087, 1e-5);
    // Independent: M2 = sqrt(1/3), p02/p01 = (8/3)^3.5 (4.5)^-2.5.
    close(value(r, 'M2'), Math.sqrt(1 / 3), 1e-14);
    close(value(r, 'p02p01'), Math.pow(8 / 3, 3.5) * Math.pow(4.5, -2.5), 1e-14);
  });

  it('inverts from the downstream Mach number and the pressure ratio', () => {
    close(value(run({ family: 'normal', known: 'M2', value: Math.sqrt(1 / 3) }), 'M1'), 2, 1e-9);
    close(value(run({ family: 'normal', known: 'p2p1', value: 4.5 }), 'M1'), 2, 1e-9);
    close(value(run({ family: 'normal', known: 'p02p01', value: 0.72087 }), 'M1'), 2, 1e-4);
  });

  it('rejects a subsonic upstream flow and a density ratio past the limit', () => {
    expect(() => run({ family: 'normal', known: 'M1', value: 0.8 })).toThrow(AeroError);
    expect(() => run({ family: 'normal', known: 'rho2rho1', value: 7 })).toThrow(AeroError);
  });
});

describe('oblique shock', () => {
  it('matches M1 = 2, theta = 10 degrees', () => {
    const weak = run({ family: 'oblique', known: 'theta', value: 10, M1: 2 });
    close(value(weak, 'beta'), 39.314, 1e-3);
    close(value(weak, 'M2'), 1.6405, 1e-4);
    close(value(weak, 'p2p1'), 1.7066, 1e-4);
    close(value(weak, 'thetaMax'), 22.974, 1e-3);
    const strong = run({ family: 'oblique', known: 'theta', value: 10, M1: 2, strong: true });
    close(value(strong, 'beta'), 83.7, 1e-3);
  });

  it('gives back theta from beta (independent tan theta formula)', () => {
    const r = run({ family: 'oblique', known: 'beta', value: 39.314, M1: 2 });
    const b = (39.314 * Math.PI) / 180;
    const tanTheta = ((2 / Math.tan(b)) * (4 * Math.sin(b) ** 2 - 1)) / (4 * (1.4 + Math.cos(2 * b)) + 2);
    close(value(r, 'theta'), (Math.atan(tanTheta) * 180) / Math.PI, 1e-12);
    close(value(r, 'theta'), 10, 1e-3);
  });

  it('reports a detached shock and a subsonic upstream flow', () => {
    expect(() => run({ family: 'oblique', known: 'theta', value: 25, M1: 2 })).toThrow(AeroError);
    expect(() => run({ family: 'oblique', known: 'theta', value: 5, M1: 0.9 })).toThrow(AeroError);
    expect(() => run({ family: 'oblique', known: 'beta', value: 20, M1: 2 })).toThrow(AeroError);
    expect(() => run({ family: 'oblique', known: 'theta', value: -5, M1: 2 })).toThrow(AeroError);
  });

  it('degenerates to a Mach wave and a normal shock at zero deflection', () => {
    close(value(run({ family: 'oblique', known: 'theta', value: 0, M1: 2 }), 'beta'), 30, 1e-9);
    close(value(run({ family: 'oblique', known: 'theta', value: 0, M1: 2, strong: true }), 'beta'), 90, 1e-9);
  });
});

describe('Prandtl-Meyer expansion', () => {
  it('matches nu(2)', () => {
    const r = run({ family: 'expansion', known: 'M', value: 2 });
    close(value(r, 'nu'), 26.38, 1e-3);
    // Independent: sqrt(6) atan(sqrt(3/6)) - atan(sqrt(3)).
    const nu = Math.sqrt(6) * Math.atan(Math.sqrt(0.5)) - Math.atan(Math.sqrt(3));
    close(value(r, 'nu'), (nu * 180) / Math.PI, 1e-12);
    close(value(run({ family: 'expansion', known: 'nu', value: 26.3798 }), 'M'), 2, 1e-4);
  });

  it('rejects a turn past the maximum', () => {
    expect(() => run({ family: 'expansion', known: 'nu', value: 140 })).toThrow(AeroError);
  });
});

describe('Fanno and Rayleigh flow', () => {
  it('matches M = 0.5', () => {
    close(value(run({ family: 'fanno', known: 'M', value: 0.5 }), 'fLD'), 1.06906, 1e-5);
    close(value(run({ family: 'rayleigh', known: 'M', value: 0.5 }), 'T0T0s'), 0.69136, 1e-5);
    // Independent closed forms at M = 0.5.
    close(
      value(run({ family: 'fanno', known: 'M', value: 0.5 }), 'fLD'),
      0.75 / 0.35 + (2.4 / 2.8) * Math.log(0.6 / 2.1),
      1e-13,
    );
    close(
      value(run({ family: 'rayleigh', known: 'M', value: 0.5 }), 'T0T0s'),
      (2 * 2.4 * 0.25 * 1.05) / 1.35 ** 2,
      1e-13,
    );
  });

  it('inverts on both branches', () => {
    close(value(run({ family: 'fanno', known: 'fLD', value: 1.06906, branch: 'subsonic' }), 'M'), 0.5, 1e-5);
    const sup = run({ family: 'fanno', known: 'fLD', value: 0.3, branch: 'supersonic' });
    close(value(sup, 'fLD'), 0.3, 1e-10);
    expect(value(sup, 'M')).toBeGreaterThan(1);
    close(value(run({ family: 'rayleigh', known: 'T0T0s', value: 0.69136, branch: 'subsonic' }), 'M'), 0.5, 1e-4);
    expect(value(run({ family: 'rayleigh', known: 'T0T0s', value: 0.8, branch: 'supersonic' }), 'M')).toBeGreaterThan(
      1,
    );
  });

  it('rejects a supersonic duct longer than the limit', () => {
    // The supersonic limit of 4fL*/D for gamma = 1.4 is 0.8215.
    expect(() => run({ family: 'fanno', known: 'fLD', value: 0.9, branch: 'supersonic' })).toThrow(AeroError);
    expect(() => run({ family: 'rayleigh', known: 'T0T0s', value: 1.2, branch: 'subsonic' })).toThrow(AeroError);
  });

  it('returns 1 for every starred ratio at M = 1', () => {
    const f = run({ family: 'fanno', known: 'M', value: 1 });
    close(value(f, 'fLD'), 0, 1e-15);
    close(value(f, 'pps'), 1, 1e-15);
    const r = run({ family: 'rayleigh', known: 'M', value: 1 });
    close(value(r, 'T0T0s'), 1, 1e-15);
    close(value(r, 'p0p0s'), 1, 1e-15);
  });
});
