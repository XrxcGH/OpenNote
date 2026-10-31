// Graphs from an edge list such as A B 4 (also A-B 4 and A -> B 4). Commas or new lines separate edges. The textbook
// algorithms on them log their relaxations, choices, or augmenting paths. Here are breadth- and depth-first search
// with times and edge classes, topological order, and components. Then Dijkstra, Bellman-Ford, Floyd-Warshall,
// Prim, and Kruskal; Edmonds-Karp with the minimum cut; bipartite matching; Euler and Hamilton checks; and coloring.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, num } from '../core/util';

export interface Edge {
  u: string;
  v: string;
  w: number;
}

export interface Graph {
  nodes: string[];
  edges: Edge[];
  directed: boolean;
  weighted: boolean;
}

export const MAX_NODES = 300;

export function parseGraph(text: string, directed: boolean): Graph {
  const nodes: string[] = [];
  const edges: Edge[] = [];
  let weighted = false;
  const add = (q: string) => {
    if (!nodes.includes(q)) {
      if (nodes.length >= MAX_NODES) fail('graphBig', { max: MAX_NODES });
      nodes.push(q);
    }
  };
  for (const raw of text.split(/[,;\n]+/)) {
    const item = raw.trim();
    if (!item || item.startsWith('#')) continue;
    const m = /^([^\s\-–→>]+)\s*(?:->|→|-|–|\s)\s*([^\s\-–→>]+)(?:\s+(-?\d+(?:\.\d+)?(?:e-?\d+)?))?$/i.exec(item);
    if (m) {
      add(m[1]);
      add(m[2]);
      if (m[3] !== undefined) weighted = true;
      edges.push({ u: m[1], v: m[2], w: m[3] === undefined ? 1 : Number(m[3]) });
    } else if (/^[^\s\-–→>]+$/.test(item)) add(item);
    else fail('edgeLine', { line: item });
  }
  if (nodes.length === 0) fail('noGraph');
  return { nodes, edges, directed, weighted };
}

export interface Arc {
  to: string;
  w: number;
  /** The edge this arc comes from, in the list. */
  e: number;
}

export function adjacency(g: Graph): Map<string, Arc[]> {
  const adj = new Map(g.nodes.map((q) => [q, [] as Arc[]]));
  g.edges.forEach((e, i) => {
    adj.get(e.u)!.push({ to: e.v, w: e.w, e: i });
    if (!g.directed && e.u !== e.v) adj.get(e.v)!.push({ to: e.u, w: e.w, e: i });
  });
  return adj;
}

const nodeOf = (g: Graph, q: string) => (g.nodes.includes(q) ? q : fail('noNode', { node: q }));

/* ---------- Search ---------- */

export function bfs(g: Graph, source: string) {
  const s = nodeOf(g, source);
  const adj = adjacency(g);
  const dist = new Map([[s, 0]]);
  const parent = new Map<string, string>();
  const order = [s];
  const tree: number[] = [];
  for (let i = 0; i < order.length; i += 1)
    for (const a of adj.get(order[i])!)
      if (!dist.has(a.to)) {
        dist.set(a.to, dist.get(order[i])! + 1);
        parent.set(a.to, order[i]);
        order.push(a.to);
        tree.push(a.e);
      }
  return { order, dist, parent, tree };
}

export type EdgeClass = 'tree' | 'back' | 'forward' | 'cross';

export function dfs(g: Graph, source: string) {
  const s = nodeOf(g, source);
  const adj = adjacency(g);
  const found = new Map<string, number>();
  const done = new Map<string, number>();
  const classes = new Map<number, EdgeClass>();
  const order: string[] = [];
  let time = 0;
  const visit = (u: string, via: number) => {
    found.set(u, (time += 1));
    order.push(u);
    for (const a of adj.get(u)!) {
      if (!g.directed && a.e === via) continue;
      if (!found.has(a.to)) {
        classes.set(a.e, 'tree');
        visit(a.to, a.e);
      } else if (!classes.has(a.e))
        classes.set(
          a.e,
          !done.has(a.to) ? 'back' : !g.directed ? 'back' : found.get(a.to)! > found.get(u)! ? 'forward' : 'cross',
        );
    }
    done.set(u, (time += 1));
  };
  for (const q of [s, ...g.nodes]) if (!found.has(q)) visit(q, -1);
  return { order, found, done, classes };
}

