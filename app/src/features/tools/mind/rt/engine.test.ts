// The response-time engine against the planned cases; the expected values come from the plan's independent
// computation or from hand arithmetic in the comments.
import { describe, expect, it } from 'vitest';
import { integrate, normPdf } from '../kit/num';
import { makeRng } from '../kit/rng';
import { MindError } from '../kit/types';
import {
  cousineauMorey,
  exGaussCdf,
  exGaussMoments,
  exGaussPdf,
  exGaussQuantile,
  fitExGauss,
  fitts,
  hick,
  readTrials,
  summarizeConditions,
  trim,
  vincentize,
} from './engine';

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

const P = { mu: 400, sigma: 40, tau: 100 };

describe('ex-Gaussian', () => {
  it('has density 0.003914 per ms at 500 ms', () => {
    expect(exGaussPdf(500, P)).toBeCloseTo(0.003914, 6);
    // The same density as the convolution of the normal and the exponential, by quadrature.
    const conv = integrate((y) => (Math.exp(-y / 100) / 100) * (normPdf((500 - y - 400) / 40) / 40), 0, 2000, 1e-12);
    expect(exGaussPdf(500, P)).toBeCloseTo(conv, 10);
  });

  it('has mean 500 ms and SD 107.703 ms, and a CDF that inverts', () => {
    const m = exGaussMoments(P);
    expect(m.mean).toBe(500);
    expect(m.sd).toBeCloseTo(Math.sqrt(1600 + 10000), 9);
    expect(m.sd).toBeCloseTo(107.703, 3);
    expect(exGaussCdf(exGaussQuantile(0.9, P), P)).toBeCloseTo(0.9, 9);
    expect(integrate((x) => exGaussPdf(x, P), 0, 3000, 1e-10)).toBeCloseTo(1, 8);
    expect(exGaussPdf(-1000, P)).toBeLessThan(1e-200);
  });

  it('recovers its parameters from a large seeded sample', () => {
    const rng = makeRng(11);
    const rts = Array.from({ length: 4000 }, () => 400 + 40 * rng.normal() - 100 * Math.log(1 - rng.next()));
    const fit = fitExGauss(rts);
    expect(Math.abs(fit.mu - 400)).toBeLessThan(10);
    expect(Math.abs(fit.sigma - 40)).toBeLessThan(8);
    expect(Math.abs(fit.tau - 100)).toBeLessThan(10);
  });

  it('needs enough response times that vary', () => {
    expect(code(() => fitExGauss([1, 2, 3]))).toBe('fewRts');
    expect(code(() => fitExGauss(Array.from({ length: 12 }, () => 5)))).toBe('noVariation');
  });
});

describe('Fitts and Hick-Hyman', () => {
  it('gives an index of difficulty of 4.08746 bits for D 256, W 16', () => {
    const r = fitts([
      [256, 16, 500],
      [64, 16, 300],
    ]);
    expect(r.ids[0]).toBeCloseTo(Math.log2(17), 12);
    expect(r.ids[0]).toBeCloseTo(4.08746, 5);
  });

  it('regresses movement time on ID: a 200 ms, b 100 ms per bit', () => {
    // D/W = 1, 3, 7, 15 give ID 1, 2, 3, 4 bits.
    const r = fitts([
      [1, 1, 300],
      [3, 1, 400],
      [7, 1, 500],
      [15, 1, 600],
    ]);
    expect(r.a).toBeCloseTo(200, 9);
    expect(r.b).toBeCloseTo(100, 9);
    expect(1000 / r.b).toBeCloseTo(10, 9);
  });

  it('fits the Hick-Hyman law', () => {
    const r = hick(
      [
        [1, 200],
        [2, 350],
        [4, 500],
      ],
      false,
    );
    expect(r.a).toBeCloseTo(200, 9);
    expect(r.b).toBeCloseTo(150, 9);
  });

  it('stops on widths of 0 and on a single difficulty', () => {
    expect(
      code(() =>
        fitts([
          [10, 0, 300],
          [10, 1, 400],
        ]),
      ),
    ).toBe('fittsRow');
    expect(
      code(() =>
        fitts([
          [10, 1, 300],
          [10, 1, 400],
        ]),
      ),
    ).toBe('sameId');
    expect(
      code(() =>
        hick(
          [
            [0, 1],
            [2, 3],
          ],
          false,
        ),
      ),
    ).toBe('hickRow');
  });
});

