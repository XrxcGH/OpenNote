// The multivariate tool's cluster pictures, and its heat map and Gaussian mixture outcomes. The heat map orders rows
// and columns by their trees (heatmap.ts) and lists the cells in that order, so the table says everything the colors
// do. The mixture is fitted by EM (mixture.ts) for each k up to the largest asked for, so BIC can compare them.
import type { Outcome, Picture, Values } from '../kit/spec';
import { StatError, step } from '../kit/types';
import type { Linkage, Metric } from './cluster';
import { clusteredHeatMap, heatMapDrawing } from './heatmap';
import { gaussianMixture, type Mixture } from './mixture';
import { literal, readColumns } from './read';

const metricOf = (v: Values): Metric =>
  v.metric === 'pearson' ? 'correlation' : v.metric === 'manhattan' ? 'manhattan' : 'euclidean';

export function clusterScatter(
  x: readonly number[][],
  cluster: readonly number[],
  centers?: readonly number[][],
): Picture {
  const k = Math.max(...cluster) + 1;
  return {
    id: 'clusters',
    type: 'plot',
    plot: {
      x: { label: 'first' },
      y: { label: 'second' },
      series: [
        ...Array.from({ length: k }, (_, c) => ({
          id: `c${c}`,
          name: `${c + 1}`,
          style: 'points' as const,
          pen: c,
          points: x.filter((_, i) => cluster[i] === c).map((r) => [r[0], r[1]] as [number, number]),
        })),
        ...(centers
          ? [
              {
                id: 'centers',
                pen: 4,
                style: 'points' as const,
                points: centers.map((c) => [c[0], c[1]] as [number, number]),
              },
            ]
          : []),
      ],
      legend: true,
    },
  };
}

export function heatmapOutcome(values: Values): Outcome {
  const z = values.standardize === 'z';
  const { x, names, labels } = readColumns(values, false);
  const linkage = String(values.linkage) as Linkage;
  const metric = metricOf(values);
  const map = clusteredHeatMap(x, linkage, metric, z);
  const rows = map.rowOrder.map((r) => labels[r]);
  const cols = map.colOrder.map((c) => names[c]);
  return {
    rows: [
      { id: 'rowOrder', value: rows.join(', '), answer: true },
      { id: 'colOrder', value: cols.join(', ') },
      { id: 'heatLow', value: map.mid - map.half },
      { id: 'heatHigh', value: map.mid + map.half },
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'heat',
        columns: ['row', ...literal(cols)],
        rows: map.rowOrder.map((r) => [labels[r], ...map.colOrder.map((c) => map.values[r][c])]),
      },
    ],
    steps: [
      step(z ? 'multivariate.standardize' : 'multivariate.heatRaw'),
      step('multivariate.distances', undefined, { metric }),
      step('multivariate.heatTrees', undefined, { linkage }),
      step('multivariate.heatOrder'),
      step('multivariate.heatColor', 't = \\frac{v - [[mid]]}{[[half]]}', { mid: map.mid, half: map.half }),
    ],
    words: step('multivariate.wordsHeat', undefined, {
      first: rows[0],
      last: rows[rows.length - 1],
      cols: cols.join(', '),
    }),
    pictures: [{ id: 'heatmap', type: 'draw', draw: heatMapDrawing(map, labels, names) }],
    notes: [z ? 'standardized' : 'sameUnits', 'heatKey'],
  };
}

export function gmmOutcome(values: Values): Outcome {
  const { x, names, labels } = readColumns(values, values.standardize === 'z');
  const k = Number(values.k);
  const seed = Number(values.seed);
  const fit = gaussianMixture(x, k, seed);
  const kmax = Math.min(Number(values.kmax), x.length - 1);
  const byK = Array.from({ length: kmax }, (_, i): Mixture | null => {
    try {
      return i + 1 === k ? fit : gaussianMixture(x, i + 1, seed);
    } catch (e) {
      // A k whose fit collapses is left out of the comparison, not an error for the k asked for.
      if (e instanceof StatError) return null;
      throw e;
    }
  });
  const fitted = byK.flatMap((m, i) => (m ? [[i + 1, m.bic] as [number, number]] : []));
  const bestK = fitted.reduce((best, row) => (row[1] < best[1] ? row : best), fitted[0])[0];
  const certainty = fit.resp.map((r) => Math.max(...r));
  return {
    rows: [
      { id: 'logLik', value: fit.logLik, sym: '\\ell', answer: true },
      { id: 'bic', value: fit.bic, sym: '\\mathrm{BIC}' },
      { id: 'aic', value: fit.aic },
      { id: 'bestK', value: bestK },
      { id: 'iterations', value: fit.iterations },
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'components',
        columns: ['cluster', 'weight', ...literal(names)],
        rows: fit.means.map((m, c) => [`${c + 1}`, fit.weights[c], ...m]),
      },
      {
        id: 'members',
        columns: ['row', 'cluster', 'probability'],
        rows: labels.map((l, i) => [l, fit.cluster[i] + 1, certainty[i]]),
      },
      { id: 'bicByK', columns: ['k', 'bic'], rows: byK.map((m, i) => [i + 1, m ? m.bic : NaN]) },
    ],
    steps: [
      step('multivariate.gmmStart', undefined, { k, seed }),
      step(
        'multivariate.gmmE',
        'r_{ic} = \\frac{\\pi_c\\, N(x_i \\mid \\mu_c, \\Sigma_c)}{\\sum_j \\pi_j\\, N(x_i \\mid \\mu_j, \\Sigma_j)}',
      ),
      step(
        'multivariate.gmmM',
        'N_c = \\sum_i r_{ic},\\ \\pi_c = \\frac{N_c}{n},\\ \\mu_c = \\frac{1}{N_c}\\sum_i r_{ic} x_i,\\ ' +
          '\\Sigma_c = \\frac{1}{N_c}\\sum_i r_{ic}(x_i - \\mu_c)(x_i - \\mu_c)^\\top',
      ),
      step('multivariate.gmmConverge', '\\ell = \\sum_i \\log \\sum_c \\pi_c N(x_i \\mid \\mu_c, \\Sigma_c) = [[ll]]', {
        iterations: fit.iterations,
        ll: fit.logLik,
      }),
      step('multivariate.gmmBic', '\\mathrm{BIC} = -2\\ell + p \\ln n = [[bic]]', { p: fit.params, bic: fit.bic }),
    ],
    words: step('multivariate.wordsGmm', undefined, { k, bic: fit.bic, best: bestK }),
    pictures: [
      clusterScatter(x, fit.cluster, fit.means),
      {
        id: 'bicPlot',
        type: 'plot',
        plot: { x: { label: 'k' }, y: { label: 'bic' }, series: [{ id: 'bic', points: fitted }], vlines: [k] },
      },
      {
        id: 'logLikPlot',
        type: 'plot',
        plot: {
          x: { label: 'round' },
          y: { label: 'logLik' },
          series: [{ id: 'logLik', points: fit.history.map((v, i) => [i, v] as [number, number]) }],
        },
      },
    ],
    notes: [values.standardize === 'z' ? 'standardized' : 'sameUnits', 'gmmLocal'],
  };
}
