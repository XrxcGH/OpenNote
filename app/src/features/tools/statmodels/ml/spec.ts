// The machine learning lab. It learns from a seeded toy set or from the data's columns, splits the rows into
// training and test sets, and trains the chosen model. It scores the model on the test rows and by k-fold cross-
// validation, and draws the decision boundary, the ROC curve, the loss curve, the decision curve, and coefficients.
import { completeRows, isNumericColumn, levelsOf, numbersAt, parseTable, wordsAt } from '../kit/data';
import { frame, H, marker, range, svg, W, type DrawContext } from '../kit/picture';
import {
  columnList,
  type Outcome,
  type Picture,
  type ResultRow,
  type ResultTable,
  type ToolSpec,
  type Values,
} from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { confusion, folds, netBenefit, rates, regressionScores, roc, toyData, trainTest, type Toy } from './metrics';
import {
  cart,
  knn,
  knnRegressor,
  lasso,
  logisticGd,
  mlp,
  naiveBayes,
  nearest,
  perceptron,
  regressionTree,
  ridge,
  type Criterion,
  type Model,
  type Tree,
} from './models';

const HOUSES =
  'size,age,rooms,price\n120,12,4,310\n85,30,3,205\n150,5,5,402\n95,22,3,236\n130,15,4,330\n70,40,2,160\n' +
  '160,3,5,430\n110,18,4,282\n90,28,3,214\n140,8,5,371\n100,25,3,245\n75,35,2,176\n125,10,4,328\n105,20,3,262\n' +
  '135,7,4,357\n80,33,2,190';

const CLASSIFIERS = ['knn', 'tree', 'bayes', 'logistic', 'perceptron', 'mlp'];
const REGRESSORS = ['linear', 'ridge', 'lasso', 'knn', 'tree'];
const BINARY_ONLY = ['logistic', 'perceptron', 'mlp'];

const is =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(String(v.model));
const fromData = (v: Values) => v.source === 'data';

interface Dataset {
  readonly x: number[][];
  readonly y: number[];
  readonly features: string[];
  readonly classes: string[];
  readonly regression: boolean;
  readonly target: string;
}

function readDataset(values: Values): Dataset {
  if (!fromData(values)) {
    const { x, y } = toyData(
      (values.toy === 'separable' ? 'linear' : String(values.toy)) as Toy,
      Number(values.n),
      Number(values.noise),
      Number(values.seed),
    );
    return { x, y, features: ['x1', 'x2'], classes: ['0', '1'], regression: false, target: 'class' };
  }
  const table = parseTable(String(values.data));
  const target = String(values.target);
  const features = columnList(values.features).filter((f) => f !== target);
  if (features.length === 0) fail('pickColumns');
  const rows = completeRows(table, [target, ...features]);
  const cols = features.map((f) => numbersAt(table, f, rows));
  const x = rows.map((_, i) => cols.map((c) => c[i]));
  const regression = values.task === 'regress';
  if (regression) {
    if (!isNumericColumn(table, target)) fail('notNumeric', `${target}|words`);
    return { x, y: numbersAt(table, target, rows), features, classes: [], regression, target };
  }
  const words = wordsAt(table, target, rows);
  const classes = levelsOf(words);
  if (classes.length < 2) fail('oneClassOnly');
  if (classes.length > 10) fail('tooManyClasses');
  return { x, y: words.map((w) => classes.indexOf(w)), features, classes, regression, target };
}

/** Standardizes with the training rows' means and standard deviations. */
function scaler(train: number[][]) {
  const p = train[0].length;
  const m = Array.from({ length: p }, (_, j) => train.reduce((s, r) => s + r[j], 0) / train.length);
  const s = m.map(
    (mj, j) => Math.sqrt(train.reduce((a, r) => a + (r[j] - mj) ** 2, 0) / Math.max(1, train.length - 1)) || 1,
  );
  return { m, s, apply: (row: readonly number[]) => row.map((v, j) => (v - m[j]) / s[j]) };
}

function parseHidden(text: string): number[] {
  const sizes = text
    .split(/[\s,]+/)
    .filter((t) => t !== '')
    .map(Number);
  if (sizes.length < 1 || sizes.length > 2 || sizes.some((v) => !(Number.isInteger(v) && v >= 1 && v <= 16)))
    fail('hiddenLayers');
  return sizes;
}