export function topoSort(g: Graph): { order: string[] } | { cycle: true } {
  if (!g.directed) fail('needsDirected');
  const indeg = new Map(g.nodes.map((q) => [q, 0]));
  for (const e of g.edges) indeg.set(e.v, indeg.get(e.v)! + 1);
  const adj = adjacency(g);
  const ready = g.nodes.filter((q) => indeg.get(q) === 0);
  const order: string[] = [];
  while (ready.length) {
    ready.sort();
    const q = ready.shift()!;
    order.push(q);
    for (const a of adj.get(q)!) {
      indeg.set(a.to, indeg.get(a.to)! - 1);
      if (indeg.get(a.to) === 0) ready.push(a.to);
    }
  }
  return order.length === g.nodes.length ? { order } : { cycle: true };
}

/** Connected components, or strongly connected ones (Tarjan) for a directed graph. */
export function components(g: Graph): string[][] {
  const adj = adjacency(g);
  if (!g.directed) {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const q of g.nodes) {
      if (seen.has(q)) continue;
      const comp = bfs(g, q).order;
      comp.forEach((x) => seen.add(x));
      out.push(comp);
    }
    return out;
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const strong = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    for (const a of adj.get(v)!) {
      if (!idx.has(a.to)) {
        strong(a.to);
        low.set(v, Math.min(low.get(v)!, low.get(a.to)!));
      } else if (on.has(a.to)) low.set(v, Math.min(low.get(v)!, idx.get(a.to)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp.reverse());
    }
  };
  for (const q of g.nodes) if (!idx.has(q)) strong(q);
  return out.reverse();
}

/* ---------- Shortest paths ---------- */

export interface Paths {
  dist: Map<string, number>;
  prev: Map<string, string>;
  log: Step[];
}

export function dijkstra(g: Graph, source: string): Paths {
  const s = nodeOf(g, source);
  if (g.edges.some((e) => e.w < 0)) fail('negativeWeight');
  const adj = adjacency(g);
  const dist = new Map(g.nodes.map((q) => [q, Infinity]));
  const prev = new Map<string, string>();
  const done = new Set<string>();
  const log: Step[] = [];
  dist.set(s, 0);
  for (;;) {
    let u: string | null = null;
    for (const q of g.nodes)
      if (!done.has(q) && dist.get(q)! < Infinity && (u === null || dist.get(q)! < dist.get(u)!)) u = q;
    if (u === null) break;
    done.add(u);
    log.push(step('settle', { node: u, d: num(dist.get(u)!) }));
    for (const a of adj.get(u)!) {
      const alt = dist.get(u)! + a.w;
      if (alt < dist.get(a.to)!) {
        dist.set(a.to, alt);
        prev.set(a.to, u);
        log.push(step('relax', { from: u, to: a.to, d: num(alt) }));
      }
    }
  }
  return { dist, prev, log };
}

export function bellmanFord(g: Graph, source: string): Paths & { negativeCycle: boolean } {
  const s = nodeOf(g, source);
  const adj = adjacency(g);
  const arcs = g.nodes.flatMap((u) => adj.get(u)!.map((a) => ({ u, v: a.to, w: a.w })));
  const dist = new Map(g.nodes.map((q) => [q, Infinity]));
  const prev = new Map<string, string>();
  const log: Step[] = [];
  dist.set(s, 0);
  for (let round = 1; round < g.nodes.length; round += 1) {
    let changed = 0;
    for (const { u, v, w } of arcs)
      if (dist.get(u)! + w < dist.get(v)!) {
        dist.set(v, dist.get(u)! + w);
        prev.set(v, u);
        changed += 1;
      }
    log.push(step('round', { round, changed, dist: g.nodes.map((q) => `${q} ${num(dist.get(q)!)}`).join(', ') }));
    if (!changed) break;
  }
  const negativeCycle = arcs.some(({ u, v, w }) => dist.get(u)! + w < dist.get(v)!);
  return { dist, prev, log, negativeCycle };
}

