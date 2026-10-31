// How well a model does, and the data it learns from. Splits and folds are seeded, and k-fold splits keep each
// class's share in every fold. Classification gives the confusion matrix, accuracy, precision, recall, F1, the ROC
// and precision-recall curves with their areas, and decision-curve net benefit = TP/n − FP/n · p_t / (1 − p_t).
// Regression gives MSE and R². The toy sets are blobs, moons, circles, spirals, and 2 linearly separable groups.
import { makeRng, shuffled } from '../kit/rng';
import { fail } from '../kit/types';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

export interface Rates {
  readonly accuracy: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly specificity: number;
}

export function rates(tp: number, fp: number, fn: number, tn: number): Rates {
  const n = tp + fp + fn + tn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : NaN;
  const recall = tp + fn > 0 ? tp / (tp + fn) : NaN;
  return {
    accuracy: (tp + tn) / n,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : NaN,
    specificity: fp + tn > 0 ? tn / (fp + tn) : NaN,
  };
}

/** counts[actual][predicted]. */
export function confusion(actual: readonly number[], predicted: readonly number[], classes: number): number[][] {
  const m = Array.from({ length: classes }, () => new Array<number>(classes).fill(0));
  actual.forEach((a, i) => m[a][predicted[i]]++);
  return m;
}

/** Net benefit of treating those above the threshold p_t: TP/n − FP/n · p_t / (1 − p_t). */
export function netBenefit(tp: number, fp: number, n: number, threshold: number): number {
  if (!(threshold > 0 && threshold < 1)) fail('thresholdRange');
  return tp / n - (fp / n) * (threshold / (1 - threshold));
}

/** The ROC curve (false-positive rate, true-positive rate) and its area by the trapezoid rule, ties together. */
export function roc(score: readonly number[], y: readonly number[]) {
  const pos = sum(y);
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) fail('oneClassOnly');
  const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const points: [number, number][] = [[0, 0]];
  const pr: [number, number][] = [];
  let [tp, fp] = [0, 0];
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (y[i] === 1) tp++;
    else fp++;
    if (k === order.length - 1 || score[order[k + 1]] !== score[i]) {
      points.push([fp / neg, tp / pos]);
      pr.push([tp / pos, tp / (tp + fp)]);
    }
  }
  let auc = 0;
  for (let k = 1; k < points.length; k++)
    auc += ((points[k][0] - points[k - 1][0]) * (points[k][1] + points[k - 1][1])) / 2;
  let ap = 0;
  let lastRecall = 0;
  for (const [r, p] of pr) {
    ap += (r - lastRecall) * p;
    lastRecall = r;
  }
  return { points, auc, pr, ap };
}

export function regressionScores(y: readonly number[], yhat: readonly number[]) {
  const n = y.length;
  const m = sum(y) / n;
  const sse = sum(y.map((v, i) => (v - yhat[i]) ** 2));
  const tss = sum(y.map((v) => (v - m) ** 2));
  return { mse: sse / n, r2: tss > 0 ? 1 - sse / tss : NaN };
}

/** A seeded split into training and test rows; with labels, each class is split in the same share. */
export function trainTest(
  n: number,
  testShare: number,
  seed: number,
  labels?: readonly number[],
): { train: number[]; test: number[] } {
  if (!(testShare > 0 && testShare < 1)) fail('shareRange');
  const rng = makeRng(seed);
  const groups = labels
    ? [...new Set(labels)].map((c) => labels.map((_, i) => i).filter((i) => labels[i] === c))
    : [Array.from({ length: n }, (_, i) => i)];
  const train: number[] = [];
  const test: number[] = [];
  for (const g of groups) {
    const mixed = shuffled(g, rng);
    const t = Math.max(1, Math.round(testShare * g.length));
    test.push(...mixed.slice(0, Math.min(t, g.length - 1)));
    train.push(...mixed.slice(Math.min(t, g.length - 1)));
  }
  if (train.length < 2 || test.length < 1) fail('tooFewRows', `${n}|3`);
  return { train: train.sort((a, b) => a - b), test: test.sort((a, b) => a - b) };
}

/** Seeded k folds; with labels, each class is dealt round the folds so every fold keeps the class shares. */
export function folds(n: number, k: number, seed: number, labels?: readonly number[]): number[] {
  if (!(k >= 2 && k <= n)) fail('foldRange', String(n));
  const rng = makeRng(seed);
  const fold = new Array<number>(n).fill(0);
  const groups = labels
    ? [...new Set(labels)].map((c) => labels.map((_, i) => i).filter((i) => labels[i] === c))
    : [Array.from({ length: n }, (_, i) => i)];
  let at = 0;
  for (const g of groups) for (const i of shuffled(g, rng)) fold[i] = at++ % k;
  return fold;
}

export type Toy = 'blobs' | 'moons' | 'circles' | 'spirals' | 'linear';

/** n points of 2 classes in 2 features, with Gaussian noise of the given size. */
export function toyData(kind: Toy, n: number, noise: number, seed: number): { x: number[][]; y: number[] } {
  const rng = makeRng(seed);
  const x: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = i % 2;
    const t = rng.next();
    let p: [number, number];
    if (kind === 'blobs') p = c ? [2, 2] : [-1, -1];
    else if (kind === 'moons')
      p = c ? [1 - Math.cos(Math.PI * t), 0.5 - Math.sin(Math.PI * t)] : [Math.cos(Math.PI * t), Math.sin(Math.PI * t)];
    else if (kind === 'circles')
      p = [(c ? 0.5 : 1) * Math.cos(2 * Math.PI * t), (c ? 0.5 : 1) * Math.sin(2 * Math.PI * t)];
    else if (kind === 'spirals') {
      const r = 0.2 + 2.8 * t;
      const a = 1.5 * Math.PI * t * 2 + c * Math.PI;
      p = [r * Math.cos(a), r * Math.sin(a)];
    } else {
      const u = rng.normal();
      p = [u, (c ? 1 : -1) * (0.6 + Math.abs(rng.normal())) + 0.5 * u];
    }
    const spread = kind === 'blobs' ? Math.max(noise, 0.05) * 4 : noise;
    x.push([p[0] + spread * rng.normal(), p[1] + spread * rng.normal()]);
    y.push(c);
  }
  return { x, y };
}