interface Trained {
  readonly model: Model;
  readonly coef?: { names: string[]; values: number[] };
  readonly tree?: Tree;
}

function train(values: Values, d: Dataset, x: number[][], y: number[]): Trained {
  const model = String(values.model);
  const k = Number(values.k);
  const lambda = Number(values.lambda);
  const rate = Number(values.rate);
  const epochs = Number(values.epochs);
  const seed = Number(values.seed);
  const depth = Number(values.depth);
  const leaf = Number(values.minLeaf);
  if (d.regression) {
    if (model === 'knn') return { model: knnRegressor(x, y, k) };
    if (model === 'tree') return { model: regressionTree(x, y, depth, leaf) };
    let b: number[];
    let b0: number;
    if (model === 'lasso') {
      const fit = lasso(x, y, lambda);
      [b, b0] = [fit.coef, fit.intercept];
    } else {
      const full = ridge(
        x.map((r) => [1, ...r]),
        y,
        model === 'ridge' ? lambda * x.length : 0,
        true,
      );
      [b0, b] = [full[0], full.slice(1)];
    }
    return {
      model: { proba: (r) => [b0 + r.reduce((s, v, j) => s + v * b[j], 0)] },
      coef: { names: ['(Intercept)', ...d.features], values: [b0, ...b] },
    };
  }
  const classes = d.classes.length;
  if (model === 'knn') return { model: knn(x, y, classes, k) };
  if (model === 'tree') {
    const tree = cart(x, y, classes, String(values.criterion) as Criterion, depth, leaf);
    return { model: tree, tree };
  }
  if (model === 'bayes') return { model: naiveBayes(x, y, classes) };
  if (model === 'logistic' || model === 'perceptron') {
    const fit = model === 'logistic' ? logisticGd(x, y, lambda, rate, epochs) : perceptron(x, y, rate, epochs, seed);
    return { model: fit, coef: { names: ['(Intercept)', ...d.features], values: [fit.bias, ...fit.weights] } };
  }
  return { model: mlp(x, y, parseHidden(String(values.hidden)), rate, epochs, seed, lambda) };
}

const argmax = (p: readonly number[]) => p.reduce((best, v, i) => (v > p[best] ? i : best), 0);

function boundaryPicture(
  x: readonly number[][],
  y: readonly number[],
  predict: (r: number[]) => number,
  labels: { x: string; y: string },
): Picture {
  return {
    id: 'boundary',
    type: 'draw',
    draw: (ctx: DrawContext) => {
      const p = ctx.palette;
      const xr = range(
        x.map((r) => r[0]),
        0.08,
      );
      const yr = range(
        x.map((r) => r[1]),
        0.08,
      );
      const f = frame(xr, yr, labels, p);
      const g = 36;
      const cells: string[] = [];
      const cw = (f.px(xr[1]) - f.px(xr[0])) / g;
      const ch = (f.py(yr[0]) - f.py(yr[1])) / g;
      for (let a = 0; a < g; a++)
        for (let b = 0; b < g; b++) {
          const cx = xr[0] + ((a + 0.5) * (xr[1] - xr[0])) / g;
          const cy = yr[0] + ((b + 0.5) * (yr[1] - yr[0])) / g;
          const c = predict([cx, cy]);
          cells.push(
            `<rect x="${(f.px(xr[0]) + a * cw).toFixed(1)}" y="${(f.py(yr[0]) - (b + 1) * ch).toFixed(1)}" ` +
              `width="${(cw + 0.5).toFixed(1)}" ` +
              `height="${(ch + 0.5).toFixed(1)}" fill="${p.pens[c % p.pens.length]}" fill-opacity="0.16"/>`,
          );
        }
      const dots = x.map((r, i) => marker(f.px(r[0]), f.py(r[1]), y[i], p.pens[y[i] % p.pens.length]));
      return svg([f.parts[0], ...cells, ...f.parts.slice(1), ...dots], p, W, H);
    },
  };
}

interface Scored {
  readonly rows: ResultRow[];
  readonly tables: ResultTable[];
  readonly pictures: Picture[];
  readonly steps: KitStep[];
}

