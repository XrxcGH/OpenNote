// What the logistic and Poisson tool reports about a fitted model. It gives Wald and profile-likelihood intervals,
// odds or rate ratios, and likelihood-ratio tests for the model and for each term. It gives the deviance, AIC, BIC,
// and pseudo R² (McFadden, Cox-Snell, Nagelkerke). For 0/1 outcomes it adds the Hosmer-Lemeshow test, the
// classification table at a threshold, and the ROC curve with its area by the Mann-Whitney identity. For counts it
// adds the quasi-Poisson dispersion.
import { chiSquareQuantile, chiSquareUpper, normalQuantile, normalTwoSided } from '../kit/dist';
import { dropColumns, type Design } from '../kit/design';
import type { Matrix } from '../kit/linalg';
import { checkOutcome, fitGlm, logLikAt, pearson, type Family, type GlmData, type GlmFit } from './fit';

export interface Coefficient {
  readonly name: string;
  readonly estimate: number;
  readonly se: number;
  readonly z: number;
  readonly p: number;
  readonly low: number;
  readonly high: number;
  /** Profile-likelihood limits, NaN when the likelihood does not fall far enough on that side. */
  readonly profileLow: number;
  readonly profileHigh: number;
}

export interface TermTest {
  readonly label: string;
  readonly df: number;
  readonly chi2: number;
  readonly p: number;
}

export interface Classification {
  readonly tp: number;
  readonly fp: number;
  readonly fn: number;
  readonly tn: number;
}

export interface GlmResult {
  readonly family: Family;
  readonly n: number;
  readonly fit: GlmFit;
  readonly coefs: readonly Coefficient[];
  readonly nullDeviance: number;
  readonly nullLogLik: number;
  readonly lr: number;
  readonly lrDf: number;
  readonly lrP: number;
  readonly aic: number;
  readonly bic: number;
  readonly mcFadden: number;
  readonly coxSnell: number;
  readonly nagelkerke: number;
  readonly terms: readonly TermTest[];
  readonly dispersion: number;
  readonly zCrit: number;
  /** For 0/1 outcomes only. */
  readonly hosmer?: { readonly chi2: number; readonly df: number; readonly p: number; readonly groups: number };
  readonly auc?: number;
  readonly roc?: readonly (readonly [number, number])[];
  readonly table?: Classification;
}

export interface GlmInput {
  readonly family: Family;
  readonly design: Design;
  readonly y: readonly number[];
  readonly trials?: readonly number[];
  readonly offset?: readonly number[];
  readonly level: number;
  readonly threshold: number;
  /** Skips the profile-likelihood intervals, which refit the model many times. */
  readonly noProfile?: boolean;
}

const data = (input: GlmInput, x: Matrix = input.design.x): GlmData => ({
  x,
  y: input.y,
  ...(input.trials ? { trials: input.trials } : {}),
  ...(input.offset ? { offset: input.offset } : {}),
  columns: input.design.columns,
});

/** The log likelihood with coefficient j fixed at b and the others refitted. */
function profileLogLik(input: GlmInput, j: number, b: number): number {
  const x = input.design.x;
  const offset = x.map((row, i) => (input.offset?.[i] ?? 0) + b * row[j]);
  const rest = dropColumns(x, [j]);
  const shifted = { ...data(input, rest), offset, columns: input.design.columns.filter((_, k) => k !== j) };
  if (rest[0].length === 0) return logLikAt(input.family, shifted, offset);
  return fitGlm(input.family, shifted).logLik;
}

/** Where the profile log likelihood falls q/2 below its maximum, on one side of the estimate. */
function profileLimit(input: GlmInput, fit: GlmFit, j: number, se: number, q: number, dir: 1 | -1): number {
  const target = fit.logLik - q / 2;
  const g = (b: number) => {
    try {
      return profileLogLik(input, j, b) - target;
    } catch {
      return NaN;
    }
  };
  let inner = fit.coef[j];
  let outer = NaN;
  for (let k = 1; k <= 64; k *= 2) {
    const b = fit.coef[j] + dir * k * se;
    const v = g(b);
    if (Number.isNaN(v)) return NaN;
    if (v < 0) {
      outer = b;
      break;
    }
    inner = b;
  }
  if (Number.isNaN(outer)) return NaN;
  for (let i = 0; i < 60 && Math.abs(outer - inner) > 1e-9 * (se + Math.abs(inner)); i += 1) {
    const mid = (inner + outer) / 2;
    const v = g(mid);
    if (Number.isNaN(v)) return NaN;
    if (v < 0) outer = mid;
    else inner = mid;
  }
  return (inner + outer) / 2;
}

function coefficients(input: GlmInput, fit: GlmFit, scale: number, zCrit: number): Coefficient[] {
  const q = chiSquareQuantile(input.level, 1);
  const profile = !input.noProfile && input.y.length * fit.coef.length <= 40_000;
  return fit.coef.map((b, j) => {
    const se = Math.sqrt(fit.cov[j][j] * scale);
    const z = b / se;
    return {
      name: input.design.columns[j],
      estimate: b,
      se,
      z,
      p: normalTwoSided(z),
      low: b - zCrit * se,
      high: b + zCrit * se,
      profileLow: profile ? profileLimit(input, fit, j, se, q, -1) : NaN,
      profileHigh: profile ? profileLimit(input, fit, j, se, q, 1) : NaN,
    };
  });
}

