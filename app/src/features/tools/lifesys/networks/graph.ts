// Random networks, each seeded: Erdős-Rényi, Watts-Strogatz small worlds, and Barabási-Albert preferential
// attachment; their degree distribution, clustering, path length, and largest component; and SIR spread on them.
import { LsError, whole, within } from '../num/errors';
import { createRng, type Rng } from '../num/rng';
import type { CalcResult } from '../types';

type Point = [number, number];
export type Generator = 'er' | 'ws' | 'ba';
export type Graph = Set<number>[];

const empty = (n: number): Graph => Array.from({ length: n }, () => new Set<number>());
const link = (g: Graph, a: number, b: number) => {
  if (a === b) return;
  g[a].add(b);
  g[b].add(a);
};

export function erdosRenyi(n: number, p: number, rng: Rng): Graph {
  const g = empty(n);
  for (let a = 0; a < n; a += 1) for (let b = a + 1; b < n; b += 1) if (rng.next() < p) link(g, a, b);
  return g;
}

/** A ring where each node links to its k nearest neighbors (k even), then each edge is rewired with probability β. */
export function wattsStrogatz(n: number, k: number, beta: number, rng: Rng): Graph {
  const g = empty(n);
  for (let a = 0; a < n; a += 1) for (let j = 1; j <= k / 2; j += 1) link(g, a, (a + j) % n);
  for (let a = 0; a < n; a += 1)
    for (let j = 1; j <= k / 2; j += 1) {
      const b = (a + j) % n;
      if (!g[a].has(b) || rng.next() >= beta) continue;
      let c = rng.int(n);
      let tries = 0;
      while ((c === a || g[a].has(c)) && tries < 10 * n) {
        c = rng.int(n);
        tries += 1;
      }
      if (c === a || g[a].has(c)) continue;
      g[a].delete(b);
      g[b].delete(a);
      link(g, a, c);
    }
  return g;
}

/** Starts from a clique of m + 1 nodes; each new node links to m distinct nodes chosen in proportion to degree. */
export function barabasiAlbert(n: number, m: number, rng: Rng): Graph {
  const g = empty(n);
  const ends: number[] = [];
  for (let a = 0; a <= m; a += 1)
    for (let b = a + 1; b <= m; b += 1) {
      link(g, a, b);
      ends.push(a, b);
    }
  for (let v = m + 1; v < n; v += 1) {
    const chosen = new Set<number>();
    while (chosen.size < m) chosen.add(ends[rng.int(ends.length)]);
    for (const u of chosen) {
      link(g, v, u);
      ends.push(v, u);
    }
  }
  return g;
}

export function makeGraph(kind: Generator, n: number, p: number, k: number, m: number, seed: number): Graph {
  whole(n, 'n', 3);
  within(n, 'n', 3, 2000);
  const rng = createRng(seed);
  if (kind === 'er') return erdosRenyi(n, within(p, 'p', 0, 1), rng);
  if (kind === 'ws') {
    whole(k, 'k', 2);
    if (k % 2 !== 0 || k >= n) throw new LsError('networks.e.wsK');
    return wattsStrogatz(n, k, within(p, 'β', 0, 1), rng);
  }
  whole(m, 'm', 1);
  if (m >= n) throw new LsError('networks.e.baM');
  return barabasiAlbert(n, m, rng);
}

/** The mean local clustering coefficient (nodes with fewer than 2 neighbors count as 0). */
export function clustering(g: Graph): number {
  let sum = 0;
  for (const nb of g) {
    const list = [...nb];
    if (list.length < 2) continue;
    let tri = 0;
    for (let i = 0; i < list.length; i += 1)
      for (let j = i + 1; j < list.length; j += 1) if (g[list[i]].has(list[j])) tri += 1;
    sum += (2 * tri) / (list.length * (list.length - 1));
  }
  return sum / g.length;
}

function bfs(g: Graph, from: number): Int32Array {
  const dist = new Int32Array(g.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let h = 0; h < queue.length; h += 1)
    for (const v of g[queue[h]])
      if (dist[v] < 0) {
        dist[v] = dist[queue[h]] + 1;
        queue.push(v);
      }
  return dist;
}

/** The largest connected component's size, and the mean shortest path within it (from up to 200 sources). */
export function pathStats(g: Graph, rng: Rng) {
  const seen = new Int8Array(g.length);
  let best: number[] = [];
  for (let s = 0; s < g.length; s += 1) {
    if (seen[s]) continue;
    const d = bfs(g, s);
    const comp: number[] = [];
    d.forEach((x, i) => {
      if (x >= 0) {
        seen[i] = 1;
        comp.push(i);
      }
    });
    if (comp.length > best.length) best = comp;
  }
  const sources = best.length <= 200 ? best : rng.shuffle(best).slice(0, 200);
  let total = 0;
  let pairs = 0;
  for (const s of sources) {
    const d = bfs(g, s);
    for (const v of best)
      if (v !== s) {
        total += d[v];
        pairs += 1;
      }
  }
  return { giant: best.length, meanPath: pairs ? total / pairs : 0 };
}

