// The PCA, factors, and clusters tool. It takes several numeric columns, with an optional column of row names. It
// finds principal components, fits factors with rotation and parallel analysis, and clusters rows by k-means or by
// joining the closest pairs, and draws a clustered heat map. It also draws a map from a table of distances by
// classical scaling.
import { parseTable, type DataTable } from '../kit/data';
import { text as svgText, line, svg, W, type DrawContext } from '../kit/picture';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import {
  agglomerate,
  classicalMds,
  cutTree,
  distanceMatrix,
  kMeansBest,
  leafOrder,
  silhouette,
  type Linkage,
  type Merge,
  type Metric,
} from './cluster';
import { factorAnalysis, parallelAnalysis, pca, type Rotation } from './engine';
import { literal, readColumns } from './read';
import { clusterScatter, heatmapOutcome } from './views';

const SCORES =
  'student,reading,writing,math,science\nAva,78,82,65,70\nBen,62,60,88,85\nCal,90,91,72,75\nDee,55,58,60,62\n' +
  'Eli,70,75,92,90\nFay,85,80,58,61\nGus,66,64,79,83\nHal,74,77,70,68\nIva,58,55,84,80\nJon,88,86,66,64\n' +
  'Kim,60,63,90,93\nLee,80,84,74,72';
const ABILITIES =
  'vocab,reading,spelling,algebra,geometry,logic\n40,45,46,54,51,61\n56,58,59,49,58,60\n47,46,50,56,60,66\n' +
  '69,68,69,44,36,55\n40,35,33,43,70,40\n71,74,71,50,50,49\n47,46,52,51,49,47\n' +
  '61,56,55,58,54,53\n59,39,37,61,61,52\n41,39,46,46,52,53\n49,44,51,53,62,45\n' +
  '44,34,51,54,64,58\n58,52,54,56,46,44\n63,56,64,71,72,63\n28,24,28,38,46,40\n' +
  '38,41,39,48,49,58\n56,61,66,51,47,36\n69,55,58,57,52,49\n43,38,34,59,59,52\n' +
  '47,63,59,48,50,38\n51,49,62,67,61,55\n56,45,43,31,45,39\n26,42,44,38,45,35\n' +
  '46,32,36,43,41,23';
const POINTS = 'x,y\n1,1\n1.5,2\n3,4\n5,7\n3.5,5\n4.5,5\n3.5,4.5';
const CITIES = 'A,B,C,D\n0,3,4,6\n3,0,5,4\n4,5,0,3\n6,4,3,0';

const is =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(String(v.analysis));

const shown = (k: number) => Array.from({ length: k }, (_, i) => `PC${i + 1}`);

