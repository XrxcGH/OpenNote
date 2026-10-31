// Curve fits against the planning pass's independent values (computed separately in Python), exact data with known
// parameters, closed forms, and the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  apparent,
  betResult,
  bindingResult,
  chengPrusoff,
  doseResponseResult,
  fitInhibition,
  fitMichaelis,
  fourPlResult,
  fSurvival,
  hillFitResult,
  hillFraction,
  inverse5,
  isothermResult,
  linearizations,
  logistic5,
  lqResult,
  lqSurvival,
  probit,
  probitResult,
  schildResult,
  standardCurveResult,
} from './engine';

const value = (r: { rows: { label: string; value: number | string }[] }, label: string) =>
  r.rows.find((x) => x.label === `curves.r.${label}`)?.value as number;
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

describe('Michaelis-Menten', () => {
  const s = [0.5, 1, 2, 4, 8, 16];
  const v = s.map((x) => (10 * x) / (2 + x));

  it('recovers Vmax 10 and Km 2 from exact data, and so does every linear plot', () => {
    const { fit } = fitMichaelis(s.map((x, i) => [x, v[i]]));
    expect(fit.params[0]).toBeCloseTo(10, 6);
    expect(fit.params[1]).toBeCloseTo(2, 6);
    const lin = linearizations(s, v);
    for (const m of [lin.lineweaver, lin.eadie, lin.hanes]) {
      expect(m.vmax).toBeCloseTo(10, 6);
      expect(m.km).toBeCloseTo(2, 6);
    }
  });

  it('refuses rates that never saturate', () => {
    throwsKey(
      () =>
        fitMichaelis([
          [1, -1],
          [2, 2],
          [3, 3],
        ]),
      'errors.positive',
    );
  });
});

describe('inhibition', () => {
  it('gives an apparent Km of 4 for competitive Km 2, Ki 1, [I] 1', () => {
    expect(apparent('competitive', 10, 2, 1, 1).km).toBeCloseTo(4, 12);
    expect(apparent('competitive', 10, 2, 1, 1).vmax).toBeCloseTo(10, 12);
    expect(apparent('noncompetitive', 10, 2, 1, 1)).toEqual({ vmax: 5, km: 2 });
    expect(apparent('uncompetitive', 10, 2, 1, 1)).toEqual({ vmax: 5, km: 1 });
    // Mixed with α = 1 is noncompetitive.
    expect(apparent('mixed', 10, 2, 1, 1, 1).km).toBeCloseTo(2, 12);
  });

  it('picks competitive for exact competitive data', () => {
    const rows: number[][] = [];
    for (const i of [0, 1, 3]) for (const s of [0.5, 1, 2, 4, 8, 16]) rows.push([s, i, (10 * s) / (2 * (1 + i) + s)]);
    const { fits } = fitInhibition(rows);
    const comp = fits.find((f) => f.type === 'competitive')!.fit!;
    expect(comp.params[2]).toBeCloseTo(1, 5);
    for (const f of fits)
      if (f.fit && f.type !== 'competitive' && f.type !== 'mixed') expect(f.fit.sse).toBeGreaterThan(comp.sse);
  });

  it('needs readings without inhibitor', () => {
    throwsKey(
      () =>
        fitInhibition([
          [1, 1, 1],
          [2, 1, 2],
          [3, 1, 3],
          [1, 2, 1],
          [2, 2, 2],
          [3, 2, 3],
        ]),
      'curves.e.levels',
    );
  });

  it('gives the F tail probability', () => {
    // F(1, 10) at 4.96 is the 95th percentile.
    expect(fSurvival(4.9646, 1, 10)).toBeCloseTo(0.05, 3);
  });
});

describe('Hill and binding', () => {
  it('gives the Hill fraction 0.0644387 for n 2.8, K 26, L 10', () => {
    expect(hillFraction(10, 26, 2.8)).toBeCloseTo(0.0644387, 6);
    expect(hillFraction(26, 26, 2.8)).toBeCloseTo(0.5, 12);
    expect(hillFraction(0, 26, 2.8)).toBe(0);
  });

  it('recovers n and K₀.₅ from exact data', () => {
    const r = hillFitResult([5, 10, 20, 26, 40, 80].map((l) => [l, hillFraction(l, 26, 2.8)]));
    expect(value(r, 'hillN')).toBeCloseTo(2.8, 5);
    expect(value(r, 'k05')).toBeCloseTo(26, 4);
  });

  it('recovers Bmax and Kd, and Cheng-Prusoff gives Ki 33.3333 nM', () => {
    const r = bindingResult(
      [0.5, 1, 2, 5, 10, 20, 50].map((l) => [l, (1000 * l) / (5 + l)]),
      'one',
    );
    expect(value(r, 'bmax')).toBeCloseTo(1000, 4);
    expect(value(r, 'kd')).toBeCloseTo(5, 6);
    expect(chengPrusoff(100, 10, 5)).toBeCloseTo(33.3333, 4);
  });

  it('separates a nonspecific slope', () => {
    const r = bindingResult(
      [0.5, 1, 2, 5, 10, 20, 50].map((l) => [l, (1000 * l) / (5 + l) + 3 * l]),
      'oneNs',
    );
    expect(value(r, 'ns')).toBeCloseTo(3, 4);
    expect(value(r, 'kd')).toBeCloseTo(5, 4);
  });
});