function scoreClassifier(d: Dataset, actual: number[], probs: number[][], threshold: number): Scored {
  const predicted = probs.map(argmax);
  const m = confusion(actual, predicted, d.classes.length);
  const table: ResultTable = {
    id: 'confusion',
    columns: ['actual', ...d.classes.map((c) => `=${c}`)],
    rows: m.map((row, a) => [d.classes[a], ...row]),
  };
  const acc = predicted.filter((v, i) => v === actual[i]).length / actual.length;
  if (d.classes.length !== 2) {
    return {
      rows: [{ id: 'accuracy', value: acc, answer: true }],
      tables: [table],
      pictures: [],
      steps: [step('ml.accuracy', undefined, { acc })],
    };
  }
  const [tn, fp, fn, tp] = [m[0][0], m[0][1], m[1][0], m[1][1]];
  const r = rates(tp, fp, fn, tn);
  const score = probs.map((p) => p[1]);
  const curve = actual.some((v) => v === 1) && actual.some((v) => v === 0) ? roc(score, actual) : null;
  const n = actual.length;
  const nb = (t: number) => {
    const tpT = score.filter((s, i) => s >= t && actual[i] === 1).length;
    const fpT = score.filter((s, i) => s >= t && actual[i] === 0).length;
    return netBenefit(tpT, fpT, n, t);
  };
  const prevalence = actual.filter((v) => v === 1).length / n;
  return {
    rows: [
      { id: 'accuracy', value: r.accuracy, answer: true },
      { id: 'precision', value: r.precision },
      { id: 'recall', value: r.recall },
      { id: 'f1', value: r.f1 },
      ...(curve
        ? [
            { id: 'auc', value: curve.auc },
            { id: 'ap', value: curve.ap },
          ]
        : []),
      { id: 'netBenefit', value: nb(threshold) },
    ],
    tables: [table],
    steps: [
      step(
        'ml.rates',
        '\\text{precision} = \\frac{TP}{TP + FP} = \\frac{[[tp]]}{[[tp]] + [[fp]]},\\quad \\text{recall} = \\frac{TP}{TP + FN} = [[rec]]',
        {
          tp,
          fp,
          rec: r.recall,
        },
      ),
      step('ml.f1', 'F_1 = \\frac{2PR}{P + R} = [[f1]]', { f1: r.f1 }),
      step('ml.netBenefit', '\\text{NB} = \\frac{TP}{n} - \\frac{FP}{n}\\cdot\\frac{p_t}{1 - p_t} = [[nb]]', {
        nb: nb(threshold),
        t: threshold,
      }),
    ],
    pictures: classifierPictures(curve, nb, prevalence),
  };
}

function classifierPictures(
  curve: ReturnType<typeof roc> | null,
  nb: (t: number) => number,
  prevalence: number,
): Picture[] {
  const ts = Array.from({ length: 12 }, (_, i) => 0.05 + i * 0.05);
  return [
    ...(curve
      ? [
          {
            id: 'roc',
            type: 'plot' as const,
            plot: {
              x: { label: 'fpr' },
              y: { label: 'tpr' },
              series: [
                { id: 'roc', points: curve.points },
                {
                  id: 'chance',
                  style: 'dashed' as const,
                  points: [
                    [0, 0],
                    [1, 1],
                  ] as [number, number][],
                },
              ],
              xRange: [0, 1] as [number, number],
              yRange: [0, 1] as [number, number],
            },
          },
        ]
      : []),
    {
      id: 'decision',
      type: 'plot',
      plot: {
        x: { label: 'threshold' },
        y: { label: 'netBenefit' },
        series: [
          { id: 'model', points: ts.map((t) => [t, nb(t)] as [number, number]) },
          {
            id: 'treatAll',
            style: 'dashed',
            points: ts.map((t) => [t, prevalence - (1 - prevalence) * (t / (1 - t))] as [number, number]),
          },
          {
            id: 'treatNone',
            style: 'dashed',
            points: [
              [ts[0], 0],
              [ts[ts.length - 1], 0],
            ],
          },
        ],
        legend: true,
      },
    },
  ];
}