export function floydWarshall(g: Graph): {
  d: number[][];
  next: (number | null)[][];
  log: Step[];
  negativeCycle: boolean;
} {
  const n = g.nodes.length;
  const at = new Map(g.nodes.map((q, i) => [q, i]));
  const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
  const next: (number | null)[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? j : null)),
  );
  for (const e of g.edges)
    for (const [a, b] of g.directed
      ? [[e.u, e.v]]
      : [
          [e.u, e.v],
          [e.v, e.u],
        ]) {
      const i = at.get(a)!;
      const j = at.get(b)!;
      if (e.w < d[i][j]) {
        d[i][j] = e.w;
        next[i][j] = j;
      }
    }
  const log: Step[] = [];
  for (let k = 0; k < n; k += 1) {
    let changed = 0;
    for (let i = 0; i < n; i += 1)
      for (let j = 0; j < n; j += 1)
        if (d[i][k] + d[k][j] < d[i][j]) {
          d[i][j] = d[i][k] + d[k][j];
          next[i][j] = next[i][k];
          changed += 1;
        }
    log.push(step('through', { node: g.nodes[k], changed }));
  }
  return { d, next, log, negativeCycle: d.some((row, i) => row[i] < 0) };
}

export function pathTo(prev: Map<string, string>, source: string, target: string): string[] {
  const path = [target];
  while (path[0] !== source) {
    const p = prev.get(path[0]);
    if (p === undefined || path.length > prev.size + 1) return [];
    path.unshift(p);
  }
  return path;
}

/* ---------- Spanning trees ---------- */

export function prim(g: Graph, source: string): { tree: number[]; weight: number; log: Step[] } {
  if (g.directed) fail('needsUndirected');
  const s = nodeOf(g, source);
  const adj = adjacency(g);
  const inTree = new Set([s]);
  const tree: number[] = [];
  const log: Step[] = [];
  let weight = 0;
  while (inTree.size < g.nodes.length) {
    let best: { from: string; a: Arc } | null = null;
    for (const u of inTree)
      for (const a of adj.get(u)!) if (!inTree.has(a.to) && (!best || a.w < best.a.w)) best = { from: u, a };
    if (!best) break;
    inTree.add(best.a.to);
    tree.push(best.a.e);
    weight += best.a.w;
    log.push(step('primAdd', { from: best.from, to: best.a.to, w: num(best.a.w) }));
  }
  return { tree, weight, log };
}

export function kruskal(g: Graph): { tree: number[]; weight: number; log: Step[] } {
  if (g.directed) fail('needsUndirected');
  const parent = new Map(g.nodes.map((q) => [q, q]));
  const find = (q: string): string => {
    while (parent.get(q) !== q) {
      parent.set(q, parent.get(parent.get(q)!)!);
      q = parent.get(q)!;
    }
    return q;
  };
  const order = g.edges.map((e, i) => ({ e, i })).sort((a, b) => a.e.w - b.e.w || a.i - b.i);
  const tree: number[] = [];
  const log: Step[] = [];
  let weight = 0;
  for (const { e, i } of order) {
    const a = find(e.u);
    const b = find(e.v);
    if (a === b) log.push(step('kruskalSkip', { u: e.u, v: e.v, w: num(e.w) }));
    else {
      parent.set(a, b);
      tree.push(i);
      weight += e.w;
      log.push(step('kruskalTake', { u: e.u, v: e.v, w: num(e.w) }));
    }
  }
  return { tree, weight, log };
}

/* ---------- Flows and matchings ---------- */