function pcaOutcome(values: Values): Outcome {
  const { x, names, labels } = readColumns(values, false);
  const corr = values.scale === 'correlation';
  const p = pca(x, corr);
  const k = Math.min(4, names.length);
  const pcs = shown(k);
  const kaiser = p.eigenvalues.filter((v) => v > 1).length;
  const scale =
    Math.max(...p.scores.map((s) => Math.hypot(s[0], s[1] ?? 0))) /
    Math.max(...p.vectors[0].map((_, j) => Math.hypot(p.vectors[0][j], p.vectors[1]?.[j] ?? 0)));
  return {
    rows: [
      { id: 'pc1', value: p.explained[0], answer: true },
      { id: 'pc2', value: p.explained[1] },
      { id: 'eigen1', value: p.eigenvalues[0], sym: '\\lambda_1' },
      { id: 'eigen2', value: p.eigenvalues[1], sym: '\\lambda_2' },
      ...(corr ? [{ id: 'kaiser', value: kaiser }] : []),
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'eigen',
        columns: ['component', 'eigenvalue', 'explained', 'cumulative'],
        rows: p.eigenvalues.map((v, i) => [`PC${i + 1}`, v, p.explained[i], p.cumulative[i]]),
      },
      {
        id: 'loadings',
        columns: ['variable', ...literal(pcs)],
        rows: names.map((n, j) => [n, ...pcs.map((_, c) => p.vectors[c][j])]),
      },
      {
        id: 'scores',
        columns: ['row', ...literal(pcs.slice(0, 2))],
        rows: labels.map((l, i) => [l, p.scores[i][0], p.scores[i][1]]),
      },
    ],
    steps: [
      step(corr ? 'multivariate.standardize' : 'multivariate.center'),
      step(corr ? 'multivariate.correlationMatrix' : 'multivariate.covarianceMatrix', undefined, { p: names.length }),
      step('multivariate.eigen', 'S v = \\lambda v,\\quad \\lambda_1 = [[l1]],\\ \\lambda_2 = [[l2]]', {
        l1: p.eigenvalues[0],
        l2: p.eigenvalues[1],
      }),
      step('multivariate.share', '\\frac{\\lambda_1}{\\sum \\lambda} = [[share]]\\%', { share: p.explained[0] }),
      step('multivariate.scores', 't_{ik} = v_k^\\top z_i'),
    ],
    words: step('multivariate.wordsPca', undefined, { share: p.explained[0], two: p.cumulative[1], p: names.length }),
    pictures: [
      {
        id: 'scree',
        type: 'plot',
        plot: {
          x: { label: 'component' },
          y: { label: 'eigenvalue' },
          series: [{ id: 'eigenvalue', points: p.eigenvalues.map((v, i) => [i + 1, v] as [number, number]) }],
          hlines: corr ? [1] : [],
        },
      },
      {
        id: 'biplot',
        type: 'plot',
        plot: {
          x: { label: 'pc1' },
          y: { label: 'pc2' },
          series: [
            { id: 'rows', style: 'points', points: p.scores.map((s) => [s[0], s[1]] as [number, number]) },
            ...names.map((n, j) => ({
              id: `v${j}`,
              name: n,
              pen: 1,
              legend: false as const,
              points: [
                [0, 0],
                [p.vectors[0][j] * scale, p.vectors[1][j] * scale],
              ] as [number, number][],
            })),
          ],
          marks: names.map((n, j) => ({ x: p.vectors[0][j] * scale, y: p.vectors[1][j] * scale, text: n })),
          hlines: [0],
          vlines: [0],
        },
      },
    ],
    notes: ['linear', corr ? 'unitsCorrelation' : 'unitsCovariance'],
  };
}

function efaOutcome(values: Values): Outcome {
  const { x, names } = readColumns(values, false);
  const k = Number(values.factors);
  const rotation = String(values.rotation) as Rotation;
  const fa = factorAnalysis(x, k, rotation);
  const sims = Number(values.sims);
  const pa = parallelAnalysis(x.length, names.length, sims, Number(values.seed));
  const keep = fa.eigenvalues.findIndex((v, i) => !(v > pa[i]));
  const suggested = keep < 0 ? names.length : keep;
  const fs = Array.from({ length: k }, (_, f) => `F${f + 1}`);
  return {
    rows: [
      { id: 'suggested', value: suggested, answer: true },
      { id: 'factors', value: k },
      { id: 'f1Variance', value: fa.variance[0] },
      { id: 'iterations', value: fa.iterations },
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'factorLoadings',
        columns: ['variable', ...literal(fs), 'communality', 'uniqueness'],
        rows: names.map((n, j) => [n, ...fa.loadings[j], fa.communalities[j], fa.uniqueness[j]]),
      },
      {
        id: 'parallel',
        columns: ['factor', 'observed', 'simulated'],
        rows: fa.eigenvalues.map((v, i) => [i + 1, v, pa[i]]),
      },
      ...(fa.phi
        ? [{ id: 'phi', columns: ['factor', ...literal(fs)], rows: fa.phi.map((row, a) => [fs[a], ...row]) }]
        : []),
    ],
    steps: [
      step('multivariate.smc', 'h_j^2 = 1 - \\frac{1}{(R^{-1})_{jj}}'),
      step('multivariate.paf', undefined, { iterations: fa.iterations }),
      step(`multivariate.rotate${rotation === 'none' ? 'None' : rotation === 'varimax' ? 'Varimax' : 'Promax'}`),
      step('multivariate.parallel', undefined, { sims, seed: Number(values.seed), suggested }),
    ],
    words: step('multivariate.wordsEfa', undefined, { suggested, k, v: fa.variance[0] }),
    pictures: [
      {
        id: 'parallelPlot',
        type: 'plot',
        plot: {
          x: { label: 'factor' },
          y: { label: 'eigenvalue' },
          series: [
            { id: 'observed', points: fa.eigenvalues.map((v, i) => [i + 1, v] as [number, number]) },
            { id: 'simulated', style: 'dashed', points: pa.map((v, i) => [i + 1, v] as [number, number]) },
          ],
          legend: true,
        },
      },
    ],
    notes: ['commonFactors', 'sampleSize'],
  };
}

