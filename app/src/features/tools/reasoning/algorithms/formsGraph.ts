// The algorithms tool's graph modes as forms: the graph algorithms, informed search, minimax with alpha-beta, and
// network measures.
import { graphFigure } from '../core/graphFigure';
import type { GraphEdge, GraphNode } from '../core/graphFigure';
import { treeFigure, treeText } from '../core/treeFigure';
import type { TreeNode } from '../core/treeFigure';
import { fail, integers, num } from '../core/util';
import { saySteps } from '../ui/say';
import type { Figure, Mode, Outcome, Table, Values } from '../ui/types';
import { T, f, s, solveWith } from './common';
import {
  adjacency,
  bellmanFord,
  bfs,
  components,
  dfs,
  dijkstra,
  euler,
  floydWarshall,
  greedyColor,
  hamilton,
  kruskal,
  matching,
  maxFlow,
  parseGraph,
  pathTo,
  prim,
  topoSort,
} from './graphs';
import type { Graph } from './graphs';
import { betweenness, closeness, clustering, eigenvector, louvain, pageRank, summary } from './network';
import { admissible, alphaBeta, bestFirst, parseGameTree, parseHeuristic } from './search';
import type { GameTree, Searched } from './search';

const MAX_DRAWN = 40;
const TONES = ['accentSoft', 'hiSoft', 'warnSoft', 'sunken', 'accent', 'hi', 'warn'] as const;

function figure(
  g: Graph,
  bold: ReadonlySet<number> = new Set(),
  notes: ReadonlyMap<string, string> = new Map(),
  colors?: ReadonlyMap<string, number>,
): Figure | undefined {
  if (g.nodes.length > MAX_DRAWN) return undefined;
  const nodes: GraphNode[] = g.nodes.map((q) => ({
    id: q,
    label: q,
    note: notes.get(q),
    tone: colors ? TONES[colors.get(q)! % TONES.length] : undefined,
  }));
  const edges: GraphEdge[] = g.edges.map((e, i) => ({
    from: e.u,
    to: e.v,
    label: g.weighted ? num(e.w) : undefined,
    bold: bold.has(i),
  }));
  const list = g.edges
    .map((e) => `${e.u} ${g.directed ? '→' : '–'} ${e.v}${g.weighted ? ` (${num(e.w)})` : ''}`)
    .join('; ');
  return {
    svg: graphFigure(nodes, edges, { directed: g.directed, layout: g.directed ? 'columns' : 'circle' }),
    alt: s('graphAlt', { nodes: g.nodes.length, edges: list }),
  };
}

function adjacencyTables(g: Graph): Table[] {
  const adj = adjacency(g);
  const lists: Table = {
    caption: s('table.lists'),
    header: [s('table.node'), s('table.neighbors')],
    rows: g.nodes.map((q) => [
      q,
      adj
        .get(q)!
        .map((a) => (g.weighted ? `${a.to} (${num(a.w)})` : a.to))
        .join(', ') || '—',
    ]),
  };
  if (g.nodes.length > 20) return [lists];
  return [
    lists,
    {
      caption: s('table.matrix'),
      header: ['', ...g.nodes],
      rows: g.nodes.map((u) => [
        u,
        ...g.nodes.map((v) => {
          const a = adj.get(u)!.filter((x) => x.to === v);
          return a.length ? (g.weighted ? a.map((x) => num(x.w)).join('/') : String(a.length)) : '0';
        }),
      ]),
    },
  ];
}

const distText = (d: number) => (d === Infinity ? '∞' : num(d));
const edgeName = (g: Graph, i: number) => `${g.edges[i].u} ${g.directed ? '→' : '–'} ${g.edges[i].v}`;

interface Drawn {
  answer: string;
  rest?: Partial<Extract<Outcome, { ok: true }>>;
  bold?: Set<number>;
  notes?: Map<string, string>;
  colors?: Map<string, number>;
}

type Handler = (g: Graph, source: string, target: string) => Drawn;

const nodeTable = (caption: string, heads: readonly string[], rows: readonly (readonly string[])[]): Table => ({
  caption,
  header: [s('table.node'), ...heads],
  rows,
});

const bfsMode: Handler = (g, source) => {
  const r = bfs(g, source);
  const rows = r.order.map((q) => [q, String(r.dist.get(q)), r.parent.get(q) ?? '—']);
  return {
    answer: s('bfsAnswer', { order: r.order.join(', ') }),
    rest: { tables: [nodeTable(s('table.levels'), [s('table.distance'), s('table.parent')], rows)] },
    bold: new Set(r.tree),
    notes: new Map([...r.dist].map(([q, d]) => [q, String(d)])),
  };
};

