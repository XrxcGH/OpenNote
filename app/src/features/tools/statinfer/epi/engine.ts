// The epidemiology tool's reports: measures of effect from a 2 × 2 table, stratified Mantel-Haenszel analysis,
// diagnostic accuracy with post-test probabilities, rates and rate ratios, standardization, and simple proportions.
import type { PlotSpec } from '../plot';
import { num, pTex, pText, step, tex, type Cell, type Report } from '../report';
import {
  accuracy,
  compareRates,
  directRate,
  effect,
  mantelHaenszel,
  postTest,
  proportion,
  smr,
  type Estimate,
  type Stratum,
  type TwoByTwo,
} from './stats';

const ci = (e: Estimate, digits = 5): string =>
  Number.isFinite(e.lower) && Number.isFinite(e.upper) ? `${num(e.lower, digits)} to ${num(e.upper, digits)}` : '—';
const pct = (confidence: number) => `${num(confidence * 100, 4)}%`;
const twoTable = (t: TwoByTwo): Cell[][] => [
  [{ key: 'exposed' }, t.a, t.b, t.a + t.b],
  [{ key: 'unexposed' }, t.c, t.d, t.c + t.d],
  [{ key: 'total' }, t.a + t.c, t.b + t.d, t.a + t.b + t.c + t.d],
];

/** Measures of effect from a cohort or cross-sectional 2 × 2 table. */
export function cohortReport(t: TwoByTwo, confidence: number): Report {
  const e = effect(t, confidence);
  const harm = e.rd.value > 0;
  const nnRow: Cell[] = [
    { key: harm ? 'nnh' : 'nnt' },
    e.nn,
    e.nnInterval ? `${num(e.nnInterval.lower, 4)} to ${num(e.nnInterval.upper, 4)}` : '—',
  ];
  return {
    answer: {
      key: 'cohort',
      vars: { rr: num(e.rr.value, 4), ci: ci(e.rr, 4), or: num(e.or.value, 4), level: pct(confidence) },
      latex: `\\mathrm{RR} = ${tex(e.rr.value, 4)}\\ (${tex(e.rr.lower, 4)},\\ ${tex(e.rr.upper, 4)})`,
    },
    tables: [
      { title: 'twoByTwo', columns: [{ text: '' }, 'cases', 'nonCases', 'total'], rows: twoTable(t) },
      {
        title: 'effectMeasures',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'riskExposed' }, e.riskExposed, ''],
          [{ key: 'riskUnexposed' }, e.riskUnexposed, ''],
          [{ key: 'riskRatio' }, e.rr.value, ci(e.rr)],
          [{ key: 'oddsRatio' }, e.or.value, ci(e.or)],
          [{ key: 'riskDifference' }, e.rd.value, ci(e.rd)],
          nnRow,
          [{ key: 'afExposed' }, e.afExposed, ''],
          [{ key: 'paf' }, e.paf, ''],
        ],
      },
    ],
    steps: [
      step(
        'eRisks',
        `R_1 = \\frac{a}{a+b} = \\frac{${t.a}}{${t.a + t.b}} = ${tex(e.riskExposed)},\\quad R_0 = \\frac{c}{c+d}` +
          ` = \\frac{${t.c}}{${t.c + t.d}} = ${tex(e.riskUnexposed)}`,
      ),
      step(
        'eRr',
        `\\mathrm{SE}(\\ln \\mathrm{RR}) = \\sqrt{\\tfrac1a - \\tfrac1{a+b} + \\tfrac1c - \\tfrac1{c+d}}` +
          ` = ${tex(e.seLogRr)}`,
      ),
      step(
        'eBack',
        `\\exp\\!\\left(\\ln ${tex(e.rrCentre, 4)} \\pm z\\,${tex(e.seLogRr, 4)}\\right)` +
          ` = ${tex(e.rr.lower, 4)},\\ ${tex(e.rr.upper, 4)}`,
      ),
      step(
        'eOr',
        `\\mathrm{OR} = \\frac{ad}{bc} = ${tex(e.or.value)},\\quad \\mathrm{SE}(\\ln \\mathrm{OR})` +
          ` = \\sqrt{\\tfrac1a + \\tfrac1b + \\tfrac1c + \\tfrac1d} = ${tex(e.seLogOr)}`,
      ),
      step(
        'eRd',
        `\\mathrm{RD} = R_1 - R_0 = ${tex(e.rd.value)},\\quad \\mathrm{NN} = 1/|\\mathrm{RD}| = ${tex(e.nn, 4)}`,
      ),
      step(e.rr.value >= 1 ? 'eSayMore' : 'eSayLess', undefined, {
        rr: num(e.rr.value, 3),
        inverse: num(1 / e.rr.value, 3),
      }),
    ],
    notes: e.corrected ? [{ key: 'halfAdded' }] : [],
  };
}