function crossValidate(values: Values, d: Dataset): { mean: number; sd: number; each: number[] } | null {
  const k = Number(values.folds);
  if (k < 2) return null;
  const fold = folds(d.x.length, k, Number(values.seed), d.regression ? undefined : d.y);
  const each = Array.from({ length: k }, (_, f) => {
    const tr = d.x.map((_, i) => i).filter((i) => fold[i] !== f);
    const te = d.x.map((_, i) => i).filter((i) => fold[i] === f);
    const sc = scaler(tr.map((i) => d.x[i]));
    const fit = train(
      values,
      d,
      tr.map((i) => sc.apply(d.x[i])),
      tr.map((i) => d.y[i]),
    );
    const out = te.map((i) => fit.model.proba(sc.apply(d.x[i])));
    if (d.regression)
      return regressionScores(
        te.map((i) => d.y[i]),
        out.map((p) => p[0]),
      ).r2;
    return te.filter((i, j) => argmax(out[j]) === d.y[i]).length / te.length;
  });
  const mean = each.reduce((a, b) => a + b, 0) / k;
  const sd = Math.sqrt(each.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, k - 1));
  return { mean, sd, each };
}

function modelSteps(values: Values, d: Dataset, xs: number[][], fit: Trained): KitStep[] {
  const model = String(values.model);
  if (model === 'knn') {
    const n = nearest(xs, xs[0], Math.min(Number(values.k) + 1, xs.length)).slice(1);
    return [step('ml.knn', "d = \\sqrt{\\sum_j (x_j - x'_j)^2}", { k: Number(values.k), d: n[0]?.distance ?? NaN })];
  }
  if (model === 'tree' && fit.tree?.root.split) {
    const s = fit.tree.root.split;
    return [
      step('ml.treeSplit', undefined, {
        feature: d.features[s.feature],
        t: s.threshold,
        imp: s.impurity,
        root: fit.tree.root.impurity,
      }),
    ];
  }
  if (model === 'bayes')
    return [step('ml.bayes', 'P(c \\mid x) \\propto P(c)\\prod_j \\mathcal{N}(x_j; \\mu_{cj}, \\sigma^2_{cj})')];
  if (model === 'logistic')
    return [
      step('ml.logistic', 'w \\leftarrow w - \\eta\\left(\\tfrac{1}{n}X^\\top(\\hat p - y) + \\lambda w\\right)', {
        eta: Number(values.rate),
        lambda: Number(values.lambda),
      }),
    ];
  if (model === 'perceptron') return [step('ml.perceptron', 'w \\leftarrow w + \\eta\\,(y - \\hat y)\\,x')];
  if (model === 'mlp')
    return [
      step('ml.mlp', '\\delta^{(L)} = \\hat p - y,\\quad \\delta^{(l)} = (1 - a^2)\\odot W^\\top \\delta^{(l+1)}', {
        hidden: String(values.hidden),
      }),
    ];
  if (model === 'ridge') return [step('ml.ridge', 'b = (X^\\top X + \\lambda n I)^{-1} X^\\top y')];
  if (model === 'lasso')
    return [
      step(
        'ml.lasso',
        'b_j \\leftarrow \\frac{S(\\rho_j, \\lambda)}{\\tfrac{1}{n}\\sum x_{ij}^2},\\quad ' +
          'S(z, \\lambda) = \\operatorname{sign}(z)(|z| - \\lambda)_+',
      ),
    ];

  return [step('ml.linear', 'b = (X^\\top X)^{-1} X^\\top y')];
}

function extraPictures(values: Values, d: Dataset, xs: number[][], ys: number[], fit: Trained): Picture[] {
  const out: Picture[] = [];
  if (fit.model.loss?.length)
    out.push({
      id: 'loss',
      type: 'plot',
      plot: {
        x: { label: 'epoch' },
        y: { label: 'loss' },
        series: [{ id: 'loss', points: fit.model.loss.map((v, i) => [i + 1, v] as [number, number]) }],
      },
    });
  if (fit.tree)
    out.push({
      id: 'importance',
      type: 'plot',
      plot: {
        x: { label: 'feature' },
        y: { label: 'importance' },
        series: [
          {
            id: 'importance',
            style: 'points',
            points: fit.tree.importance.map((v, j) => [j + 1, v] as [number, number]),
          },
        ],
        marks: fit.tree.importance.map((v, j) => ({ x: j + 1, y: v, text: d.features[j] })),
      },
    });
  if (values.model === 'lasso' || values.model === 'ridge') {
    const lambdas = Array.from({ length: 15 }, (_, i) => 10 ** (-3 + (i * 4) / 14));
    const path = lambdas.map((l) =>
      values.model === 'lasso'
        ? lasso(xs, ys, l).coef
        : ridge(
            xs.map((r) => [1, ...r]),
            ys,
            l * xs.length,
            true,
          ).slice(1),
    );
    out.push({
      id: 'path',
      type: 'plot',
      plot: {
        x: { label: 'logLambda' },
        y: { label: 'coefficient' },
        series: d.features.map((f, j) => ({
          id: `b${j}`,
          name: f,
          points: lambdas.map((l, i) => [Math.log10(l), path[i][j]] as [number, number]),
        })),
        hlines: [0],
        legend: true,
      },
    });
  }
  return out;
}

