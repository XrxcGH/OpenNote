import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  aashto,
  casagrande,
  circleLoad,
  cornerFactor,
  degreeOf,
  directShear,
  dryUnitWeightAt,
  failureStress,
  fallingHead,
  flowCurve,
  gradation,
  hydrometer,
  indices,
  isochrone,
  layeredK,
  phases,
  pointLoad,
  preconsolidation,
  proctor,
  quickCondition,
  secondary,
  settlement,
  skempton,
  stressProfile,
  stripLoad,
  taylor,
  timeFactor,
  triaxial,
  twoToOne,
  uscs,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const rel = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual / expected - 1)).toBeLessThanOrEqual(tol);
const GW = 9.81;

describe('phase relations', () => {
  it('gives the saturated soil of the plan from Gs, e, and S', () => {
    const p = phases(2.7, { e: 0.6, S: 1 }, GW);
    within(p.gammaSat, 20.233125, 1e-6);
    within(p.gammaD, 16.554375, 1e-6);
    within(p.w, 0.222222, 1e-6);
    within(p.n, 0.375, 1e-12);
    within(p.gamma, p.gammaSat, 1e-12);
  });

  it('reaches the same soil from any independent pair', () => {
    const base = phases(2.7, { e: 0.8, w: 0.2 }, GW);
    for (const known of [
      { n: base.n, S: base.S },
      { gammaD: base.gammaD, gamma: base.gamma },
      { w: base.w, S: base.S },
      { w: base.w, gamma: base.gamma },
      { S: base.S, gamma: base.gamma },
    ]) {
      const p = phases(2.7, known, GW);
      within(p.e, 0.8, 1e-9);
      within(p.w, 0.2, 1e-9);
    }
  });

  it('refuses dependent, missing, and impossible pairs', () => {
    expect(() => phases(2.7, { e: 0.6, n: 0.375 }, GW)).toThrow(CivilError);
    expect(() => phases(2.7, { e: 0.6 }, GW)).toThrow(CivilError);
    expect(() => phases(2.7, { e: 0.6, w: 0.5 }, GW)).toThrow(/inconsistent/);
    expect(() => phases(2.7, { e: 0.6, S: 1.2 }, GW)).toThrow(CivilError);
  });
});

describe('gradation and limits', () => {
  const sieve = [
    [4.75, 97],
    [2, 75],
    [1.2, 60],
    [0.4, 30],
    [0.1, 10],
    [0.075, 3],
  ];

  it('reads D10, D30, and D60 off the curve and the plan coefficients', () => {
    const g = gradation(sieve);
    within(g.D10!, 0.1, 1e-12);
    within(g.D30!, 0.4, 1e-12);
    within(g.D60!, 1.2, 1e-12);
    within(g.Cu!, 12, 1e-9);
    within(g.Cc!, 4 / 3, 1e-9);
    within(g.fines!, 3, 1e-9);
    within(g.gravel!, 3, 1e-9);
  });

  it('leaves a size off the curve empty and refuses rising passing', () => {
    expect(gradation(sieve.slice(0, 4)).D10).toBeNull();
    expect(() =>
      gradation([
        [2, 50],
        [1, 60],
      ]),
    ).toThrow(CivilError);
  });

  it('finds the Stokes diameter and the 152H percent finer', () => {
    const h = hydrometer(2.65, 1.002e-3, 0.1, 60, 1000, 30, 50);
    within(h.D, 0.0430941196, 1e-9);
    within(h.finer!, 60, 1e-9);
  });

  it('reads the liquid limit at 25 blows and the indices', () => {
    const rows = [15, 22, 30, 38].map((N) => [N, 60 - 12 * Math.log10(N)]);
    within(flowCurve(rows).LL, 43.2247198959, 1e-9);
    const i = indices(45, 25, 30, 40);
    within(i.PI, 20, 1e-12);
    within(i.LI!, 0.25, 1e-12);
    within(i.activity!, 0.5, 1e-12);
    expect(() => indices(20, 25, null, null)).toThrow(CivilError);
  });
});

