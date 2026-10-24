import { describe, expect, it } from 'vitest';
import { creep, criticalCrack, eutectic, fracture, larsonMiller, lever, leverFractions } from './engine';
import { basquin, fatigue, interpolate, tensile } from './mechanical';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const has = (o: Outcome, key: string) => o.ok && o.rows.some((r) => r.key === key);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const MPA = 1e6;

describe('lever rule', () => {
  const base = { C0: 35, C1: 31.5, C2: 42.5, rho1: NaN, rho2: NaN, mass: NaN };

  it('35 wt% Ni with liquid at 31.5 and solid at 42.5: W_L = 0.68182 and W_alpha = 0.31818', () => {
    const o = lever(base);
    expect(Math.abs(val(o, 'kitChemMat.ph.row.W1') - 0.68182)).toBeLessThan(1e-5);
    expect(Math.abs(val(o, 'kitChemMat.ph.row.W2') - 0.31818)).toBeLessThan(1e-5);
    expect(val(o, 'kitChemMat.ph.row.W1') + val(o, 'kitChemMat.ph.row.W2')).toBeCloseTo(1, 14);
    expect(leverFractions(35, 31.5, 42.5)[0]).toBeCloseTo(7.5 / 11, 14);
  });

  it('the tie line may be written in either direction', () => {
    const swapped = lever({ ...base, C1: 42.5, C2: 31.5 });
    expect(val(swapped, 'kitChemMat.ph.row.W1')).toBeCloseTo(0.31818181818, 9);
  });

  it('the overall mass fraction balances the composition: W1 C1 + W2 C2 = C0', () => {
    const [w1, w2] = leverFractions(37.3, 12, 88);
    expect(w1 * 12 + w2 * 88).toBeCloseTo(37.3, 12);
  });

  it('volume fractions and masses follow from densities and a total mass', () => {
    const o = lever({ ...base, rho1: 8.0, rho2: 9.0, mass: 200 });
    const w1 = 7.5 / 11;
    const w2 = 3.5 / 11;
    const v1 = w1 / 8 / (w1 / 8 + w2 / 9);
    expect(rel(val(o, 'kitChemMat.ph.row.V1'), v1)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.ph.row.m1'), 200 * w1)).toBeLessThan(1e-12);
    expect(val(o, 'kitChemMat.ph.row.m1') + val(o, 'kitChemMat.ph.row.m2')).toBeCloseTo(200, 10);
  });

  it('an alloy at an end of the tie line is a single phase', () => {
    const o = lever({ ...base, C0: 31.5 });
    expect(val(o, 'kitChemMat.ph.row.W1')).toBe(1);
    expect(val(o, 'kitChemMat.ph.row.W2')).toBe(0);
    expect(o.ok && o.notes.some((n) => n.key === 'kitChemMat.ph.note.single')).toBe(true);
  });

  it('refuses compositions outside the tie line, equal ends, and bad extras', () => {
    expect(lever({ ...base, C0: 50 })).toMatchObject({ key: 'kitChemMat.ph.err.outside' });
    expect(lever({ ...base, C0: 20 })).toMatchObject({ key: 'kitChemMat.ph.err.outside' });
    expect(lever({ ...base, C2: 31.5 })).toMatchObject({ key: 'kitChemMat.ph.err.sameEnds' });
    expect(lever({ ...base, C0: NaN })).toMatchObject({ key: 'kitChemMat.ph.err.composition' });
    expect(lever({ ...base, rho1: 8 })).toMatchObject({ key: 'kitChemMat.ph.err.density' });
    expect(lever({ ...base, mass: -5 })).toMatchObject({ key: 'kitChemMat.ph.err.mass' });
  });
});

describe('eutectic microconstituents', () => {
  const base = { C0: 40, Ca: 18.3, CE: 61.9, Cb: 97.8 };

  it('a hypoeutectic alloy: proeutectic alpha (CE - C0)/(CE - Ca) and the rest eutectic', () => {
    const o = eutectic(base);
    const pro = (61.9 - 40) / (61.9 - 18.3);
    expect(rel(val(o, 'kitChemMat.ph.row.proAlpha'), pro)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.ph.row.eutectic'), 1 - pro)).toBeLessThan(1e-12);
    // total alpha by the lever rule over the whole alpha-beta tie line
    expect(rel(val(o, 'kitChemMat.ph.row.totalAlpha'), (97.8 - 40) / (97.8 - 18.3))).toBeLessThan(1e-12);
    // the alpha inside the eutectic plus the proeutectic alpha is all the alpha
    expect(val(o, 'kitChemMat.ph.row.proAlpha') + val(o, 'kitChemMat.ph.row.alphaInEutectic')).toBeCloseTo(
      val(o, 'kitChemMat.ph.row.totalAlpha'),
      12,
    );
    expect(val(o, 'kitChemMat.ph.row.betaInEutectic')).toBeCloseTo(val(o, 'kitChemMat.ph.row.totalBeta'), 12);
  });

  it('a hypereutectic alloy has proeutectic beta', () => {
    const o = eutectic({ ...base, C0: 80 });
    expect(rel(val(o, 'kitChemMat.ph.row.proBeta'), (80 - 61.9) / (97.8 - 61.9))).toBeLessThan(1e-12);
    expect(has(o, 'kitChemMat.ph.row.proAlpha')).toBe(false);
    expect(val(o, 'kitChemMat.ph.row.proBeta') + val(o, 'kitChemMat.ph.row.betaInEutectic')).toBeCloseTo(
      val(o, 'kitChemMat.ph.row.totalBeta'),
      12,
    );
  });

  it('the eutectic composition is entirely eutectic', () => {
    const o = eutectic({ ...base, C0: 61.9 });
    expect(val(o, 'kitChemMat.ph.row.eutectic')).toBeCloseTo(1, 12);
  });

  it('refuses a disordered diagram and an alloy outside it', () => {
    expect(eutectic({ ...base, CE: 10 })).toMatchObject({ key: 'kitChemMat.ph.err.order' });
    expect(eutectic({ ...base, C0: 100 })).toMatchObject({ key: 'kitChemMat.ph.err.outside' });
    expect(eutectic({ ...base, C0: 5 })).toMatchObject({ key: 'kitChemMat.ph.err.outside' });
  });
});

describe('fracture toughness', () => {
  it('K 26 MPa sqrt(m), Y 1, 250 MPa: critical crack length 3.4428 mm', () => {
    const o = fracture({ find: 'crack', K: 26, Y: 1, stress: 250 * MPA, a: NaN });
    expect(rel(val(o, 'kitChemMat.ph.row.crack'), 3.4428e-3)).toBeLessThan(1e-4);
    expect(rel(criticalCrack(26, 1, 250), (26 / 250) ** 2 / Math.PI)).toBeLessThan(1e-14);
  });

  it('the three forms are consistent with each other', () => {
    const a = val(fracture({ find: 'crack', K: 26, Y: 1.12, stress: 250 * MPA, a: NaN }), 'kitChemMat.ph.row.crack');
    const k = val(fracture({ find: 'toughness', K: NaN, Y: 1.12, stress: 250 * MPA, a }), 'kitChemMat.ph.row.K');
    expect(rel(k, 26)).toBeLessThan(1e-12);
    const s = val(fracture({ find: 'stress', K: 26, Y: 1.12, stress: NaN, a }), 'kitChemMat.ph.row.fractureStress');
    expect(rel(s, 250 * MPA)).toBeLessThan(1e-12);
  });

  it('a larger geometry factor shortens the critical crack, and doubling the stress quarters it', () => {
    const a1 = val(fracture({ find: 'crack', K: 26, Y: 1, stress: 250 * MPA, a: NaN }), 'kitChemMat.ph.row.crack');
    const a2 = val(fracture({ find: 'crack', K: 26, Y: 1, stress: 500 * MPA, a: NaN }), 'kitChemMat.ph.row.crack');
    expect(rel(a2, a1 / 4)).toBeLessThan(1e-12);
  });

  it('refuses zero or negative inputs', () => {
    expect(fracture({ find: 'crack', K: 26, Y: 0, stress: 1e8, a: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.geometry',
    });
    expect(fracture({ find: 'crack', K: -1, Y: 1, stress: 1e8, a: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.toughness',
    });
    expect(fracture({ find: 'crack', K: 26, Y: 1, stress: 0, a: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.stress',
    });
    expect(fracture({ find: 'stress', K: 26, Y: 1, stress: NaN, a: 0 })).toMatchObject({
      key: 'kitChemMat.ph.err.crack',
    });
  });
});

describe('Larson-Miller parameter', () => {
  it('800 K, 1000 h, C = 20 gives 18400', () => {
    const o = creep({ T1: 800, t1: 1000 * 3600, C: 20, T2: NaN, tTarget: NaN });
    expect(val(o, 'kitChemMat.ph.row.lmp')).toBeCloseTo(18400, 9);
    expect(larsonMiller(800, 1000, 20)).toBe(18400);
  });

  it('a hotter part has a shorter life at the same parameter, and the temperature for a life inverts it', () => {
    const o = creep({ T1: 800, t1: 1000 * 3600, C: 20, T2: 850, tTarget: 5000 * 3600 });
    const h2 = val(o, 'kitChemMat.ph.row.life2') / 3600;
    expect(h2).toBeLessThan(1000);
    expect(rel(h2, 10 ** (18400 / 850 - 20))).toBeLessThan(1e-12);
    const T = val(o, 'kitChemMat.ph.row.temp2');
    expect(rel(larsonMiller(T, 5000, 20), 18400)).toBeLessThan(1e-12);
  });

  it('refuses impossible input', () => {
    expect(creep({ T1: 0, t1: 3600, C: 20, T2: NaN, tTarget: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.temperature',
    });
    expect(creep({ T1: 800, t1: 0, C: 20, T2: NaN, tTarget: NaN })).toMatchObject({ key: 'kitChemMat.ph.err.life' });
    expect(creep({ T1: 800, t1: 3600, C: NaN, T2: NaN, tTarget: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.constant',
    });
    // a life so short that C + log10(t) is not positive has no temperature
    expect(creep({ T1: 800, t1: 3600, C: 1, T2: NaN, tTarget: 1e-3 * 3600 })).toMatchObject({
      key: 'kitChemMat.ph.err.noTemperature',
    });
    expect(creep({ T1: 800, t1: 3600, C: 20, T2: 10, tTarget: NaN })).toMatchObject({
      key: 'kitChemMat.ph.err.hugeLife',
    });
  });
});

// Elastic to 300 MPa at 0.0015 (E = 200 GPa), then a straight hardening line of slope 2000 MPa per unit strain.
const bilinear = '0, 0\n0.0005, 100\n0.001, 200\n0.0015, 300\n0.01, 317\n0.05, 397\n0.1, 497';
const input = {
  data: bilinear,
  strainUnit: 'fraction',
  stressUnit: 'MPa',
  elasticPercent: 50,
  E: NaN,
  offset: 0.002,
};

describe('tensile test', () => {
  it('the 0.2% offset yield equals the analytic intersection of the offset line and the hardening line', () => {
    // hardening line: s = 300 + 2000 (e - 0.0015); offset line: s = 200000 (e - 0.002)
    // 300 - 3 + 2000 e = 200000 e - 400, so e = 697 / 198000
    const eStar = 697 / 198000;
    const sStar = 200000 * (eStar - 0.002);
    const o = tensile(input);
    expect(rel(val(o, 'kitChemMat.ph.row.E'), 200e9)).toBeLessThan(1e-9);
    expect(rel(val(o, 'kitChemMat.ph.row.yieldStrain'), eStar)).toBeLessThan(1e-6);
    expect(rel(val(o, 'kitChemMat.ph.row.yield') / MPA, sStar)).toBeLessThan(1e-6);
  });

  it('a low-yield, high-hardening curve gives E = 110 GPa and the analytic offset yield with the default window', () => {
    // E 110 GPa to 70 MPa, then 1000 MPa per unit strain to 310 MPa; the offset line meets it at e = 289.364/109000.
    const ey = 70 / 110000;
    const pts = [0, 0.0002, 0.0004, 0.0006].map((e) => [e, 110000 * e]);
    for (const e of [0.001, 0.005, 0.02, 0.05, 0.1, 0.2]) pts.push([e, 70 + 1000 * (e - ey)]);
    const exact = pts.map((p) => p.join(', ')).join('\n');
    const o = tensile({ ...input, data: exact, elasticPercent: 100 });
    expect(rel(val(o, 'kitChemMat.ph.row.E'), 110e9)).toBeLessThan(1e-6);
    const eStar = (110000 * 0.002 + 70 - 1000 * ey) / 109000;
    expect(rel(val(o, 'kitChemMat.ph.row.yieldStrain'), eStar)).toBeLessThan(1e-5);
    expect(rel(val(o, 'kitChemMat.ph.row.yield') / MPA, 110000 * (eStar - 0.002))).toBeLessThan(1e-5);
  });

  it('refuses a curve that ends below its elastic line instead of reporting a negative elongation', () => {
    const data = '0, 0\n0.001, 100\n0.002, 200\n0.003, 300\n0.0035, 2000';
    expect(tensile({ ...input, data })).toMatchObject({ key: 'kitChemMat.ph.err.elongation' });
  });
});

describe('tensile test details', () => {
  it('ultimate strength, fracture strain, toughness and true values come from the data', () => {
    const o = tensile(input);
    expect(val(o, 'kitChemMat.ph.row.uts')).toBe(497 * MPA);
    expect(val(o, 'kitChemMat.ph.row.fractureStrain')).toBe(0.1);
    // trapezoid area under the curve, in MJ/m3
    const e = [0, 0.0005, 0.001, 0.0015, 0.01, 0.05, 0.1];
    const s = [0, 100, 200, 300, 317, 397, 497];
    let area = 0;
    for (let i = 1; i < e.length; i++) area += ((s[i] + s[i - 1]) / 2) * (e[i] - e[i - 1]);
    expect(rel(val(o, 'kitChemMat.ph.row.toughness'), area)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.ph.row.trueStress'), 497 * 1.1 * MPA)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.ph.row.trueStrain'), Math.log(1.1))).toBeLessThan(1e-12);
    // plastic elongation is the fracture strain less the elastic recovery
    expect(rel(val(o, 'kitChemMat.ph.row.elongation'), (0.1 - 497 / 200000) * 100)).toBeLessThan(1e-9);
  });

  it('percent strain and ksi stress give the same answer', () => {
    const rows = bilinear.split('\n').map((l) => {
      const [e, s] = l.split(',').map(Number);
      return `${e * 100}, ${s / 6.894757293168}`;
    });
    const o = tensile({ ...input, data: rows.join('\n'), strainUnit: 'percent', stressUnit: 'ksi' });
    const ref = tensile(input);
    expect(rel(val(o, 'kitChemMat.ph.row.yield'), val(ref, 'kitChemMat.ph.row.yield'))).toBeLessThan(1e-9);
    expect(rel(val(o, 'kitChemMat.ph.row.E'), val(ref, 'kitChemMat.ph.row.E'))).toBeLessThan(1e-9);
  });

  it('a toe at the start moves the offset line so the yield stays put', () => {
    const shifted = bilinear
      .split('\n')
      .map((l) => {
        const [e, s] = l.split(',').map(Number);
        return `${e + 0.001}, ${s}`;
      })
      .join('\n');
    const o = tensile({ ...input, data: shifted });
    const ref = tensile(input);
    // the elastic fit uses the straight part, so the yield stress is unchanged
    expect(rel(val(o, 'kitChemMat.ph.row.yield'), val(ref, 'kitChemMat.ph.row.yield'))).toBeLessThan(1e-9);
  });

  it('a given modulus overrides the fit', () => {
    const o = tensile({ ...input, E: 150e9 });
    expect(val(o, 'kitChemMat.ph.row.E')).toBe(150e9);
  });

  it('says so when the curve never meets the offset line', () => {
    const elastic = '0, 0\n0.001, 200\n0.002, 400\n0.003, 600\n0.004, 800';
    const o = tensile({ ...input, data: elastic });
    expect(o.ok).toBe(true);
    expect(has(o, 'kitChemMat.ph.row.yield')).toBe(false);
    expect(o.ok && o.notes.some((n) => n.key === 'kitChemMat.ph.note.noYield')).toBe(true);
  });

  it('refuses malformed, too short, negative, repeated and out-of-range data', () => {
    expect(tensile({ ...input, data: '0, 0\n1' })).toMatchObject({ key: 'kitChemMat.ph.err.table' });
    expect(tensile({ ...input, data: '0, 0\n1, 2\n2, 3' })).toMatchObject({ key: 'kitChemMat.ph.err.fewPoints' });
    expect(tensile({ ...input, data: bilinear + '\n0.11, -5' })).toMatchObject({ key: 'kitChemMat.ph.err.negative' });
    expect(tensile({ ...input, data: bilinear + '\n0.1, 400' })).toMatchObject({ key: 'kitChemMat.ph.err.repeated' });
    expect(tensile({ ...input, offset: 0 })).toMatchObject({ key: 'kitChemMat.ph.err.offset' });
    expect(tensile({ ...input, elasticPercent: 0 })).toMatchObject({ key: 'kitChemMat.ph.err.elastic' });
    expect(tensile({ ...input, elasticPercent: 1 })).toMatchObject({ key: 'kitChemMat.ph.err.fewElastic' });
    expect(tensile({ ...input, E: -5 })).toMatchObject({ key: 'kitChemMat.ph.err.modulus' });
  });

  it('interpolates linearly and holds the ends', () => {
    expect(interpolate([0, 1, 3], [0, 10, 14], 2)).toBe(12);
    expect(interpolate([0, 1, 3], [0, 10, 14], -1)).toBe(0);
    expect(interpolate([0, 1, 3], [0, 10, 14], 5)).toBe(14);
  });
});

describe('fatigue (Basquin)', () => {
  const A = 1000e6;
  const b = -0.1;
  const N = [1e4, 1e5, 1e6, 1e7];
  const data = N.map((n) => `${n}, ${(A * n ** b) / MPA}`).join('\n');

  it('recovers A and b from exact power-law data, and sigma_f from A / 2^b', () => {
    const o = fatigue({ data, stressUnit: 'MPa', stress: NaN, cycles: NaN });
    expect(rel(val(o, 'kitChemMat.ph.row.A'), A)).toBeLessThan(1e-9);
    expect(Math.abs(val(o, 'kitChemMat.ph.row.b') - b)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.ph.row.sigmaF'), A / 2 ** b)).toBeLessThan(1e-9);
    // Basquin's form S = sigma_f (2N)^b reproduces the data
    const sigmaF = val(o, 'kitChemMat.ph.row.sigmaF');
    expect(rel(sigmaF * (2 * 1e6) ** b, A * 1e6 ** b)).toBeLessThan(1e-9);
    expect(val(o, 'kitChemMat.ph.row.r2')).toBeCloseTo(1, 12);
  });

  it('predicts the life at a stress and the strength at a life', () => {
    const o = fatigue({ data, stressUnit: 'MPa', stress: 400 * MPA, cycles: 5e5 });
    expect(rel(val(o, 'kitChemMat.ph.row.life'), (400e6 / A) ** (1 / b))).toBeLessThan(1e-8);
    expect(rel(val(o, 'kitChemMat.ph.row.strength'), A * 5e5 ** b)).toBeLessThan(1e-8);
  });

  it('noisy data lower R^2 but still fit', () => {
    const o = fatigue({ data: '1e4, 480\n1e5, 400\n1e6, 290\n1e7, 250', stressUnit: 'MPa', stress: NaN, cycles: NaN });
    expect(val(o, 'kitChemMat.ph.row.r2')).toBeLessThan(1);
    expect(val(o, 'kitChemMat.ph.row.r2')).toBeGreaterThan(0.95);
    expect(val(o, 'kitChemMat.ph.row.b')).toBeLessThan(0);
  });

  it('works in ksi', () => {
    const ksi = N.map((n) => `${n}, ${(A * n ** b) / 6.894757293168e6}`).join('\n');
    const o = fatigue({ data: ksi, stressUnit: 'ksi', stress: NaN, cycles: NaN });
    expect(rel(val(o, 'kitChemMat.ph.row.A'), A)).toBeLessThan(1e-9);
  });

  it('refuses short, malformed and non-positive data, and a rising line', () => {
    const base = { stressUnit: 'MPa', stress: NaN, cycles: NaN };
    expect(fatigue({ ...base, data: '1e4, 400\n1e5, 300' })).toMatchObject({ key: 'kitChemMat.ph.err.fewFatigue' });
    expect(fatigue({ ...base, data: '1e4, 400\n1e5' })).toMatchObject({ key: 'kitChemMat.ph.err.fatigueTable' });
    expect(fatigue({ ...base, data: '1e4, 400\n1e5, 300\n0, 200' })).toMatchObject({
      key: 'kitChemMat.ph.err.fatigueRange',
    });
    expect(fatigue({ ...base, data: '1e4, 400\n1e4, 300\n1e4, 200' })).toMatchObject({
      key: 'kitChemMat.ph.err.sameLife',
    });
    expect(fatigue({ ...base, data: '1e4, 200\n1e5, 300\n1e6, 400', stress: 250e6 })).toMatchObject({
      key: 'kitChemMat.ph.err.noLife',
    });
    expect(basquin([1, 1], [1, 2])).toBeNull();
  });
});
