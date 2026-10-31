// Geochronology and isotopes: each planning case is checked against the value worked out independently (the
// planning pass, a published worked example, or a closed form), then the edge cases.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { rel } from '../core/testing';
import {
  SYSTEMS,
  arArAge,
  calibrate,
  concordia,
  concordiaIntercepts,
  jFactor,
  kArAge,
  normalization,
  plateau,
  radiocarbon,
  ratioAge,
} from './decay';
import { alphaOf, formula, fractionation, mix, molarMass } from './isotopes';
import { DIVISIONS, lookup } from './timescale';
import { york } from './york';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('ages', () => {
  it('gives the Rb-Sr age 700.728 Myr for a ratio of 0.01', () => {
    expect(rel(ratioAge(0.01, 1.42e-11) / 1e6, 700.728)).toBeLessThan(1e-6);
    expect(ratioAge(0, 1.42e-11)).toBe(0);
    expect(problem(() => ratioAge(-0.1, 1.42e-11))).toBe('negativeRatio');
  });

  it('gives the radiocarbon age 5568.05 yr BP for F14C 0.5 and the factor 0.989822 for δ13C −20', () => {
    expect(Math.abs(radiocarbon(0.5, null).age - 5568.05)).toBeLessThan(5e-3);
    expect(Math.abs(normalization(-20) - 0.989822)).toBeLessThan(5e-7);
    expect(normalization(-25)).toBeCloseTo(1, 12);
    expect(problem(() => radiocarbon(0, null))).toBe('fraction');
  });

  it('gives 614.409 Myr for 206Pb/238U 0.1 and the concordant 207Pb/235U 0.831436', () => {
    const t = ratioAge(0.1, SYSTEMS.u238.lambda);
    expect(rel(t / 1e6, 614.409)).toBeLessThan(1e-6);
    expect(Math.abs(concordia(t)[0] - 0.831436)).toBeLessThan(5e-7);
  });

  it('finds both ends of a discordia drawn from 2500 Myr to 500 Myr', () => {
    const [x1, y1] = concordia(2500e6);
    const [x2, y2] = concordia(500e6);
    const b = (y1 - y2) / (x1 - x2);
    const hits = concordiaIntercepts(y2 - b * x2, b);
    expect(hits).toHaveLength(2);
    expect(Math.abs(hits[0] - 500e6)).toBeLessThan(1);
    expect(Math.abs(hits[1] - 2500e6)).toBeLessThan(1);
  });

  it('gives the K-Ar age 164.394 Myr and an Ar-Ar age that returns its standard', () => {
    expect(rel(kArAge(0.01) / 1e6, 164.394)).toBeLessThan(1e-6);
    const j = jFactor(28.2e6, 1.5);
    expect(rel(arArAge(1.5, j), 28.2e6)).toBeLessThan(1e-12);
  });

  it('finds the plateau in a step-heating spectrum and refuses one with too little gas', () => {
    const steps = [
      { gas: 5, age: 80, sigma: 2 },
      { gas: 20, age: 100.5, sigma: 1 },
      { gas: 30, age: 99.8, sigma: 1 },
      { gas: 25, age: 100.2, sigma: 1 },
      { gas: 20, age: 115, sigma: 2 },
    ];
    const p = plateau(steps)!;
    expect([p.from, p.to, p.gas]).toEqual([2, 4, 75]);
    // Equal errors give the plain mean of 100.5, 99.8, and 100.2.
    expect(p.age).toBeCloseTo(100.1666667, 6);
    expect(plateau(steps.map((s, i) => ({ ...s, age: 100 + i * 10 })))).toBeNull();
  });

  it('calibrates against a straight curve to a symmetric range around the matching year', () => {
    const curve = [0, 10000].map((cal) => ({ cal, c14: cal, sigma: 0 }));
    const c = calibrate(5000, 50, curve);
    expect(c.median).toBe(5000);
    // One range of about ±σ: 99 to 101 whole years centered on 5000.
    expect(c.ranges68).toHaveLength(1);
    const [older, younger] = c.ranges68[0];
    expect(older - younger).toBeGreaterThanOrEqual(98);
    expect(older - younger).toBeLessThanOrEqual(100);
    expect(Math.abs((older + younger) / 2 - 5000)).toBeLessThanOrEqual(1);
    expect(problem(() => calibrate(50000, 50, curve))).toBe('outside');
  });
});

