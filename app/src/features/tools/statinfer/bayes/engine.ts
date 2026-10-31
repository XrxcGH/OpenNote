// The Bayesian updating tool's reports. Each shows the prior and the data, the update rule with numbers, and the
// posterior's summaries, with a plot of the prior and the posterior where there is one.
import type { PlotSpec } from '../plot';
import { num, step, tex, type Cell, type KitTable, type Report } from '../report';
import {
  bayesTable,
  betaBinomial,
  densities,
  dirichlet,
  gammaPoisson,
  gridPosterior,
  jzs,
  metropolis,
  normalInverseGamma,
  normalKnown,
  type Summary,
} from './stats';

const pct = (level: number) => `${num(level * 100, 4)}%`;

function summaryTable(
  s: Summary,
  title: 'posteriorSummary' | 'meanPosterior' | 'variancePosterior' = 'posteriorSummary',
): KitTable {
  return {
    title,
    columns: ['measure', 'value'],
    rows: [
      [{ key: 'mean' }, s.mean],
      [{ key: 'median' }, s.median],
      [{ key: 'posteriorMode' }, s.mode],
      [{ key: 'sd' }, s.sd],
      [{ key: 'equalTailed' }, `${num(s.lower)} to ${num(s.upper)}`],
      [{ key: 'hdiInterval' }, `${num(s.hdiLower)} to ${num(s.hdiUpper)}`],
    ],
  };
}

function curves(
  title: 'betaCurves' | 'normalCurves' | 'gammaCurves' | 'gridCurves',
  xs: readonly number[],
  prior: (x: number) => number,
  post: (x: number) => number,
  words: readonly string[],
): PlotSpec {
  return {
    title,
    legend: words,
    x: { label: 'parameter' },
    y: { label: 'density', min: 0 },
    marks: [
      { kind: 'line', tone: 0, dashed: true, points: xs.map((x) => ({ x, y: prior(x) })) },
      { kind: 'line', tone: 1, points: xs.map((x) => ({ x, y: post(x) })) },
    ],
  };
}

const span = (lo: number, hi: number, count = 201) =>
  Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));

export function betaReport(
  a: number,
  b: number,
  s: number,
  f: number,
  level: number,
  theta0: number | null,
  words: readonly string[],
): Report {
  const u = betaBinomial(a, b, s, f, level, theta0);
  const xs = span(0.0025, 0.9975);
  return {
    answer: {
      key: 'beta',
      vars: {
        a: num(u.a),
        b: num(u.b),
        mean: num(u.summary.mean),
        lo: num(u.summary.lower, 5),
        hi: num(u.summary.upper, 5),
        level: pct(level),
      },
      latex: `\\theta \\mid \\text{data} \\sim \\mathrm{Beta}(${tex(u.a)},\\ ${tex(u.b)})`,
    },
    tables: [
      summaryTable(u.summary),
      {
        title: 'predictiveTable',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'nextSuccess' }, u.predictive],
          ...(u.bf10 === null ? [] : [[{ key: 'bf10' }, u.bf10] as Cell[], [{ key: 'bf01' }, 1 / u.bf10] as Cell[]]),
        ],
      },
    ],
    steps: [
      step(
        'yBeta',
        `\\mathrm{Beta}(a + s,\\ b + f) = \\mathrm{Beta}(${num(a)} + ${s},\\ ${num(b)} + ${f})` +
          ` = \\mathrm{Beta}(${tex(u.a)},\\ ${tex(u.b)})`,
      ),
      step('yBetaMean', `E[\\theta] = \\frac{a'}{a' + b'} = ${tex(u.summary.mean)}`),
      step('yIntervals', undefined, { level: pct(level) }),
      ...(u.bf10 === null
        ? []
        : [
            step('ySavage', `BF_{10} = \\frac{p(\\theta_0)}{p(\\theta_0 \\mid \\text{data})} = ${tex(u.bf10)}`, {
              theta: num(theta0 ?? 0),
            }),
          ]),
    ],
    plots: [
      curves(
        'betaCurves',
        xs,
        (x) => densities.betaPdf(x, a, b),
        (x) => densities.betaPdf(x, u.a, u.b),
        words,
      ),
    ],
  };
}

