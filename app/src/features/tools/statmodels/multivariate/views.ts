// The multivariate tool's cluster pictures and its heat map outcome. The heat map orders rows and columns by their
// trees (heatmap.ts) and lists the cells in that order, so the table says everything the colors do.
import type { Outcome, Picture, Values } from '../kit/spec';
import { step } from '../kit/types';
import type { Linkage, Metric } from './cluster';
import { clusteredHeatMap, heatMapDrawing } from './heatmap';
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
      step('multivariate.heatColor', 't = \frac{v - [[mid]]}{[[half]]}', { mid: map.mid, half: map.half }),
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
