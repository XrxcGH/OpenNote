// The machine learning lab against values worked out by hand: the best Gini split, the rates from a confusion
// matrix, 3 nearest neighbors, a ridge fit, and decision-curve net benefit. Backpropagation is checked against
// finite differences. Seeded training and splits must repeat, and simple separable data must be learned.
import { describe, expect, it } from 'vitest';
import { StatError } from '../kit/types';
import { confusion, folds, netBenefit, rates, regressionScores, roc, toyData, trainTest } from './metrics';
import {
  backprop,
  bestSplit,
  cart,
  forward,
  knn,
  lasso,
  logisticGd,
  mlp,
  naiveBayes,
  nearest,
  perceptron,
  ridge,
  type Network,
} from './models';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

describe('trees', () => {
  it('finds the best Gini split for x 1 to 8', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => [v]);
    const y = [0, 0, 0, 1, 0, 1, 1, 1];
    const s = bestSplit(
      x,
      y,
      x.map((_, i) => i),
      2,
      'gini',
      1,
    );
    close(s?.threshold ?? NaN, 3.5, 1e-12);
    close(s?.impurity ?? NaN, 0.2, 1e-9);
    const tree = cart(x, y, 2, 'gini', 1, 1);
    expect(tree.proba([2])).toEqual([1, 0]);
    close(tree.proba([6])[1], 0.8, 1e-12);
  });
});

describe('metrics', () => {
  it('works out the rates from TP 40, FP 10, FN 5, TN 45', () => {
    const r = rates(40, 10, 5, 45);
    close(r.accuracy, 0.85, 1e-6);
    close(r.precision, 0.8, 1e-6);
    close(r.recall, 0.888889, 1e-6);
    close(r.f1, 0.842105, 1e-6);
  });

  it('gives the net benefit at threshold 0.2', () => {
    close(netBenefit(40, 10, 100, 0.2), 0.375, 1e-9);
  });

  it('builds the confusion matrix and the ROC area', () => {
    expect(confusion([0, 1, 1, 0], [0, 1, 0, 0], 2)).toEqual([
      [2, 0],
      [1, 1],
    ]);
    close(roc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1]).auc, 0.75, 1e-12);
    close(roc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0]).auc, 1, 1e-12);
    const s = regressionScores([1, 2, 3], [1, 2, 4]);
    close(s.mse, 1 / 3, 1e-12);
    close(s.r2, 0.5, 1e-12);
  });

  it('splits and folds the same way for the same seed and keeps class shares', () => {
    const labels = Array.from({ length: 20 }, (_, i) => (i < 10 ? 0 : 1));
    expect(trainTest(20, 0.3, 4, labels)).toEqual(trainTest(20, 0.3, 4, labels));
    const f = folds(20, 5, 2, labels);
    for (let k = 0; k < 5; k++) expect(labels.filter((c, i) => f[i] === k && c === 1)).toHaveLength(2);
  });
});

describe('neighbors, Bayes, and linear models', () => {
  it('finds the 3 nearest neighbors of (3, 3.5)', () => {
    const train = [
      [1, 1],
      [1, 2],
      [2, 1],
      [5, 5],
      [6, 5],
      [5, 6],
    ];
    const y = [0, 0, 0, 1, 1, 1];
    const n = nearest(train, [3, 3.5], 3);
    expect(n.map((v) => v.index).sort()).toEqual([1, 2, 3]);
    close(n.find((v) => v.index === 1)?.distance ?? NaN, 2.5, 1e-12);
    close(n.find((v) => v.index === 3)?.distance ?? NaN, 2.5, 1e-12);
    close(n.find((v) => v.index === 2)?.distance ?? NaN, 2.6926, 1e-4);
    const p = knn(train, y, 2, 3).proba([3, 3.5]);
    close(p[0], 2 / 3, 1e-12);
    expect(naiveBayes(train, y, 2).proba([1.2, 1.2])[0]).toBeGreaterThan(0.99);
  });

  it('fits ridge without an intercept', () => {
    const b = ridge(
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [1, 2, 3],
      1,
      false,
    );
    close(b[0], 0.875, 1e-9);
    close(b[1], 1.375, 1e-9);
  });

  it('shrinks the lasso to 0 for a large penalty and to least squares for none', () => {
    const x = [
      [1, 0.5],
      [2, -0.3],
      [3, 0.8],
      [4, 0.1],
      [5, -0.6],
    ];
    const y = [2.1, 3.9, 6.2, 8.0, 9.8];
    lasso(x, y, 100).coef.forEach((b) => close(b, 0, 0));
    const free = lasso(x, y, 0).coef;
    const ls = ridge(
      x.map((r) => [1, ...r]),
      y,
      0,
      true,
    );
    close(free[0], ls[1], 1e-6);
    close(free[1], ls[2], 1e-6);
  });

  it('learns linearly separable groups by gradient descent and by the perceptron', () => {
    const { x, y } = toyData('linear', 80, 0.05, 3);
    const lg = logisticGd(x, y, 0.01, 0.5, 300);
    const acc = x.filter((r, i) => (lg.proba(r)[1] > 0.5 ? 1 : 0) === y[i]).length / x.length;
    expect(acc).toBeGreaterThan(0.95);
    expect(lg.loss?.[299]).toBeLessThan(lg.loss?.[0] ?? 0);
    expect(perceptron(x, y, 1, 50, 1).weights).toEqual(perceptron(x, y, 1, 50, 1).weights);
  });
});

describe('the multilayer perceptron', () => {
  it('matches backpropagation with finite differences on a 2-2-1 network', () => {
    const net: Network = {
      weights: [
        [
          [0.3, -0.2],
          [0.5, 0.4],
        ],
        [[0.7, -0.6]],
      ],
      biases: [[0.1, -0.1], [0.05]],
    };
    const x = [0.6, -1.2];
    const g = backprop(net, x, 1);
    const lossAt = (n: Network) => -Math.log(forward(n, x)[2][0]);
    const h = 1e-6;
    for (let l = 0; l < 2; l++)
      net.weights[l].forEach((row, u) =>
        row.forEach((_, i) => {
          const up = structuredClone(net);
          up.weights[l][u][i] += h;
          const down = structuredClone(net);
          down.weights[l][u][i] -= h;
          close(g.gw[l][u][i], (lossAt(up) - lossAt(down)) / (2 * h), 1e-7);
        }),
      );
  });

  it('learns the circles, which no straight line splits', () => {
    const { x, y } = toyData('circles', 200, 0.05, 2);
    const m = mlp(x, y, [8], 0.5, 300, 1);
    const acc = x.filter((r, i) => (m.proba(r)[1] > 0.5 ? 1 : 0) === y[i]).length / x.length;
    expect(acc).toBeGreaterThan(0.9);
  });
});

describe('impossible machine learning input', () => {
  it('says why a model or score cannot be made', () => {
    expect(code(() => nearest([[1], [2]], [1], 3))).toBe('knnRange');
    expect(code(() => netBenefit(1, 1, 10, 1))).toBe('thresholdRange');
    expect(code(() => roc([0.1, 0.2], [1, 1]))).toBe('oneClassOnly');
    expect(code(() => trainTest(10, 0, 1))).toBe('shareRange');
    expect(code(() => folds(3, 5, 1))).toBe('foldRange');
    expect(code(() => naiveBayes([[1], [2]], [0, 0], 2))).toBe('emptyClass');
  });
});
