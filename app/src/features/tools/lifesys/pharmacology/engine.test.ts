// Pharmacokinetics against the planning pass's independent values (computed separately in Python), plus closed forms,
// a numeric cross-check of the Michaelis-Menten time, and the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  biexponentialResult,
  concentration,
  emax,
  hybrid,
  microFromMacro,
  michaelisResult,
  mmTime,
  mosteller,
  multipleDose,
  multipleDoseResult,
  nca,
  ncaResult,
  oneCompartmentResult,
  oralPeak,
  pdResult,
  pkpdResult,
  releaseResult,
  scalingResult,
  twoCompartmentResult,
  type OneCompartment,
} from './engine';

const bolus: OneCompartment = { route: 'bolus', dose: 500, V: 50, k: 0.1, ka: 0, F: 1, tinf: 0, t: 4 };
const row = (r: { rows: { label: string; value: number | string }[] }, label: string) =>
  r.rows.find((x) => x.label === `pharmacology.r.${label}`)?.value as number;
const throwsKey = (fn: () => unknown, key: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LsError);
    expect((e as LsError).key).toBe(key);
    return;
  }
  throw new Error(`expected ${key}`);
};

describe('one-compartment models', () => {
  it('gives C(4 h) 6.7032, t½ 6.93147, CL 5, AUC 100 for a 500 mg bolus, V 50 L, k 0.1 /h', () => {
    const r = oneCompartmentResult(bolus);
    expect(row(r, 'conc')).toBeCloseTo(6.7032, 4);
    expect(row(r, 'half')).toBeCloseTo(6.93147, 5);
    expect(row(r, 'CL')).toBeCloseTo(5, 9);
    expect(row(r, 'auc')).toBeCloseTo(100, 9);
  });

  it('gives tmax 2.55843 h and Cmax 7.74264 mg/L for an oral 500 mg, ka 1, k 0.1', () => {
    const p: OneCompartment = { ...bolus, route: 'oral', ka: 1 };
    const { tmax, cmax } = oralPeak(p);
    expect(tmax).toBeCloseTo(2.55843, 5);
    expect(cmax).toBeCloseTo(7.74264, 5);
    // The slope is zero at the peak.
    expect(concentration(p, tmax + 1e-4)).toBeLessThan(cmax);
    expect(concentration(p, tmax - 1e-4)).toBeLessThan(cmax);
  });

  it('uses the limit F D k t e^(−kt) / V when ka equals k', () => {
    const p: OneCompartment = { ...bolus, route: 'oral', ka: 0.1 };
    expect(concentration(p, 10)).toBeCloseTo(10 * 0.1 * 10 * Math.exp(-1), 9);
    expect(oralPeak(p).tmax).toBeCloseTo(10, 9);
  });

  it('approaches R0 / CL during a long infusion and falls after it', () => {
    const p: OneCompartment = { ...bolus, route: 'infusion', tinf: 100 };
    expect(concentration(p, 100)).toBeCloseTo((5 / 5) * (1 - Math.exp(-10)), 9);
    expect(concentration(p, 110)).toBeCloseTo(concentration(p, 100) * Math.exp(-1), 9);
    expect(row(oneCompartmentResult(p), 'css')).toBeCloseTo(1, 9);
  });

  it('rejects zero, negative, and impossible values', () => {
    throwsKey(() => oneCompartmentResult({ ...bolus, V: 0 }), 'errors.positive');
    throwsKey(() => oneCompartmentResult({ ...bolus, k: -1 }), 'errors.positive');
    throwsKey(() => oneCompartmentResult({ ...bolus, route: 'oral', ka: 1, F: 1.5 }), 'errors.range');
    throwsKey(() => oneCompartmentResult({ ...bolus, route: 'infusion', tinf: 0 }), 'errors.positive');
  });

  it('stays finite for a huge dose and an extreme time', () => {
    const r = oneCompartmentResult({ ...bolus, dose: 1e12, t: 1e4 });
    expect(Number.isFinite(row(r, 'conc'))).toBe(true);
    expect(row(r, 'conc')).toBeGreaterThanOrEqual(0);
  });
});