function run(values: Values): Outcome {
  const d = readDataset(values);
  const model = String(values.model);
  if (!(d.regression ? REGRESSORS : CLASSIFIERS).includes(model))
    fail(d.regression ? 'modelForClasses' : 'modelForNumbers');
  if (!d.regression && BINARY_ONLY.includes(model) && d.classes.length !== 2) fail('binaryOnly');
  const split = trainTest(d.x.length, Number(values.testShare), Number(values.seed), d.regression ? undefined : d.y);
  const sc = scaler(split.train.map((i) => d.x[i]));
  const xs = split.train.map((i) => sc.apply(d.x[i]));
  const ys = split.train.map((i) => d.y[i]);
  const fit = train(values, d, xs, ys);
  const probs = split.test.map((i) => fit.model.proba(sc.apply(d.x[i])));
  const actual = split.test.map((i) => d.y[i]);
  const cv = crossValidate(values, d);
  const trainScore = d.regression
    ? regressionScores(
        ys,
        xs.map((r) => fit.model.proba(r)[0]),
      ).r2
    : xs.filter((r, i) => argmax(fit.model.proba(r)) === ys[i]).length / xs.length;
  const scored = d.regression
    ? regressionScored(
        actual,
        probs.map((p) => p[0]),
      )
    : scoreClassifier(d, actual, probs, Number(values.threshold));
  const pictures = [...scored.pictures, ...extraPictures(values, d, xs, ys, fit)];
  if (!d.regression && d.features.length === 2)
    pictures.unshift(
      boundaryPicture(d.x, d.y, (r) => argmax(fit.model.proba(sc.apply(r))), { x: d.features[0], y: d.features[1] }),
    );
  return {
    rows: [
      ...scored.rows,
      { id: d.regression ? 'trainR2' : 'trainAccuracy', value: trainScore },
      ...(cv
        ? [
            { id: 'cvMean', value: cv.mean },
            { id: 'cvSd', value: cv.sd },
          ]
        : []),
      { id: 'trainRows', value: split.train.length },
      { id: 'testRows', value: split.test.length },
    ],
    tables: [
      ...scored.tables,
      ...(fit.coef
        ? [
            {
              id: 'coefficients',
              columns: ['term', 'estimate'],
              rows: fit.coef.names.map((n, j) => [n, fit.coef?.values[j] ?? NaN]),
            },
          ]
        : []),
      ...(cv
        ? [
            {
              id: 'folds',
              columns: ['fold', d.regression ? 'r2' : 'accuracy'],
              rows: cv.each.map((v, f) => [f + 1, v]),
            },
          ]
        : []),
    ],
    steps: [
      step('ml.split', undefined, { train: split.train.length, test: split.test.length, seed: Number(values.seed) }),
      step('ml.scale', 'z = \\frac{x - \\bar x_{\\text{train}}}{s_{\\text{train}}}'),
      ...modelSteps(values, d, xs, fit),
      ...scored.steps,
      ...(cv ? [step('ml.cv', undefined, { k: Number(values.folds), mean: cv.mean, sd: cv.sd })] : []),
    ],
    words: d.regression
      ? step('ml.wordsRegression', undefined, { r2: scored.rows[0].value ?? NaN, test: split.test.length })
      : step('ml.wordsClassifier', undefined, { acc: scored.rows[0].value ?? NaN, test: split.test.length }),
    pictures,
    notes: ['heldOut', d.regression ? 'scaledRegression' : 'sameDistribution'],
  };
}