function termTests(input: GlmInput, fit: GlmFit): TermTest[] {
  return input.design.terms.map((term) => {
    const x = dropColumns(input.design.x, term.columns);
    const reduced = fitGlm(input.family, {
      ...data(input, x),
      columns: input.design.columns.filter((_, k) => !term.columns.includes(k)),
    });
    const chi2 = Math.max(0, reduced.deviance - fit.deviance);
    return { label: term.label, df: term.columns.length, chi2, p: chiSquareUpper(chi2, term.columns.length) };
  });
}

/** The area under the ROC curve by the Mann-Whitney identity, with ties counted half, and the curve's points. */
export function rocCurve(score: readonly number[], pos: readonly number[], neg: readonly number[]) {
  const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const totalPos = pos.reduce((s, v) => s + v, 0);
  const totalNeg = neg.reduce((s, v) => s + v, 0);
  const points: [number, number][] = [[0, 0]];
  let tp = 0;
  let fp = 0;
  let area = 0;
  for (let k = 0; k < order.length;) {
    let dp = 0;
    let dn = 0;
    const s = score[order[k]];
    while (k < order.length && score[order[k]] === s) {
      dp += pos[order[k]];
      dn += neg[order[k]];
      k += 1;
    }
    area += dn * (tp + dp / 2);
    tp += dp;
    fp += dn;
    points.push([fp / totalNeg, tp / totalPos]);
  }
  return { auc: area / (totalPos * totalNeg), points };
}

/** The Hosmer-Lemeshow test on groups of about equal size by fitted probability. */
export function hosmerLemeshow(y: readonly number[], p: readonly number[], groups: number) {
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const n = y.length;
  let chi2 = 0;
  for (let g = 0; g < groups; g += 1) {
    const members = order.slice(Math.round((g * n) / groups), Math.round(((g + 1) * n) / groups));
    const observed = members.reduce((s, i) => s + y[i], 0);
    const expected = members.reduce((s, i) => s + p[i], 0);
    const size = members.length;
    if (expected > 0 && expected < size) chi2 += (observed - expected) ** 2 / (expected * (1 - expected / size));
  }
  return { chi2, df: groups - 2, p: chiSquareUpper(chi2, groups - 2), groups };
}

function binaryExtras(input: GlmInput, fit: GlmFit) {
  const y = input.y;
  const p = fit.mu;
  const roc = rocCurve(
    p,
    y,
    y.map((v) => 1 - v),
  );
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  p.forEach((pi, i) => {
    const said = pi >= input.threshold;
    if (y[i] === 1 && said) tp += 1;
    else if (y[i] === 1) fn += 1;
    else if (said) fp += 1;
    else tn += 1;
  });
  const groups = Math.min(10, Math.floor(y.length / 2));
  return {
    auc: roc.auc,
    roc: roc.points,
    table: { tp, fp, fn, tn },
    ...(groups >= 3 ? { hosmer: hosmerLemeshow(y, p, groups) } : {}),
  };
}

/** Fits the model and works out everything the tool shows. */
export function analyzeGlm(input: GlmInput): GlmResult {
  checkOutcome(input.family, data(input));
  const fit = fitGlm(input.family, data(input));
  const n = input.y.length;
  const k = fit.coef.length;
  const nullFit = fitGlm(input.family, {
    ...data(
      input,
      input.design.x.map(() => [1]),
    ),
    columns: ['(Intercept)'],
  });
  const lr = Math.max(0, nullFit.deviance - fit.deviance);
  const dispersion = input.family === 'poisson' ? pearson(input.family, data(input), fit.mu) / (n - k) : 1;
  const zCrit = normalQuantile(1 - (1 - input.level) / 2);
  const coxSnell = 1 - Math.exp((2 / n) * (nullFit.logLik - fit.logLik));
  const binary = input.family === 'logistic' && !input.trials;
  return {
    family: input.family,
    n,
    fit,
    coefs: coefficients(input, fit, 1, zCrit),
    nullDeviance: nullFit.deviance,
    nullLogLik: nullFit.logLik,
    lr,
    lrDf: k - 1,
    lrP: chiSquareUpper(lr, k - 1),
    aic: -2 * fit.logLik + 2 * k,
    bic: -2 * fit.logLik + Math.log(n) * k,
    mcFadden: 1 - fit.logLik / nullFit.logLik,
    coxSnell,
    nagelkerke: coxSnell / (1 - Math.exp((2 / n) * nullFit.logLik)),
    terms: termTests(input, fit),
    dispersion,
    zCrit,
    ...(binary ? binaryExtras(input, fit) : {}),
  };
}

/** Confusion-table rates: accuracy, sensitivity (recall), specificity, and precision. */
export function rates(t: Classification) {
  const n = t.tp + t.fp + t.fn + t.tn;
  return {
    accuracy: (t.tp + t.tn) / n,
    sensitivity: t.tp / (t.tp + t.fn),
    specificity: t.tn / (t.tn + t.fp),
    precision: t.tp / (t.tp + t.fp),
  };
}