export function normalReport(
  mu0: number,
  tau0: number,
  xbar: number,
  n: number,
  sigma: number,
  level: number,
  words: readonly string[],
): Report {
  const u = normalKnown(mu0, tau0, xbar, n, sigma, level);
  const sd = Math.sqrt(u.variance);
  const lo = Math.min(mu0 - 3 * tau0, u.mean - 4 * sd);
  const hi = Math.max(mu0 + 3 * tau0, u.mean + 4 * sd);
  return {
    answer: {
      key: 'normal',
      vars: {
        mean: num(u.mean),
        variance: num(u.variance),
        lo: num(u.summary.lower, 5),
        hi: num(u.summary.upper, 5),
        level: pct(level),
      },
      latex: `\\mu \\mid \\text{data} \\sim N(${tex(u.mean)},\\ ${tex(u.variance)})`,
    },
    tables: [
      summaryTable(u.summary),
      {
        title: 'predictiveTable',
        columns: ['measure', 'value'],
        rows: [[{ key: 'predictiveVariance' }, u.predictiveVariance]],
      },
    ],
    steps: [
      step(
        'yPrecision',
        `\\frac{1}{\\tau_n^2} = \\frac{1}{\\tau_0^2} + \\frac{n}{\\sigma^2}` +
          ` = \\frac{1}{${tex(tau0 ** 2)}} + \\frac{${n}}{${tex(sigma ** 2)}} = ${tex(1 / u.variance)}`,
      ),
      step(
        'yNormalMean',
        `\\mu_n = \\tau_n^2\\left(\\frac{\\mu_0}{\\tau_0^2} + \\frac{n\\bar x}{\\sigma^2}\\right) = ${tex(u.mean)}`,
      ),
      step('yIntervals', undefined, { level: pct(level) }),
    ],
    plots: [
      curves(
        'normalCurves',
        span(lo, hi),
        (x) => densities.normalPdf(x, mu0, tau0),
        (x) => densities.normalPdf(x, u.mean, sd),
        words,
      ),
    ],
  };
}

export function nigReport(
  mu0: number,
  kappa0: number,
  alpha0: number,
  beta0: number,
  n: number,
  xbar: number,
  s2: number,
  level: number,
): Report {
  const u = normalInverseGamma(mu0, kappa0, alpha0, beta0, n, xbar, s2, level);
  return {
    answer: {
      key: 'nig',
      vars: {
        mu: num(u.mu),
        lo: num(u.meanSummary.lower, 5),
        hi: num(u.meanSummary.upper, 5),
        level: pct(level),
        v: num(u.varianceSummary.median, 5),
      },
      latex:
        `\\mu_n = ${tex(u.mu)},\\ \\kappa_n = ${tex(u.kappa)},\\ \\alpha_n = ${tex(u.alpha)},\\ \\beta_n` +
        ` = ${tex(u.beta)}`,
    },
    tables: [summaryTable(u.meanSummary, 'meanPosterior'), summaryTable(u.varianceSummary, 'variancePosterior')],
    steps: [
      step(
        'yNig',
        `\\kappa_n = ${tex(u.kappa)},\\quad \\mu_n = \\frac{\\kappa_0\\mu_0 + n\\bar x}{\\kappa_n}` +
          ` = ${tex(u.mu)},\\quad \\alpha_n = \\alpha_0 + \\tfrac n2 = ${tex(u.alpha)}`,
      ),
      step(
        'yNigBeta',
        `\\beta_n = \\beta_0 + \\tfrac12(n-1)s^2 + \\frac{\\kappa_0 n(\\bar x - \\mu_0)^2}{2\\kappa_n}` +
          ` = ${tex(u.beta)}`,
      ),
      step(
        'yNigMarginal',
        `\\mu \\sim t_{${tex(2 * u.alpha)}}\\!\\left(${tex(u.mu)},\\ \\tfrac{\\beta_n}{\\alpha_n\\kappa_n}\\right)`,
      ),
    ],
  };
}

