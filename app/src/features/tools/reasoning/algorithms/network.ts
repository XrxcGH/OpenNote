// Network measures from an edge list: degree, betweenness (Brandes' algorithm, unnormalized), closeness, eigenvector
// centrality and PageRank (power iteration, damping 0.85), clustering, density, path lengths, and communities by
// the Louvain method in a seeded order with their modularity. Edge weights are ignored except in modularity.
import { seeded } from '../core/util';
import { adjacency, components } from './graphs';
import type { Graph } from './graphs';

const neighbors = (g: Graph): Map<string, string[]> => {
  const adj = adjacency(g);
  return new Map([...adj].map(([q, arcs]) => [q, [...new Set(arcs.map((a) => a.to))]]));
};

/** Shortest-path counts from each source (unweighted), as Brandes' algorithm needs. */
export function betweenness(g: Graph): Map<string, number> {
  const nb = neighbors(g);
  const cb = new Map(g.nodes.map((q) => [q, 0]));
  for (const s of g.nodes) {
    const stack: string[] = [];
    const pred = new Map(g.nodes.map((q) => [q, [] as string[]]));
    const sigma = new Map(g.nodes.map((q) => [q, 0]));
    const dist = new Map(g.nodes.map((q) => [q, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue = [s];
    for (let i = 0; i < queue.length; i += 1) {
      const v = queue[i];
      stack.push(v);
      for (const w of nb.get(v)!) {
        if (dist.get(w)! < 0) {
          queue.push(w);
          dist.set(w, dist.get(v)! + 1);
        }
        if (dist.get(w) === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map(g.nodes.map((q) => [q, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w)!) delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      if (w !== s) cb.set(w, cb.get(w)! + delta.get(w)!);
    }
  }
  // An undirected graph counts each pair from both ends.
  if (!g.directed) for (const q of g.nodes) cb.set(q, cb.get(q)! / 2);
  return cb;
}

function distancesFrom(nb: Map<string, string[]>, s: string): Map<string, number> {
  const dist = new Map([[s, 0]]);
  const queue = [s];
  for (let i = 0; i < queue.length; i += 1)
    for (const w of nb.get(queue[i])!)
      if (!dist.has(w)) {
        dist.set(w, dist.get(queue[i])! + 1);
        queue.push(w);
      }
  return dist;
}

/** Closeness: (reachable − 1) / total distance to them, within the node's component. */
export function closeness(g: Graph): Map<string, number> {
  const nb = neighbors(g);
  return new Map(
    g.nodes.map((q) => {
      const d = distancesFrom(nb, q);
      const total = [...d.values()].reduce((a, b) => a + b, 0);
      return [q, total > 0 ? (d.size - 1) / total : 0];
    }),
  );
}

/** Eigenvector centrality by power iteration on A + I (same eigenvector, no oscillation), scaled to sum 1. */
export function eigenvector(g: Graph): Map<string, number> {
  const nb = neighbors({ ...g, directed: false });
  let x = new Map(g.nodes.map((q) => [q, 1 / g.nodes.length]));
  for (let it = 0; it < 1000; it += 1) {
    const next = new Map(g.nodes.map((q) => [q, x.get(q)! + nb.get(q)!.reduce((a, w) => a + x.get(w)!, 0)]));
    const sum = [...next.values()].reduce((a, b) => a + b, 0) || 1;
    for (const q of g.nodes) next.set(q, next.get(q)! / sum);
    const diff = g.nodes.reduce((a, q) => a + Math.abs(next.get(q)! - x.get(q)!), 0);
    x = next;
    if (diff < 1e-13) break;
  }
  return x;
}

export function pageRank(g: Graph, damping = 0.85): { rank: Map<string, number>; iterations: number } {
  const n = g.nodes.length;
  const out = neighbors(g);
  let r = new Map(g.nodes.map((q) => [q, 1 / n]));
  let iterations = 0;
  for (; iterations < 10_000; iterations += 1) {
    const dangling = g.nodes.filter((q) => out.get(q)!.length === 0).reduce((a, q) => a + r.get(q)!, 0);
    const next = new Map(g.nodes.map((q) => [q, (1 - damping) / n + (damping * dangling) / n]));
    for (const q of g.nodes)
      for (const w of out.get(q)!) next.set(w, next.get(w)! + (damping * r.get(q)!) / out.get(q)!.length);
    const diff = g.nodes.reduce((a, q) => a + Math.abs(next.get(q)! - r.get(q)!), 0);
    r = next;
    if (diff < 1e-14) break;
  }
  return { rank: r, iterations: iterations + 1 };
}

export function clustering(g: Graph): Map<string, number> {
  const nb = neighbors({ ...g, directed: false });
  return new Map(
    g.nodes.map((q) => {
      const list = nb.get(q)!.filter((w) => w !== q);
      const k = list.length;
      if (k < 2) return [q, 0];
      let links = 0;
      for (let i = 0; i < k; i += 1)
        for (let j = i + 1; j < k; j += 1) if (nb.get(list[i])!.includes(list[j])) links += 1;
      return [q, (2 * links) / (k * (k - 1))];
    }),
  );
}

export function summary(g: Graph) {
  const n = g.nodes.length;
  const pairs = g.directed ? n * (n - 1) : (n * (n - 1)) / 2;
  const nb = neighbors(g);
  let total = 0;
  let count = 0;
  let diameter = 0;
  for (const q of g.nodes)
    for (const [w, d] of distancesFrom(nb, q))
      if (w !== q) {
        total += d;
        count += 1;
        diameter = Math.max(diameter, d);
      }
  const simple = new Set(
    g.edges
      .filter((e) => e.u !== e.v)
      .map((e) => (g.directed || e.u < e.v ? `${e.u}\u0000${e.v}` : `${e.v}\u0000${e.u}`)),
  );
  return {
    density: pairs ? simple.size / pairs : 0,
    averagePath: count ? total / count : 0,
    diameter,
    components: components(g).length,
  };
}

/** Modularity of a split into communities, on the undirected weighted graph. */
export function modularity(g: Graph, community: Map<string, number>): number {
  const m = g.edges.reduce((a, e) => a + e.w, 0);
  if (m === 0) return 0;
  const k = new Map(g.nodes.map((q) => [q, 0]));
  for (const e of g.edges) {
    k.set(e.u, k.get(e.u)! + e.w);
    k.set(e.v, k.get(e.v)! + e.w);
  }
  let inside = 0;
  for (const e of g.edges) if (community.get(e.u) === community.get(e.v)) inside += e.w;
  const tot = new Map<number, number>();
  for (const q of g.nodes) tot.set(community.get(q)!, (tot.get(community.get(q)!) ?? 0) + k.get(q)!);
  return inside / m - [...tot.values()].reduce((a, t) => a + (t / (2 * m)) ** 2, 0);
}

/** The Louvain method: move nodes to the neighboring community that most raises modularity, then merge and repeat. */
export function louvain(g: Graph, seed = 1): { community: Map<string, number>; modularity: number; levels: number } {
  const rand = seeded(seed);
  // Level graph: nodes are groups of original nodes; weights between groups.
  let groups: string[][] = g.nodes.map((q) => [q]);
  let w = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  g.edges.forEach((e) => {
    const a = g.nodes.indexOf(e.u);
    const b = g.nodes.indexOf(e.v);
    w.set(key(a, b), (w.get(key(a, b)) ?? 0) + e.w);
  });
  const m = g.edges.reduce((a, e) => a + e.w, 0);
  let levels = 0;
  for (; levels < 20 && m > 0; levels += 1) {
    const n = groups.length;
    const nb: Map<number, number>[] = Array.from({ length: n }, () => new Map());
    const deg = new Array<number>(n).fill(0);
    for (const [k, x] of w) {
      const [a, b] = k.split(',').map(Number);
      if (a === b) {
        deg[a] += 2 * x;
        nb[a].set(a, (nb[a].get(a) ?? 0) + 2 * x);
      } else {
        deg[a] += x;
        deg[b] += x;
        nb[a].set(b, (nb[a].get(b) ?? 0) + x);
        nb[b].set(a, (nb[b].get(a) ?? 0) + x);
      }
    }
    const comm = Array.from({ length: n }, (_, i) => i);
    const tot = deg.slice();
    let moved = false;
    for (let pass = 0; pass < 100; pass += 1) {
      let any = false;
      const order = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const v of order) {
        const links = new Map<number, number>();
        for (const [u, x] of nb[v]) if (u !== v) links.set(comm[u], (links.get(comm[u]) ?? 0) + x);
        const own = comm[v];
        tot[own] -= deg[v];
        let best = own;
        let gain = (links.get(own) ?? 0) - (tot[own] * deg[v]) / (2 * m);
        for (const [c, x] of links) {
          const gc = x - (tot[c] * deg[v]) / (2 * m);
          if (gc > gain + 1e-12) {
            gain = gc;
            best = c;
          }
        }
        tot[best] += deg[v];
        if (best !== own) {
          comm[v] = best;
          any = true;
          moved = true;
        }
      }
      if (!any) break;
    }
    if (!moved) break;
    const ids = [...new Set(comm)];
    const next: string[][] = ids.map(() => []);
    comm.forEach((c, i) => next[ids.indexOf(c)].push(...groups[i]));
    const nw = new Map<string, number>();
    for (const [k, x] of w) {
      const [a, b] = k.split(',').map(Number);
      const kk = key(ids.indexOf(comm[a]), ids.indexOf(comm[b]));
      nw.set(kk, (nw.get(kk) ?? 0) + x);
    }
    groups = next;
    w = nw;
  }
  const community = new Map<string, number>();
  groups.forEach((members, i) => members.forEach((q) => community.set(q, i)));
  return { community, modularity: modularity(g, community), levels };
}