function kmeansOutcome(values: Values): Outcome {
  const { x, names, labels } = readColumns(values, values.standardize === 'z');
  const k = Number(values.k);
  const seed = Number(values.seed);
  const starts = Number(values.starts);
  const fit = kMeansBest(x, k, seed, starts);
  const sil = k > 1 ? silhouette(x, fit.cluster) : { mean: NaN, each: x.map(() => NaN) };
  const kmax = Math.min(Number(values.kmax), x.length);
  const elbow = Array.from(
    { length: kmax },
    (_, i) => [i + 1, kMeansBest(x, i + 1, seed, starts).totalWithin] as [number, number],
  );
  const total = fit.totalWithin + fit.betweenSs;
  return {
    rows: [
      { id: 'within', value: fit.totalWithin, answer: true },
      { id: 'betweenShare', value: (100 * fit.betweenSs) / total },
      { id: 'silhouette', value: sil.mean },
      { id: 'iterations', value: fit.iterations },
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'centers',
        columns: ['cluster', 'size', ...literal(names)],
        rows: fit.centers.map((c, i) => [`${i + 1}`, fit.sizes[i], ...c]),
      },
      {
        id: 'members',
        columns: ['row', 'cluster', 'silhouette'],
        rows: labels.map((l, i) => [l, fit.cluster[i] + 1, sil.each[i]]),
      },
      { id: 'elbow', columns: ['k', 'within'], rows: elbow.map(([a, b]) => [a, b]) },
    ],
    steps: [
      step('multivariate.plusPlus', undefined, { k, seed, starts }),
      step('multivariate.lloyd', undefined, { iterations: fit.iterations }),
      step('multivariate.withinSs', 'W = \\sum_c \\sum_{i \\in c} \\lVert x_i - \\bar x_c \\rVert^2 = [[w]]', {
        w: fit.totalWithin,
      }),
      step('multivariate.silhouetteStep', 's_i = \\frac{b_i - a_i}{\\max(a_i, b_i)},\\quad \\bar s = [[s]]', {
        s: sil.mean,
      }),
    ],
    words: step('multivariate.wordsKmeans', undefined, { k, share: (100 * fit.betweenSs) / total, s: sil.mean }),
    pictures: [
      clusterScatter(x, fit.cluster, fit.centers),
      {
        id: 'elbowPlot',
        type: 'plot',
        plot: { x: { label: 'k' }, y: { label: 'within' }, series: [{ id: 'within', points: elbow }], vlines: [k] },
      },
    ],
    notes: [values.standardize === 'z' ? 'standardized' : 'sameUnits', 'roundClusters'],
  };
}

function dendrogram(merges: readonly Merge[], labels: readonly string[]) {
  return (ctx: DrawContext): string => {
    const p = ctx.palette;
    const n = labels.length;
    const order = leafOrder(merges, n);
    const height = 300;
    const top = Math.max(...merges.map((m) => m.height), 1e-12);
    const left = 40;
    const right = W - 16;
    const base = height - 60;
    const xOf = new Map<number, number>();
    const yOf = new Map<number, number>();
    order.forEach((leaf, i) => {
      xOf.set(leaf, left + ((i + 0.5) * (right - left)) / n);
      yOf.set(leaf, base);
    });
    const parts = [`<rect width="${W}" height="${height}" fill="${p.surface}"/>`];
    merges.forEach((m, s) => {
      const y = base - (m.height / top) * (base - 16);
      const [xa, xb] = [xOf.get(m.a) as number, xOf.get(m.b) as number];
      parts.push(
        line(xa, yOf.get(m.a) as number, xa, y, p.text),
        line(xb, yOf.get(m.b) as number, xb, y, p.text),
        line(xa, y, xb, y, p.text),
      );
      xOf.set(n + s, (xa + xb) / 2);
      yOf.set(n + s, y);
    });
    order.forEach((leaf) => {
      const x = xOf.get(leaf) as number;
      parts.push(
        `<g transform="translate(${x.toFixed(1)} ${base + 8}) rotate(60)">${svgText(0, 0, labels[leaf], p.text, 'start', 11)}</g>`,
      );
    });
    parts.push(
      line(left - 8, base, left - 8, 16, p.muted),
      svgText(left - 10, 20, top.toPrecision(3), p.muted, 'end', 10),
    );
    return svg(parts, p, W, height);
  };
}