const dfsMode: Handler = (g, source) => {
  const r = dfs(g, source);
  const times = r.order.map((q) => [q, String(r.found.get(q)), String(r.done.get(q))]);
  const classes: Table = {
    caption: s('table.classes'),
    header: [s('table.edge'), s('table.class')],
    rows: g.edges.map((_, i) => [edgeName(g, i), s(`edgeClass.${r.classes.get(i) ?? 'tree'}`)]),
  };
  return {
    answer: s('dfsAnswer', { order: r.order.join(', ') }),
    rest: { tables: [nodeTable(s('table.times'), [s('table.found'), s('table.finished')], times), classes] },
    bold: new Set([...r.classes].filter(([, c]) => c === 'tree').map(([e]) => e)),
    notes: new Map(g.nodes.map((q) => [q, `${r.found.get(q)}/${r.done.get(q)}`])),
  };
};

const topoMode: Handler = (g) => {
  const r = topoSort(g);
  return {
    answer: 'cycle' in r ? s('topoCycle') : s('topoAnswer', { order: r.order.join(', ') }),
    rest: { steps: [s('steps.kahn')] },
  };
};

const componentsMode: Handler = (g) => {
  const c = components(g);
  const list = c.map((x) => `{${x.join(', ')}}`).join(' ');
  return {
    answer: s(g.directed ? 'sccAnswer' : 'ccAnswer', { count: c.length, list }),
    colors: new Map(c.flatMap((comp, i) => comp.map((q) => [q, i] as [string, number]))),
  };
};

function pathEdges(g: Graph, path: readonly string[]): Set<number> {
  const bold = new Set<number>();
  for (let i = 0; i + 1 < path.length; i += 1)
    g.edges.forEach((e, k) => {
      const forward = e.u === path[i] && e.v === path[i + 1];
      if (forward || (!g.directed && e.v === path[i] && e.u === path[i + 1])) bold.add(k);
    });
  return bold;
}

const pathsMode =
  (bellman: boolean): Handler =>
  (g, source, target) => {
    const r = bellman ? bellmanFord(g, source) : dijkstra(g, source);
    const neg = 'negativeCycle' in r && r.negativeCycle;
    const path = target ? pathTo(r.prev, source, target) : [];
    const all = s('distAnswer', { list: g.nodes.map((q) => `${q} ${distText(r.dist.get(q)!)}`).join(', ') });
    const reached = path.length
      ? s('pathAnswer', { path: path.join(' → '), d: distText(r.dist.get(target) ?? Infinity) })
      : s('noPath', { target });
    const rows = g.nodes.map((q) => [q, distText(r.dist.get(q)!), r.prev.get(q) ?? '—']);
    return {
      answer: neg ? s('negativeCycle') : target ? reached : all,
      rest: {
        note: target && !neg ? all : undefined,
        steps: saySteps(T, r.log.slice(0, 300)),
        tables: [nodeTable(s('table.distances'), [s('table.distance'), s('table.previous')], rows)],
      },
      bold: pathEdges(g, path),
      notes: new Map(g.nodes.map((q) => [q, distText(r.dist.get(q)!)])),
    };
  };

const floydMode: Handler = (g) => {
  if (g.nodes.length > 60) fail('graphBig', { max: 60 });
  const r = floydWarshall(g);
  const table: Table = {
    caption: s('table.allPairs'),
    header: ['', ...g.nodes],
    rows: g.nodes.map((q, i) => [q, ...r.d[i].map(distText)]),
  };
  return {
    answer: r.negativeCycle ? s('negativeCycle') : s('floydAnswer', { n: g.nodes.length }),
    rest: { steps: saySteps(T, r.log), tables: [table] },
  };
};

const treeMode =
  (usePrim: boolean): Handler =>
  (g, source) => {
    const r = usePrim ? prim(g, source) : kruskal(g);
    const spans = r.tree.length === g.nodes.length - 1;
    return {
      answer: s(spans ? 'mstAnswer' : 'forestAnswer', { w: num(r.weight), count: r.tree.length }),
      rest: { steps: saySteps(T, r.log) },
      bold: new Set(r.tree),
    };
  };

const flowMode: Handler = (g, source, target) => {
  const r = maxFlow(g, source, target || g.nodes[g.nodes.length - 1]);
  const table: Table = {
    caption: s('table.flows'),
    header: [s('table.edge'), s('table.flow'), s('table.capacity')],
    rows: g.edges.map((e) => [`${e.u} → ${e.v}`, num(Math.max(0, r.flow(e.u, e.v))), num(e.w)]),
  };
  return {
    answer: s('flowAnswer', { total: num(r.total), cut: r.cut.join(', ') }),
    rest: { steps: saySteps(T, r.log), tables: [table] },
    bold: new Set(r.cutEdges),
  };
};

