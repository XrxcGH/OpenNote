// The algorithms tool's sorting, searching, data-structure, dynamic-programming, and hidden Markov model modes as
// forms. Graphs, informed search, game search, and networks are in formsGraph.ts.
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, matrix, num } from '../core/util';
import { saySteps } from '../ui/say';
import type { Field, Mode, Outcome, Table, ToolSpec, Values } from '../ui/types';
import { T, f, numList, s, solveWith, whole } from './common';
import { coinChange, editDistance, hmm, knapsack, lcs, matrixChain } from './dp';
import { GRAPH, INFORMED, MINIMAX, NETWORK } from './formsGraph';
import { SORTS, binarySearch, sort } from './sorting';
import type { SortId } from './sorting';
import { PROBES, bTreeOps, hashOps, heapOps, linear, parseOps, treeOps } from './structures';
import type { BNode, Bst, Probe } from './structures';

function sortOutcome(v: Values): Outcome {
  const id = ((SORTS as readonly string[]).includes(v.algorithm ?? '') ? v.algorithm : 'insertion') as SortId;
  const a = numList(v, 'array');
  const r = sort(id, a);
  return {
    ok: true,
    answer: s('sorted', { array: r.result.map((x) => num(x)).join(', ') || '∅' }),
    note: s(`counts_${r.moveKind}`, { comparisons: r.comparisons, moves: r.moves }),
    steps: saySteps(T, r.log.slice(0, 300)),
    tables: [
      {
        caption: s('table.counts'),
        header: [s('table.measure'), s('table.value')],
        rows: [
          [s('table.comparisons'), String(r.comparisons)],
          [s(`table.${r.moveKind}`), String(r.moves)],
          [s('table.size'), String(a.length)],
        ],
      },
    ],
  };
}

function searchOutcome(v: Values): Outcome {
  const a = numList(v, 'array');
  const target = numList(v, 'target');
  if (target.length !== 1) fail('oneNumber', { field: s('fields.target') });
  const r = binarySearch(a, target[0]);
  return {
    ok: true,
    answer:
      r.index >= 0
        ? s('foundAt', { index: r.index, comparisons: r.comparisons })
        : s('absent', { comparisons: r.comparisons }),
    note: s('zeroBased'),
    steps: saySteps(T, r.log),
  };
}

const bstNode = (t: Bst | null): TreeNode =>
  t
    ? {
        label: num(t.key),
        children: t.left || t.right ? [bstNode(t.left), bstNode(t.right)] : [],
      }
    : { label: '·', children: [], tone: 'muted', shape: 'box' };

const bNode = (n: BNode): TreeNode => ({ label: n.keys.join(' | ') || '∅', shape: 'box', children: n.kids.map(bNode) });

function heapNode(a: readonly number[], i = 0): TreeNode {
  const kids = [2 * i + 1, 2 * i + 2].filter((k) => k < a.length).map((k) => heapNode(a, k));
  return { label: num(a[i]), children: kids };
}

const figureOf = (node: TreeNode) => ({ svg: treeFigure(node), alt: s('treeAlt', { tree: treeText(node) }) });

const STRUCTURE_OPS: Record<string, string> = {
  stack: 'push 1, push 2, push 3, pop, peek',
  queue: 'enqueue 1, enqueue 2, enqueue 3, dequeue, peek',
  bst: 'insert 50, 30, 70, 20, 40, 60, 80, delete 30, search 60',
  avl: 'insert 1, 2, 3, 4, 5, 6, 7',
  heap: 'insert 5, 3, 8, 1, 9, extract',
  btree: 'insert 10, 20, 5, 6, 12, 30, 7, 17',
  hash: 'insert 89, 18, 49, 58, 69',
};