describe('York fit', () => {
  // Pearson's data with York's weights: York et al. (2004), table 2.
  const xs = [0, 0.9, 1.8, 2.6, 3.3, 4.4, 5.2, 6.1, 6.5, 7.4];
  const ys = [5.9, 5.4, 4.4, 4.6, 3.5, 3.7, 2.8, 2.8, 2.4, 1.5];
  const wx = [1000, 1000, 500, 800, 200, 80, 60, 20, 1.8, 1];
  const wy = [1, 1.8, 4, 8, 20, 20, 70, 70, 100, 500];

  it('reproduces the published slope −0.48053 and intercept 5.4799 with their errors', () => {
    const fit = york(xs.map((x, i) => ({ x, y: ys[i], sx: 1 / Math.sqrt(wx[i]), sy: 1 / Math.sqrt(wy[i]) })));
    expect(Math.abs(fit.slope + 0.48053)).toBeLessThan(5e-5);
    expect(Math.abs(fit.intercept - 5.47991)).toBeLessThan(5e-5);
    // York's errors are 0.0580 and 0.2950; scaled by √MSWD they are the 0.0706 and 0.3592 often quoted.
    expect(Math.abs(fit.seSlope - 0.058)).toBeLessThan(5e-4);
    expect(Math.abs(fit.seIntercept - 0.295)).toBeLessThan(5e-4);
    expect(Math.abs(fit.seSlope * Math.sqrt(fit.mswd) - 0.0706)).toBeLessThan(5e-4);
    expect(Math.abs(fit.seIntercept * Math.sqrt(fit.mswd) - 0.3592)).toBeLessThan(5e-4);
  });

  it('fits an exact isochron exactly and refuses zero errors', () => {
    const fit = york([1, 2, 3].map((x) => ({ x, y: 0.7 + 0.01 * x, sx: 0.01, sy: 0.001 })));
    expect(fit.slope).toBeCloseTo(0.01, 12);
    expect(fit.intercept).toBeCloseTo(0.7, 12);
    expect(problem(() => york([1, 2].map((x) => ({ x, y: x, sx: 0, sy: 1 }))))).toBe('sigma');
  });
});

describe('stable isotopes and formulas', () => {
  it('gives −6.9075 per mil by Rayleigh for α 1.01, f 0.5, and −4.09091 for the planning mix', () => {
    expect(Math.abs(fractionation(0, 1.01, 0.5).rayleigh + 6.9075)).toBeLessThan(5e-5);
    const m = mix([
      { fraction: 0.5, concentration: 10, delta: -5 },
      { fraction: 0.5, concentration: 1, delta: 5 },
    ]);
    expect(Math.abs(m.delta + 4.09091)).toBeLessThan(5e-6);
    expect(
      problem(() =>
        mix([
          { fraction: 0.4, concentration: 1, delta: 0 },
          { fraction: 0.4, concentration: 1, delta: 1 },
        ]),
      ),
    ).toBe('fractions');
  });

  it('closes the open-system mass balance and keeps the batch residual between the end states', () => {
    const f = fractionation(0, 1.01, 0.5);
    expect(0.5 * f.rayleigh + 0.5 * f.product).toBeCloseTo(0, 9);
    expect(f.batch).toBeLessThan(0);
    expect(f.batch).toBeGreaterThan(f.rayleigh);
    expect(alphaOf(10, 0).alpha).toBeCloseTo(1.01, 12);
  });

  it('gives olivine Si 0.98219, Mg 1.8303, Fe 0.20535 on 4 oxygens', () => {
    const f = formula({ SiO2: 40, MgO: 50, FeO: 10 }, 4, null);
    expect(Math.abs(f.cations.Si! - 0.98219)).toBeLessThan(1e-4);
    expect(Math.abs(f.cations.Mg! - 1.8303)).toBeLessThan(1e-4);
    expect(Math.abs(f.cations.Fe! - 0.20535)).toBeLessThan(1e-4);
  });

  it('splits magnetite into one Fe2+ and two Fe3+ by charge balance', () => {
    // Fe3O4 with all iron reported as FeO: 3 FeO per formula, 3 × 71.844 / 231.533 = 93.09 wt%.
    const wt = (300 * molarMass('FeO')) / (3 * molarMass('FeO') + 15.999);
    const f = formula({ FeO: wt }, 4, 3);
    expect(f.cations.Fe3).toBeCloseTo(2, 9);
    expect(f.cations.Fe).toBeCloseTo(1, 9);
    expect(problem(() => formula({}, 4, null))).toBe('noOxides');
  });
});

describe('time scale', () => {
  it('places 100 Ma in the Cretaceous and 10 Ma in the Miocene', () => {
    expect(lookup(100).map((x) => x.id)).toEqual(['phanerozoic', 'mesozoic', 'cretaceous']);
    expect(lookup(10).map((x) => x.id)).toEqual(['phanerozoic', 'cenozoic', 'neogene', 'miocene']);
    expect(lookup(0).map((x) => x.id)).toEqual(['phanerozoic', 'cenozoic', 'quaternary', 'holocene']);
  });

  it('has no gaps or overlaps within a rank', () => {
    for (const rank of ['eon', 'period'] as const) {
      const list = DIVISIONS.filter((x) => x.rank === rank).sort((a, b) => b.start - a.start);
      for (let i = 1; i < list.length; i++) expect(list[i].start).toBe(list[i - 1].end);
    }
  });
});