export function maxFlow(g: Graph, source: string, sink: string) {
  const s = nodeOf(g, source);
  const t = nodeOf(g, sink);
  if (s === t) fail('sameEnds');
  if (g.edges.some((e) => e.w < 0)) fail('negativeCapacity');
  const cap = new Map<string, number>();
  const key = (u: string, v: string) => `${u}\u0000${v}`;
  const nbrs = new Map(g.nodes.map((q) => [q, new Set<string>()]));
  const addCap = (u: string, v: string, c: number) => {
    cap.set(key(u, v), (cap.get(key(u, v)) ?? 0) + c);
    nbrs.get(u)!.add(v);
    nbrs.get(v)!.add(u);
  };
  for (const e of g.edges) {
    addCap(e.u, e.v, e.w);
    if (!g.directed) addCap(e.v, e.u, e.w);
  }
  const flow = new Map<string, number>();
  const residual = (u: string, v: string) => (cap.get(key(u, v)) ?? 0) - (flow.get(key(u, v)) ?? 0);
  const log: Step[] = [];
  let total = 0;
  for (let round = 0; round < 10_000; round += 1) {
    const prev = new Map<string, string>([[s, s]]);
    const queue = [s];
    for (let i = 0; i < queue.length && !prev.has(t); i += 1)
      for (const v of nbrs.get(queue[i])!)
        if (!prev.has(v) && residual(queue[i], v) > 1e-12) {
          prev.set(v, queue[i]);
          queue.push(v);
        }
    if (!prev.has(t)) {
      const cut = new Set(prev.keys());
      const cutEdges = g.edges
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => cut.has(e.u) !== cut.has(e.v) && (cut.has(e.u) || !g.directed));
      return {
        total,
        log,
        cut: [...cut],
        cutEdges: cutEdges.map((c) => c.i),
        flow: (u: string, v: string) => flow.get(key(u, v)) ?? 0,
      };
    }
    const path = [t];
    while (path[0] !== s) path.unshift(prev.get(path[0])!);
    let push = Infinity;
    for (let i = 0; i + 1 < path.length; i += 1) push = Math.min(push, residual(path[i], path[i + 1]));
    for (let i = 0; i + 1 < path.length; i += 1) {
      flow.set(key(path[i], path[i + 1]), (flow.get(key(path[i], path[i + 1])) ?? 0) + push);
      flow.set(key(path[i + 1], path[i]), (flow.get(key(path[i + 1], path[i])) ?? 0) - push);
    }
    total += push;
    log.push(step('augment', { path: path.join(' → '), push: num(push), total: num(total) }));
  }
  return fail('flowLimit');
}

/** Two-coloring by breadth-first search; null when an odd cycle makes it impossible. */
export function twoColor(g: Graph): Map<string, 0 | 1> | null {
  const adj = adjacency({ ...g, directed: false });
  const side = new Map<string, 0 | 1>();
  for (const q of g.nodes) {
    if (side.has(q)) continue;
    side.set(q, 0);
    const queue = [q];
    for (let i = 0; i < queue.length; i += 1)
      for (const a of adj.get(queue[i])!) {
        if (!side.has(a.to)) {
          side.set(a.to, side.get(queue[i]) === 0 ? 1 : 0);
          queue.push(a.to);
        } else if (side.get(a.to) === side.get(queue[i])) return null;
      }
  }
  return side;
}

/** A maximum matching of a bipartite graph by augmenting paths. */
export function matching(g: Graph): { pairs: [string, string][]; log: Step[] } {
  const side = twoColor(g) ?? fail('notBipartite');
  const adj = adjacency({ ...g, directed: false });
  const mate = new Map<string, string>();
  const log: Step[] = [];
  const left = g.nodes.filter((q) => side.get(q) === 0);
  const tryAug = (u: string, seen: Set<string>): boolean => {
    for (const a of adj.get(u)!) {
      if (seen.has(a.to)) continue;
      seen.add(a.to);
      if (!mate.has(a.to) || tryAug(mate.get(a.to)!, seen)) {
        mate.set(a.to, u);
        mate.set(u, a.to);
        return true;
      }
    }
    return false;
  };
  for (const u of left)
    if (tryAug(u, new Set())) log.push(step('matchGrow', { node: u, size: left.filter((x) => mate.has(x)).length }));
  return { pairs: left.filter((u) => mate.has(u)).map((u) => [u, mate.get(u)!]), log };
}