/** Mantel-Haenszel pooled measures over strata of 2 × 2 tables. */
export function strataReport(strata: readonly TwoByTwo[], confidence: number): Report {
  const p = mantelHaenszel(strata, confidence);
  const rows: Cell[][] = strata.map((t, i) => [
    `${i + 1}`,
    `${t.a}, ${t.b}, ${t.c}, ${t.d}`,
    p.strata[i].or,
    p.strata[i].rr,
  ]);
  return {
    answer: {
      key: 'strata',
      vars: { or: num(p.orMh.value, 5), ci: ci(p.orMh, 4), level: pct(confidence), p: pText(p.pBreslowDay) },
      latex: `\\mathrm{OR}_{MH} = ${tex(p.orMh.value)}\\ (${tex(p.orMh.lower, 4)},\\ ${tex(p.orMh.upper, 4)})`,
    },
    tables: [
      { title: 'strata', columns: ['stratum', 'cells', 'oddsRatio', 'riskRatio'], rows },
      {
        title: 'pooled',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'crudeOr' }, p.crude, ''],
          [{ key: 'orMh' }, p.orMh.value, ci(p.orMh)],
          [{ key: 'rrMh' }, p.rrMh, ''],
        ],
      },
      {
        title: 'tests',
        columns: ['test', 'statistic', 'df', 'p'],
        rows: [
          [{ key: 'cmh' }, p.cmh, 1, p.pCmh],
          [{ key: 'breslowDay' }, p.breslowDay, p.df, p.pBreslowDay],
        ],
      },
    ],
    steps: [
      step('eMh', `\\mathrm{OR}_{MH} = \\frac{\\sum a_i d_i / n_i}{\\sum b_i c_i / n_i} = ${tex(p.orMh.value)}`),
      step('eRbg', `(${tex(p.orMh.lower, 4)},\\ ${tex(p.orMh.upper, 4)})`),
      step('eCmh', `\\chi^2_{MH} = ${tex(p.cmh)},\\ ${pTex(p.pCmh)}`),
      step('eBd', `\\chi^2_{BD}(${p.df}) = ${tex(p.breslowDay)},\\ ${pTex(p.pBreslowDay)}`),
      step(p.pBreslowDay < 0.05 ? 'eBdDiffer' : 'eBdSame'),
    ],
  };
}

function faganPlot(sens: number, spec: number, prior: number): PlotSpec {
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  const pos = xs.map((x) => ({ x, y: postTest(sens, spec, x).positive }));
  const neg = xs.map((x) => ({ x, y: postTest(sens, spec, x).negative }));
  const at = postTest(sens, spec, prior);
  return {
    title: 'postTest',
    x: { label: 'preTest', min: 0, max: 1 },
    y: { label: 'postTestAxis', min: 0, max: 1 },
    marks: [
      { kind: 'line', tone: 0, points: pos },
      { kind: 'line', tone: 1, points: neg, dashed: true },
      { kind: 'points', tone: 0, points: [{ x: prior, y: at.positive }] },
      { kind: 'points', tone: 1, points: [{ x: prior, y: at.negative }] },
      { kind: 'vline', x: prior },
    ],
  };
}