export function gammaReport(
  a: number,
  b: number,
  total: number,
  n: number,
  level: number,
  words: readonly string[],
): Report {
  const u = gammaPoisson(a, b, total, n, level);
  const hi = Math.max(u.summary.upper * 1.6, (a / b) * 3);
  return {
    answer: {
      key: 'gamma',
      vars: {
        shape: num(u.shape),
        rate: num(u.rate),
        mean: num(u.summary.mean),
        lo: num(u.summary.lower, 5),
        hi: num(u.summary.upper, 5),
        level: pct(level),
      },
      latex: `\\lambda \\mid \\text{data} \\sim \\mathrm{Gamma}(${tex(u.shape)},\\ \\text{rate } ${tex(u.rate)})`,
    },
    tables: [
      summaryTable(u.summary),
      {
        title: 'predictiveCounts',
        columns: ['count', 'probability'],
        rows: u.predictive.slice(0, 15).map((p, k): Cell[] => [`${k}`, p]),
      },
    ],
    steps: [
      step(
        'yGamma',
        `\\mathrm{Gamma}(a + \\textstyle\\sum x,\\ b + n)` +
          ` = \\mathrm{Gamma}(${num(a)} + ${total},\\ ${num(b)} + ${num(n)})` +
          ` = \\mathrm{Gamma}(${tex(u.shape)},\\ ${tex(u.rate)})`,
      ),
      step('yGammaMean', `E[\\lambda] = \\frac{a'}{b'} = ${tex(u.summary.mean)}`),
      step('yNegBin'),
    ],
    plots: [
      curves(
        'gammaCurves',
        span(hi / 400, hi),
        (x) => densities.gammaPdf(x, a, 1 / b),
        (x) => densities.gammaPdf(x, u.shape, 1 / u.rate),
        words,
      ),
    ],
  };
}

export function dirichletReport(
  names: readonly string[],
  alpha: readonly number[],
  counts: readonly number[],
  level: number,
): Report {
  const parts = dirichlet(alpha, counts, level);
  return {
    answer: {
      key: 'dirichlet',
      vars: { shares: parts.map((p, i) => `${names[i]} ${num(p.summary.mean, 4)}`).join(', ') },
      latex: `\\mathrm{Dirichlet}(${parts.map((p) => tex(p.alpha)).join(',\\ ')})`,
    },
    tables: [
      {
        title: 'shares',
        columns: ['category', 'posteriorAlpha', 'mean', 'equalTailed'],
        rows: parts.map((p, i): Cell[] => [
          names[i],
          p.alpha,
          p.summary.mean,
          `${num(p.summary.lower)} to ${num(p.summary.upper)}`,
        ]),
      },
    ],
    steps: [step('yDirichlet'), step('yIntervals', undefined, { level: pct(level) })],
  };
}

export function jzsReport(t: number, n1: number, n2: number | null, r: number): Report {
  const bf = jzs(t, n1, n2, r);
  const strength =
    bf >= 100
      ? 'extreme'
      : bf >= 30
        ? 'veryStrong'
        : bf >= 10
          ? 'strong'
          : bf >= 3
            ? 'moderate'
            : bf > 1 / 3
              ? 'anecdotal'
              : 'forNull';
  return {
    answer: { key: 'jzs', vars: { bf: num(bf, 5), inverse: num(1 / bf, 5) }, latex: `BF_{10} = ${tex(bf, 5)}` },
    tables: [
      {
        title: 'bayesFactors',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'bf10' }, bf],
          [{ key: 'bf01' }, 1 / bf],
        ],
      },
    ],
    steps: [
      step(n2 === null ? 'yJzsOne' : 'yJzsTwo', undefined, { r: num(r) }),
      step(
        'yJzsIntegral',
        `BF_{10}` +
          ` = \\frac{\\int_0^\\infty (1 + Ngr^2)^{-1/2}` +
          `\\left(1 + \\frac{t^2}{(1 + Ngr^2)\\nu}\\right)^{-\\frac{\\nu+1}{2}} p(g)\\,dg}` +
          `{\\left(1 + \\frac{t^2}{\\nu}\\right)^{-\\frac{\\nu+1}{2}}}` +
          ` = ${tex(bf, 5)}`,
      ),
      step(`yStrength_${strength}` as const),
    ],
  };
}

