// The rank-test tool's reports: two independent samples, paired samples, several groups, and blocks of treatments.
import type { Alternative } from '../../subjects/stats/dist';
import type { Adjustment } from '../num/adjust';
import type { Group } from '../num/data';
import { num, pTex, pText, step, tex, type Cell, type KitTable, type Report } from '../report';
import {
  friedman,
  hodgesLehmann,
  kolmogorovSmirnov,
  kruskalWallis,
  mannWhitney,
  signedRank,
  signTest,
  type PairwiseRow,
} from './stats';

const method = (exact: boolean) => ({ key: exact ? ('exact' as const) : ('normalApprox' as const) });

function pairTable(
  title: 'dunn' | 'conover' | 'nemenyi',
  rows: readonly PairwiseRow[],
  names: readonly string[],
): KitTable {
  return {
    title,
    columns: ['pair', 'statistic', 'p', 'pAdjusted'],
    rows: rows.map((r): Cell[] => [`${names[r.a]} − ${names[r.b]}`, r.statistic, r.p, r.adjusted]),
  };
}

/** Two independent samples: Mann-Whitney, Hodges-Lehmann, the rank-biserial r, and Kolmogorov-Smirnov. */
export function twoSampleReport(x: Group, y: Group, alternative: Alternative, confidence: number): Report {
  const u = mannWhitney(x.values, y.values, alternative);
  const hl = hodgesLehmann(x.values, y.values, confidence);
  const ks = kolmogorovSmirnov(x.values, y.values);
  const m = x.values.length;
  const n = y.values.length;
  return {
    answer: {
      key: 'mannWhitney',
      vars: { u: num(u.u1), p: pText(u.p), shift: num(hl.shift) },
      latex: `U = ${tex(u.u1)},\\; ${pTex(u.p)}`,
    },
    tables: [
      {
        title: 'tests',
        columns: ['test', 'statistic', 'p', 'method'],
        rows: [
          [{ key: 'mannWhitneyU' }, u.u1, u.p, method(u.exact)],
          [{ key: 'ksTest' }, ks.d, ks.p, method(ks.exact)],
        ],
      },
      {
        title: 'effects',
        columns: ['measure', 'value', 'interval'],
        rows: [
          [{ key: 'hlShift' }, hl.shift, Number.isFinite(hl.lower) ? `${num(hl.lower)} to ${num(hl.upper)}` : '—'],
          [{ key: 'rankBiserial' }, u.rankBiserial, ''],
        ],
      },
    ],
    steps: [
      step('rRankAll', `R_1 = ${tex(u.r1)},\\; R_2 = ${tex(u.r2)}`, { m: `${m}`, n: `${n}` }),
      step(
        'rU',
        `U_1 = R_1 - \\frac{m(m+1)}{2} = ${tex(u.r1)} - ${(m * (m + 1)) / 2} = ${tex(u.u1)},\\; U_2 = mn - U_1 = ${tex(u.u2)}`,
      ),
      u.exact
        ? step('rExact', pTex(u.p))
        : step('rNormal', `z = \\frac{|U_1 - mn/2| - \\tfrac12}{\\sigma_U} = ${tex(u.z, 5)},\\; ${pTex(u.p)}`),
      step('rHl', `\\hat\\Delta = \\operatorname{median}(x_i - y_j) = ${tex(hl.shift)}`, { count: `${m * n}` }),
      step(u.p < 0.05 ? 'rDiffer' : 'rNoDiffer', undefined, { a: x.label, b: y.label }),
    ],
    plots: [
      {
        title: 'ranksBox',
        x: { label: 'group', categories: [x.label, y.label] },
        y: { label: 'value' },
        marks: [
          {
            kind: 'points',
            points: [...x.values.map((v) => ({ x: 0, y: v })), ...y.values.map((v) => ({ x: 1, y: v }))],
          },
        ],
      },
    ],
  };
}