function structureOutcome(v: Values): Outcome {
  const kind = v.kind ?? 'stack';
  const ops = parseOps(v.ops ?? '');
  if (kind === 'stack' || kind === 'queue') {
    const r = linear(kind, ops);
    return {
      ok: true,
      answer: s(kind === 'stack' ? 'stackNow' : 'queueNow', { items: r.items.join(' ') || '∅' }),
      steps: saySteps(T, r.log),
    };
  }
  if (kind === 'bst' || kind === 'avl') {
    const r = treeOps(kind === 'avl', ops);
    return {
      ok: true,
      answer: r.root ? s('treeNow', { root: num(r.root.key), height: r.root.height }) : s('treeEmpty'),
      note: kind === 'avl' ? s('rotations', { count: r.rotations }) : undefined,
      steps: saySteps(T, r.log),
      figure: r.root ? figureOf(bstNode(r.root)) : undefined,
    };
  }
  if (kind === 'heap') {
    const r = heapOps(ops);
    return {
      ok: true,
      answer: s('heapNow', { heap: r.heap.join(' ') || '∅' }),
      steps: saySteps(T, r.log),
      figure: r.heap.length ? figureOf(heapNode(r.heap)) : undefined,
    };
  }
  if (kind === 'btree') {
    const r = bTreeOps(whole(v, 'order'), ops);
    return {
      ok: true,
      answer: s('bTreeNow', { root: r.root.keys.join(' ') || '∅', splits: r.splits }),
      steps: saySteps(T, r.log),
      figure: figureOf(bNode(r.root)),
    };
  }
  const probe = ((PROBES as readonly string[]).includes(v.probe ?? '') ? v.probe : 'linear') as Probe;
  const m = whole(v, 'size');
  const r = hashOps(m, probe, ops);
  const keys = r.slots.reduce((a, x) => a + x.length, 0);
  return {
    ok: true,
    answer: s('hashNow', { keys, m, probes: r.probes, load: num(keys / m, 3) }),
    note: probe === 'double' ? s('doubleRule', { m1: m - 1 }) : undefined,
    steps: saySteps(T, r.log),
    tables: [
      {
        caption: s('table.slots'),
        header: [s('table.slot'), s('table.keys')],
        rows: r.slots.map((x, i) => [String(i), x.join(' → ') || '—']),
      },
    ],
  };
}

const grid = (
  caption: string,
  rowNames: readonly string[],
  colNames: readonly string[],
  t: readonly (readonly (number | string)[])[],
): Table => ({
  caption,
  header: ['', ...colNames],
  rows: t.map((row, i) => [rowNames[i], ...row.map((x) => (typeof x === 'number' ? num(x) : x))]),
});

function dpOutcome(v: Values): Outcome {
  const problem = v.problem ?? 'edit';
  if (problem === 'edit' || problem === 'lcs') {
    const a = v.a ?? '';
    const b = v.b ?? '';
    const rows = ['ε', ...a];
    const cols = ['ε', ...b];
    if (problem === 'edit') {
      const r = editDistance(a, b);
      const word = (op: string) =>
        op[0] === '='
          ? s('op.keep', { c: op[1] })
          : op[0] === '~'
            ? s('op.swap', { a: op[1], b: op[2] })
            : op[0] === '-'
              ? s('op.delete', { c: op[1] })
              : s('op.insert', { c: op[1] });
      return {
        ok: true,
        answer: s('editAnswer', { d: r.distance }),
        steps: [s('steps.editRule'), ...r.ops.map(word)],
        tables: [grid(s('table.dp'), rows, cols, r.table)],
      };
    }
    const r = lcs(a, b);
    return {
      ok: true,
      answer: s('lcsAnswer', { length: r.length, seq: r.sequence || 'ε' }),
      steps: [s('steps.lcsRule')],
      tables: [grid(s('table.dp'), rows, cols, r.table)],
    };
  }
  if (problem === 'knapsack') {
    const w = numList(v, 'weights');
    const val = numList(v, 'values');
    const cap = whole(v, 'capacity');
    const r = knapsack(w, val, cap);
    const caps = Array.from({ length: cap + 1 }, (_, c) => String(c));
    return {
      ok: true,
      answer: s('knapsackAnswer', { best: num(r.best), items: r.chosen.map((i) => i + 1).join(', ') || '—' }),
      steps: [s('steps.knapsackRule')],
      tables:
        cap <= 60 ? [grid(s('table.dp'), ['0', ...w.map((_, i) => s('itemName', { i: i + 1 }))], caps, r.table)] : [],
    };
  }
  if (problem === 'coins') {
    const coins = numList(v, 'coins');
    const amount = whole(v, 'amount');
    const r = coinChange(coins, amount);
    const head = Array.from({ length: Math.min(amount, 40) + 1 }, (_, x) => String(x));
    return {
      ok: true,
      answer:
        r.fewest === Infinity
          ? s('coinsNone', { amount })
          : s('coinsAnswer', { count: r.fewest, used: r.used.join(' + '), amount }),
      note: s('coinWays', { ways: r.ways, amount }),
      steps: [s('steps.coinsRule')],
      tables: [
        grid(s('table.coins'), [s('table.fewest'), s('table.ways')], head, [
          r.table.slice(0, head.length).map((x) => (x === Infinity ? '∞' : x)),
          r.waysTable.slice(0, head.length),
        ]),
      ],
    };
  }
  const dims = numList(v, 'dims');
  const r = matrixChain(dims);
  const names = r.m.map((_, i) => `A${i + 1}`);
  return {
    ok: true,
    answer: s('chainAnswer', { cost: r.cost, order: r.order }),
    steps: [s('steps.chainRule')],
    tables: [
      grid(
        s('table.chainCost'),
        names,
        names,
        r.m.map((row, i) => row.map((x, j) => (j < i ? '' : x))),
      ),
      grid(
        s('table.chainSplit'),
        names,
        names,
        r.s.map((row, i) => row.map((x, j) => (j <= i ? '' : `A${x + 1}`))),
      ),
    ],
  };
}

