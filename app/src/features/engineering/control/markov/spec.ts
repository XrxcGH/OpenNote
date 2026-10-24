// The Markov chains and queues tool: a chain from its transition matrix or generator, the gambler's ruin chain, and
// the M/M/1 and M/M/c queues. Entries may be fractions, and the answers stay exact where the chain allows it.
import { readPlainNumber } from '../ui/units';
import { inField } from '../ui/read';
import type { Picture } from '../ui/plot';
import { FieldProblem, type Outcome, type Row, type Table, type ToolSpec, type Values } from '../ui/spec';
import { fmt } from '../lib/tf';
import { analyzeChain, gamblersRuin, queue, type Cell, type ChainResult } from './engine';
import { stateDiagram } from './diagram';

const text = (values: Values, id: string) => String(values[id] ?? '');
const num = (values: Values, id: string) => Number(values[id]);
const isChain = (t: Readonly<Record<string, string>>) => t.mode === 'chain';

const matrixTable = (id: string, names: readonly string[], m: readonly (readonly Cell[])[]): Table => ({
  id,
  columns: ['state', ...names.map((name) => ({ text: name }))],
  rows: m.map((row, i) => [names[i], ...row.map((c) => c.text)]),
});

function chainTables(r: ChainResult): Table[] {
  const tables: Table[] = [];
  if (r.power) tables.push(matrixTable(r.kind === 'discrete' ? 'power' : 'transient', r.names, r.power.matrix));
  if (r.absorption) {
    const tn = r.absorption.transient.map((i) => r.names[i]);
    const an = r.absorption.absorbing.map((i) => r.names[i]);
    tables.push({
      id: 'absorption',
      columns: ['state', 'expected', ...an.map((name) => ({ text: `→ ${name}` }))],
      rows: tn.map((name, i) => [
        name,
        r.absorption?.expected[i].text ?? '',
        ...(r.absorption?.probabilities[i] ?? []).map((c) => c.text),
      ]),
    });
  }
  if (r.passage) tables.push(matrixTable('passage', r.names, r.passage));
  return tables;
}

function chainRows(r: ChainResult): Row[] {
  const rows: Row[] = [
    {
      id: 'classes',
      value: r.classes.map((c) => `{${c.states.map((s) => r.names[s]).join(', ')}}${c.closed ? '' : ' *'}`).join(' '),
    },
    { id: 'irreducible', value: r.irreducible ? '✓' : '✗' },
  ];
  if (r.stationary.length === 1) {
    rows.push({
      id: 'stationary',
      value: r.stationary[0].map((c, i) => `π(${r.names[i]}) = ${c.text}`).join(', '),
      tex: `\\pi = \\left(${r.stationary[0].map((c) => c.tex).join(',\\ ')}\\right)`,
      answer: true,
    });
  } else if (r.stationary.length > 1) rows.push({ id: 'stationaryCount', value: String(r.stationary.length) });
  if (r.distribution) {
    rows.push({
      id: r.kind === 'discrete' ? 'distribution' : 'distributionAt',
      vars: { k: fmt(r.power?.k ?? 0) },
      value: r.distribution.map((c, i) => `${r.names[i]}: ${c.text}`).join(', '),
    });
  }
  if (r.holding) {
    rows.push({ id: 'holding', value: r.holding.map((c, i) => `${r.names[i]}: ${c.text}`).join(', ') });
  }
  return rows;
}

function diagram(r: ChainResult) {
  const labels = r.matrix.map((row, i) =>
    row.map((c, j) => (c.value === 0 || (r.kind === 'continuous' && i === j) ? '' : c.text)),
  );
  return {
    id: 'diagram',
    draw: stateDiagram.bind(null, { title: 'diagram', names: r.names, labels, marked: r.absorbing }),
  };
}

function bars(id: string, names: readonly string[], cells: readonly Cell[]) {
  return {
    id,
    x: { label: 'state', names: names.map((text, at) => ({ at, text })) },
    y: { label: 'probability', min: 0 },
    series: [{ id: '', style: 'bars' as const, points: cells.map((c, i) => [i, c.value] as const) }],
  };
}

function runChain(values: Values): Outcome {
  const kind = text(values, 'kind') === 'continuous' ? 'continuous' : 'discrete';
  const byCode = { initialLength: 'initial', initialSum: 'initial', initialNegative: 'initial' };
  const r = inField(
    'matrix',
    () =>
      analyzeChain({
        kind,
        matrix: text(values, 'matrix'),
        names: text(values, 'names'),
        initial: text(values, 'initial'),
        steps: kind === 'discrete' ? num(values, 'steps') : undefined,
        time: kind === 'continuous' ? num(values, 'time') : undefined,
      }),
    { ...byCode, tooManySteps: 'steps', badTime: 'time' },
  );
  if (kind === 'discrete' && !(num(values, 'steps') >= 0)) throw new FieldProblem('steps', 'notNegative');
  const shown = r.distribution ?? (r.stationary.length === 1 ? r.stationary[0] : undefined);
  const out: Picture[] = [diagram(r)];
  if (shown) out.push(bars(r.distribution ? 'distribution' : 'stationary', r.names, shown));
  return {
    rows: chainRows(r),
    steps: r.steps,
    tables: chainTables(r),
    plots: out,
    notes: [{ id: kind === 'discrete' ? 'discrete' : 'continuous' }, { id: 'exact' }],
  };
}