/** Paired samples: the Wilcoxon signed-rank test and the sign test on the differences x − y. */
export function pairedReport(diffs: readonly number[], zeros: 'wilcox' | 'pratt', alternative: Alternative): Report {
  const w = signedRank(diffs, zeros, alternative);
  const plus = diffs.filter((d) => d > 0).length;
  const nonzero = diffs.filter((d) => d !== 0).length;
  const sign = signTest(plus, nonzero, alternative);
  const shown = w.rows.slice(0, 100).map((r): Cell[] => [num(r.d), r.rank]);
  return {
    answer: {
      key: 'signedRank',
      vars: { w: num(Math.min(w.wPlus, w.wMinus)), p: pText(w.p), sign: pText(sign) },
      latex: `W^+ = ${tex(w.wPlus)},\\; W^- = ${tex(w.wMinus)},\\; ${pTex(w.p)}`,
    },
    tables: [
      {
        title: 'tests',
        columns: ['test', 'statistic', 'p', 'method'],
        rows: [
          [{ key: 'signedRankW' }, Math.min(w.wPlus, w.wMinus), w.p, method(w.exact)],
          [{ key: 'signTestRow' }, plus, sign, { key: 'exact' }],
          [{ key: 'rankBiserial' }, w.rankBiserial, '', ''],
        ],
      },
      { title: 'signedRanks', columns: ['difference', 'signedRank'], rows: shown },
    ],
    steps: [
      step('rDiffs', undefined, { n: `${w.n}`, zeros: `${w.zeros}`, method: zeros }),
      step('rW', `W^+ = ${tex(w.wPlus)},\\quad W^- = ${tex(w.wMinus)}`),
      w.exact ? step('rExact', pTex(w.p)) : step('rNormalW', `z = ${tex(w.z, 5)},\\; ${pTex(w.p)}`),
      step('rSign', `P = ${tex(sign)}`, { plus: `${plus}`, n: `${nonzero}` }),
    ],
  };
}

/** Several independent groups: Kruskal-Wallis with Dunn's pairwise tests. */
export function groupsReport(groups: readonly Group[], adjustment: Adjustment): Report {
  const kw = kruskalWallis(
    groups.map((g) => g.values),
    adjustment,
  );
  const names = groups.map((g) => g.label);
  const N = kw.sizes.reduce((a, b) => a + b, 0);
  return {
    answer: {
      key: 'kruskal',
      vars: { h: num(kw.h), df: `${kw.df}`, p: pText(kw.p) },
      latex: `H(${kw.df}) = ${tex(kw.h)},\\; ${pTex(kw.p)}`,
    },
    tables: [
      {
        title: 'rankSums',
        columns: ['group', 'n', 'rankSum', 'meanRank'],
        rows: groups.map((g, i): Cell[] => [g.label, kw.sizes[i], kw.sums[i], kw.sums[i] / kw.sizes[i]]),
      },
      pairTable('dunn', kw.dunn, names),
    ],
    steps: [
      step('rH', `H = \\frac{12}{N(N+1)}\\sum\\frac{R_i^2}{n_i} - 3(N+1),\\quad N = ${N}`),
      step('rTies', `C = 1 - \\frac{\\sum(t^3 - t)}{N^3 - N} = ${tex(kw.correction)},\\quad H = ${tex(kw.h)}`),
      step('tP', `df = ${kw.df},\\; ${pTex(kw.p)}`),
      step('rDunn', undefined, { method: adjustment }),
    ],
    notes: [{ key: 'epsilon', vars: { e: num(kw.epsilon2, 4) } }],
  };
}

/** Blocks by treatments: Friedman's test with Conover's and Nemenyi's follow-up tests. */
export function blocksReport(
  blocks: readonly (readonly number[])[],
  names: readonly string[],
  adjustment: Adjustment,
): Report {
  const f = friedman(blocks, adjustment);
  const k = f.sums.length;
  const labels = names.length === k ? names : f.sums.map((_, j) => `${j + 1}`);
  return {
    answer: {
      key: 'friedman',
      vars: { chi2: num(f.chi2), df: `${f.df}`, p: pText(f.p), w: num(f.kendallW, 4) },
      latex: `\\chi^2_r(${f.df}) = ${tex(f.chi2)},\\; ${pTex(f.p)}`,
    },
    tables: [
      {
        title: 'rankSums',
        columns: ['group', 'rankSum', 'meanRank'],
        rows: f.sums.map((s, j): Cell[] => [labels[j], s, s / f.blocks]),
      },
      pairTable('conover', f.conover, labels),
      pairTable('nemenyi', f.nemenyi, labels),
    ],
    steps: [
      step('rBlocks', undefined, { n: `${f.blocks}`, k: `${k}` }),
      step(
        'rFriedman',
        `\\chi^2_r = \\frac{12}{nk(k+1)}\\sum R_j^2 - 3n(k+1),\\quad C = ${tex(f.correction)},\\quad \\chi^2_r` +
          ` = ${tex(f.chi2)}`,
      ),
      step('tP', `df = ${f.df},\\; ${pTex(f.p)}`),
    ],
    notes: [{ key: 'kendallW', vars: { w: num(f.kendallW, 4) } }],
  };
}