describe('classification', () => {
  it('classifies the plan clay and sand', () => {
    const clay = uscs({ fines: 80, passing4: 100, LL: 45, PL: 25, Cu: null, Cc: null });
    expect(clay.symbol).toBe('CL');
    expect(clay.name).toBe('soils.names.CL');
    const sand = uscs({ fines: 3, passing4: 90, LL: null, PL: null, Cu: 12, Cc: 4 / 3 });
    expect(sand.symbol).toBe('SW');
  });

  it('gives dual and borderline symbols', () => {
    expect(uscs({ fines: 8, passing4: 30, LL: 30, PL: 25, Cu: 3, Cc: 1 }).symbol).toBe('GP-GM');
    expect(uscs({ fines: 20, passing4: 80, LL: 20, PL: 14, Cu: null, Cc: null }).symbol).toBe('SC-SM');
    expect(uscs({ fines: 60, passing4: 100, LL: 60, PL: 40, Cu: null, Cc: null }).symbol).toBe('MH');
    expect(() => uscs({ fines: 3, passing4: 90, LL: null, PL: null, Cu: null, Cc: null })).toThrow(CivilError);
  });

  it('gives the AASHTO group and group index', () => {
    // Das's worked example: (95-35)(0.2+0.005*20) + 0.01(95-15)(30) = 18 + 24 = 42, so A-7-6(42). The current
    // M 145 sets no upper limit on the index; the 0-40 and 0-20 term caps belong to the superseded pre-1970s form.
    const a = aashto({ p10: 100, p40: 100, p200: 95, LL: 60, PI: 40 });
    expect(a.group).toBe('A-7-6');
    expect(a.GI).toBe(42);
    expect(aashto({ p10: 40, p40: 20, p200: 10, LL: 0, PI: 0 }).group).toBe('A-1-a');
    expect(aashto({ p10: 100, p40: 80, p200: 5, LL: 0, PI: 0 }).group).toBe('A-3');
    const a26 = aashto({ p10: 90, p40: 60, p200: 30, LL: 35, PI: 15 });
    expect(a26.group).toBe('A-2-6');
    within(a26.raw, 0.75, 1e-12);
  });
});

describe('compaction and permeability', () => {
  it('gives the zero-air-voids unit weight of the plan', () => {
    within(dryUnitWeightAt(0.15, 2.7, GW), 18.8519573, 1e-6);
  });

  it('finds the peak of a Proctor curve and refuses one with no peak', () => {
    const rows = [10, 12, 14, 16, 18].map((w) => [w, 18 - 0.05 * (w - 14) ** 2]);
    const p = proctor(rows, 2);
    within(p.wOpt, 14, 1e-6);
    within(p.gammaMax, 18, 1e-9);
    expect(() =>
      proctor(
        [10, 12, 14, 16].map((w) => [w, 15 + 0.1 * w]),
        2,
      ),
    ).toThrow(CivilError);
  });

  it('gives the falling-head k of the plan and layered equivalents', () => {
    // a 1 cm², L 10 cm, A 50 cm², 600 s, 100 to 50 cm, in meters: k in m/s.
    within(fallingHead(1e-4, 0.1, 50e-4, 600, 1, 0.5) * 100, 0.00023104906, 1e-11);
    const k = layeredK([
      [1, 1e-4],
      [1, 1e-6],
    ]);
    within(k.kx, 5.05e-5, 1e-15);
    within(k.kz, 2 / (1e4 + 1e6), 1e-15);
    expect(() => fallingHead(1, 1, 1, 1, 1, 2)).toThrow(CivilError);
  });
});

describe('stresses', () => {
  it('gives the effective stress of the plan and with a capillary zone', () => {
    const plain = stressProfile([[10, 18, 20]], 2, 0, GW);
    within(plain.at(5).eff, 66.57, 1e-9);
    const cap = stressProfile([[10, 17, 19]], 3, 1, GW);
    within(cap.at(2.5).sigma, 43.5, 1e-9);
    within(cap.at(2.5).u, -4.905, 1e-9);
    within(cap.at(5).eff, 71.38, 1e-9);
  });

  it('gives the quick condition', () => {
    const q = quickCondition(20, 1, 2, GW);
    within(q.ic, (20 - GW) / GW, 1e-12);
    within(q.FS, (2 * (20 - GW)) / GW, 1e-12);
    expect(() => quickCondition(9, 1, 2, GW)).toThrow(CivilError);
  });

  it('gives Boussinesq stresses checked by numerical integration', () => {
    within(pointLoad(100, 0, 2), 11.9366207, 1e-6);
    within(cornerFactor(1, 1, 1), 0.1752214826, 1e-9);
    within(cornerFactor(2, 3, 1.5), 0.2182021492, 1e-9);
    within(4 * cornerFactor(1, 1.5, 2), 0.4282917159, 1e-9);
    within(stripLoad(100, 2, 0.5, 1.5), 60.7064291297, 1e-8);
    within(circleLoad(100, 1, 1), 64.6446609407, 1e-9);
    within(twoToOne(100, 2, 2, 2), 25, 1e-12);
    expect(() => pointLoad(100, 0, 0)).toThrow(CivilError);
  });
});

