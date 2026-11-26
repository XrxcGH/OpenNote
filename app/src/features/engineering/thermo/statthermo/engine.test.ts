import '../text';
import { describe, expect, it } from 'vitest';
import { ThermoError } from '../common/types';
import { shown } from '../ui/present';
import {
  debyeCv,
  einsteinCv,
  meanFreePath,
  occupancy,
  rotation,
  solveGas,
  solveOccupancy,
  solveSolid,
  solveSpeeds,
  speeds,
  translation,
  vibration,
} from './engine';

const rel = (actual: number, expected: number) => Math.abs(actual / expected - 1);

// Independent values: CODATA exact constants written out again, and plain formulas evaluated without the engine.
const k = 1.380649e-23;
const h = 6.62607015e-34;
const c = 299792458;
const NA = 6.02214076e23;
const R = k * NA;

describe('statistical thermodynamics: plan validation cases', () => {
  it('N2 rotational temperature from B = 1.998 cm-1 is 2.8747 K', () => {
    expect(rel(rotation(1.998, 2, 300).theta, 2.8747)).toBeLessThan(1e-4);
    expect(rel(rotation(1.998, 2, 300).theta, (h * c * 199.8) / k)).toBeLessThan(1e-12);
  });

  it('N2 vibration at 2358.6 cm-1: theta_vib = 3393.5 K and cv/R = 0.41419 at 1000 K', () => {
    const vib = vibration(2358.6, 1000);
    expect(rel(vib.theta, 3393.5)).toBeLessThan(1e-4);
    expect(rel(vib.cv / R, 0.41419)).toBeLessThan(1e-4);
  });

  it('Debye at T = theta/2 gives cv/R = 2.4762 and Einstein at theta/T = 2 gives 2.1722', () => {
    expect(rel(debyeCv(400, 200), 2.4762)).toBeLessThan(1e-4);
    expect(rel(einsteinCv(400, 200), 2.1722)).toBeLessThan(1e-4);
  });

  it('N2 at 300 K: most probable 422.0, mean 476.2, rms 516.8 m/s', () => {
    const v = speeds(28.0134, 300);
    expect(rel(v.mp, 422.0)).toBeLessThan(1e-4);
    expect(rel(v.mean, 476.2)).toBeLessThan(1e-4);
    expect(rel(v.rms, 516.8)).toBeLessThan(1e-4);
  });

  it('mean free path of air at 300 K, 101.325 kPa, d = 0.37 nm is 67.2 nm', () => {
    expect(rel(meanFreePath(300, 101.325, 0.37) * 1e9, 67.2)).toBeLessThan(1e-3);
  });

  it('Sackur-Tetrode entropy of argon at 298.15 K and 1 bar is 154.85 J/(mol K)', () => {
    expect(rel(translation(39.948, 298.15, 100).S, 154.85)).toBeLessThan(1e-4);
  });
});