function hmmOutcome(v: Values): Outcome {
  const states = (v.states ?? '').split(/[\s,]+/).filter(Boolean);
  const symbols = (v.symbols ?? '').split(/[\s,]+/).filter(Boolean);
  const start = numList(v, 'start');
  const trans = matrix(v.trans ?? '') ?? fail('matrixField', { field: s('fields.trans') });
  const emit = matrix(v.emit ?? '') ?? fail('matrixField', { field: s('fields.emit') });
  const obs = (v.observations ?? '').split(/[\s,]+/).filter(Boolean);
  const r = hmm({ states, symbols, start, trans, emit }, obs);
  const cols = obs.map((o, t) => `${t + 1}: ${o}`);
  const t = (m: number[][]) => states.map((_, i) => m.map((row) => row[i]));
  return {
    ok: true,
    answer: s('hmmAnswer', { path: r.path.join(' → '), p: num(r.pathProbability, 5) }),
    note: s('hmmProbability', { p: num(r.probability, 6) }),
    steps: [s('steps.forward'), s('steps.viterbi')],
    tables: [grid(s('table.forward'), states, cols, t(r.alpha)), grid(s('table.viterbi'), states, cols, t(r.delta))],
  };
}

const SORT: Mode = {
  id: 'sort',
  fields: [f('array', '5, 2, 4, 6, 1, 3', { wide: true }), { id: 'algorithm', kind: 'select', options: SORTS }],
  solve: solveWith(sortOutcome),
};
const SEARCH: Mode = {
  id: 'search',
  fields: [f('array', '1, 3, 5, 7, 9, 11, 13', { wide: true }), f('target', '11')],
  solve: solveWith(searchOutcome),
};
const STRUCTURE: Mode = {
  id: 'structure',
  fields: (v) => {
    const kind = v.kind ?? 'stack';
    return [
      { id: 'kind', kind: 'select', options: ['stack', 'queue', 'bst', 'avl', 'heap', 'btree', 'hash'] },
      f('ops', STRUCTURE_OPS[kind] ?? STRUCTURE_OPS.stack, { help: true, wide: true }),
      ...(kind === 'btree' ? [f('order', '3', { help: true })] : []),
      ...(kind === 'hash'
        ? [f('size', '10'), { id: 'probe', kind: 'select' as const, options: PROBES, initial: 'linear' }]
        : []),
    ];
  },
  solve: solveWith(structureOutcome),
};
const DP_FIELDS: Record<string, Field[]> = {
  edit: [f('a', 'kitten'), f('b', 'sitting')],
  lcs: [f('a', 'ABCBDAB'), f('b', 'BDCABA')],
  knapsack: [f('weights', '1, 3, 4, 5'), f('values', '1, 4, 5, 7'), f('capacity', '7')],
  coins: [f('coins', '1, 2, 5'), f('amount', '11')],
  chain: [f('dims', '30, 35, 15, 5, 10, 20, 25', { help: true, wide: true })],
};
const DP: Mode = {
  id: 'dp',
  fields: (v) => [
    { id: 'problem', kind: 'select', options: ['edit', 'lcs', 'knapsack', 'coins', 'chain'] },
    ...(DP_FIELDS[v.problem ?? 'edit'] ?? DP_FIELDS.edit),
  ],
  solve: solveWith(dpOutcome),
};
const HMM: Mode = {
  id: 'hmm',
  fields: [
    f('states', 'Healthy, Fever'),
    f('symbols', 'normal, cold, dizzy'),
    f('start', '0.6, 0.4', { help: true }),
    { id: 'trans', kind: 'area', initial: '0.7 0.3\n0.4 0.6', rows: 3, help: true },
    { id: 'emit', kind: 'area', initial: '0.5 0.4 0.1\n0.1 0.3 0.6', rows: 3, help: true },
    f('observations', 'normal, cold, dizzy', { wide: true }),
  ],
  solve: solveWith(hmmOutcome),
};

export const ALGORITHMS: ToolSpec = {
  id: 'algorithms',
  modes: [SORT, SEARCH, STRUCTURE, GRAPH, INFORMED, MINIMAX, DP, HMM, NETWORK],
};