/** Diagnostic accuracy from a test-by-disease 2 × 2 table, and the post-test probabilities at a prevalence. */
export function diagnosticReport(
  cells: { tp: number; fn: number; fp: number; tn: number },
  prior: number | null,
  confidence: number,
  words: { positive: string; negative: string },
): Report {
  const a = accuracy(cells.tp, cells.fn, cells.fp, cells.tn, confidence);
  const p = prior ?? a.prevalence;
  const post = postTest(a.sensitivity.value, a.specificity.value, p);
  const plot = faganPlot(a.sensitivity.value, a.specificity.value, p);
  const ppvDenominator = a.sensitivity.value * p + (1 - a.specificity.value) * (1 - p);
  return {
    answer: {
      key: 'diagnostic',
      vars: {
        sens: num(a.sensitivity.value, 4),
        spec: num(a.specificity.value, 4),
        ppv: num(post.positive, 4),
        prev: num(p, 4),
      },
      latex:
        `\\mathrm{Se} = ${tex(a.sensitivity.value, 4)},\\ \\mathrm{Sp}` +
        ` = ${tex(a.specificity.value, 4)},\\ \\mathrm{PPV} = ${tex(post.positive, 4)}`,
    },
    tables: [
      {
        title: 'accuracyTable',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'sensitivity' }, a.sensitivity.value, ci(a.sensitivity)],
          [{ key: 'specificity' }, a.specificity.value, ci(a.specificity)],
          [{ key: 'ppvSample' }, a.ppv.value, ci(a.ppv)],
          [{ key: 'npvSample' }, a.npv.value, ci(a.npv)],
          [{ key: 'lrPositive' }, a.lrPositive.value, ci(a.lrPositive)],
          [{ key: 'lrNegative' }, a.lrNegative.value, ci(a.lrNegative)],
          [{ key: 'accuracy' }, a.accuracy.value, ci(a.accuracy)],
          [{ key: 'youden' }, a.youden, ''],
          [{ key: 'ppvAt' }, post.positive, ''],
          [{ key: 'npvAt' }, 1 - post.negative, ''],
        ],
      },
    ],
    steps: [
      step(
        'eSens',
        `\\mathrm{Se} = \\frac{TP}{TP + FN} = \\frac{${cells.tp}}{${cells.tp + cells.fn}}` +
          ` = ${tex(a.sensitivity.value)},\\quad \\mathrm{Sp} = \\frac{TN}{TN + FP}` +
          ` = \\frac{${cells.tn}}{${cells.tn + cells.fp}} = ${tex(a.specificity.value)}`,
      ),
      step(
        'eLr',
        `LR^+ = \\frac{\\mathrm{Se}}{1 - \\mathrm{Sp}} = ${tex(a.lrPositive.value)},\\quad LR^-` +
          ` = \\frac{1 - \\mathrm{Se}}{\\mathrm{Sp}} = ${tex(a.lrNegative.value)}`,
      ),
      step(
        'ePpv',
        `\\mathrm{PPV} = \\frac{\\mathrm{Se}\\,p}{\\mathrm{Se}\\,p + (1 - \\mathrm{Sp})(1 - p)}` +
          ` = \\frac{${tex(a.sensitivity.value, 4)} \\cdot ${tex(p, 4)}}{${tex(ppvDenominator, 4)}}` +
          ` = ${tex(post.positive)}`,
        { prev: num(p, 4) },
      ),
      step('eWilson', undefined, { level: pct(confidence) }),
    ],
    plots: [{ ...plot, legend: [words.positive, words.negative] }],
  };
}

/** Incidence rates in two groups, their ratio, and their difference. */
export function ratesReport(c1: number, t1: number, c0: number, t0: number, per: number, confidence: number): Report {
  const r = compareRates(c1, t1, c0, t0, confidence);
  const scaled = (e: Estimate): Cell[] => [e.value * per, `${num(e.lower * per, 5)} to ${num(e.upper * per, 5)}`];
  return {
    answer: {
      key: 'rates',
      vars: { ratio: num(r.ratio.value, 4), ci: ci(r.ratio, 4), level: pct(confidence) },
      latex: `\\mathrm{IRR} = ${tex(r.ratio.value, 4)}\\ (${tex(r.ratio.lower, 4)},\\ ${tex(r.ratio.upper, 4)})`,
    },
    tables: [
      {
        title: 'rateTable',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'rateGroup1' }, ...scaled(r.rate1)],
          [{ key: 'rateGroup0' }, ...scaled(r.rate0)],
          [{ key: 'rateRatio' }, r.ratio.value, ci(r.ratio)],
          [{ key: 'rateDifference' }, ...scaled(r.difference)],
        ],
      },
    ],
    steps: [
      step(
        'eRate',
        `I_1 = \\frac{${c1}}{${num(t1)}} = ${tex(r.rate1.value)},\\quad I_0 = \\frac{${c0}}{${num(t0)}}` +
          ` = ${tex(r.rate0.value)}`,
      ),
      step('eGarwood'),
      step('eIrr', `\\mathrm{IRR} = I_1 / I_0 = ${tex(r.ratio.value)}`),
    ],
    notes: [{ key: 'perUnits', vars: { per: num(per) } }],
  };
}

