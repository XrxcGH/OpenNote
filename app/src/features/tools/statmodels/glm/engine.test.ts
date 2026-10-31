// Logistic and Poisson regression against values worked out independently (NumPy and SciPy from first principles),
// and the messages for outcomes a model cannot take.
import { describe, expect, it } from 'vitest';
import { parseTable } from '../kit/data';
import { buildDesign, mainTerms } from '../kit/design';
import { StatError } from '../kit/types';
import { analyzeGlm, hosmerLemeshow, rates, rocCurve, type GlmInput } from './engine';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

function input(family: GlmInput['family'], x: number[][], y: number[], extra: Partial<GlmInput> = {}): GlmInput {
  const text = ['x', ...x.map((r) => String(r[0]))].join('\n');
  const design = buildDesign(parseTable(text), mainTerms(['x']));
  return { family, design, y, level: 0.95, threshold: 0.5, ...extra };
}

const xs = Array.from({ length: 10 }, (_, i) => [i]);
const ys = [0, 0, 0, 1, 0, 1, 1, 0, 1, 1];

describe('logistic regression', () => {
  const result = analyzeGlm(input('logistic', xs, ys));

  it('fits the coefficients, standard error and odds ratio', () => {
    close(result.coefs[0].estimate, -2.44664, 1e-5);
    close(result.coefs[1].estimate, 0.543697, 1e-5);
    close(result.coefs[1].se, 0.33616, 1e-5);
    close(Math.exp(result.coefs[1].estimate), 1.72236, 1e-5);
  });

  it('reports the deviance, the likelihood-ratio chi-square and McFadden R²', () => {
    close(result.fit.deviance, 9.88316, 1e-5);
    close(result.lr, 3.97978, 1e-5);
    close(result.mcFadden, 0.28708, 1e-5);
  });

  it('finds the area under the ROC curve', () => {
    close(result.auc ?? NaN, 0.84, 1e-9);
  });

  it('gives profile-likelihood limits that bracket the estimate and differ from the Wald limits', () => {
    const b = result.coefs[1];
    expect(b.profileLow).toBeLessThan(b.estimate);
    expect(b.profileHigh).toBeGreaterThan(b.estimate);
    // Independent value: the root of 2(l(b) - l_p(beta)) = 3.841459 by SciPy brentq.
    close(b.profileLow, 0.0082187, 1e-5);
    close(b.profileHigh, 1.4466, 1e-4);
  });

  it('stops with a message for complete separation', () => {
    const run = () => analyzeGlm(input('logistic', xs, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]));
    expect(run).toThrow(StatError);
    try {
      run();
    } catch (error) {
      expect((error as StatError).code).toBe('separation');
    }
  });

  it('stops when a 0/1 outcome has another value', () => {
    expect(() => analyzeGlm(input('logistic', xs, [0, 0, 0, 2, 0, 1, 1, 0, 1, 1]))).toThrow(StatError);
  });
});

describe('Poisson regression with an offset', () => {
  const counts = [2, 3, 6, 7, 8, 9, 10, 12, 15];
  const exposure = [10, 10, 12, 12, 12, 14, 14, 15, 15];
  const x = counts.map((_, i) => [i + 1]);
  const result = analyzeGlm(input('poisson', x, counts, { offset: exposure.map(Math.log) }));

  it('fits the coefficients, standard error, rate ratio and deviance', () => {
    close(result.coefs[0].estimate, -1.28921, 1e-5);
    close(result.coefs[1].estimate, 0.142849, 1e-5);
    close(result.coefs[1].se, 0.049583, 1e-5);
    close(Math.exp(result.coefs[1].estimate), 1.15356, 1e-5);
    close(result.fit.deviance, 1.3165, 1e-4);
  });

  it('estimates the dispersion from Pearson chi-square', () => {
    // Independent value: Pearson chi-square over n - p from the published coefficients, by NumPy.
    close(result.dispersion, 0.182164, 1e-4);
  });

  it('stops for negative or fractional counts', () => {
    expect(() => analyzeGlm(input('poisson', x, [2, 3, -1, 7, 8, 9, 10, 12, 15]))).toThrow(StatError);
    expect(() => analyzeGlm(input('poisson', x, [2, 3, 1.5, 7, 8, 9, 10, 12, 15]))).toThrow(StatError);
  });
});

describe('model checks', () => {
  it('computes the ROC area with ties counted half', () => {
    expect(rocCurve([0.5, 0.5], [1, 0], [0, 1]).auc).toBe(0.5);
    expect(rocCurve([0.9, 0.1], [1, 0], [0, 1]).auc).toBe(1);
  });

  it('computes classification rates', () => {
    const r = rates({ tp: 40, fp: 10, fn: 5, tn: 45 });
    close(r.accuracy, 0.85, 1e-12);
    close(r.precision, 0.8, 1e-12);
    close(r.sensitivity, 40 / 45, 1e-12);
  });

  it('gives a Hosmer-Lemeshow statistic of 0 when each group matches its expectation', () => {
    const y = [0, 1, 0, 1, 0, 1];
    expect(hosmerLemeshow(y, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5], 3).chi2).toBeCloseTo(0, 12);
  });
});
