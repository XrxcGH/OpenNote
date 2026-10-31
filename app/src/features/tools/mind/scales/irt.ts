// Item response curves from given parameters: the 1-, 2-, and 3-parameter logistic models with scaling constant D
// (1 or 1.702), and Samejima's graded response model, with item and test information and SE(theta).
import { fail } from '../kit/types';

export interface Item {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/** P(theta) for the 3-parameter model; c = 0 gives the 2-parameter model, and a = 1 too the 1-parameter one. */
export function pCorrect(theta: number, item: Item, D: number): number {
  return item.c + (1 - item.c) / (1 + Math.exp(-D * item.a * (theta - item.b)));
}

/** Item information: D^2 a^2 (Q/P) ((P - c)/(1 - c))^2, which is D^2 a^2 P Q when c = 0. */
export function information(theta: number, item: Item, D: number): number {
  const p = pCorrect(theta, item, D);
  return (D * item.a) ** 2 * ((1 - p) / p) * ((p - item.c) / (1 - item.c)) ** 2;
}

export function checkItem(item: Item, line: number): Item {
  if (!(item.a > 0)) fail('slope', { line }, 'items');
  if (!(item.c >= 0 && item.c < 1)) fail('guess', { line }, 'items');
  if (!Number.isFinite(item.b)) fail('badCell', { line, cell: String(item.b) }, 'items');
  return item;
}

export interface Graded {
  readonly a: number;
  /** Thresholds in increasing order; the item has one more category than thresholds. */
  readonly b: readonly number[];
}

/** The category probabilities of a graded-response item at theta. */
export function gradedProbabilities(theta: number, item: Graded, D: number): number[] {
  const star = [1, ...item.b.map((b) => 1 / (1 + Math.exp(-D * item.a * (theta - b)))), 0];
  return star.slice(0, -1).map((s, k) => s - star[k + 1]);
}

/** The information of a graded-response item: the sum over categories of P_k'^2 / P_k. */
export function gradedInformation(theta: number, item: Graded, D: number): number {
  const star = [1, ...item.b.map((b) => 1 / (1 + Math.exp(-D * item.a * (theta - b)))), 0];
  let total = 0;
  for (let k = 0; k < star.length - 1; k += 1) {
    const p = star[k] - star[k + 1];
    const slope = D * item.a * (star[k] * (1 - star[k]) - star[k + 1] * (1 - star[k + 1]));
    if (p > 0) total += (slope * slope) / p;
  }
  return total;
}

export function checkGraded(item: Graded, line: number): Graded {
  if (!(item.a > 0)) fail('slope', { line }, 'items');
  if (item.b.length < 1) fail('thresholds', { line }, 'items');
  if (item.b.some((b, i) => i > 0 && !(b > item.b[i - 1]))) fail('thresholds', { line }, 'items');
  return item;
}