describe('multiple dosing', () => {
  it('gives R 1.81597, average 12.5 mg/L, and a 625 mg loading dose every 8 h', () => {
    const m = multipleDose(500, 8, 0.1, 50, 1, null);
    expect(m.R).toBeCloseTo(1.81597, 5);
    expect(m.avg).toBeCloseTo(12.5, 9);
    expect(m.loading).toBeCloseTo(625, 9);
    expect(m.max).toBeCloseTo(10 * m.R, 9);
    expect(m.min).toBeCloseTo(m.max * Math.exp(-0.8), 9);
    expect(m.tss90).toBeCloseTo(Math.log(10) / 0.1, 9);
  });

  it('matches the summed single doses at steady state for oral dosing', () => {
    const m = multipleDose(500, 8, 0.1, 50, 1, 1);
    const single: OneCompartment = { ...bolus, route: 'oral', ka: 1 };
    let sum = 0;
    for (let i = 0; i < 400; i += 1) sum += concentration(single, m.tmaxSs + i * 8);
    expect(m.max).toBeCloseTo(sum, 6);
    expect(m.min).toBeLessThan(m.avg);
    expect(m.max).toBeGreaterThan(m.avg);
  });

  it('caps the plotted doses and refuses equal ka and k', () => {
    throwsKey(() => multipleDoseResult(500, 8, 0.1, 50, 1, null, 61), 'errors.range');
    throwsKey(() => multipleDose(500, 8, 0.1, 50, 1, 0.1), 'pharmacology.e.kaEqualsK');
    throwsKey(() => multipleDose(500, 0, 0.1, 50, 1, null), 'errors.positive');
  });
});

describe('two-compartment models', () => {
  it('gives α 0.93589 and β 0.0641101 for k10 0.2, k12 0.5, k21 0.3', () => {
    const { alpha, beta } = hybrid(0.2, 0.5, 0.3);
    expect(alpha).toBeCloseTo(0.93589, 5);
    expect(beta).toBeCloseTo(0.0641101, 6);
    expect(alpha + beta).toBeCloseTo(1, 12);
    expect(alpha * beta).toBeCloseTo(0.06, 12);
  });

  it('starts at D / V1 and round-trips the micro-constants', () => {
    const r = twoCompartmentResult(500, 20, 0.2, 0.5, 0.3);
    const [A, B] = [row(r, 'A'), row(r, 'B')];
    expect(A + B).toBeCloseTo(25, 9);
    const micro = microFromMacro(A, row(r, 'alpha'), B, row(r, 'beta'));
    expect(micro.k10).toBeCloseTo(0.2, 9);
    expect(micro.k12).toBeCloseTo(0.5, 9);
    expect(micro.k21).toBeCloseTo(0.3, 9);
    expect(row(r, 'auc')).toBeCloseTo(500 / (0.2 * 20), 9);
  });

  it('recovers the parameters from noise-free biexponential data', () => {
    const r0 = twoCompartmentResult(500, 20, 0.2, 0.5, 0.3);
    const [A, a, B, b] = [row(r0, 'A'), row(r0, 'alpha'), row(r0, 'B'), row(r0, 'beta')];
    const data = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24].map((t) => [t, A * Math.exp(-a * t) + B * Math.exp(-b * t)]);
    const r = biexponentialResult(data, 500);
    expect(row(r, 'alpha')).toBeCloseTo(a, 4);
    expect(row(r, 'beta')).toBeCloseTo(b, 5);
    expect(row(r, 'k10')).toBeCloseTo(0.2, 4);
    expect(row(r, 'V1')).toBeCloseTo(20, 3);
  });

  it('needs 5 points for the fit', () => {
    throwsKey(
      () =>
        biexponentialResult(
          [
            [1, 2],
            [2, 1],
          ],
          null,
        ),
      'errors.points',
    );
  });
});

describe('non-compartmental analysis', () => {
  const t = [0, 1, 2, 4, 8];
  const c = [0, 8, 6, 4, 2];

  it('gives AUC0-8 33, λz 0.173287, and AUCinf 44.5416', () => {
    const r = nca(t, c, 2, 'linear');
    expect(r.auc).toBeCloseTo(33, 9);
    expect(r.lambdaZ).toBeCloseTo(0.173287, 6);
    expect(r.aucInf).toBeCloseTo(44.5416, 4);
    expect(r.cmax).toBe(8);
    expect(r.tmax).toBe(1);
  });

  it('gives the exact area of an exponential with log-down trapezoids', () => {
    const times = [0, 1, 2, 4, 8, 12];
    const r = nca(
      times,
      times.map((x) => 10 * Math.exp(-0.2 * x)),
      3,
      'logDown',
    );
    expect(r.aucInf).toBeCloseTo(50, 9);
    expect(r.mrt).toBeCloseTo(5, 9);
    expect(r.lambdaZ).toBeCloseTo(0.2, 9);
  });

  it('derives CL, Vz, and Vss from the dose', () => {
    const r = ncaResult(
      t.map((x, i) => [x, c[i]]),
      2,
      'linear',
      100,
      'iv',
    );
    expect(row(r, 'CL')).toBeCloseTo(100 / 44.5416, 4);
    expect(row(r, 'Vz')).toBeCloseTo(100 / 44.5416 / 0.173287, 3);
  });

  it('rejects unordered times, a rising tail, and too many terminal points', () => {
    throwsKey(() => nca([0, 2, 1], [1, 2, 3], 2, 'linear'), 'pharmacology.e.times');
    throwsKey(() => nca([0, 1, 2], [1, 2, 3], 2, 'linear'), 'pharmacology.e.lambdaZ');
    throwsKey(() => nca([0, 1, 2], [3, 2, 1], 4, 'linear'), 'pharmacology.e.terminal');
    throwsKey(() => nca([0, 1, 2], [3, 2, 0], 2, 'linear'), 'pharmacology.e.terminalZero');
    throwsKey(() => nca([0, 1], [3, 2], 2, 'linear'), 'errors.points');
  });
});