describe('within-subject intervals', () => {
  it('gives the Cousineau-Morey 95% half-widths 16.24, 26.187, 15.912', () => {
    const h = cousineauMorey([
      [500, 550, 600],
      [450, 520, 560],
      [520, 560, 640],
      [480, 500, 580],
    ]);
    expect(h[0]).toBeCloseTo(16.24, 2);
    expect(h[1]).toBeCloseTo(26.187, 3);
    expect(h[2]).toBeCloseTo(15.912, 3);
  });

  it('needs 2 subjects and 2 conditions', () => {
    expect(code(() => cousineauMorey([[1, 2]]))).toBe('fewSubjects');
    expect(code(() => cousineauMorey([[1], [2]]))).toBe('fewConditions');
  });
});

describe('trials', () => {
  const TEXT = [
    'subject, condition, rt, correct',
    ...['s1', 's2'].flatMap((s, si) =>
      ['easy', 'hard'].flatMap((c, ci) =>
        [400, 420, 440, 460, 480].map(
          (rt, i) => `${s}, ${c}, ${rt + 100 * ci + 10 * si}, ${i === 4 && ci === 1 ? 0 : 1}`,
        ),
      ),
    ),
    's1, easy, 3000, 1',
    's1, easy, 90, 1',
    's2, hard, NA, 1',
  ].join('\n');

  it('reads trials, skips missing RTs, and applies absolute cut-offs', () => {
    const { trials, hasAccuracy, skipped } = readTrials(TEXT);
    expect(trials).toHaveLength(22);
    expect(hasAccuracy).toBe(true);
    expect(skipped).toBe(1);
    const t = trim(trials, 150, 2500, 'none', 2.5);
    expect(t.belowMin).toBe(1);
    expect(t.aboveMax).toBe(1);
    expect(t.errors).toBe(2);
    expect(t.kept).toHaveLength(18);
  });

  it('trims by SD, MAD, and recursively within each cell', () => {
    const trials = [400, 410, 420, 430, 440, 1500].map((rt) => ({ subject: 's', condition: 'c', rt, correct: true }));
    expect(trim(trials, 0, 1e9, 'sd', 2).kept).toHaveLength(5);
    expect(trim(trials, 0, 1e9, 'mad', 3).kept).toHaveLength(5);
    expect(trim(trials, 0, 1e9, 'recursive', 2.5).kept.map((t) => t.rt)).toEqual([400, 410, 420, 430, 440]);
    expect(code(() => trim(trials, 500, 100, 'none', 2))).toBe('minMax');
  });

  it('summarizes conditions from subject means, with accuracy and inverse efficiency', () => {
    const { trials, hasAccuracy } = readTrials(TEXT);
    const t = trim(trials, 150, 2500, 'none', 2.5);
    const r = summarizeConditions(trials, t.kept, hasAccuracy);
    // easy: s1 mean of 400..480 = 440, s2 450, so 445. hard: s1 520..560 correct = 530, s2 540: 535.
    expect(r.summaries[0].mean).toBeCloseTo(445, 9);
    expect(r.summaries[1].mean).toBeCloseTo(535, 9);
    // hard has 10 trials with RTs, 2 of them errors: 0.8.
    expect(r.summaries[1].accuracy).toBeCloseTo(0.8, 12);
    expect(r.summaries[1].ies).toBeCloseTo(535 / 0.8, 9);
    // Subject 2 is subject 1 plus 10 ms in both conditions, so there is no within-subject spread.
    expect(r.summaries[0].halfWidth).toBeCloseTo(0, 9);
  });

  it('vincentizes quantiles over subjects', () => {
    const { trials } = readTrials(TEXT);
    const v = vincentize(trim(trials, 150, 2500, 'none', 2.5).kept, 'easy', [0.5]);
    expect(v.subjects).toBe(2);
    expect(v.quantiles[0]).toBeCloseTo((440 + 450) / 2, 9);
  });

  it('stops without the needed columns or with a bad accuracy cell', () => {
    expect(code(() => readTrials('1, 2, 3'))).toBe('trialHeader');
    expect(code(() => readTrials('subject, condition, rt, correct\ns, c, 400, yes'))).toBe('correctCell');
    expect(code(() => readTrials('subject, condition, rt\ns, c, -4'))).toBe('negativeRt');
  });
});