describe('statistical thermodynamics: independent checks', () => {
  it('Sackur-Tetrode matches the formula written out by hand', () => {
    const m = 0.039948 / NA;
    const T = 298.15;
    const v = (k * T) / 1e5;
    const byHand = R * (Math.log(v * ((2 * Math.PI * m * k * T) / h ** 2) ** 1.5) + 2.5);
    expect(rel(translation(39.948, T, 100).S, byHand)).toBeLessThan(1e-12);
  });

  it('the Debye integral agrees with a fine Simpson rule', () => {
    const f = (x: number) => (x < 1e-9 ? x * x : (x ** 4 * Math.exp(x)) / Math.expm1(x) ** 2);
    const n = 20000;
    const top = 3;
    let sum = f(0) + f(top);
    for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f((top * i) / n);
    const simpson = (9 / top ** 3) * ((top / n) * (sum / 3));
    expect(rel(debyeCv(3, 1), simpson)).toBeLessThan(1e-9);
  });

  it('N2 gas at 298.15 K and 1 bar has an entropy near the tabulated 191.6 J/(mol K)', () => {
    const gas = solveGas({
      M: 28.0134,
      T: 298.15,
      p: 100,
      shape: 'linear',
      B: 1.998,
      sigma: 2,
      modes: [2358.6],
      g0: 1,
    });
    const S = gas.rows.find((r) => r.key === 'sMolar')!.value;
    expect(Math.abs(S - 191.6)).toBeLessThan(0.3);
    const cv = gas.rows.find((r) => r.key === 'cvMolar')!.value;
    expect(Math.abs(cv / R - 2.5)).toBeLessThan(0.01);
  });

  it('kinetic theory k and mu follow from the same speeds and path', () => {
    const result = solveSpeeds({ M: 28.97, T: 300, p: 101.325, d: 0.37, L: 1e-6, cvk: 2.5 });
    const get = (key: string) => result.rows.find((r) => r.key === key)!.value;
    const n = 101325 / (k * 300);
    const vbar = Math.sqrt((8 * k * 300) / (Math.PI * (0.02897 / NA)));
    const lambda = (k * 300) / (Math.SQRT2 * Math.PI * 0.37e-9 ** 2 * 101325);
    expect(rel(get('kKinetic'), (n * 2.5 * k * vbar * lambda) / 3)).toBeLessThan(1e-10);
    expect(rel(get('knudsen'), lambda / 1e-6)).toBeLessThan(1e-10);
    // The collision rate is a frequency, v_mean / lambda per second (about 7.1e9 for air here), shown in 1/s.
    const z = result.rows.find((r) => r.key === 'collisionRate')!;
    expect(rel(z.value, vbar / lambda)).toBeLessThan(1e-10);
    expect(shown(z, 'SI').unit).toBe('1/s');
  });
});

describe('statistical thermodynamics: edge cases', () => {
  it('rejects zero and negative temperature, mass, and pressure', () => {
    expect(() => solveSolid({ model: 'debye', theta: 300, T: 0 })).toThrow(ThermoError);
    expect(() => solveSpeeds({ M: -4, T: 300, p: 100, d: 0.3, L: 1, cvk: 1.5 })).toThrow(ThermoError);
    expect(() => solveGas({ M: 4, T: 300, p: 0, shape: 'atom', B: 0, sigma: 1, modes: [], g0: 1 })).toThrow(
      ThermoError,
    );
  });

  it('refuses high-temperature rotation below about 5 theta_rot', () => {
    try {
      solveGas({ M: 2.016, T: 100, p: 100, shape: 'linear', B: 60.85, sigma: 2, modes: [], g0: 1 });
      throw new Error('expected an error');
    } catch (error) {
      expect((error as ThermoError).code).toBe('rotationLowT');
    }
  });

  it('stays finite at very low and very high temperature', () => {
    expect(vibration(3000, 1).cv).toBe(0);
    expect(Number.isFinite(vibration(3000, 1).S)).toBe(true);
    expect(rel(vibration(100, 1e7).cv, R)).toBeLessThan(1e-6);
    expect(rel(einsteinCv(1, 1e6), 3)).toBeLessThan(1e-6);
    expect(rel(debyeCv(1, 1e6), 3)).toBeLessThan(1e-6);
    expect(debyeCv(1000, 1)).toBeGreaterThan(0);
  });

  it('Debye cv follows the T^3 law at low temperature', () => {
    const T = 5;
    const theta = 400;
    const law = ((12 * Math.PI ** 4) / 5) * (T / theta) ** 3;
    expect(rel(debyeCv(theta, T), law)).toBeLessThan(1e-6);
  });

  it('occupancy at E = mu is one half for Fermi-Dirac and infinite for Bose-Einstein', () => {
    const at = occupancy(1, 1, 300);
    expect(at.fd).toBeCloseTo(0.5, 12);
    expect(at.be).toBe(Number.POSITIVE_INFINITY);
    expect(solveOccupancy({ E: 1, mu: 1, T: 300 }).notes).toContain('boseBelowMu');
  });
});