describe('isotherms', () => {
  it('recovers a Langmuir qmax 5 and K 0.5', () => {
    const r = isothermResult([1, 2, 5, 10, 20, 50].map((c) => [c, (5 * 0.5 * c) / (1 + 0.5 * c)]));
    expect(value(r, 'qmax')).toBeCloseTo(5, 6);
    expect(value(r, 'kL')).toBeCloseTo(0.5, 6);
  });

  it('recovers BET vm 2 and c 100 from the linear range', () => {
    const v = (x: number) => (2 * 100 * x) / ((1 - x) * (1 + 99 * x));
    const r = betResult([0.02, 0.05, 0.1, 0.2, 0.3, 0.35, 0.5].map((x) => [x, v(x)]));
    expect(value(r, 'vm')).toBeCloseTo(2, 9);
    expect(value(r, 'cBet')).toBeCloseTo(100, 6);
  });

  it('needs points in the BET range', () => {
    throwsKey(
      () =>
        betResult([
          [0.5, 1],
          [0.6, 2],
          [0.7, 3],
        ]),
      'curves.e.betRange',
    );
  });
});

describe('4PL and 5PL', () => {
  it('gives y(5) = 0.641376 for a 0.05, d 2, c 10, b 1.2, and back-calculates x = 5', () => {
    expect(logistic5(5, 0.05, 1.2, 10, 2)).toBeCloseTo(0.641376, 6);
    expect(inverse5(logistic5(5, 0.05, 1.2, 10, 2), 0.05, 1.2, 10, 2)).toBeCloseTo(5, 9);
    const r = fourPlResult(0.05, 1.2, 10, 2, 1, 5, 0.641376);
    expect(value(r, 'yAt')).toBeCloseTo(0.641376, 6);
    expect(value(r, 'xAt')).toBeCloseTo(5, 5);
  });

  it('inverts the 5PL curve too', () => {
    const y = logistic5(7, 0.1, 1.5, 12, 2.5, 0.7);
    expect(inverse5(y, 0.1, 1.5, 12, 2.5, 0.7)).toBeCloseTo(7, 9);
  });

  it('refuses a response outside the curve', () => {
    throwsKey(() => fourPlResult(0.05, 1.2, 10, 2, 1, null, 3), 'curves.e.outside');
    throwsKey(() => fourPlResult(1, 1.2, 10, 1, 1, 5, null), 'curves.e.flat');
  });

  it('fits a standard curve and reads unknowns back', () => {
    const xs = [0.5, 1, 2, 5, 10, 20, 50, 100];
    const r = standardCurveResult(
      xs.map((x) => [x, logistic5(x, 0.05, 1.2, 10, 2)]),
      false,
      [0.641376],
    );
    expect(value(r, 'c')).toBeCloseTo(10, 4);
    expect(r.table?.rows[0][1] as number).toBeCloseTo(5, 4);
  });
});

describe('dose response and Schild', () => {
  it('recovers EC50 1 and slope 1', () => {
    const r = doseResponseResult([0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30].map((x) => [x, 100 / (1 + 1 / x)]));
    expect(value(r, 'ec50')).toBeCloseTo(1, 5);
    expect(value(r, 'hillSlope')).toBeCloseTo(1, 5);
  });

  it('gives pA2 9 for a slope-1 antagonist with KB 1 nM', () => {
    const r = schildResult([1e-8, 3e-8, 1e-7].map((b) => [b, 1 + b / 1e-9]));
    expect(value(r, 'pA2')).toBeCloseTo(9, 9);
    expect(value(r, 'schildSlope')).toBeCloseTo(1, 9);
  });

  it('needs dose ratios above 1', () => {
    throwsKey(
      () =>
        schildResult([
          [1e-8, 1],
          [1e-7, 2],
          [1e-6, 3],
        ]),
      'curves.e.doseRatio',
    );
  });
});

describe('probit', () => {
  it('gives a −1.6793, b 2.6587, and LD50 4.2819 for the planning data', () => {
    const p = probit([1, 2, 4, 8, 16], [20, 20, 20, 20, 20], [1, 4, 9, 15, 19]);
    expect(p.a).toBeCloseTo(-1.6793, 3);
    expect(p.b).toBeCloseTo(2.6587, 3);
    expect(10 ** p.logLd50).toBeCloseTo(4.2819, 2);
    expect(p.fieller).not.toBeNull();
    expect(10 ** p.fieller![0]).toBeLessThan(4.2819);
    expect(10 ** p.fieller![1]).toBeGreaterThan(4.2819);
  });

  it('refuses more dead than exposed, and deaths that fall with dose', () => {
    throwsKey(
      () =>
        probitResult([
          [1, 10, 11],
          [2, 10, 5],
          [4, 10, 9],
        ]),
      'curves.e.moreDead',
    );
    throwsKey(
      () =>
        probitResult([
          [1, 10, 9],
          [2, 10, 5],
          [4, 10, 1],
        ]),
      'curves.e.probitSlope',
    );
  });
});

describe('linear-quadratic survival', () => {
  it('gives S 0.486752, BED 72 Gy, and EQD2 60 Gy', () => {
    expect(lqSurvival(0.3, 0.03, 2)).toBeCloseTo(0.486752, 6);
    const r = lqResult(0.3, 0.03, 2, 30);
    expect(value(r, 'bed')).toBeCloseTo(72, 9);
    expect(value(r, 'eqd2')).toBeCloseTo(60, 9);
  });

  it('needs a whole number of fractions', () => {
    throwsKey(() => lqResult(0.3, 0.03, 2, 2.5), 'errors.whole');
    throwsKey(() => lqResult(0.3, 0, 2, 30), 'errors.positive');
  });
});
