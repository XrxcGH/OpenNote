// The machine learning lab's models, all trained with seeded randomness so a run can be repeated. Classifiers give a
// probability for each class: k-nearest neighbors (vote shares), a CART tree (leaf shares), Gaussian naive Bayes,
// logistic regression by gradient descent with an L2 penalty, the perceptron, and a small multilayer perceptron
// trained by backpropagation. For a numeric target there are least squares, ridge, and the lasso (cyclic coordinate
// descent with soft thresholding), with the intercept left unpenalized.
import { inverse, matVec, type Matrix } from '../kit/linalg';
import { makeRng, shuffled } from '../kit/rng';
import { fail } from '../kit/types';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const dist2 = (a: readonly number[], b: readonly number[]) => sum(a.map((v, j) => (v - b[j]) ** 2));

/** Predicts class probabilities (one per class, adding to 1) or a number for regression. */
export interface Model {
  readonly proba: (x: readonly number[]) => number[];
  /** The loss after each epoch, for models trained by gradient steps. */
  readonly loss?: readonly number[];
}

export interface Neighbor {
  readonly index: number;
  readonly distance: number;
}

/** The k nearest training rows, nearest first; ties keep the earlier row. */
export function nearest(train: Matrix, x: readonly number[], k: number): Neighbor[] {
  if (!(k >= 1 && k <= train.length)) fail('knnRange', String(train.length));
  return train
    .map((row, index) => ({ index, distance: Math.sqrt(dist2(row, x)) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .slice(0, k);
}

export function knn(train: Matrix, y: readonly number[], classes: number, k: number): Model {
  return {
    proba: (x) => {
      const votes = new Array<number>(classes).fill(0);
      for (const n of nearest(train, x, k)) votes[y[n.index]] += 1 / k;
      return votes;
    },
  };
}

export function knnRegressor(train: Matrix, y: readonly number[], k: number): Model {
  return { proba: (x) => [sum(nearest(train, x, k).map((n) => y[n.index])) / k] };
}

export type Criterion = 'gini' | 'entropy';

const impurity = (counts: readonly number[], c: Criterion): number => {
  const n = sum(counts);
  if (n === 0) return 0;
  return c === 'gini'
    ? 1 - sum(counts.map((v) => (v / n) ** 2))
    : -sum(counts.map((v) => (v > 0 ? (v / n) * Math.log2(v / n) : 0)));
};

export interface Split {
  readonly feature: number;
  readonly threshold: number;
  /** The weighted impurity of the 2 sides. */
  readonly impurity: number;
}

/** The split with the smallest weighted impurity, trying midpoints between neighboring distinct values. */
export function bestSplit(
  x: Matrix,
  y: readonly number[],
  rows: readonly number[],
  classes: number,
  c: Criterion,
  minLeaf: number,
): Split | null {
  let best: Split | null = null;
  const n = rows.length;
  for (let f = 0; f < (x[0]?.length ?? 0); f++) {
    const order = [...rows].sort((a, b) => x[a][f] - x[b][f]);
    const left = new Array<number>(classes).fill(0);
    const right = new Array<number>(classes).fill(0);
    order.forEach((i) => right[y[i]]++);
    for (let s = 0; s < n - 1; s++) {
      left[y[order[s]]]++;
      right[y[order[s]]]--;
      const [a, b] = [x[order[s]][f], x[order[s + 1]][f]];
      if (a === b || s + 1 < minLeaf || n - s - 1 < minLeaf) continue;
      const w = ((s + 1) * impurity(left, c) + (n - s - 1) * impurity(right, c)) / n;
      if (!best || w < best.impurity - 1e-12) best = { feature: f, threshold: (a + b) / 2, impurity: w };
    }
  }
  return best;
}

export interface TreeNode {
  readonly id: number;
  readonly depth: number;
  readonly counts: number[];
  readonly impurity: number;
  readonly split?: Split;
  readonly left?: TreeNode;
  readonly right?: TreeNode;
}

export interface Tree extends Model {
  readonly root: TreeNode;
  readonly importance: number[];
  readonly nodes: TreeNode[];
}

/** CART for classes: grow by the best split until the depth limit, a pure node, or too few rows for 2 leaves. */
export function cart(
  x: Matrix,
  y: readonly number[],
  classes: number,
  c: Criterion,
  maxDepth: number,
  minLeaf: number,
): Tree {
  const p = x[0]?.length ?? 0;
  const importance = new Array<number>(p).fill(0);
  const nodes: TreeNode[] = [];
  const grow = (rows: number[], depth: number): TreeNode => {
    const counts = new Array<number>(classes).fill(0);
    rows.forEach((i) => counts[y[i]]++);
    const imp = impurity(counts, c);
    const id = nodes.length;
    const stub: TreeNode = { id, depth, counts, impurity: imp };
    nodes.push(stub);
    const split = depth < maxDepth && imp > 0 ? bestSplit(x, y, rows, classes, c, minLeaf) : null;
    if (!split) return stub;
    importance[split.feature] += (rows.length / x.length) * (imp - split.impurity);
    const left = grow(
      rows.filter((i) => x[i][split.feature] <= split.threshold),
      depth + 1,
    );
    const right = grow(
      rows.filter((i) => x[i][split.feature] > split.threshold),
      depth + 1,
    );
    const full: TreeNode = { ...stub, split, left, right };
    nodes[id] = full;
    return full;
  };
  const root = grow(
    x.map((_, i) => i),
    0,
  );
  const total = sum(importance);
  return {
    root,
    nodes,
    importance: importance.map((v) => (total > 0 ? v / total : 0)),
    proba: (row) => {
      let node = root;
      while (node.split && node.left && node.right)
        node = row[node.split.feature] <= node.split.threshold ? node.left : node.right;
      const n = sum(node.counts);
      return node.counts.map((v) => v / n);
    },
  };
}

/** A regression tree by the smallest sum of squared errors, predicting each leaf's mean. */
export function regressionTree(x: Matrix, y: readonly number[], maxDepth: number, minLeaf: number): Model {
  type Node = { value: number; f?: number; t?: number; l?: Node; r?: Node };
  const grow = (rows: number[], depth: number): Node => {
    const mean = sum(rows.map((i) => y[i])) / rows.length;
    const node: Node = { value: mean };
    if (depth >= maxDepth || rows.length < 2 * minLeaf) return node;
    let best = { sse: Infinity, f: -1, t: 0 };
    for (let f = 0; f < x[0].length; f++) {
      const order = [...rows].sort((a, b) => x[a][f] - x[b][f]);
      let [ls, lq] = [0, 0];
      const [ts, tq] = [sum(order.map((i) => y[i])), sum(order.map((i) => y[i] ** 2))];
      for (let s = 0; s < order.length - 1; s++) {
        ls += y[order[s]];
        lq += y[order[s]] ** 2;
        const nl = s + 1;
        const nr = order.length - nl;
        if (x[order[s]][f] === x[order[s + 1]][f] || nl < minLeaf || nr < minLeaf) continue;
        const sse = lq - ls ** 2 / nl + (tq - lq) - (ts - ls) ** 2 / nr;
        if (sse < best.sse - 1e-12) best = { sse, f, t: (x[order[s]][f] + x[order[s + 1]][f]) / 2 };
      }
    }
    if (best.f < 0) return node;
    node.f = best.f;
    node.t = best.t;
    node.l = grow(
      rows.filter((i) => x[i][best.f] <= best.t),
      depth + 1,
    );
    node.r = grow(
      rows.filter((i) => x[i][best.f] > best.t),
      depth + 1,
    );
    return node;
  };
  const root = grow(
    x.map((_, i) => i),
    0,
  );
  return {
    proba: (row) => {
      let node = root;
      while (node.l && node.r && node.f !== undefined && node.t !== undefined)
        node = row[node.f] <= node.t ? node.l : node.r;
      return [node.value];
    },
  };
}

export interface Bayes extends Model {
  readonly priors: number[];
  readonly means: Matrix;
  readonly variances: Matrix;
}

/** Gaussian naive Bayes, with a small variance floor so a constant feature does not divide by 0. */
export function naiveBayes(x: Matrix, y: readonly number[], classes: number): Bayes {
  const p = x[0].length;
  const all = x.flat();
  const floor = 1e-9 * Math.max(1, ...all.map(Math.abs));
  const priors: number[] = [];
  const means: Matrix = [];
  const variances: Matrix = [];
  for (let c = 0; c < classes; c++) {
    const rows = x.filter((_, i) => y[i] === c);
    if (rows.length === 0) fail('emptyClass', String(c + 1));
    priors.push(rows.length / x.length);
    const m = Array.from({ length: p }, (_, j) => sum(rows.map((r) => r[j])) / rows.length);
    means.push(m);
    variances.push(m.map((mj, j) => sum(rows.map((r) => (r[j] - mj) ** 2)) / rows.length + floor));
  }
  return {
    priors,
    means,
    variances,
    proba: (row) => {
      const logs = priors.map(
        (pr, c) =>
          Math.log(pr) -
          0.5 *
            sum(row.map((v, j) => Math.log(2 * Math.PI * variances[c][j]) + (v - means[c][j]) ** 2 / variances[c][j])),
      );
      const top = Math.max(...logs);
      const e = logs.map((l) => Math.exp(l - top));
      return e.map((v) => v / sum(e));
    },
  };
}

export interface Linear extends Model {
  readonly weights: number[];
  readonly bias: number;
}

/** Logistic regression by full-batch gradient descent on the mean log loss plus (λ/2)||w||². */
export function logisticGd(x: Matrix, y: readonly number[], lambda: number, rate: number, epochs: number): Linear {
  const p = x[0].length;
  let w = new Array<number>(p).fill(0);
  let b = 0;
  const loss: number[] = [];
  const n = x.length;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array<number>(p).fill(0);
    let gb = 0;
    let l = 0;
    x.forEach((row, i) => {
      const q = sigmoid(b + sum(row.map((v, j) => v * w[j])));
      const err = q - y[i];
      row.forEach((v, j) => (gw[j] += (err * v) / n));
      gb += err / n;
      l -= (y[i] * Math.log(Math.max(q, 1e-15)) + (1 - y[i]) * Math.log(Math.max(1 - q, 1e-15))) / n;
    });
    loss.push(l + (lambda / 2) * sum(w.map((v) => v * v)));
    w = w.map((v, j) => v - rate * (gw[j] + lambda * v));
    b -= rate * gb;
  }
  return {
    weights: w,
    bias: b,
    loss,
    proba: (row) => {
      const q = sigmoid(b + sum(row.map((v, j) => v * w[j])));
      return [1 - q, q];
    },
  };
}

/** The perceptron: on each mistake, w += rate (y − ŷ) x, visiting rows in a seeded order each epoch. */
export function perceptron(x: Matrix, y: readonly number[], rate: number, epochs: number, seed: number): Linear {
  const p = x[0].length;
  const w = new Array<number>(p).fill(0);
  let b = 0;
  const rng = makeRng(seed);
  const loss: number[] = [];
  const order = x.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    let mistakes = 0;
    for (const i of shuffled(order, rng)) {
      const yhat = b + sum(x[i].map((v, j) => v * w[j])) >= 0 ? 1 : 0;
      if (yhat === y[i]) continue;
      mistakes++;
      x[i].forEach((v, j) => (w[j] += rate * (y[i] - yhat) * v));
      b += rate * (y[i] - yhat);
    }
    loss.push(mistakes / x.length);
    if (mistakes === 0) break;
  }
  return { weights: w, bias: b, loss, proba: (row) => (b + sum(row.map((v, j) => v * w[j])) >= 0 ? [0, 1] : [1, 0]) };
}

export interface Network {
  /** weights[l][u][i]: from unit i of layer l to unit u of layer l + 1; biases[l][u]. */
  readonly weights: number[][][];
  readonly biases: number[][];
}

/** The activations of each layer: tanh in the hidden layers and a sigmoid at the 1 output. */
export function forward(net: Network, x: readonly number[]): number[][] {
  const acts = [[...x]];
  net.weights.forEach((layer, l) => {
    const last = l === net.weights.length - 1;
    acts.push(
      layer.map((row, u) => {
        const z = net.biases[l][u] + sum(row.map((w, i) => w * acts[l][i]));
        return last ? sigmoid(z) : Math.tanh(z);
      }),
    );
  });
  return acts;
}

/** The log loss of one row and its gradients by backpropagation. */
export function backprop(net: Network, x: readonly number[], y: number) {
  const acts = forward(net, x);
  const L = net.weights.length;
  const out = acts[L][0];
  const loss = -(y * Math.log(Math.max(out, 1e-15)) + (1 - y) * Math.log(Math.max(1 - out, 1e-15)));
  let delta = [out - y];
  const gw: number[][][] = net.weights.map((layer) => layer.map((row) => row.map(() => 0)));
  const gb: number[][] = net.biases.map((layer) => layer.map(() => 0));
  for (let l = L - 1; l >= 0; l--) {
    delta.forEach((d, u) => {
      gb[l][u] = d;
      acts[l].forEach((a, i) => (gw[l][u][i] = d * a));
    });
    if (l > 0) delta = acts[l].map((a, i) => (1 - a * a) * sum(delta.map((d, u) => d * net.weights[l][u][i])));
  }
  return { loss, gw, gb, acts };
}

export interface Mlp extends Model {
  readonly net: Network;
}

/** A multilayer perceptron with the given hidden sizes, trained by mini-batch gradient descent with seeded starts. */
export function mlp(
  x: Matrix,
  y: readonly number[],
  hidden: readonly number[],
  rate: number,
  epochs: number,
  seed: number,
  lambda = 0,
): Mlp {
  const rng = makeRng(seed);
  const sizes = [x[0].length, ...hidden, 1];
  const weights = sizes
    .slice(1)
    .map((n, l) =>
      Array.from({ length: n }, () => Array.from({ length: sizes[l] }, () => rng.normal() * Math.sqrt(1 / sizes[l]))),
    );
  const biases = sizes.slice(1).map((n) => new Array<number>(n).fill(0));
  const net: Network = { weights, biases };
  const loss: number[] = [];
  const batch = Math.min(32, x.length);
  const order = x.map((_, i) => i);
  for (let e = 0; e < epochs; e++) {
    const mixed = shuffled(order, rng);
    let total = 0;
    for (let s = 0; s < mixed.length; s += batch) {
      const rows = mixed.slice(s, s + batch);
      const gw = weights.map((layer) => layer.map((row) => row.map(() => 0)));
      const gb = biases.map((layer) => layer.map(() => 0));
      for (const i of rows) {
        const g = backprop(net, x[i], y[i]);
        total += g.loss;
        g.gw.forEach((layer, l) => layer.forEach((row, u) => row.forEach((v, k) => (gw[l][u][k] += v / rows.length))));
        g.gb.forEach((layer, l) => layer.forEach((v, u) => (gb[l][u] += v / rows.length)));
      }
      weights.forEach((layer, l) =>
        layer.forEach((row, u) => {
          row.forEach((v, k) => (row[k] = v - rate * (gw[l][u][k] + lambda * v)));
          biases[l][u] -= rate * gb[l][u];
        }),
      );
    }
    loss.push(total / x.length);
  }
  return {
    net,
    loss,
    proba: (row) => {
      const acts = forward(net, row);
      const q = acts[acts.length - 1][0];
      return [1 - q, q];
    },
  };
}

/** Ridge: b = (X'X + λI)^-1 X'y. With `intercept`, the first column is 1s and is not penalized. */
export function ridge(x: Matrix, y: readonly number[], lambda: number, intercept: boolean): number[] {
  const p = x[0].length;
  const xtx: Matrix = Array.from({ length: p }, (_, a) =>
    Array.from(
      { length: p },
      (_, b) => sum(x.map((r) => r[a] * r[b])) + (a === b && !(intercept && a === 0) ? lambda : 0),
    ),
  );
  const inv = inverse(xtx);
  if (!inv) fail('singularDesign');
  return matVec(
    inv,
    Array.from({ length: p }, (_, a) => sum(x.map((r, i) => r[a] * y[i]))),
  );
}

const soft = (z: number, g: number) => (Math.abs(z) <= g ? 0 : Math.sign(z) * (Math.abs(z) - g));

/**
 * The lasso by cyclic coordinate descent on (1 / 2n)||y − b0 − Xb||² + λ||b||1, for centered y and standardized X.
 */
export function lasso(
  x: Matrix,
  y: readonly number[],
  lambda: number,
  start?: readonly number[],
): { coef: number[]; intercept: number } {
  const n = x.length;
  const p = x[0].length;
  const ym = sum(y) / n;
  const means = Array.from({ length: p }, (_, j) => sum(x.map((r) => r[j])) / n);
  const xc = x.map((r) => r.map((v, j) => v - means[j]));
  const yc = y.map((v) => v - ym);
  const norms = Array.from({ length: p }, (_, j) => sum(xc.map((r) => r[j] ** 2)) / n);
  const b = start ? [...start] : new Array<number>(p).fill(0);
  const resid = yc.map((v, i) => v - sum(xc[i].map((xv, j) => xv * b[j])));
  for (let sweep = 0; sweep < 10_000; sweep++) {
    let change = 0;
    for (let j = 0; j < p; j++) {
      if (norms[j] === 0) continue;
      const rho = sum(xc.map((r, i) => r[j] * (resid[i] + r[j] * b[j]))) / n;
      const next = soft(rho, lambda) / norms[j];
      const d = next - b[j];
      if (d !== 0) xc.forEach((r, i) => (resid[i] -= r[j] * d));
      change = Math.max(change, Math.abs(d));
      b[j] = next;
    }
    if (change < 1e-10) break;
  }
  return { coef: b, intercept: ym - sum(b.map((v, j) => v * means[j])) };
}