const LINK_MATH: Record<Linkage, string> = {
  single: 'd(k, i \\cup j) = \\min(d_{ki}, d_{kj})',
  complete: 'd(k, i \\cup j) = \\max(d_{ki}, d_{kj})',
  average: 'd(k, i \\cup j) = \\frac{n_i d_{ki} + n_j d_{kj}}{n_i + n_j}',
  ward: 'd^2(k, i \\cup j) = \\frac{(n_i + n_k) d^2_{ki} + (n_j + n_k) d^2_{kj} - n_k d^2_{ij}}{n_i + n_j + n_k}',
};

function hierarchicalOutcome(values: Values): Outcome {
  const { x, labels } = readColumns(values, values.standardize === 'z');
  const linkage = String(values.linkage) as Linkage;
  const metric: Metric =
    values.metric === 'pearson' ? 'correlation' : values.metric === 'manhattan' ? 'manhattan' : 'euclidean';
  const d = distanceMatrix(x, metric);
  const merges = agglomerate(d, linkage);
  const k = Number(values.k);
  const cluster = cutTree(merges, x.length, k);
  const name = (id: number) => (id < x.length ? labels[id] : `#${id - x.length + 1}`);
  return {
    rows: [
      { id: 'lastHeight', value: merges[merges.length - 1].height, answer: true },
      { id: 'clusters', value: k },
      { id: 'n', value: x.length },
    ],
    tables: [
      {
        id: 'merges',
        columns: ['step', 'joined', 'with', 'height', 'size'],
        rows: merges.map((m, s) => [s + 1, name(m.a), name(m.b), m.height, m.size]),
      },
      { id: 'members', columns: ['row', 'cluster'], rows: labels.map((l, i) => [l, cluster[i] + 1]) },
    ],
    steps: [
      step('multivariate.distances', undefined, { metric }),
      step(`multivariate.${linkage}Link` as 'multivariate.singleLink', LINK_MATH[linkage]),
      step('multivariate.firstMerge', undefined, { a: name(merges[0].a), b: name(merges[0].b), h: merges[0].height }),
      step('multivariate.cut', undefined, { k }),
    ],
    words: step('multivariate.wordsTree', undefined, { k, h: merges[merges.length - k]?.height ?? NaN }),
    pictures: [{ id: 'dendrogram', type: 'draw', draw: dendrogram(merges, labels) }],
    notes: [linkage === 'ward' && metric !== 'euclidean' ? 'wardEuclidean' : 'treeShape'],
  };
}

function mdsMatrix(values: Values): { d: number[][]; labels: string[] } {
  if (values.input === 'columns') {
    const { x, labels } = readColumns(values, values.standardize === 'z');
    return { d: distanceMatrix(x, 'euclidean'), labels };
  }
  const table: DataTable = parseTable(String(values.data));
  const d = table.cells.map((row, i) =>
    row.map((cell, j) => {
      const v = Number(cell);
      if (cell === '' || !Number.isFinite(v)) fail('notNumeric', `${table.names[j]}|${cell}`);
      return i === j && v !== 0 ? NaN : v;
    }),
  );
  return { d, labels: [...table.names] };
}

function mdsOutcome(values: Values): Outcome {
  const { d, labels } = mdsMatrix(values);
  const m = classicalMds(d);
  return {
    rows: [
      { id: 'mdsFit', value: 100 * m.fit, answer: true },
      { id: 'eigen1', value: m.eigenvalues[0], sym: '\\lambda_1' },
      { id: 'eigen2', value: m.eigenvalues[1], sym: '\\lambda_2' },
      { id: 'n', value: d.length },
    ],
    tables: [
      {
        id: 'coords',
        columns: ['row', 'dim1', 'dim2'],
        rows: labels.map((l, i) => [l, m.coords[i][0], m.coords[i][1]]),
      },
      { id: 'eigen', columns: ['component', 'eigenvalue'], rows: m.eigenvalues.map((v, i) => [`${i + 1}`, v]) },
    ],
    steps: [
      step(
        'multivariate.doubleCenter',
        'B = -\\tfrac{1}{2} J D^{(2)} J,\\quad J = I - \\tfrac{1}{n}\\mathbf{1}\\mathbf{1}^\\top',
      ),
      step('multivariate.mdsEigen', '\\lambda_1 = [[l1]],\\ \\lambda_2 = [[l2]]', {
        l1: m.eigenvalues[0],
        l2: m.eigenvalues[1],
      }),
      step('multivariate.mdsCoords', 'x_{ik} = \\sqrt{\\lambda_k}\\, v_{ik}'),
    ],
    words: step('multivariate.wordsMds', undefined, { fit: 100 * m.fit }),
    pictures: [
      {
        id: 'map',
        type: 'plot',
        plot: {
          x: { label: 'dim1' },
          y: { label: 'dim2' },
          series: [{ id: 'rows', style: 'points', points: m.coords.map((c) => [c[0], c[1]] as [number, number]) }],
          marks: m.coords.map((c, i) => ({ x: c[0], y: c[1], text: labels[i] })),
        },
      },
    ],
    notes: ['euclideanMds'],
  };
}