/* ---------- Tours and coloring ---------- */

/** The Euler circuit or path by Hierholzer's algorithm, or why there is none. */
export function euler(g: Graph): { kind: 'circuit' | 'path'; walk: string[] } | { kind: 'none'; reason: string } {
  const adj = adjacency(g);
  const used = new Set<number>();
  const deg = new Map(g.nodes.map((q) => [q, { out: 0, in: 0 }]));
  for (const e of g.edges) {
    deg.get(e.u)!.out += 1;
    deg.get(e.v)!.in += 1;
  }
  let start = g.edges[0]?.u ?? g.nodes[0];
  let odd: number;
  if (g.directed) {
    let plus = 0;
    let minus = 0;
    for (const [q, d] of deg) {
      if (d.out - d.in === 1) {
        plus += 1;
        start = q;
      } else if (d.in - d.out === 1) minus += 1;
      else if (d.in !== d.out) return { kind: 'none', reason: 'eulerDegreeDirected' };
    }
    if (plus > 1 || minus > 1) return { kind: 'none', reason: 'eulerDegreeDirected' };
    odd = plus;
  } else {
    const odds = [...deg].filter(([, d]) => (d.in + d.out) % 2 === 1).map(([q]) => q);
    if (odds.length > 2) return { kind: 'none', reason: 'eulerOdd' };
    if (odds.length === 2) start = odds[0];
    odd = odds.length;
  }
  const stack = [start];
  const walk: string[] = [];
  while (stack.length) {
    const u = stack[stack.length - 1];
    const a = adj.get(u)!.find((x) => !used.has(x.e));
    if (a) {
      used.add(a.e);
      stack.push(a.to);
    } else walk.unshift(stack.pop()!);
  }
  if (used.size !== g.edges.length) return { kind: 'none', reason: 'eulerDisconnected' };
  return { kind: odd ? 'path' : 'circuit', walk };
}

export const MAX_HAMILTON = 14;

/** A Hamilton cycle, or else a Hamilton path, by backtracking on small graphs. */
export function hamilton(g: Graph): { kind: 'cycle' | 'path' | 'none'; walk: string[] } {
  if (g.nodes.length > MAX_HAMILTON) fail('hamiltonBig', { max: MAX_HAMILTON });
  const adj = adjacency(g);
  const n = g.nodes.length;
  const has = (u: string, v: string) => adj.get(u)!.some((a) => a.to === v);
  const search = (cycle: boolean): string[] | null => {
    for (const s of cycle ? g.nodes.slice(0, 1) : g.nodes) {
      const path = [s];
      const seen = new Set([s]);
      const go = (): boolean => {
        if (path.length === n) return !cycle || has(path[n - 1], s);
        for (const a of adj.get(path[path.length - 1])!) {
          if (seen.has(a.to)) continue;
          seen.add(a.to);
          path.push(a.to);
          if (go()) return true;
          path.pop();
          seen.delete(a.to);
        }
        return false;
      };
      if (go()) return cycle ? [...path, s] : path;
    }
    return null;
  };
  const c = n >= 3 || g.directed ? search(true) : null;
  if (c) return { kind: 'cycle', walk: c };
  const p = search(false);
  return p ? { kind: 'path', walk: p } : { kind: 'none', walk: [] };
}

/** Greedy coloring in the order the nodes appear: each takes the smallest color no neighbor has. */
export function greedyColor(g: Graph): Map<string, number> {
  const adj = adjacency({ ...g, directed: false });
  const color = new Map<string, number>();
  for (const q of g.nodes) {
    const taken = new Set(adj.get(q)!.map((a) => color.get(a.to)));
    let c = 0;
    while (taken.has(c)) c += 1;
    color.set(q, c);
  }
  return color;
}