const matchingMode: Handler = (g) => {
  const r = matching(g);
  const index = (a: string, b: string) =>
    g.edges.findIndex((e) => (e.u === a && e.v === b) || (e.u === b && e.v === a));
  const list = r.pairs.map(([a, b]) => `${a}–${b}`).join(', ') || '—';
  return {
    answer: s('matchAnswer', { count: r.pairs.length, list }),
    rest: { steps: saySteps(T, r.log) },
    bold: new Set(r.pairs.map(([a, b]) => index(a, b))),
  };
};

const eulerMode: Handler = (g) => {
  const r = euler(g);
  const found = r.kind === 'circuit' ? 'eulerCircuit' : 'eulerPath';
  return {
    answer: r.kind === 'none' ? s(r.reason) : s(found, { walk: r.walk.join(' → ') }),
    rest: { steps: [s(g.directed ? 'steps.eulerDirected' : 'steps.eulerRule')] },
  };
};

const hamiltonMode: Handler = (g) => {
  const r = hamilton(g);
  const found = r.kind === 'cycle' ? 'hamiltonCycle' : 'hamiltonPath';
  return {
    answer: r.kind === 'none' ? s('hamiltonNone') : s(found, { walk: r.walk.join(' → ') }),
    rest: { steps: [s('steps.hamiltonRule')] },
  };
};

const coloringMode: Handler = (g) => {
  const c = greedyColor(g);
  const rows = g.nodes.map((q) => [q, String(c.get(q)! + 1)]);
  return {
    answer: s('colorAnswer', { count: new Set(c.values()).size }),
    rest: { steps: [s('steps.greedyRule')], tables: [nodeTable(s('table.colors'), [s('table.color')], rows)] },
    notes: new Map(rows.map(([q, k]) => [q, k])),
    colors: c,
  };
};

const HANDLERS: Record<string, Handler> = {
  bfs: bfsMode,
  dfs: dfsMode,
  topo: topoMode,
  components: componentsMode,
  dijkstra: pathsMode(false),
  bellman: pathsMode(true),
  floyd: floydMode,
  prim: treeMode(true),
  kruskal: treeMode(false),
  flow: flowMode,
  matching: matchingMode,
  euler: eulerMode,
  hamilton: hamiltonMode,
  coloring: coloringMode,
};

function graphOutcome(v: Values): Outcome {
  const g = parseGraph(v.edges ?? '', v.directed !== 'undirected');
  const run = HANDLERS[v.algorithm ?? 'dijkstra'] ?? HANDLERS.dijkstra;
  const d = run(g, (v.source ?? '').trim() || g.nodes[0], (v.target ?? '').trim());
  return {
    ok: true,
    answer: d.answer,
    ...d.rest,
    tables: [...(d.rest?.tables ?? []), ...adjacencyTables(g)],
    figure: figure(g, d.bold, d.notes, d.colors),
  };
}

function informedOutcome(v: Values): Outcome {
  const g = parseGraph(v.edges ?? '', v.directed === 'directed');
  const h = parseHeuristic(v.heuristic ?? '');
  const start = (v.start ?? '').trim();
  const goal = (v.goal ?? '').trim();
  const greedy = v.method === 'greedy';
  const r = bestFirst(g, h, start, goal, greedy);
  const bad = greedy ? [] : admissible(g, h, goal);
  return {
    ok: true,
    answer: r.path.length
      ? s('searchAnswer', { path: r.path.join(' → '), cost: num(r.cost), count: r.expansions.length })
      : s('searchNone', { goal }),
    note: bad.length ? s('notAdmissible', { list: bad.join(', ') }) : greedy ? s('greedyNote') : s('admissibleNote'),
    steps: [s(greedy ? 'steps.greedy' : 'steps.astar')],
    tables: [
      {
        caption: s('table.expansions'),
        header: [s('table.order'), s('table.node'), 'g', 'h', greedy ? 'h' : 'f = g + h', s('table.open')],
        rows: r.expansions.slice(0, 200).map((e, i) => [String(i + 1), e.node, num(e.g), num(e.h), num(e.f), e.open]),
      },
    ],
    figure: figure(g, new Set(), new Map(g.nodes.map((q) => [q, `h ${num(h.get(q) ?? 0)}`]))),
  };
}

function searchedNode(n: GameTree, r: Searched | undefined, max: boolean): TreeNode {
  if (!r)
    return {
      label: n.kids.length ? '·' : num(n.value!),
      children: [],
      cut: true,
      tone: 'muted',
      shape: max ? 'box' : 'circle',
    };
  return {
    label: num(r.value),
    shape: max ? 'box' : 'circle',
    tone: r.leaf ? undefined : max ? 'accentSoft' : 'hiSoft',
    children: n.kids.map((k, i) => searchedNode(k, r.kids[i], !max)),
  };
}