/** Direct standardization of rates by strata to a standard's weights. */
export function directReport(
  strata: readonly Stratum[],
  standard: readonly number[],
  per: number,
  confidence: number,
): Report {
  const d = directRate(strata, standard, confidence);
  const rows: Cell[][] = strata.map((s, k) => [s.label, s.cases, s.time, d.rates[k] * per, d.weights[k]]);
  const terms = d.weights.map((w, k) => `${tex(w, 4)} \\cdot ${tex(d.rates[k] * per, 4)}`);
  return {
    answer: {
      key: 'direct',
      vars: { rate: num(d.rate.value * per), per: num(per), crude: num(d.crude * per) },
      latex: `\\text{adjusted rate} = ${tex(d.rate.value * per)} \\text{ per } ${tex(per)}`,
    },
    tables: [
      { title: 'strataRates', columns: ['stratum', 'cases', 'personTime', 'rate', 'weight'], rows },
      {
        title: 'adjusted',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'crudeRate' }, d.crude * per, ''],
          [
            { key: 'adjustedRate' },
            d.rate.value * per,
            `${num(d.rate.lower * per, 5)} to ${num(d.rate.upper * per, 5)}`,
          ],
        ],
      },
    ],
    steps: [
      step('eWeights'),
      step(
        'eDirect',
        `\\sum_k w_k r_k = ${terms.length > 4 ? `${terms.slice(0, 3).join(' + ')} + \\cdots` : terms.join(' + ')}` +
          ` = ${tex(d.rate.value * per)}`,
      ),
      step('eDirectCi', undefined, { level: pct(confidence) }),
    ],
    plots: [
      {
        title: 'rateByStratum',
        x: { label: 'stratum', categories: strata.map((s) => s.label) },
        y: { label: 'rate', min: 0 },
        marks: [{ kind: 'bars', bars: d.rates.map((r, k) => ({ x0: k - 0.35, x1: k + 0.35, y: r * per })) }],
      },
    ],
    notes: [{ key: 'perUnits', vars: { per: num(per) } }],
  };
}

/** Indirect standardization: the standardized mortality (or morbidity) ratio. */
export function indirectReport(
  observed: number,
  strata: readonly { rate: number; time: number }[],
  confidence: number,
): Report {
  const expectedCount = strata.reduce((sum, s) => sum + s.rate * s.time, 0);
  const s = smr(observed, expectedCount, confidence);
  return {
    answer: {
      key: 'smr',
      vars: { smr: num(s.smr.value, 5), ci: ci(s.smr, 5), level: pct(confidence) },
      latex: `\\mathrm{SMR} = \\frac{O}{E} = \\frac{${observed}}{${tex(expectedCount)}} = ${tex(s.smr.value)}`,
    },
    tables: [
      {
        title: 'smrTable',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'observed' }, observed, ''],
          [{ key: 'expected' }, expectedCount, ''],
          [{ key: 'smrRow' }, s.smr.value, ci(s.smr)],
        ],
      },
    ],
    steps: [
      step('eExpected', `E = \\sum_k R_k\\,T_k = ${tex(expectedCount)}`),
      step(
        'eSmr',
        `\\mathrm{SMR}` +
          ` = ${tex(s.smr.value)},\\quad \\left(\\frac{\\chi^2_{\\alpha/2}(2O)}{2E},\\ ` +
          `\\frac{\\chi^2_{1-\\alpha/2}(2O+2)}{2E}\\right)` +
          ` = (${tex(s.smr.lower)},\\ ${tex(s.smr.upper)})`,
      ),
    ],
  };
}

/** A simple proportion such as a prevalence, attack rate, or case fatality, with its intervals. */
export function proportionReport(cases: number, total: number, confidence: number): Report {
  const p = proportion(cases, total, confidence);
  return {
    answer: {
      key: 'proportion',
      vars: {
        p: num(p.value, 5),
        pct: num(p.value * 100, 4),
        lo: num(p.wilson.lower, 4),
        hi: num(p.wilson.upper, 4),
        level: pct(confidence),
      },
      latex: `\\hat p = \\frac{${cases}}{${total}} = ${tex(p.value)}`,
    },
    tables: [
      {
        title: 'proportionTable',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'wilsonInterval' }, p.value, `${num(p.wilson.lower, 5)} to ${num(p.wilson.upper, 5)}`],
          [{ key: 'exactInterval' }, p.value, `${num(p.exact.lower, 5)} to ${num(p.exact.upper, 5)}`],
        ],
      },
    ],
    steps: [step('eProportion', `\\hat p = ${tex(p.value)}`)],
  };
}