export function gridReport(
  prior: string,
  likelihood: string,
  lo: number,
  hi: number,
  points: number,
  level: number,
  words: readonly string[],
): Report {
  const g = gridPosterior(prior, likelihood, lo, hi, points, level);
  const every = Math.max(1, Math.floor(g.xs.length / 400));
  const xs = g.xs.filter((_, i) => i % every === 0);
  const idx = (x: number) => g.xs.indexOf(x);
  return {
    answer: {
      key: 'grid',
      vars: { mean: num(g.mean), lo: num(g.lower, 5), hi: num(g.upper, 5), level: pct(level) },
      latex: `E[\\theta] = ${tex(g.mean)}`,
    },
    tables: [
      {
        title: 'posteriorSummary',
        columns: ['measure', 'value'],
        rows: [
          [{ key: 'mean' }, g.mean],
          [{ key: 'posteriorMode' }, g.mode],
          [{ key: 'sd' }, g.sd],
          [{ key: 'equalTailed' }, `${num(g.lower)} to ${num(g.upper)}`],
        ],
      },
    ],
    steps: [step('yGrid', undefined, { points: `${points}`, lo: num(lo), hi: num(hi) }), step('yGridNormalize')],
    plots: [
      curves(
        'gridCurves',
        xs,
        (x) => g.prior[idx(x)],
        (x) => g.posterior[idx(x)],
        words,
      ),
    ],
  };
}

export function metropolisReport(
  logDensity: string,
  names: readonly string[],
  start: readonly number[],
  stepSizes: readonly number[],
  iterations: number,
  burn: number,
  seed: bigint,
): Report {
  const c = metropolis(logDensity, names, start, stepSizes, iterations, burn, seed);
  const every = Math.max(1, Math.floor(c.samples.length / 2000));
  const trace = c.samples.filter((_, i) => i % every === 0).map((s, i) => ({ x: burn + i * every, y: s[0] }));
  return {
    answer: {
      key: 'metropolis',
      vars: { mean: num(c.means[0]), sd: num(c.sds[0], 4), rate: num(c.acceptance * 100, 3), seed: seed.toString() },
      latex: `E[${names[0] === 'theta' ? '\\theta' : names[0]}] \\approx ${tex(c.means[0])}`,
    },
    tables: [
      {
        title: 'chainTable',
        columns: ['parameter', 'mean', 'sd'],
        rows: names.map((name, j): Cell[] => [name, c.means[j], c.sds[j]]),
      },
      {
        title: 'autocorrelation',
        columns: ['lag', 'value'],
        rows: [1, 2, 5, 10, 20].map((lag): Cell[] => [`${lag}`, c.autocorrelation[lag]]),
      },
    ],
    steps: [
      step('yMetropolis', undefined, { iterations: `${iterations}`, burn: `${burn}`, seed: seed.toString() }),
      step('yAccept', undefined, { rate: num(c.acceptance * 100, 3) }),
    ],
    plots: [
      {
        title: 'trace',
        x: { label: 'iteration' },
        y: { label: 'parameter' },
        marks: [{ kind: 'line', points: trace }],
      },
    ],
  };
}

export function tableReport(rows: readonly { label: string; prior: number; likelihood: number }[]): Report {
  const t = bayesTable(rows);
  const best = t.posteriors.indexOf(Math.max(...t.posteriors));
  return {
    answer: {
      key: 'table',
      vars: { best: rows[best].label, p: num(t.posteriors[best], 5) },
      latex: `\\max_H P(H \\mid E) = ${tex(t.posteriors[best], 5)}`,
    },
    tables: [
      {
        title: 'bayesTable',
        columns: ['hypothesis', 'prior', 'likelihood', 'joint', 'posterior'],
        rows: rows.map((r, i): Cell[] => [r.label, t.priors[i], r.likelihood, t.joint[i], t.posteriors[i]]),
      },
    ],
    steps: [
      step('yJoint'),
      step('yEvidence', `P(E) = \\sum P(H)P(E \\mid H) = ${tex(t.evidence)}`),
      step('yPosterior', `P(H \\mid E) = \\frac{P(H)P(E \\mid H)}{P(E)}`),
    ],
  };
}
