// Inter-rater agreement against values worked from first principles, by hand, and from Shrout and Fleiss's data.
import { describe, expect, it } from 'vitest';
import { blandAltman, iccForms, meanSquares } from './icc';
import { cohen, crossTab, fleiss, landisKoch, presenceKappa, weightedKappa } from './kappa';
import { alphaInterval, krippendorff } from './kripp';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

describe('kappa', () => {
  it('gives p_o 0.7, p_e 0.5, and kappa 0.4 for [[20, 5], [10, 15]]', () => {
    const r = cohen([
      [20, 5],
      [10, 15],
    ]);
    close(r.po, 0.7, 1e-9);
    close(r.pe, 0.5, 1e-9);
    close(r.kappa, 0.4, 1e-9);
    // By hand from Fleiss, Cohen, and Everitt's variance: (0.10972 + 0.10188 - 0.01) / 12.5 = 0.016128.
    close(r.se, Math.sqrt(0.016128), 1e-9);
    close(r.pabak, 0.4, 1e-9);
    expect(landisKoch(r.kappa)).toBe('fair');
  });

  it('gives quadratic weighted kappa 0.744898', () => {
    const r = weightedKappa(
      [
        [10, 3, 1],
        [2, 12, 4],
        [0, 3, 15],
      ],
      'quadratic',
    );
    close(r.kappa, 0.744898, 1e-6);
  });

  it('agrees with plain kappa when weights are off', () => {
    const counts = [
      [10, 3, 1],
      [2, 12, 4],
      [0, 3, 15],
    ];
    close(weightedKappa(counts, 'none').kappa, cohen(counts).kappa, 1e-12);
  });

  it('cross-tabulates codes in numeric order', () => {
    const t = crossTab(['2', '1', '1', '3'], ['2', '1', '2', '3']);
    expect(t.categories).toEqual(['1', '2', '3']);
    expect(t.counts).toEqual([
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('gives Fleiss kappa 0.209931 for 10 subjects and 14 raters', () => {
    const r = fleiss([
      [0, 0, 0, 0, 14],
      [0, 2, 6, 4, 2],
      [0, 0, 3, 5, 6],
      [0, 3, 9, 2, 0],
      [2, 2, 8, 1, 1],
      [7, 7, 0, 0, 0],
      [3, 2, 6, 3, 0],
      [2, 5, 3, 2, 2],
      [6, 5, 2, 1, 0],
      [0, 2, 2, 3, 7],
    ]);
    close(r.kappa, 0.209931, 1e-6);
    close(r.pBar, 0.378022, 1e-6);
  });

  it('gives 80% agreement and kappa 0.6 for one code applied by 2 coders', () => {
    const one = Array.from({ length: 10 }, (_, i) => i < 5);
    const two = Array.from({ length: 10 }, (_, i) => i >= 1 && i < 6);
    const r = presenceKappa(one, two);
    close(r.agree, 0.8, 1e-9);
    close(r.kappa, 0.6, 1e-9);
  });

  it('stops on tables that are not square and on raters that differ by subject', () => {
    expect(() =>
      cohen([
        [1, 2, 3],
        [1, 2, 3],
      ]),
    ).toThrow('square');
    expect(() =>
      fleiss([
        [1, 2],
        [2, 2],
      ]),
    ).toThrow('sameRaters');
    expect(() => crossTab(['a'], ['a', 'b'])).toThrow('sameLength');
  });
});

describe('Krippendorff alpha', () => {
  it('gives 0.755556 for nominal codes a,a,b,b,c,a and a,b,b,b,c,a', () => {
    const one = ['a', 'a', 'b', 'b', 'c', 'a'];
    const two = ['a', 'b', 'b', 'b', 'c', 'a'];
    close(
      krippendorff(
        one.map((v, i) => [v, two[i]]),
        'nominal',
      ).alpha,
      0.755556,
      1e-6,
    );
  });

  it('gives 8/11 for interval values (1, 2) and (3, 3), worked by hand', () => {
    close(
      krippendorff(
        [
          ['1', '2'],
          ['3', '3'],
        ],
        'interval',
      ).alpha,
      1 - 0.5 / (22 / 12),
      1e-12,
    );
  });

  it('skips missing values and units with 1 value', () => {
    const full = krippendorff(
      [
        ['a', 'a'],
        ['b', 'b'],
        ['a', 'b'],
      ],
      'nominal',
    ).alpha;
    close(
      krippendorff(
        [
          ['a', 'a', ''],
          ['b', 'b', ''],
          ['a', 'b', ''],
          ['c', '', ''],
        ],
        'nominal',
      ).alpha,
      full,
      1e-12,
    );
  });

  it('repeats a seeded bootstrap interval', () => {
    const units = ['a', 'a', 'b', 'b', 'c', 'a'].map((v, i) => [v, ['a', 'b', 'b', 'b', 'c', 'a'][i]]);
    const first = alphaInterval(units, 'nominal', 200, 11);
    expect(alphaInterval(units, 'nominal', 200, 11)).toEqual(first);
    expect(first.low).toBeLessThanOrEqual(first.high);
  });

  it('stops when no unit has 2 values or nothing varies', () => {
    expect(() =>
      krippendorff(
        [
          ['a', ''],
          ['b', ''],
        ],
        'nominal',
      ),
    ).toThrow('noPairs');
    expect(() =>
      krippendorff(
        [
          ['a', 'a'],
          ['a', 'a'],
        ],
        'nominal',
      ),
    ).toThrow('noVariation');
  });
});

describe('intraclass correlation and Bland-Altman', () => {
  const ratings = [
    [9, 2, 5, 8],
    [6, 1, 3, 2],
    [8, 4, 6, 8],
    [7, 1, 2, 6],
    [10, 5, 6, 9],
    [6, 2, 4, 7],
  ];

  it("gives Shrout and Fleiss's values for 6 targets and 4 judges", () => {
    const forms = Object.fromEntries(iccForms(meanSquares(ratings)).map((one) => [one.id, one]));
    close(forms['1,1'].value, 0.16574, 1e-5);
    close(forms['2,1'].value, 0.28976, 1e-5);
    close(forms['3,1'].value, 0.71484, 1e-5);
    close(forms['3,k'].value, 0.90932, 1e-5);
    for (const form of Object.values(forms)) {
      expect(form.low).toBeLessThan(form.value);
      expect(form.high).toBeGreaterThan(form.value);
    }
  });

  it('gives bias 0.166667 and limits -0.38307 and 0.7164', () => {
    const r = blandAltman([0.5, -0.2, 0.3, 0.1, 0.4, -0.1]);
    close(r.bias, 0.166667, 1e-5);
    close(r.lower, -0.38307, 1e-5);
    close(r.upper, 0.7164, 1e-5);
  });

  it('stops on missing ratings and on too few pairs', () => {
    expect(() =>
      meanSquares([
        [1, NaN],
        [2, 3],
      ]),
    ).toThrow('complete');
    expect(() => blandAltman([1, 2])).toThrow('fewPairs');
  });
});
