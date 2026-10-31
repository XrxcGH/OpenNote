import { describe, expect, it } from 'vitest';
import { C, RY_EV } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import {
  angular,
  fineStructure,
  laguerre,
  legendre,
  line,
  moseley,
  radial,
  radialCalc,
  realOrbital,
  realY,
  ylm2,
} from './hydrogen';
import {
  hundGround,
  landeG,
  parseConfiguration,
  parseLevel,
  selection,
  termCalc,
  terms,
  termText,
  zeeman,
} from './terms';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;
const text = (calc: { items: readonly { key: string; text?: string }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.text;

describe('hydrogen-like lines', () => {
  it('gives the H-alpha vacuum wavelength 656.4696 nm with the reduced mass', () => {
    const calc = line(1, C.mp, 3, 2);
    expect(Math.abs(item(calc, 'vacuum') * 1e9 - 656.4696)).toBeLessThan(1e-4);
    // 1/λ = R∞ / (1 + mₑ/mₚ) × 5/36, worked independently of the engine.
    expect(rel(item(calc, 'vacuum'), 36 / (5 * (C.Rinf / (1 + C.me / C.mp))))).toBeLessThan(1e-12);
    // The NIST air wavelength of H-alpha is 656.279 nm (the fine-structure average).
    expect(Math.abs(item(calc, 'air') * 1e9 - 656.279)).toBeLessThan(0.01);
  });

  it('gives the series limit of an infinite nucleus as 1/R∞ and no air wavelength below 200 nm', () => {
    const calc = line(1, 0, 1000, 1);
    expect(rel(item(calc, 'vacuum'), 1 / (C.Rinf * (1 - 1e-6)))).toBeLessThan(1e-12);
    expect(calc.items.some((one) => one.key === 'air')).toBe(false);
  });

  it('scales by Z squared for one-electron ions and refuses impossible levels', () => {
    expect(rel(item(line(2, 0, 2, 1), 'photon'), 4 * RY_EV * 0.75)).toBeLessThan(1e-12);
    expect(() => line(1, 0, 2, 2)).toThrow(PhysicsError);
    expect(() => line(0, 0, 3, 2)).toThrow(PhysicsError);
    expect(() => line(1, -1, 3, 2)).toThrow(PhysicsError);
  });
});

describe('wavefunctions', () => {
  it('gives mean radii of 1.5, 6, and 5 a0 for 1s, 2s, and 2p', () => {
    expect(Math.abs(item(radialCalc(1, 1, 0), 'meanR') - 1.5)).toBeLessThan(1e-12);
    expect(Math.abs(item(radialCalc(1, 2, 0), 'meanR') - 6)).toBeLessThan(1e-12);
    expect(Math.abs(item(radialCalc(1, 2, 1), 'meanR') - 5)).toBeLessThan(1e-12);
  });

  it('matches the closed forms of R10 and R21, with peaks at 1 and 4 a0', () => {
    for (const r of [0.3, 1, 2.5]) {
      expect(radial(1, 1, 0, r)).toBeCloseTo(2 * Math.exp(-r), 13);
      expect(radial(1, 2, 1, r)).toBeCloseTo((r * Math.exp(-r / 2)) / Math.sqrt(24), 13);
    }
    expect(item(radialCalc(1, 1, 0), 'peakR')).toBeCloseTo(1, 6);
    expect(item(radialCalc(1, 2, 1), 'peakR')).toBeCloseTo(4, 6);
  });

  it('normalizes the radial density and the angular density', () => {
    let sum = 0;
    for (let i = 0; i < 20000; i += 1) {
      const r = (i + 0.5) * 0.004;
      sum += r * r * radial(1, 3, 1, r) ** 2 * 0.004;
    }
    expect(sum).toBeCloseTo(1, 6);
    let ang = 0;
    for (let i = 0; i < 4000; i += 1) {
      const th = ((i + 0.5) * Math.PI) / 4000;
      ang += ylm2(2, 1, th) * Math.sin(th) * 2 * Math.PI * (Math.PI / 4000);
    }
    expect(ang).toBeCloseTo(1, 6);
  });

  it('uses the standard polynomials', () => {
    expect(laguerre(2, 1, 0.5)).toBeCloseTo((0.5 ** 2 - 6 * 0.5 + 6) / 2, 13);
    expect(legendre(2, 0, 0.3)).toBeCloseTo((3 * 0.09 - 1) / 2, 14);
    expect(legendre(2, 1, 0.3)).toBeCloseTo(3 * 0.3 * Math.sqrt(1 - 0.09), 14);
    expect(item(angular(2, 1), 'angularNodes')).toBe(1);
    expect(() => radialCalc(1, 2, 2)).toThrow(PhysicsError);
    expect(() => angular(1, 2)).toThrow(PhysicsError);
  });
});

describe('real orbitals', () => {
  // The Cartesian forms: px = √(3/4π) x/r, dz² = √(5/16π)(3z² − r²)/r², dxy = √(15/4π) xy/r².
  it('matches the Cartesian real orbitals', () => {
    const at = (x: number, y: number, z: number) => {
      const r = Math.hypot(x, y, z);
      return [Math.acos(z / r), Math.atan2(y, x)] as const;
    };
    const [t1, p1] = at(0.3, -0.5, 0.8);
    const r1 = Math.hypot(0.3, -0.5, 0.8);
    expect(realY(1, 1, t1, p1)).toBeCloseTo(Math.sqrt(3 / (4 * Math.PI)) * (0.3 / r1), 12);
    expect(realY(1, -1, t1, p1)).toBeCloseTo(Math.sqrt(3 / (4 * Math.PI)) * (-0.5 / r1), 12);
    expect(realY(2, 0, t1, p1)).toBeCloseTo(Math.sqrt(5 / (16 * Math.PI)) * ((3 * 0.64) / r1 ** 2 - 1), 12);
    expect(realY(2, -2, t1, p1)).toBeCloseTo(Math.sqrt(15 / (4 * Math.PI)) * ((0.3 * -0.5) / r1 ** 2), 12);
  });

  it('draws dxy in the x-y plane with four lobes of alternating sign', () => {
    const calc = realOrbital(2, -2, 'xy');
    expect(calc.items[0]!.text).toBe('dxy');
    // The largest value is at 45°: √(15/4π)/2.
    expect(calc.items[1]!.value).toBeCloseTo(Math.sqrt(15 / (4 * Math.PI)) / 2, 6);
    const [plus, minus] = calc.plot!.series;
    // Positive lobes in the first and third quadrants (xy > 0), negative in the second and fourth.
    for (const [x, y] of plus!.points)
      if (Number.isFinite(x) && Math.abs(x * y) > 1e-3) expect(x * y).toBeGreaterThan(0);
    for (const [x, y] of minus!.points) if (Number.isFinite(x) && Math.abs(x * y) > 1e-3) expect(x * y).toBeLessThan(0);
  });

  it('draws pz in the x-z plane, positive up and negative down', () => {
    const calc = realOrbital(1, 0, 'xz');
    const [plus, minus] = calc.plot!.series;
    expect(plus!.points.filter(([x]) => Number.isFinite(x)).every(([, z]) => z >= -1e-12)).toBe(true);
    expect(minus!.points.filter(([x]) => Number.isFinite(x)).every(([, z]) => z <= 1e-12)).toBe(true);
    expect(calc.items[1]!.value).toBeCloseTo(Math.sqrt(3 / (4 * Math.PI)), 6);
  });
});

describe('fine structure and X-rays', () => {
  it('gives the 2p splitting 4.5283e-5 eV = 0.36523 per cm', () => {
    const calc = fineStructure(1, 2, 1);
    expect(rel(item(calc, 'splitting'), 4.5283e-5)).toBeLessThan(1e-3);
    expect(rel(item(calc, 'splittingCm'), 0.36523)).toBeLessThan(1e-3);
    // The closed form for n = 2, l = 1: the splitting is Ry α² / 16.
    expect(rel(item(calc, 'splitting'), (RY_EV * C.alpha ** 2) / 16)).toBeLessThan(1e-12);
  });

  it('gives the Moseley K-alpha estimate 8000.1 eV for copper, and a Bragg angle', () => {
    const calc = moseley(29, 2, 1, 1, 201.4e-12);
    expect(rel(item(calc, 'xray'), 8000.1)).toBeLessThan(1e-3);
    const lambda = (C.h * C.c) / (item(calc, 'xray') * C.e);
    expect(item(calc, 'bragg')).toBeCloseTo((Math.asin(lambda / (2 * 201.4e-12)) * 180) / Math.PI, 10);
    expect(() => moseley(29, 2, 1, 1, 50e-12)).toThrow(PhysicsError);
    expect(() => moseley(1, 2, 1, 1)).toThrow(PhysicsError);
  });
});

describe('term symbols', () => {
  it('gives 1S, 1D, 3P for p2, and ground levels 3P0, 3P2, 4F3/2 for p2, p4, d3', () => {
    expect(
      terms(parseConfiguration('p2'))
        .terms.map((one) => termText(one))
        .sort(),
    ).toEqual(['1D', '1S', '3P']);
    const ground = (config: string) => {
      const shells = parseConfiguration(config);
      const g = hundGround(terms(shells).terms, shells[0]!);
      return termText(g.term, g.j2);
    };
    expect(ground('p2')).toBe('3P0');
    expect(ground('2p4')).toBe('3P2');
    expect(ground('d3')).toBe('4F3/2');
    expect(text(termCalc(parseConfiguration('d3')), 'ground')).toBe('4F3/2');
  });

  it('counts microstates and lists the terms of sp and d2', () => {
    const names = (config: string) =>
      terms(parseConfiguration(config))
        .terms.map((one) => termText(one))
        .sort();
    expect(terms(parseConfiguration('d3')).total).toBe(120);
    expect(names('sp')).toEqual(['1P', '3P']);
    expect(names('d2')).toEqual(['1D', '1G', '1S', '3F', '3P']);
    expect(text(termCalc(parseConfiguration('p6')), 'ground')).toBe('1S0');
    expect(text(termCalc(parseConfiguration('3d1 4s1')), 'terms')).toBe('3D, 1D');
  });

  it('refuses bad configurations', () => {
    expect(() => parseConfiguration('p7')).toThrow(PhysicsError);
    expect(() => parseConfiguration('x2')).toThrow(PhysicsError);
    expect(() => parseConfiguration('')).toThrow(PhysicsError);
    expect(() => parseConfiguration('p2p1')).toThrow(PhysicsError);
  });
});

describe('Lande g, Zeeman, and selection rules', () => {
  it('gives g = 4/3 for 2P3/2, 2/3 for 2P1/2, and 2 for 2S1/2', () => {
    expect(Math.abs(landeG(2, 1, 3) - 4 / 3)).toBeLessThan(1e-12);
    expect(landeG(2, 1, 1)).toBeCloseTo(2 / 3, 14);
    expect(landeG(0, 1, 1)).toBe(2);
  });

  it('splits the D1 line into four lines and the D2 line into six', () => {
    const s = parseLevel('2S1/2');
    const lines = (upper: string) => zeeman(parseLevel(upper), s, 1).items.filter((one) => one.key === 'line').length;
    expect(lines('2P1/2')).toBe(4);
    expect(lines('2P3/2')).toBe(6);
  });

  it('gives the normal Zeeman triplet for a singlet line', () => {
    const calc = zeeman(parseLevel('1D2'), parseLevel('1P1'), 1);
    const unit = C.muB / C.e;
    const shifts = calc.items
      .filter((one) => one.key === 'line')
      .map((one) => Math.round((one.value / unit) * 1e9) / 1e9);
    expect(shifts).toEqual([-1, 0, 1]);
  });

  it('checks electric-dipole rules', () => {
    expect(selection(parseLevel('2P°3/2'), parseLevel('2S1/2')).allowed).toBe(true);
    expect(selection(parseLevel('2D5/2'), parseLevel('2S1/2')).broken).toEqual(
      expect.arrayContaining(['parity', 'deltaJ', 'deltaL']),
    );
    expect(selection(parseLevel('3Po0'), parseLevel('3P0')).broken).toContain('zeroJ');
    expect(selection(parseLevel('3Po1'), parseLevel('1S0')).broken).toEqual(['deltaS']);
    expect(() => parseLevel('2P5/2')).toThrow(PhysicsError);
    expect(() => parseLevel('hello')).toThrow(PhysicsError);
  });
});