describe('consolidation', () => {
  it('gives the plan time factors and the series', () => {
    within(timeFactor(0.5).approx, 0.19635, 1e-4);
    within(timeFactor(0.9).approx, 0.848, 1e-4);
    within(degreeOf(0.2), 0.5040878202, 1e-9);
    within(degreeOf(1), 0.9312596785, 1e-9);
    within(timeFactor(0.5).exact, 0.1967307395, 1e-8);
    within(timeFactor(0.9).exact, 0.848085408, 1e-8);
    expect(() => timeFactor(1)).toThrow(CivilError);
  });

  it('has isochrones that start at 1 and drain at the boundary', () => {
    within(isochrone(1, 0.01), 1, 1e-6);
    within(isochrone(0, 0.3), 0, 1e-12);
  });

  it('gives normally and overconsolidated settlement', () => {
    within(settlement({ Cc: 0.3, Cr: null, e0: 0.9, H: 4, s0: 100, ds: 50, sp: null }).S, 0.111216, 1e-6);
    within(settlement({ Cc: 0.3, Cr: 0.05, e0: 0.9, H: 4, s0: 100, ds: 100, sp: 150 }).S, 0.0974445978, 1e-9);
    expect(() => settlement({ Cc: 0.3, Cr: 0.05, e0: 0.9, H: 4, s0: 100, ds: 100, sp: 80 })).toThrow(CivilError);
    within(secondary(0.01, 2, 0.9, 1, 10), 0.01 * (2 / 1.9), 1e-12);
  });

  // Readings made from Terzaghi's theory with c_v 2 m²/yr and a 10 mm drainage path, in minutes and mm.
  const cv = 2 / (365.25 * 1440);
  const H = 0.01;
  const times = [0, 0.1, 0.25, 0.5, 1, 2, 4, 6, 8, 10, 12, 15, 18, 21, 24, 27, 30, 40, 60, 120, 240, 480, 1440];
  const rows = times.map((t) => [t, degreeOf((cv * t) / (H * H)) + (t > 60 ? 0.02 * Math.log10(t / 60) : 0)]);

  it('recovers t90 by Taylor and t50 by Casagrande close to the theory', () => {
    rel(taylor(rows, 4).t90, (0.848085 * H * H) / cv, 0.02);
    rel(casagrande(rows, 4).t50, (0.196731 * H * H) / cv, 0.08);
  });

  it('finds the preconsolidation pressure at the corner of a two-line curve', () => {
    const e = (s: number) =>
      s <= 200 ? 1 - 0.05 * Math.log10(s / 25) : 1 - 0.05 * Math.log10(8) - 0.4 * Math.log10(s / 200);
    const p = preconsolidation(
      [25, 50, 100, 200, 400, 800, 1600].map((s) => [s, e(s)]),
      3,
    );
    rel(p.sp, 200, 1e-9);
    within(p.Cc, 0.4, 1e-9);
    within(p.Cr, 0.05, 1e-9);
  });
});

describe('shear strength', () => {
  it('fits the plan triaxial pair', () => {
    const t = triaxial([
      [100, 300],
      [200, 500],
    ]);
    within(t.phi, 19.4712206, 1e-5);
    within(t.c, 35.3553391, 1e-5);
  });

  it('recovers c and φ from three tests and predicts σ₁', () => {
    const rows = [50, 100, 200].map((s3) => [s3, failureStress(20, 30, s3)]);
    within(rows[0]![1]!, 219.282032303, 1e-8);
    const t = triaxial(rows);
    within(t.phi, 30, 1e-9);
    within(t.c, 20, 1e-9);
    expect(triaxial([[100, 180]]).c).toBe(40);
  });

  it('fits direct shear and Skempton parameters', () => {
    const d = directShear([
      [50, 10 + 50 * Math.tan(Math.PI / 6)],
      [150, 10 + 150 * Math.tan(Math.PI / 6)],
    ]);
    within(d.phi, 30, 1e-9);
    within(d.c, 10, 1e-9);
    const s = skempton(100, 98, 200, 60);
    within(s.B, 0.98, 1e-12);
    within(s.A, 60 / (0.98 * 200), 1e-12);
    expect(() => triaxial([[200, 100]])).toThrow(CivilError);
  });
});
