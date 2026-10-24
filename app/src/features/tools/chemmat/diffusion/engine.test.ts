import { describe, expect, it } from 'vitest';
import {
  arrheniusFit,
  coefficient,
  diffusivity,
  dopant,
  erfcInverse,
  erfProfile,
  errorFunction,
  firstLaw,
  oxidation,
  oxideThickness,
  predepositionDose,
  vacancies,
} from './engine';
import { erfc } from '../num';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const EV = 1.602176634e-19;
const KB = 1.380649e-23;
const NA = 6.02214076e23;

describe('vacancies', () => {
  it('0.9 eV at 1000 degrees C: fraction 2.7374e-4', () => {
    const o = vacancies({ Q: 0.9 * EV * NA, T: 1273.15, rho: NaN, A: NaN });
    expect(rel(val(o, 'kitChemMat.df.row.fraction'), 2.7374e-4)).toBeLessThan(1e-4);
    // independent: exp(-E / (k_B T)) with E per atom
    expect(rel(val(o, 'kitChemMat.df.row.fraction'), Math.exp(-(0.9 * EV) / (KB * 1273.15)))).toBeLessThan(1e-9);
  });

  it('the same energy in kJ/mol gives the same fraction, and a count per cm3 for copper', () => {
    const kj = (0.9 * EV * NA) / 1000;
    const o = vacancies({ Q: kj * 1000, T: 1273.15, rho: 8.96, A: 63.546 });
    const sites = (8.96 * NA) / 63.546;
    expect(rel(val(o, 'kitChemMat.df.row.sites'), sites)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.df.row.count'), sites * Math.exp(-(0.9 * EV) / (KB * 1273.15)))).toBeLessThan(1e-9);
  });

  it('zero energy gives fraction 1, and impossible input is explained', () => {
    expect(val(vacancies({ Q: 0, T: 300, rho: NaN, A: NaN }), 'kitChemMat.df.row.fraction')).toBe(1);
    expect(vacancies({ Q: -1, T: 300, rho: NaN, A: NaN })).toMatchObject({ key: 'kitChemMat.df.err.energy' });
    expect(vacancies({ Q: 1e5, T: 0, rho: NaN, A: NaN })).toMatchObject({ key: 'kitChemMat.df.err.temperature' });
    expect(vacancies({ Q: 1e5, T: -5, rho: NaN, A: NaN })).toMatchObject({ key: 'kitChemMat.df.err.temperature' });
    expect(vacancies({ Q: 1e5, T: 300, rho: 8.9, A: NaN })).toMatchObject({ key: 'kitChemMat.df.err.density' });
    // a very low temperature underflows to zero rather than failing
    expect(val(vacancies({ Q: 5e5, T: 1, rho: NaN, A: NaN }), 'kitChemMat.df.row.fraction')).toBe(0);
  });
});

describe('diffusion coefficient', () => {
  it('D = D0 exp(-Q / RT): carbon in gamma iron at 1000 degrees C', () => {
    const o = coefficient({ D0: 2.3e-5, Q: 148000, T: 1273.15 });
    expect(rel(val(o, 'kitChemMat.df.row.D'), 2.3e-5 * Math.exp(-148000 / (8.314462618 * 1273.15)))).toBeLessThan(
      1e-12,
    );
    expect(val(o, 'kitChemMat.df.row.D')).toBeGreaterThan(1e-11);
    expect(val(o, 'kitChemMat.df.row.D')).toBeLessThan(3e-11);
  });

  it('two measurements recover Q and D0 exactly, and predict a third temperature', () => {
    const D0 = 4.1e-6;
    const Q = 120e3;
    const o = arrheniusFit({
      D1: diffusivity(D0, Q, 800),
      T1: 800,
      D2: diffusivity(D0, Q, 1100),
      T2: 1100,
      T3: 950,
    });
    expect(rel(val(o, 'kitChemMat.df.row.Q'), Q)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.df.row.D0'), D0)).toBeLessThan(1e-10);
    expect(rel(val(o, 'kitChemMat.df.row.D3'), diffusivity(D0, Q, 950))).toBeLessThan(1e-10);
  });

  it('refuses equal temperatures, zero or negative coefficients, and negative energy', () => {
    expect(arrheniusFit({ D1: 1e-12, T1: 900, D2: 1e-11, T2: 900, T3: NaN })).toMatchObject({
      key: 'kitChemMat.df.err.sameT',
    });
    expect(arrheniusFit({ D1: 0, T1: 900, D2: 1e-11, T2: 1000, T3: NaN })).toMatchObject({
      key: 'kitChemMat.df.err.d',
    });
    expect(coefficient({ D0: -1, Q: 1, T: 300 })).toMatchObject({ key: 'kitChemMat.df.err.d0' });
    expect(coefficient({ D0: 1, Q: -1, T: 300 })).toMatchObject({ key: 'kitChemMat.df.err.energy' });
    // a coefficient that falls with temperature is flagged
    const odd = arrheniusFit({ D1: 1e-11, T1: 800, D2: 1e-12, T2: 1000, T3: NaN });
    expect(odd.ok && odd.notes.some((n) => n.key === 'kitChemMat.df.note.negative')).toBe(true);
  });
});

describe("Fick's first law", () => {
  it('J = D dC / dx in mol/(m2 s) from mol/L', () => {
    const o = firstLaw(1e-10, 0.5, 0.1, 1e-3);
    // 0.4 mol/L is 400 mol/m3 over 1 mm
    expect(rel(val(o, 'kitChemMat.df.row.flux'), 1e-10 * (400 / 1e-3))).toBeLessThan(1e-12);
    expect(val(firstLaw(1e-10, 0.1, 0.5, 1e-3), 'kitChemMat.df.row.flux')).toBeLessThan(0);
    expect(val(firstLaw(1e-10, 0.3, 0.3, 1e-3), 'kitChemMat.df.row.flux')).toBe(0);
  });

  it('refuses zero thickness and negative concentration', () => {
    expect(firstLaw(1e-10, 0.5, 0.1, 0)).toMatchObject({ key: 'kitChemMat.df.err.thickness' });
    expect(firstLaw(1e-10, -1, 0.1, 1e-3)).toMatchObject({ key: 'kitChemMat.df.err.conc' });
    expect(firstLaw(0, 1, 0.1, 1e-3)).toMatchObject({ key: 'kitChemMat.df.err.d' });
  });
});

describe('error-function solution', () => {
  const carb = { Cs: 1.2, C0: 0.25, D: 1.6e-11, unknown: 'time', x: 0.5e-3, t: NaN, Cx: 0.8 };

  it('carburizing to 0.8 wt% at 0.5 mm: z = 0.39239 and t = 25370 s', () => {
    const o = errorFunction(carb);
    expect(rel(val(o, 'kitChemMat.df.row.z'), 0.39239)).toBeLessThan(1e-3);
    expect(rel(val(o, 'kitChemMat.df.row.t'), 25370)).toBeLessThan(1e-3);
    // independent: the profile evaluated at that time returns the target
    expect(Math.abs(erfProfile(1.2, 0.25, 1.6e-11, 0.5e-3, val(o, 'kitChemMat.df.row.t')) - 0.8)).toBeLessThan(1e-9);
  });

  it('the three unknowns agree with each other', () => {
    const t = val(errorFunction(carb), 'kitChemMat.df.row.t');
    const depth = errorFunction({ ...carb, unknown: 'depth', x: NaN, t });
    expect(rel(val(depth, 'kitChemMat.df.row.x'), 0.5e-3)).toBeLessThan(1e-9);
    const conc = errorFunction({ ...carb, unknown: 'conc', t, Cx: NaN });
    expect(Math.abs(val(conc, 'kitChemMat.df.row.Cx') - 0.8)).toBeLessThan(1e-9);
  });

  it('the surface holds Cs and far away the bar holds C0', () => {
    const at0 = errorFunction({ ...carb, unknown: 'conc', x: 0, t: 3600 });
    expect(val(at0, 'kitChemMat.df.row.Cx')).toBeCloseTo(1.2, 12);
    const far = errorFunction({ ...carb, unknown: 'conc', x: 0.1, t: 3600 });
    expect(val(far, 'kitChemMat.df.row.Cx')).toBeCloseTo(0.25, 12);
  });

  it('decarburizing works the same way (surface below the core)', () => {
    const o = errorFunction({ Cs: 0.1, C0: 0.8, D: 1.6e-11, unknown: 'time', x: 0.4e-3, t: NaN, Cx: 0.4 });
    const t = val(o, 'kitChemMat.df.row.t');
    expect(Math.abs(erfProfile(0.1, 0.8, 1.6e-11, 0.4e-3, t) - 0.4)).toBeLessThan(1e-9);
  });

  it('a target outside the range between C0 and Cs, and equal surface and core, are explained', () => {
    expect(errorFunction({ ...carb, Cx: 1.3 })).toMatchObject({ key: 'kitChemMat.df.err.targetRange' });
    expect(errorFunction({ ...carb, Cx: 0.25 })).toMatchObject({ key: 'kitChemMat.df.err.targetRange' });
    expect(errorFunction({ ...carb, Cx: 0.1 })).toMatchObject({ key: 'kitChemMat.df.err.targetRange' });
    expect(errorFunction({ ...carb, C0: 1.2 })).toMatchObject({ key: 'kitChemMat.df.err.sameConc' });
    expect(errorFunction({ ...carb, D: 0 })).toMatchObject({ key: 'kitChemMat.df.err.d' });
    expect(errorFunction({ ...carb, x: 0 })).toMatchObject({ key: 'kitChemMat.df.err.depth' });
    expect(errorFunction({ ...carb, unknown: 'conc', t: 0 })).toMatchObject({ key: 'kitChemMat.df.err.time' });
  });

  it('the inverse of erfc holds over many decades', () => {
    for (const p of [0.9, 0.5, 1e-3, 1e-6, 1e-12, 1e-30, 1e-100]) {
      const z = erfcInverse(p);
      expect(rel(erfc(z), p)).toBeLessThan(1e-8);
    }
    expect(erfcInverse(1)).toBe(0);
    expect(erfcInverse(0)).toBeNaN();
    expect(erfcInverse(1.5)).toBeNaN();
  });
});

describe('dopant predeposition and drive-in', () => {
  const pre = { Cs: 1e20, D1: 1e-18, t1: 1800, Cb: NaN, D2: NaN, t2: NaN };

  it('Cs 1e20 cm-3, D 1e-14 cm2/s, 30 minutes: dose 4.7873e14 cm-2', () => {
    const o = dopant(pre);
    expect(rel(val(o, 'kitChemMat.df.row.dose'), 4.7873e14)).toBeLessThan(1e-4);
    expect(rel(predepositionDose(1e20, 1e-14, 1800), 2e20 * Math.sqrt((1e-14 * 1800) / Math.PI))).toBeLessThan(1e-12);
  });

  it('the junction after predeposition puts the erfc profile at the background level', () => {
    const o = dopant({ ...pre, Cb: 1e16 });
    const xj = val(o, 'kitChemMat.df.row.junction1'); // meters
    const L = Math.sqrt(1e-14 * 1800) * 1e-2; // m
    expect(rel(1e20 * erfc(xj / (2 * L)), 1e16)).toBeLessThan(1e-9);
  });

  it('drive-in conserves the dose and puts the junction where the Gaussian meets the background', () => {
    const o = dopant({ ...pre, Cb: 1e16, D2: 1e-16, t2: 3600 });
    const Q = val(o, 'kitChemMat.df.row.dose');
    const s2 = val(o, 'kitChemMat.df.row.surface2');
    const L2 = Math.sqrt(1e-12 * 3600); // cm
    // the area under a Gaussian is C(0) sqrt(pi) L2 = Q
    expect(rel(s2 * Math.sqrt(Math.PI) * L2, Q)).toBeLessThan(1e-12);
    const xj = val(o, 'kitChemMat.df.row.junction2') * 100; // cm
    expect(rel(s2 * Math.exp(-(xj * xj) / (4 * L2 * L2)), 1e16)).toBeLessThan(1e-9);
  });

  it('a background above the drive-in surface level means there is no junction', () => {
    expect(dopant({ ...pre, Cb: 9e19, D2: 1e-14, t2: 36000 })).toMatchObject({ key: 'kitChemMat.df.err.noJunction' });
    expect(dopant({ ...pre, Cb: 2e20 })).toMatchObject({ key: 'kitChemMat.df.err.backgroundHigh' });
    expect(dopant({ ...pre, Cs: 0 })).toMatchObject({ key: 'kitChemMat.df.err.surface' });
    expect(dopant({ ...pre, D2: 1e-16 })).toMatchObject({ key: 'kitChemMat.df.err.drive' });
    expect(dopant({ ...pre, Cb: -1 })).toMatchObject({ key: 'kitChemMat.df.err.background' });
  });

  it('the plot has a log axis and every plotted value is positive', () => {
    const o = dopant({ ...pre, Cb: 1e16, D2: 1e-16, t2: 3600 });
    expect(o.ok && o.plot?.logY).toBe(true);
    if (o.ok) for (const s of o.plot!.series) for (const [, y] of s.points) expect(y).toBeGreaterThan(0);
  });
});

describe('Deal-Grove oxidation', () => {
  const base = { source: 'custom', B: 0.027, BA: 0.62, T: NaN, t: 1, xi: NaN, target: NaN };

  it('B 0.027 um2/h, B/A 0.62 um/h, 1 h: 0.14398 um', () => {
    const o = oxidation(base);
    expect(rel(val(o, 'kitChemMat.df.row.oxide'), 0.14398e-6)).toBeLessThan(1e-4);
    // independent: the thickness must satisfy x^2 + A x = B t
    const x = val(o, 'kitChemMat.df.row.oxide') * 1e6;
    const A = 0.027 / 0.62;
    expect(rel(x * x + A * x, 0.027 * 1)).toBeLessThan(1e-12);
  });

  it('short times grow linearly (B/A t) and long times as sqrt(B t)', () => {
    const A = 0.027 / 0.62;
    expect(rel(oxideThickness(0.027, A, 0, 1e-6), 0.62 * 1e-6)).toBeLessThan(1e-3);
    expect(rel(oxideThickness(0.027, A, 0, 1e8), Math.sqrt(0.027 * 1e8))).toBeLessThan(1e-3);
    expect(oxideThickness(0.027, A, 0, 0)).toBe(0);
  });

  it('time to a target thickness inverts the growth law', () => {
    const o = oxidation({ ...base, target: 0.2 });
    const t = val(o, 'kitChemMat.df.row.timeTo') / 3600; // h
    const A = 0.027 / 0.62;
    expect(rel(oxideThickness(0.027, A, 0, t), 0.2)).toBeLessThan(1e-12);
  });

  it('an oxide already present sets tau, and growth starts from that thickness', () => {
    const A = 0.027 / 0.62;
    const tau = (0.05 * 0.05 + A * 0.05) / 0.027;
    expect(oxideThickness(0.027, A, tau, 0)).toBeCloseTo(0.05, 12);
    const o = oxidation({ ...base, t: 0, xi: 0.05 });
    expect(rel(val(o, 'kitChemMat.df.row.oxide'), 0.05e-6)).toBeLessThan(1e-9);
    // already thicker than the target
    const done = oxidation({ ...base, xi: 0.5, target: 0.2 });
    expect(done.ok && done.rows.some((r) => r.key === 'kitChemMat.df.row.alreadyThick')).toBe(true);
  });

  it('the published dry and wet constants at 1000 degrees C match the Arrhenius form', () => {
    const T = 1273.15;
    const kT = 8.617333262e-5 * T;
    const dry = oxidation({ ...base, source: 'dry', T, orientation: '111' });
    expect(rel(val(dry, 'kitChemMat.df.row.B'), 772 * Math.exp(-1.23 / kT))).toBeLessThan(1e-12);
    expect(rel(val(dry, 'kitChemMat.df.row.BA'), 6.23e6 * Math.exp(-2.0 / kT))).toBeLessThan(1e-12);
    const wet = oxidation({ ...base, source: 'wet', T, orientation: '111' });
    // wet oxidation is far faster than dry at the same temperature
    expect(val(wet, 'kitChemMat.df.row.oxide')).toBeGreaterThan(5 * val(dry, 'kitChemMat.df.row.oxide'));
  });

  it('dry 1000 C, 1 h on (100) silicon grows about 38.5 nm; (111) grows more', () => {
    const T = 1273.15;
    const kT = 8.617333262e-5 * T;
    const B = 772 * Math.exp(-1.23 / kT);
    const BA = (6.23e6 / 1.68) * Math.exp(-2.0 / kT);
    const o = oxidation({ ...base, source: 'dry', T, orientation: '100' });
    const nm = val(o, 'kitChemMat.df.row.oxide') * 1e9;
    expect(Math.abs(nm - 38.5)).toBeLessThan(1);
    // independent: the thickness satisfies x^2 + A x = B t
    const x = nm * 1e-3;
    expect(Math.abs(x * x + (B / BA) * x - B)).toBeLessThan(1e-9);
    expect(val(oxidation({ ...base, source: 'dry', T, orientation: '111' }), 'kitChemMat.df.row.oxide') * 1e9).toBeGreaterThan(nm);
  });

  it('refuses bad rates, negative time and thickness, and a missing temperature', () => {
    expect(oxidation({ ...base, B: 0 })).toMatchObject({ key: 'kitChemMat.df.err.rates' });
    expect(oxidation({ ...base, t: -1 })).toMatchObject({ key: 'kitChemMat.df.err.hours' });
    expect(oxidation({ ...base, xi: -0.1 })).toMatchObject({ key: 'kitChemMat.df.err.initial' });
    expect(oxidation({ ...base, target: 0 })).toMatchObject({ key: 'kitChemMat.df.err.targetOxide' });
    expect(oxidation({ ...base, source: 'dry', T: NaN })).toMatchObject({ key: 'kitChemMat.df.err.temperature' });
  });
});
