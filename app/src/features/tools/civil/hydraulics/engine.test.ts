import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  G,
  classify,
  convolve,
  criticalDepth,
  curveNumber,
  detention,
  directStep,
  frequencyFit,
  froude,
  geometry,
  gumbelK,
  hardyCross,
  hazenK,
  jump,
  kirpich,
  manning,
  muskingum,
  muskingumCoefficients,
  normalDepth,
  normalQuantile,
  pearsonK,
  puls,
  rational,
  risk,
  sCurve,
  specificEnergy,
  usleLS,
  weirFlow,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};

describe('rainfall and runoff', () => {
  it('gives the plan rational and curve-number runoff', () => {
    within(rational(0.5, 50, 2), 13.9, 1e-9);
    within(curveNumber(4, 80).Q, 2.04167, 1e-5);
    expect(curveNumber(0.4, 80).Q).toBe(0);
  });

  it('gives Kirpich in minutes by hand', () => {
    // 1000^0.77 = 204.2 and 0.01^-0.385 = 5.888, so 0.0195 x 204.2 x 5.888 = 23.45 min; the US form
    // 0.0078 x (3281 ft)^0.77 x 0.01^-0.385 gives the same 23.4 min.
    within(kirpich(1000, 0.01), 23.45, 0.01);
  });

  it('convolves a unit hydrograph and keeps its volume through the S-curve', () => {
    const uh = [0, 2, 5, 3, 1, 0];
    expect(convolve(uh, [1, 2])).toEqual([0, 2, 9, 13, 7, 2, 0]);
    // A 2-step hydrograph changed to 1 step keeps the same volume.
    const two = convolve([0, 1, 2, 1, 0], [0.5, 0.5]);
    const one = sCurve(two, 2, 1);
    within(
      one.U.reduce((s, v) => s + v, 0),
      two.reduce((s, v) => s + v, 0),
      1e-9,
    );
  });

  it('refuses a curve number outside its range', () => {
    expect(key(() => curveNumber(4, 120))).toBe('hydraulics.errors.cn');
  });
});