function regressionScored(actual: number[], predicted: number[]): Scored {
  const s = regressionScores(actual, predicted);
  return {
    rows: [
      { id: 'r2', value: s.r2, answer: true, sym: 'R^2' },
      { id: 'mse', value: s.mse },
      { id: 'rmse', value: Math.sqrt(s.mse) },
    ],
    tables: [],
    pictures: [
      {
        id: 'fitPlot',
        type: 'plot',
        plot: {
          x: { label: 'actual' },
          y: { label: 'predicted' },
          series: [
            { id: 'test', style: 'points', points: actual.map((v, i) => [v, predicted[i]] as [number, number]) },
          ],
        },
      },
    ],
    steps: [step('ml.r2', 'R^2 = 1 - \\frac{\\sum (y - \\hat y)^2}{\\sum (y - \\bar y)^2} = [[r2]]', { r2: s.r2 })],
  };
}

export const mlSpec: ToolSpec = {
  fields: [
    { id: 'source', type: 'choice', options: ['toy', 'data'], first: 'toy' },
    {
      id: 'toy',
      type: 'choice',
      options: ['moons', 'blobs', 'circles', 'spirals', 'separable'],
      first: 'moons',
      when: (v) => !fromData(v),
    },
    { id: 'n', type: 'number', first: '200', integer: true, min: 20, max: 2000, when: (v) => !fromData(v) },
    { id: 'noise', type: 'number', first: '0.2', min: 0, max: 2, when: (v) => !fromData(v) },
    { id: 'data', type: 'data', first: HOUSES, rows: 6, when: fromData },
    { id: 'task', type: 'choice', options: ['classify', 'regress'], first: 'regress', when: fromData },
    { id: 'target', type: 'column', data: 'data', first: 'price', when: fromData },
    { id: 'features', type: 'column', data: 'data', first: 'size\nage\nrooms', multi: true, when: fromData },
    {
      id: 'model',
      type: 'choice',
      options: ['knn', 'tree', 'bayes', 'logistic', 'perceptron', 'mlp', 'linear', 'ridge', 'lasso'],
      first: 'knn',
    },
    { id: 'k', type: 'number', first: '5', integer: true, min: 1, max: 100, when: is('knn') },
    {
      id: 'criterion',
      type: 'choice',
      options: ['gini', 'entropy'],
      first: 'gini',
      when: (v) => is('tree')(v) && !(fromData(v) && v.task === 'regress'),
    },
    { id: 'depth', type: 'number', first: '4', integer: true, min: 1, max: 12, when: is('tree') },
    { id: 'minLeaf', type: 'number', first: '2', integer: true, min: 1, max: 100, when: is('tree') },
    { id: 'hidden', type: 'text', first: '8', rows: 1, when: is('mlp') },
    { id: 'rate', type: 'number', first: '0.3', min: 1e-6, max: 10, when: is('logistic', 'perceptron', 'mlp') },
    {
      id: 'epochs',
      type: 'number',
      first: '200',
      integer: true,
      min: 1,
      max: 2000,
      when: is('logistic', 'perceptron', 'mlp'),
    },
    { id: 'lambda', type: 'number', first: '0.01', min: 0, max: 1000, when: is('logistic', 'mlp', 'ridge', 'lasso') },
    { id: 'testShare', type: 'number', first: '0.3', min: 0.05, max: 0.9 },
    { id: 'folds', type: 'number', first: '5', integer: true, min: 0, max: 20 },
    {
      id: 'threshold',
      type: 'number',
      first: '0.2',
      min: 0.01,
      max: 0.99,
      when: (v) => !(fromData(v) && v.task === 'regress'),
    },
    { id: 'seed', type: 'number', first: '1', integer: true, min: 0 },
  ],
  run,
  examples: [
    { id: 'knnMoons', values: { source: 'toy', toy: 'moons', model: 'knn', k: '5' } },
    { id: 'treeBlobs', values: { source: 'toy', toy: 'blobs', model: 'tree', depth: '3' } },
    {
      id: 'mlpCircles',
      values: { source: 'toy', toy: 'circles', model: 'mlp', hidden: '8', epochs: '200', noise: '0.1' },
    },
    { id: 'logisticLinear', values: { source: 'toy', toy: 'separable', model: 'logistic', rate: '0.5' } },
    {
      id: 'lassoHouses',
      values: {
        source: 'data',
        data: HOUSES,
        task: 'regress',
        target: 'price',
        features: 'size\nage\nrooms',
        model: 'lasso',
        lambda: '1',
      },
    },
  ],
};