describe('Michaelis-Menten elimination', () => {
  it('agrees between the integrated time and the simulation', () => {
    const time = mmTime(20, 5, 2, 4);
    expect(time).toBeCloseTo((4 * Math.log(4) + 15) / 2, 12);
    const r = michaelisResult(20, 2, 4, 5, time);
    expect(row(r, 'conc')).toBeCloseTo(5, 4);
    expect(row(r, 'timeTo')).toBeCloseTo(time, 12);
  });

  it('reaches the integrated time at a non-round end time', () => {
    // t = (Km ln(c0 / c) + c0 − c) / Vmax = (5 ln 10 + 90) / 20 = 5.07565 h to fall from 100 to 10 mg/L.
    const time = (5 * Math.log(10) + 90) / 20;
    expect(row(michaelisResult(100, 20, 5, null, time), 'conc')).toBeCloseTo(10, 4);
    for (const t of [1.63076, 5.0838, 6.33912, 10.7548])
      expect(() => michaelisResult(100, 20, 5, null, t)).not.toThrow();
  });

  it('refuses a target above the start', () => {
    throwsKey(() => michaelisResult(5, 2, 4, 10, 12), 'pharmacology.e.c1');
  });
});

describe('dose scaling', () => {
  it('gives the Mosteller BSA 1.81812 m² for 170 cm and 70 kg', () => {
    expect(mosteller(170, 70)).toBeCloseTo(1.81812, 5);
    const r = scalingResult(170, 70, 2, 100);
    expect(row(r, 'byWeight')).toBeCloseTo(140, 9);
    expect(row(r, 'byArea')).toBeCloseTo(181.812, 3);
  });

  it('rejects a zero height', () => {
    throwsKey(() => scalingResult(0, 70, null, null), 'errors.positive');
  });
});

describe('release kinetics', () => {
  it('recovers a pure square-root release as Fickian with n 0.5', () => {
    const data = [0.5, 1, 2, 4, 6, 8].map((t) => [t, 0.1 * Math.sqrt(t)]);
    const r = releaseResult(data);
    expect(row(r, 'peppasN')).toBeCloseTo(0.5, 4);
    expect(row(r, 'peppasK')).toBeCloseTo(0.1, 4);
    expect(r.notes?.[0].key).toBe('pharmacology.n.fickian');
    expect(r.rows.find((x) => x.label === 'pharmacology.r.best')?.word).toBe('pharmacology.o.higuchi');
  });

  it('rejects a fraction above 1', () => {
    throwsKey(
      () =>
        releaseResult([
          [1, 0.2],
          [2, 0.5],
          [3, 1.2],
        ]),
      'errors.range',
    );
  });
});

describe('pharmacodynamics', () => {
  it('gives half the maximum at EC50 and the Hill shape', () => {
    expect(emax(2, 0, 100, 2, 1)).toBeCloseTo(50, 12);
    expect(emax(4, 0, 100, 2, 2)).toBeCloseTo(80, 12);
    const r = pdResult(2, 0, 100, 1, 1, 1, 400, 100);
    expect(row(r, 'effect')).toBeCloseTo(200 / 3, 9);
    expect(row(r, 'occupancy')).toBeCloseTo(200 / 3, 9);
    expect(row(r, 'ti')).toBeCloseTo(4, 12);
  });

  it('needs both TD50 and ED50', () => {
    throwsKey(() => pdResult(2, 0, 100, 1, 1, null, 400, null), 'pharmacology.e.tiPair');
  });

  it('puts the effect peak after time 0 when the effect site lags', () => {
    const r = pkpdResult({ dose: 100, V: 10, k: 0.2, ke0: 0.5, e0: 0, em: 100, ec50: 2, n: 1, t: 24 });
    // Ce peaks where Ce = Cp: tpeak = ln(ke0/k)/(ke0 − k) = ln 2.5 / 0.3.
    expect(row(r, 'peakTime')).toBeCloseTo(Math.log(2.5) / 0.3, 1);
  });
});
