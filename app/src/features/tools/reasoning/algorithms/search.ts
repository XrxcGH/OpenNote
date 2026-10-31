// Informed search and game search: A* and greedy best-first on a weighted graph with a heuristic table, and minimax
// with alpha-beta pruning on a tree of leaf values typed with parentheses, such as ((3, 5), (2, 9)).
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines, num } from '../core/util';
import { adjacency } from './graphs';
import type { Graph } from './graphs';

/** Heuristic values, one "node value" pair per line or comma. */
export function parseHeuristic(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of lines(text).flatMap((l) => l.split(/[,;]/))) {
    const p = part.trim();
    if (!p) continue;
    const m = /^(\S+)\s*[:=]?\s+(-?\d+(?:\.\d+)?)$/.exec(p) ?? /^(\S+?)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/.exec(p);
    if (!m) fail('heuristicLine', { line: p });
    out.set(m![1], Number(m![2]));
  }
  return out;
}

export interface Expansion {
  node: string;
  g: number;
  h: number;
  f: number;
  open: string;
}

export function bestFirst(g: Graph, h: Map<string, number>, start: string, goal: string, greedy: boolean) {
  for (const q of [start, goal]) if (!g.nodes.includes(q)) fail('noNode', { node: q });
  if (g.edges.some((e) => e.w < 0)) fail('negativeWeight');
  const adj = adjacency(g);
  const hOf = (q: string) => h.get(q) ?? 0;
  const gOf = new Map([[start, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([start]);
  const closed = new Set<string>();
  const expansions: Expansion[] = [];
  const score = (q: string) => (greedy ? hOf(q) : gOf.get(q)! + hOf(q));
  while (open.size) {
    const u = [...open].sort((a, b) => score(a) - score(b) || hOf(a) - hOf(b) || (a < b ? -1 : 1))[0];
    open.delete(u);
    closed.add(u);
    expansions.push({
      node: u,
      g: gOf.get(u)!,
      h: hOf(u),
      f: score(u),
      open: [...open].map((q) => `${q} ${num(score(q))}`).join(', ') || '∅',
    });
    if (u === goal) {
      const path = [goal];
      while (path[0] !== start) path.unshift(prev.get(path[0])!);
      return { path, cost: gOf.get(goal)!, expansions };
    }
    if (expansions.length > 10_000) break;
    for (const a of adj.get(u)!) {
      const alt = gOf.get(u)! + a.w;
      if (closed.has(a.to) && alt >= gOf.get(a.to)!) continue;
      if (!gOf.has(a.to) || alt < gOf.get(a.to)!) {
        gOf.set(a.to, alt);
        prev.set(a.to, u);
        closed.delete(a.to);
        open.add(a.to);
      }
    }
  }
  return { path: [] as string[], cost: Infinity, expansions };
}

/** Whether h never overestimates the true remaining cost (checked by Dijkstra from the goal on the reversed graph). */
export function admissible(g: Graph, h: Map<string, number>, goal: string): string[] {
  const rev: Graph = { ...g, edges: g.directed ? g.edges.map((e) => ({ u: e.v, v: e.u, w: e.w })) : g.edges };
  const adj = adjacency(rev);
  const dist = new Map(g.nodes.map((q) => [q, Infinity]));
  dist.set(goal, 0);
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    for (const q of g.nodes)
      if (!done.has(q) && dist.get(q)! < Infinity && (u === null || dist.get(q)! < dist.get(u)!)) u = q;
    if (u === null) break;
    done.add(u);
    for (const a of adj.get(u)!) dist.set(a.to, Math.min(dist.get(a.to)!, dist.get(u)! + a.w));
  }
  return g.nodes.filter((q) => (h.get(q) ?? 0) > dist.get(q)! + 1e-12);
}

/* ---------- Minimax ---------- */

export interface GameTree {
  value?: number;
  kids: GameTree[];
}

export function parseGameTree(text: string): GameTree {
  const t = text.replace(/\s+/g, '');
  let i = 0;
  const parse = (): GameTree => {
    if (t[i] === '(') {
      i += 1;
      const kids = [parse()];
      while (t[i] === ',') {
        i += 1;
        kids.push(parse());
      }
      if (t[i] !== ')') fail('treeText', { at: i + 1 });
      i += 1;
      return { kids };
    }
    const m = /^-?\d+(\.\d+)?/.exec(t.slice(i));
    if (!m) return fail('treeText', { at: i + 1 });
    i += m[0].length;
    return { value: Number(m[0]), kids: [] };
  };
  if (!t) fail('treeEmpty');
  const root = parse();
  if (i !== t.length) fail('treeText', { at: i + 1 });
  return root;
}

export interface Searched {
  value: number;
  /** Children searched, in order; the rest were pruned. */
  kids: Searched[];
  pruned: number;
  leaf: boolean;
  alpha: number;
  beta: number;
}

/** Minimax with alpha-beta: the root maximizes. Returns the searched tree and how many leaves were evaluated. */
export function alphaBeta(root: GameTree, prune: boolean): { tree: Searched; leaves: number; log: Step[] } {
  let leaves = 0;
  const log: Step[] = [];
  const go = (n: GameTree, max: boolean, alpha: number, beta: number, depth: number): Searched => {
    if (!n.kids.length) {
      leaves += 1;
      return { value: n.value!, kids: [], pruned: 0, leaf: true, alpha, beta };
    }
    let best = max ? -Infinity : Infinity;
    const kids: Searched[] = [];
    for (let k = 0; k < n.kids.length; k += 1) {
      const c = go(n.kids[k], !max, alpha, beta, depth + 1);
      kids.push(c);
      best = max ? Math.max(best, c.value) : Math.min(best, c.value);
      if (max) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (prune && alpha >= beta && k < n.kids.length - 1) {
        log.push(
          step('cut', {
            depth,
            kind: max ? 'beta' : 'alpha',
            count: n.kids.length - k - 1,
            alpha: num(alpha),
            beta: num(beta),
          }),
        );
        return { value: best, kids, pruned: n.kids.length - k - 1, leaf: false, alpha, beta };
      }
    }
    return { value: best, kids, pruned: 0, leaf: false, alpha, beta };
  };
  const tree = go(root, true, -Infinity, Infinity, 0);
  return { tree, leaves, log };
}