function runRuin(values: Values): Outcome {
  const target = num(values, 'target');
  const start = num(values, 'start');
  const matrix = inField('target', () => gamblersRuin(target, text(values, 'p').trim()), { probabilityRange: 'p' });
  if (!Number.isInteger(start) || start <= 0 || start >= target) {
    throw new FieldProblem('start', 'ruinStart', { max: String(target - 1) });
  }
  const names = Array.from({ length: target + 1 }, (_, i) => String(i));
  const r = analyzeChain({ kind: 'discrete', matrix, names: names.join(' '), steps: 1 });
  const absorption = r.absorption;
  if (!absorption) throw new FieldProblem('p', 'ruinDegenerate');
  const row = absorption.transient.indexOf(start);
  const win = absorption.absorbing.indexOf(target);
  const reach = absorption.probabilities[row][win];
  const duration = absorption.expected[row];
  return {
    rows: [
      { id: 'reach', vars: { target: String(target) }, value: reach.text, tex: `P = ${reach.tex}`, answer: true },
      { id: 'ruin', value: absorption.probabilities[row][1 - win].text },
      { id: 'duration', value: duration.text, tex: `E[T] = ${duration.tex}`, answer: true },
    ],
    steps: r.steps,
    tables: chainTables({ ...r, power: undefined }),
    plots: [
      {
        id: 'reachPlot',
        x: { label: 'start' },
        y: { label: 'probability', min: 0, max: 1 },
        series: [
          {
            id: '',
            style: 'line',
            marker: 'dot',
            points: [
              [0, 0],
              ...absorption.transient.map((s, i) => [s, absorption.probabilities[i][win].value] as const),
              [target, 1],
            ],
          },
        ],
      },
    ],
    notes: [{ id: 'ruin' }],
  };
}

function runQueue(values: Values): Outcome {
  const servers = readPlainNumber(text(values, 'servers'), 'servers');
  const r = inField(null, () => queue({ lambda: num(values, 'lambda'), mu: num(values, 'mu'), servers }), {
    serversRange: 'servers',
  });
  const t = (x: number) => fmt(x);
  return {
    rows: [
      { id: 'rho', value: t(r.rho), tex: `\\rho = ${t(r.rho)}` },
      { id: 'p0', value: t(r.p0) },
      { id: 'pWait', value: t(r.pWait) },
      { id: 'l', value: t(r.l), tex: `L = ${t(r.l)}`, answer: true },
      { id: 'lq', value: t(r.lq), tex: `L_q = ${t(r.lq)}`, answer: true },
      { id: 'w', value: t(r.w), tex: `W = ${t(r.w)}`, answer: true },
      { id: 'wq', value: t(r.wq), tex: `W_q = ${t(r.wq)}`, answer: true },
    ],
    steps: r.steps,
    tables: [{ id: 'pn', columns: ['n', 'pn'], rows: r.pn.map((p, k) => [String(k), t(p)]) }],
    plots: [
      {
        id: 'pnPlot',
        x: { label: 'customers' },
        y: { label: 'probability', min: 0 },
        series: [{ id: '', style: 'bars', points: r.pn.map((p, k) => [k, p] as const) }],
      },
    ],
    notes: [{ id: 'queue' }],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['chain', 'ruin', 'queue'], first: 'chain' },
    { id: 'kind', type: 'choice', options: ['discrete', 'continuous'], first: 'discrete', when: isChain },
    { id: 'matrix', type: 'text', rows: 4, first: '0.9 0.1\n0.5 0.5', when: isChain },
    { id: 'names', type: 'text', first: '', when: isChain },
    { id: 'initial', type: 'text', first: '1 0', when: isChain },
    { id: 'steps', type: 'number', first: '3', when: (t) => isChain(t) && t.kind !== 'continuous' },
    { id: 'time', type: 'number', first: '1', when: (t) => isChain(t) && t.kind === 'continuous' },
    { id: 'target', type: 'number', first: '10', when: (t) => t.mode === 'ruin' },
    { id: 'start', type: 'number', first: '3', when: (t) => t.mode === 'ruin' },
    { id: 'p', type: 'text', first: '1/2', when: (t) => t.mode === 'ruin' },
    { id: 'lambda', type: 'number', first: '8', when: (t) => t.mode === 'queue' },
    { id: 'mu', type: 'number', first: '10', when: (t) => t.mode === 'queue' },
    { id: 'servers', type: 'text', first: '1', when: (t) => t.mode === 'queue' },
  ],
  run(values) {
    const mode = text(values, 'mode');
    if (mode === 'ruin') return runRuin(values);
    if (mode === 'queue') return runQueue(values);
    return runChain(values);
  },
  examples: [
    { id: 'weather', texts: { mode: 'chain', kind: 'discrete', matrix: '0.9 0.1\n0.5 0.5', names: 'sunny rainy' } },
    {
      id: 'absorbing',
      texts: { mode: 'chain', kind: 'discrete', matrix: '1 0 0 0\n1/2 0 1/2 0\n0 1/2 0 1/2\n0 0 0 1', initial: '' },
    },
    {
      id: 'machine',
      texts: { mode: 'chain', kind: 'continuous', matrix: '* 2\n3 *', names: 'up down', initial: '1 0', time: '0.5' },
    },
    { id: 'ruin', texts: { mode: 'ruin', target: '10', start: '3', p: '1/2' } },
    { id: 'mm1', texts: { mode: 'queue', lambda: '8', mu: '10', servers: '1' } },
    { id: 'mmc', texts: { mode: 'queue', lambda: '2', mu: '1.5', servers: '2' } },
  ],
};