function minimaxOutcome(v: Values): Outcome {
  const tree = parseGameTree(v.tree ?? '');
  const prune = v.prune !== 'no';
  const r = alphaBeta(tree, prune);
  const full = alphaBeta(tree, false).leaves;
  const node = searchedNode(tree, r.tree, true);
  return {
    ok: true,
    answer: s('minimaxAnswer', { value: num(r.tree.value) }),
    note: s('leavesNote', { seen: r.leaves, all: full }),
    steps: [s('steps.minimaxRule'), ...saySteps(T, r.log)],
    figure: { svg: treeFigure(node), alt: s('treeAlt', { tree: treeText(node) }) },
  };
}

function networkOutcome(v: Values): Outcome {
  const g = parseGraph(v.edges ?? '', v.directed === 'directed');
  const seedText = integers(v.seed ?? '');
  const seed = seedText?.length === 1 ? seedText[0] : fail('wholeField', { field: s('fields.seed') });
  const adj = adjacency(g);
  const b = betweenness(g);
  const c = closeness(g);
  const e = eigenvector(g);
  const pr = pageRank(g);
  const cl = clustering(g);
  const sum = summary(g);
  const comm = louvain({ ...g, directed: false }, seed);
  const avgCl = g.nodes.reduce((a, q) => a + cl.get(q)!, 0) / g.nodes.length;
  return {
    ok: true,
    answer: s('networkAnswer', {
      n: g.nodes.length,
      m: g.edges.length,
      density: num(sum.density, 4),
      communities: new Set(comm.community.values()).size,
      q: num(comm.modularity, 4),
    }),
    note: s('networkNote', {
      avg: num(sum.averagePath, 4),
      diameter: sum.diameter,
      components: sum.components,
      clustering: num(avgCl, 4),
      iterations: pr.iterations,
    }),
    steps: [s('steps.brandes'), s('steps.pagerank'), s('steps.louvain', { seed })],
    tables: [
      {
        caption: s('table.centrality'),
        header: [
          s('table.node'),
          s('table.degree'),
          s('table.betweenness'),
          s('table.closeness'),
          s('table.eigenvector'),
          'PageRank',
          s('table.clustering'),
          s('table.community'),
        ],
        rows: g.nodes.map((q) => [
          q,
          String(adj.get(q)!.length),
          num(b.get(q)!, 4),
          num(c.get(q)!, 4),
          num(e.get(q)!, 4),
          num(pr.rank.get(q)!, 4),
          num(cl.get(q)!, 4),
          String(comm.community.get(q)! + 1),
        ]),
      },
    ],
    figure: figure(g, new Set(), new Map(), comm.community),
  };
}

export const GRAPH: Mode = {
  id: 'graph',
  fields: [
    { id: 'edges', kind: 'area', initial: 'A-B 4, A-C 2, B-C 5, B-D 10, C-E 3, E-D 4', rows: 4, help: true },
    { id: 'directed', kind: 'select', options: ['directed', 'undirected'] },
    {
      id: 'algorithm',
      kind: 'select',
      initial: 'dijkstra',
      options: [
        'bfs',
        'dfs',
        'topo',
        'components',
        'dijkstra',
        'bellman',
        'floyd',
        'prim',
        'kruskal',
        'flow',
        'matching',
        'euler',
        'hamilton',
        'coloring',
      ],
    },
    f('source', 'A'),
    f('target', 'D', { help: true }),
  ],
  solve: solveWith(graphOutcome),
};
export const INFORMED: Mode = {
  id: 'informed',
  fields: [
    { id: 'edges', kind: 'area', initial: 'S A 1, S B 4, A B 2, A C 5, B C 1, C G 3', rows: 3, help: true },
    { id: 'directed', kind: 'select', options: ['undirected', 'directed'] },
    f('heuristic', 'S 7, A 6, B 2, C 1, G 0', { help: true, wide: true }),
    f('start', 'S'),
    f('goal', 'G'),
    { id: 'method', kind: 'select', options: ['astar', 'greedy'] },
  ],
  solve: solveWith(informedOutcome),
};
export const MINIMAX: Mode = {
  id: 'minimax',
  fields: [
    f('tree', '((3, 12, 8), (2, 4, 6), (14, 5, 2))', { help: true, wide: true }),
    { id: 'prune', kind: 'select', options: ['yes', 'no'] },
  ],
  solve: solveWith(minimaxOutcome),
};
export const NETWORK: Mode = {
  id: 'network',
  fields: [
    { id: 'edges', kind: 'area', initial: 'a b, b c, c a, c d, d e, e f, f d', rows: 4, help: true },
    { id: 'directed', kind: 'select', options: ['undirected', 'directed'] },
    f('seed', '1', { help: true }),
  ],
  solve: solveWith(networkOutcome),
};