describe('routing', () => {
  it('gives the plan Muskingum coefficients', () => {
    const c = muskingumCoefficients(12, 0.2, 6);
    within(c.C0, 0.047619, 1e-6);
    within(c.C1, 0.428571, 1e-6);
    within(c.C2, 0.52381, 1e-6);
    within(c.C0 + c.C1 + c.C2, 1, 1e-12);
  });

  it('keeps volume and lowers the peak through a reservoir', () => {
    const inflow = [0, 10, 30, 20, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const r = puls(
      inflow,
      [
        [0, 0],
        [100000, 10],
        [300000, 30],
      ],
      3600,
    );
    expect(Math.max(...r.outflow)).toBeLessThan(30);
    const routed = muskingum([0, 10, 30, 20, 10, 0, 0, 0, 0, 0, 0, 0], 2, 0.2, 1);
    expect(Math.max(...routed.outflow)).toBeLessThan(30);
  });

  it('drains a detention basin through its orifice', () => {
    const d = detention(
      [
        [0, 0],
        [1800, 2],
        [3600, 0],
      ],
      2000,
      { Cd: 0.6, area: 0.2 },
      { Cw: 1.8, L: 2, crest: 3 },
    );
    expect(d.peakO).toBeLessThan(d.peakI);
    expect(d.peakH).toBeGreaterThan(0);
    // Mass balance: the 3600 m3 triangle of inflow leaves as outflow or is still stored at the end.
    let out = 0;
    for (let i = 1; i < d.points.length; i++) {
      const [ta, , oa] = d.points[i - 1]!;
      const [tb, , ob] = d.points[i]!;
      out += ((oa + ob) / 2) * (tb - ta);
    }
    const stored = 2000 * d.points[d.points.length - 1]![3];
    within((out + stored) / 3600, 1, 0.01);
  });
});

describe('flood frequency', () => {
  it('gives the plan Gumbel flood and risk', () => {
    within(gumbelK(100), 3.13668, 1e-5);
    within(500 + 150 * gumbelK(100), 970.502, 1e-3);
    within(risk(100, 30), 0.2603, 1e-4);
  });

  it('gives normal quantiles and the Wilson-Hilferty factor', () => {
    within(normalQuantile(0.99), 2.326347874, 1e-8);
    within(normalQuantile(0.5), 0, 1e-12);
    within(pearsonK(100, 0), 2.326347874, 1e-8);
    // The published Pearson III table gives 2.686 for skew 0.5 at 100 years; Wilson-Hilferty is within 0.003.
    within(pearsonK(100, 0.5), 2.686, 0.003);
    // The same table at 100 years gives 3.022 for skew +1 and 1.588 for skew -1; the transform reads 3.030 and 1.601.
    within(pearsonK(100, 1), 3.022, 0.015);
    within(pearsonK(100, -1), 1.588, 0.015);
  });

  it('ranks peaks with Weibull positions', () => {
    const f = frequencyFit([100, 300, 200]);
    expect(f.ranked[0]).toEqual([300, 1, 0.25, 4]);
    within(f.mean, 200, 1e-12);
    within(f.sd, 100, 1e-12);
  });
});

describe('open channels', () => {
  const rect = { kind: 'rectangle' as const, b: 3 };

  it('gives the plan Manning flow and critical depth', () => {
    within(manning(rect, 1, 0.015, 0.001), 4.49915, 1e-5);
    within(criticalDepth({ kind: 'rectangle', b: 1 }, 1.5), 0.612191, 1e-6);
    within(normalDepth(rect, manning(rect, 1, 0.015, 0.001), 0.015, 0.001), 1, 1e-9);
  });

  it('finds critical depth at the minimum of specific energy', () => {
    const yc = criticalDepth({ kind: 'trapezoid', b: 2, z: 1.5 }, 8);
    const s = { kind: 'trapezoid' as const, b: 2, z: 1.5 };
    expect(specificEnergy(s, 8, yc)).toBeLessThan(specificEnergy(s, 8, yc * 1.01));
    expect(specificEnergy(s, 8, yc)).toBeLessThan(specificEnergy(s, 8, yc * 0.99));
    within(froude(s, 8, yc), 1, 1e-9);
  });

  it('matches the circle at half full', () => {
    const g = geometry({ kind: 'circle', D: 2 }, 1);
    within(g.A, Math.PI / 2, 1e-12);
    within(g.P, Math.PI, 1e-12);
  });

  it('gives the plan hydraulic jump', () => {
    const j = jump(1.5, 0.3);
    within(j.Fr1, 2.91507, 1e-5);
    within(j.y2, 1.09582, 1e-5);
    expect(key(() => jump(1.5, 1))).toBe('hydraulics.errors.subcritical');
  });

  it('classifies profiles and steps a backwater curve upstream', () => {
    expect(classify(0.001, 2, 1, 0.6)).toBe('M1');
    expect(classify(0.001, 0.8, 1, 0.6)).toBe('M2');
    expect(classify(0.02, 0.5, 0.4, 0.6)).toBe('S2');
    expect(classify(0, 1, null, 0.6)).toBe('H2');
    const yn = normalDepth(rect, 4.5, 0.015, 0.001);
    const p = directStep(rect, 4.5, 0.015, 0.001, 2, yn * 1.01, 40);
    expect(p.length).toBeLessThan(0);
    // yn = 1.0001 m here: stepping from 0.9 m (M2) to 1.2 m would cross Sf = S0 and give a false length.
    expect(key(() => directStep(rect, 4.5, 0.015, 0.001, 0.9, 1.2, 40))).toBe('hydraulics.errors.profileRange');
    // yc = 0.6121 m: an M3 control at 0.4 m cannot step past the critical depth either.
    expect(key(() => directStep(rect, 4.5, 0.015, 0.001, 0.4, 0.8, 40))).toBe('hydraulics.errors.profileRange');
    expect(key(() => directStep(rect, 4.5, 0.015, 0, 0.4, 0.8, 40))).toBe('hydraulics.errors.profileRange');
  });

  it('gives weirs and orifices by hand', () => {
    // Worked by hand with sqrt(2g) = 4.4287: 0.4133 x 4.4287 x 2 x 0.16432; 0.06 x 6.2631; 0.3093 x 4.4287 x 0.017889.
    within(weirFlow('rect', 0.62, 0.3, 2), 0.6016, 2e-4);
    within(weirFlow('orifice', 0.6, 2, 0.1), 0.3758, 2e-4);
    within(weirFlow('vnotch', 0.58, 0.2, 90), 0.02451, 2e-4);
  });

  it('gives a Hazen-Williams head loss that matches the velocity form', () => {
    // 1000 m of 0.3 m pipe, C 100, Q 0.1 m3/s: V = 0.849 C R^0.63 S^0.54 with R = 0.075 m gives S = 0.01046.
    within(hazenK(1000, 0.3, 100) * 0.1 ** 1.852, 10.46, 0.05);
  });
});

describe('erosion and pipe networks', () => {
  it('gives the unit plot an LS of 1', () => {
    within(usleLS(22.13, 9), 1, 0.01);
  });

  it('balances the plan parallel pipes by Hardy Cross', () => {
    const r = hardyCross([
      { k: 1, e: 2, Q0: 1.5, loops: [1] },
      { k: 4, e: 2, Q0: 1.5, loops: [-1] },
    ]);
    // Both pipes carry flow from the same node to the other; pipe 2 runs counterclockwise around the loop.
    within(r.Q[0]!, 2, 1e-6);
    within(r.Q[1]!, 1, 1e-6);
  });
});