function run(values: Values): Outcome {
  switch (values.analysis) {
    case 'efa':
      return efaOutcome(values);
    case 'kmeans':
      return kmeansOutcome(values);
    case 'hierarchical':
      return hierarchicalOutcome(values);
    case 'mds':
      return mdsOutcome(values);
    case 'heatmap':
      return heatmapOutcome(values);
    default:
      return pcaOutcome(values);
  }
}

const usesColumns = (v: Values) => v.analysis !== 'mds' || v.input === 'columns';

export const multivariateSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: SCORES, rows: 6 },
    {
      id: 'analysis',
      type: 'choice',
      options: ['pca', 'efa', 'kmeans', 'hierarchical', 'heatmap', 'mds'],
      first: 'pca',
    },
    { id: 'input', type: 'choice', options: ['matrix', 'columns'], first: 'matrix', when: is('mds') },
    {
      id: 'columns',
      type: 'column',
      data: 'data',
      first: 'reading\nwriting\nmath\nscience',
      multi: true,
      when: usesColumns,
    },
    { id: 'label', type: 'column', data: 'data', first: 'student', optional: true, when: usesColumns },
    { id: 'scale', type: 'choice', options: ['correlation', 'covariance'], first: 'correlation', when: is('pca') },
    {
      id: 'standardize',
      type: 'choice',
      options: ['z', 'raw'],
      first: 'z',
      when: (v) => is('kmeans', 'hierarchical', 'heatmap')(v) || (is('mds')(v) && v.input === 'columns'),
    },
    { id: 'factors', type: 'number', first: '2', integer: true, min: 1, max: 10, when: is('efa') },
    { id: 'rotation', type: 'choice', options: ['varimax', 'promax', 'none'], first: 'varimax', when: is('efa') },
    { id: 'sims', type: 'number', first: '200', integer: true, min: 20, max: 2000, when: is('efa') },
    { id: 'k', type: 'number', first: '2', integer: true, min: 1, max: 20, when: is('kmeans', 'hierarchical') },
    { id: 'kmax', type: 'number', first: '6', integer: true, min: 2, max: 20, when: is('kmeans') },
    { id: 'starts', type: 'number', first: '10', integer: true, min: 1, max: 100, when: is('kmeans') },
    {
      id: 'linkage',
      type: 'choice',
      options: ['ward', 'average', 'complete', 'single'],
      first: 'ward',
      when: is('hierarchical', 'heatmap'),
    },
    {
      id: 'metric',
      type: 'choice',
      options: ['euclidean', 'manhattan', 'pearson'],
      first: 'euclidean',
      when: is('hierarchical', 'heatmap'),
    },
    { id: 'seed', type: 'number', first: '1', integer: true, min: 0, when: is('efa', 'kmeans') },
  ],
  run,
  examples: [
    {
      id: 'pca',
      values: {
        data: SCORES,
        analysis: 'pca',
        columns: 'reading\nwriting\nmath\nscience',
        label: 'student',
        scale: 'correlation',
      },
    },
    {
      id: 'efa',
      values: {
        data: ABILITIES,
        analysis: 'efa',
        columns: 'vocab\nreading\nspelling\nalgebra\ngeometry\nlogic',
        label: '',
        factors: '2',
        rotation: 'varimax',
      },
    },
    {
      id: 'kmeans',
      values: { data: POINTS, analysis: 'kmeans', columns: 'x\ny', label: '', k: '2', standardize: 'raw' },
    },
    {
      id: 'tree',
      values: {
        data: SCORES,
        analysis: 'hierarchical',
        columns: 'reading\nwriting\nmath\nscience',
        label: 'student',
        linkage: 'ward',
        k: '3',
      },
    },
    {
      id: 'heatmap',
      values: {
        data: SCORES,
        analysis: 'heatmap',
        columns: 'reading\nwriting\nmath\nscience',
        label: 'student',
        standardize: 'z',
        linkage: 'average',
        metric: 'euclidean',
      },
    },
    { id: 'mds', values: { data: CITIES, analysis: 'mds', input: 'matrix' } },
  ],
};