export function networkResult(kind: Generator, n: number, p: number, k: number, m: number, seed: number): CalcResult {
  const g = makeGraph(kind, n, p, k, m, seed);
  const degrees = g.map((s) => s.size);
  const mean = degrees.reduce((s, d) => s + d, 0) / n;
  const counts = new Array<number>(Math.max(...degrees) + 1).fill(0);
  for (const d of degrees) counts[d] += 1;
  const stats = pathStats(g, createRng(seed + 1));
  const c = clustering(g);
  return {
    rows: [
      { label: 'networks.r.edges', value: degrees.reduce((s, d) => s + d, 0) / 2 },
      { label: 'networks.r.meanDegree', value: mean },
      { label: 'networks.r.maxDegree', value: counts.length - 1 },
      { label: 'networks.r.clustering', value: c },
      { label: 'networks.r.meanPath', value: stats.meanPath },
      { label: 'networks.r.giant', value: (100 * stats.giant) / n, unit: '%' },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: `networks.s.gen.${kind}`, vars: { n, p, k, m } },
      { key: 'networks.s.netStats', vars: { d: mean, c, l: stats.meanPath } },
    ],
    notes: [{ key: `networks.n.${kind}` }],
    plots: [
      {
        title: 'networks.p.degrees',
        x: { label: 'networks.p.degree' },
        y: { label: 'networks.p.nodes', min: 0 },
        series: [{ name: 'networks.p.nodesSeries', style: 'bars', points: counts.map((v, d) => [d, v] as Point) }],
      },
    ],
  };
}

/** Discrete-time SIR on a network: each step an infected node infects each susceptible neighbor with probability β. */
export function networkSir(g: Graph, beta: number, gamma: number, seeds: number, rng: Rng, steps = 1000) {
  const state = new Int8Array(g.length);
  for (const v of rng.shuffle(Array.from({ length: g.length }, (_, i) => i)).slice(0, seeds)) state[v] = 1;
  const curve: Point[] = [[0, seeds]];
  for (let t = 1; t <= steps; t += 1) {
    const next = Int8Array.from(state);
    let infected = 0;
    for (let v = 0; v < g.length; v += 1) {
      if (state[v] !== 1) continue;
      for (const u of g[v]) if (state[u] === 0 && next[u] === 0 && rng.next() < beta) next[u] = 1;
      if (rng.next() < gamma) next[v] = 2;
    }
    state.set(next);
    for (let v = 0; v < g.length; v += 1) if (state[v] === 1) infected += 1;
    curve.push([t, infected]);
    if (infected === 0) break;
  }
  let ever = 0;
  for (let v = 0; v < g.length; v += 1) if (state[v] !== 0) ever += 1;
  return { curve, ever };
}

export function networkSirResult(
  kind: Generator,
  n: number,
  p: number,
  k: number,
  m: number,
  beta: number,
  gamma: number,
  seeds: number,
  seed: number,
): CalcResult {
  const g = makeGraph(kind, n, p, k, m, seed);
  within(beta, 'β', 0, 1);
  within(gamma, 'γ', 0, 1);
  whole(seeds, 'I₀', 1);
  if (seeds >= n) throw new LsError('networks.e.i0');
  const run = networkSir(g, beta, gamma, seeds, createRng(seed + 7));
  const peak = run.curve.reduce((b, c) => (c[1] > b[1] ? c : b), run.curve[0]);
  const mean = g.reduce((s, x) => s + x.size, 0) / n;
  return {
    rows: [
      { label: 'networks.r.finalSize', value: (100 * run.ever) / n, unit: '%' },
      { label: 'networks.r.peakI', value: peak[1] },
      { label: 'networks.r.peakTime', value: peak[0] },
      { label: 'networks.r.meanDegree', value: mean },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: `networks.s.gen.${kind}`, vars: { n, p, k, m } },
      { key: 'networks.s.netSir', vars: { b: beta, g: gamma, f: (100 * run.ever) / n, t: run.curve.length - 1 } },
    ],
    notes: [{ key: 'networks.n.netSir' }],
    plots: [
      {
        title: 'networks.p.netEpidemic',
        x: { label: 'networks.p.step' },
        y: { label: 'networks.p.infected', min: 0 },
        series: [{ name: 'networks.p.I', points: run.curve }],
      },
    ],
  };
}
