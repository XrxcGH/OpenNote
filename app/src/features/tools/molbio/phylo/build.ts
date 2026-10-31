// Building trees: distances from an alignment (p, Jukes-Cantor, Kimura two-parameter, Poisson), UPGMA and
// neighbor-joining with every intermediate matrix kept for the worked steps, Fitch parsimony on a given tree and by
// exhaustive branch-and-bound search, and a seeded bootstrap with a majority-rule consensus.
import type { Rng } from '../../subjects/num/rng';
import { fail } from '../shared';
import { clone, isLeaf, leaf, leaves, nodes, splits } from './tree';
import type { TreeNode } from './tree';

export interface Taxon {
  name: string;
  seq: string;
}

export type Model = 'p' | 'jc' | 'k2p' | 'poisson';

export interface Distances {
  names: string[];
  /** Symmetric, zero on the diagonal; NaN where the model is undefined (saturated). */
  d: number[][];
  /** Sites compared for each pair after pairwise deletion. */
  sites: number[][];
}

const PURINE = new Set(['A', 'G']);
const DNA = new Set(['A', 'C', 'G', 'T']);
const GAP = new Set(['-', '.', '?']);

export const jukesCantor = (p: number): number => (p <= 0 ? 0 : p < 0.75 ? -0.75 * Math.log(1 - (4 * p) / 3) : NaN);

export function kimura(P: number, Q: number): number {
  const a = 1 - 2 * P - Q;
  const b = 1 - 2 * Q;
  if (P <= 0 && Q <= 0) return 0;
  return a > 0 && b > 0 ? -0.5 * Math.log(a) - 0.25 * Math.log(b) : NaN;
}

export const poisson = (p: number): number => (p <= 0 ? 0 : p < 1 ? -Math.log(1 - p) : NaN);

/** Pairwise distances; a site with a gap or an ambiguous letter in either sequence is left out of that pair. */
export function distances(taxa: readonly Taxon[], model: Model, protein: boolean): Distances {
  const n = taxa.length;
  const d = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const sites = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = taxa[i]!.seq;
      const b = taxa[j]!.seq;
      let compared = 0;
      let diff = 0;
      let transitions = 0;
      for (let k = 0; k < a.length; k++) {
        const x = a[k]!;
        const y = b[k]!;
        if (GAP.has(x) || GAP.has(y)) continue;
        if (!protein && (!DNA.has(x) || !DNA.has(y))) continue;
        if (protein && (x === 'X' || y === 'X' || x === '*' || y === '*')) continue;
        compared += 1;
        if (x !== y) {
          diff += 1;
          if (!protein && PURINE.has(x) === PURINE.has(y)) transitions += 1;
        }
      }
      if (compared === 0) return fail('phylo.e.noOverlap', { a: taxa[i]!.name, b: taxa[j]!.name });
      const p = diff / compared;
      let value = p;
      if (model === 'jc') value = jukesCantor(p);
      else if (model === 'k2p') value = kimura(transitions / compared, (diff - transitions) / compared);
      else if (model === 'poisson') value = poisson(p);
      d[i]![j] = d[j]![i] = value;
      sites[i]![j] = sites[j]![i] = compared;
    }
  }
  return { names: taxa.map((t) => t.name), d, sites };
}

/** The first pair whose distance is undefined, so a tree is not built on it. */
export function saturated(dist: Distances): [string, string] | null {
  for (let i = 0; i < dist.names.length; i++)
    for (let j = i + 1; j < dist.names.length; j++)
      if (!Number.isFinite(dist.d[i]![j]!)) return [dist.names[i]!, dist.names[j]!];
  return null;
}

export interface JoinStep {
  /** The matrix before this join, with its row names. */
  names: string[];
  matrix: number[][];
  a: string;
  b: string;
  node: string;
  /** Branch lengths from the 2 joined nodes to the new node (NJ), or the new node's height (UPGMA). */
  la: number;
  lb: number;
  q?: number;
  /** The third node and its branch when neighbor-joining ends at a center node. */
  c?: string;
  lc?: number;
}

export interface Built {
  tree: TreeNode;
  steps: JoinStep[];
}

/** Names u, v, w, ... for new nodes, then u2, v2, ... */
const nodeName = (k: number): string => {
  const letters = 'uvwxyz';
  return k < letters.length ? letters[k]! : `${letters[k % letters.length]}${Math.floor(k / letters.length) + 1}`;
};

function checkMatrix(names: readonly string[], d: readonly number[][]): void {
  if (names.length < 3) fail('phylo.e.fewTaxa');
  const bad = saturated({ names: [...names], d: d.map((r) => [...r]), sites: [] });
  if (bad) fail('phylo.e.saturated', { a: bad[0], b: bad[1] });
}

/** UPGMA: join the closest clusters, average distances by cluster size, and place each join at half the distance. */
export function upgma(names: readonly string[], d0: readonly number[][]): Built {
  checkMatrix(names, d0);
  let labels = [...names];
  let d = d0.map((row) => [...row]);
  let clusters: { node: TreeNode; size: number; height: number }[] = names.map((n) => ({
    node: leaf(n),
    size: 1,
    height: 0,
  }));
  const steps: JoinStep[] = [];
  let made = 0;
  while (clusters.length > 1) {
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < d.length; i++)
      for (let j = i + 1; j < d.length; j++) if (d[i]![j]! < d[bi]![bj]!) [bi, bj] = [i, j];
    const height = d[bi]![bj]! / 2;
    const A = clusters[bi]!;
    const B = clusters[bj]!;
    A.node.length = height - A.height;
    B.node.length = height - B.height;
    const name = nodeName(made++);
    steps.push({ names: labels, matrix: d, a: labels[bi]!, b: labels[bj]!, node: name, la: height, lb: height });
    const joined = { node: { name: '', children: [A.node, B.node] } as TreeNode, size: A.size + B.size, height };
    const keep = d.map((_, k) => k).filter((k) => k !== bi && k !== bj);
    const row = keep.map((k) => (A.size * d[bi]![k]! + B.size * d[bj]![k]!) / (A.size + B.size));
    d = [...keep.map((k, x) => [...keep.map((m) => d[k]![m]!), row[x]!]), [...row, 0]];
    labels = [...keep.map((k) => labels[k]!), name];
    clusters = [...keep.map((k) => clusters[k]!), joined];
  }
  const root = clusters[0]!.node;
  delete root.length;
  return { tree: root, steps };
}

/** Neighbor-joining (Saitou and Nei 1987) with the Q criterion; the last three nodes meet at one center node. */
export function neighborJoining(names: readonly string[], d0: readonly number[][]): Built {
  checkMatrix(names, d0);
  let labels = [...names];
  let d = d0.map((row) => [...row]);
  let trees: TreeNode[] = names.map((n) => leaf(n));
  const steps: JoinStep[] = [];
  let made = 0;
  while (trees.length > 3) {
    const n = trees.length;
    const r = d.map((row) => row.reduce((a, b) => a + b, 0));
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const q = (n - 2) * d[i]![j]! - r[i]! - r[j]!;
        if (q < best - 1e-12) [best, bi, bj] = [q, i, j];
      }
    }
    const la = d[bi]![bj]! / 2 + (r[bi]! - r[bj]!) / (2 * (n - 2));
    const lb = d[bi]![bj]! - la;
    const name = nodeName(made++);
    steps.push({ names: labels, matrix: d, a: labels[bi]!, b: labels[bj]!, node: name, la, lb, q: best });
    trees[bi]!.length = la;
    trees[bj]!.length = lb;
    const joined: TreeNode = { name: '', children: [trees[bi]!, trees[bj]!] };
    const keep = d.map((_, k) => k).filter((k) => k !== bi && k !== bj);
    const row = keep.map((k) => (d[bi]![k]! + d[bj]![k]! - d[bi]![bj]!) / 2);
    d = [...keep.map((k, x) => [...keep.map((m) => d[k]![m]!), row[x]!]), [...row, 0]];
    labels = [...keep.map((k) => labels[k]!), name];
    trees = [...keep.map((k) => trees[k]!), joined];
  }
  const [x, y, z] = [0, 1, 2];
  const lx = (d[x]![y]! + d[x]![z]! - d[y]![z]!) / 2;
  const ly = (d[x]![y]! + d[y]![z]! - d[x]![z]!) / 2;
  const lz = (d[x]![z]! + d[y]![z]! - d[x]![y]!) / 2;
  const center = nodeName(made);
  steps.push({
    names: labels,
    matrix: d,
    a: labels[x]!,
    b: labels[y]!,
    node: center,
    la: lx,
    lb: ly,
    c: labels[z]!,
    lc: lz,
  });
  trees[x]!.length = lx;
  trees[y]!.length = ly;
  trees[z]!.length = lz;
  return { tree: { name: '', children: [trees[x]!, trees[y]!, trees[z]!] }, steps };
}

// ---- Parsimony ----

export interface FitchSite {
  score: number;
  /** The state set at each internal node, parents before children, as letters such as "GT". */
  sets: { node: TreeNode; set: string }[];
}

/** Fitch-Hartigan parsimony at one site; a node with k children keeps the states most of them share. */
export function fitch(root: TreeNode, states: ReadonlyMap<string, string>): FitchSite {
  let score = 0;
  const sets: { node: TreeNode; set: string }[] = [];
  const visit = (n: TreeNode): Set<string> => {
    if (isLeaf(n)) {
      const s = states.get(n.name);
      if (s === undefined) return fail('phylo.e.missingTaxon', { name: n.name });
      return GAP.has(s) || s === 'N' || s === 'X' ? new Set(['*']) : new Set([s]);
    }
    const kids = n.children.map(visit).filter((s) => !s.has('*'));
    if (kids.length === 0) return new Set(['*']);
    const tally = new Map<string, number>();
    for (const s of kids) for (const x of s) tally.set(x, (tally.get(x) ?? 0) + 1);
    const most = Math.max(...tally.values());
    score += kids.length - most;
    const set = new Set([...tally].filter(([, c]) => c === most).map(([x]) => x));
    sets.push({ node: n, set: [...set].sort().join('') });
    return set;
  };
  visit(root);
  return { score, sets: sets.reverse() };
}

/** The parsimony score of an alignment on a tree. */
export function parsimonyScore(root: TreeNode, taxa: readonly Taxon[]): number {
  const length = taxa[0]?.seq.length ?? 0;
  let total = 0;
  for (let k = 0; k < length; k++) total += fitch(root, new Map(taxa.map((t) => [t.name, t.seq[k]!]))).score;
  return total;
}

export interface Search {
  best: number;
  trees: TreeNode[];
  /** How many full trees were scored; fewer than the total when branch and bound cut some off. */
  scored: number;
  total: number;
}

/** Double factorial (2n − 5)!!: the number of unrooted binary trees on n taxa. */
export const unrootedTrees = (n: number): number => {
  let out = 1;
  for (let k = 3; k <= 2 * n - 5; k += 2) out *= k;
  return out;
};

/** Every most-parsimonious unrooted tree for up to 9 taxa, by stepwise addition with branch and bound. */
export function searchParsimony(taxa: readonly Taxon[], keep = 20): Search {
  if (taxa.length < 4) return fail('phylo.e.fewParsimony');
  if (taxa.length > 9) return fail('phylo.e.manyParsimony');
  const columns = Array.from({ length: taxa[0]!.seq.length }, (_, k) => new Map(taxa.map((t) => [t.name, t.seq[k]!])));
  const score = (root: TreeNode) => columns.reduce((s, col) => s + fitch(root, col).score, 0);
  let best = Infinity;
  let found: TreeNode[] = [];
  let scored = 0;
  const grow = (root: TreeNode, next: number) => {
    const s = score(root);
    if (s > best) return;
    if (next === taxa.length) {
      scored += 1;
      if (s < best) {
        best = s;
        found = [];
      }
      if (found.length < keep) found.push(clone(root));
      return;
    }
    const all = nodes(root).slice(1);
    for (let k = 0; k < all.length; k++) {
      const copy = clone(root);
      const target = nodes(copy).slice(1)[k]!;
      const parent = nodes(copy).find((p) => p.children.includes(target))!;
      const at = parent.children.indexOf(target);
      parent.children[at] = { name: '', children: [target, leaf(taxa[next]!.name)] };
      grow(copy, next + 1);
    }
  };
  grow({ name: '', children: taxa.slice(0, 3).map((t) => leaf(t.name)) }, 3);
  return { best, trees: found, scored, total: unrootedTrees(taxa.length) };
}

// ---- Bootstrap ----

export interface Bootstrap {
  /** Split key (taxa joined by NUL) to the share of replicates holding it. */
  support: Map<string, number>;
  consensus: TreeNode;
}

/** Resamples alignment columns with replacement, rebuilds the tree each time, and counts every split. */
export function bootstrap(
  taxa: readonly Taxon[],
  model: Model,
  protein: boolean,
  method: 'nj' | 'upgma',
  replicates: number,
  rng: Rng,
): Bootstrap {
  const order = taxa.map((t) => t.name);
  const length = taxa[0]!.seq.length;
  const counts = new Map<string, number>();
  for (let r = 0; r < replicates; r++) {
    const pick = Array.from({ length }, () => rng.integer(length));
    const sample = taxa.map((t) => ({ name: t.name, seq: pick.map((k) => t.seq[k]!).join('') }));
    const dist = distances(sample, model, protein);
    if (saturated(dist)) return fail('phylo.e.bootSaturated');
    const built = method === 'nj' ? neighborJoining(dist.names, dist.d) : upgma(dist.names, dist.d);
    for (const s of splits(built.tree, order)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const support = new Map([...counts].map(([s, c]) => [s, c / replicates]));
  return { support, consensus: majorityRule(order, support) };
}

/** The majority-rule consensus: every split in more than half the replicates, labeled with its percentage. */
export function majorityRule(order: readonly string[], support: ReadonlyMap<string, number>): TreeNode {
  const clusters = [...support]
    .filter(([, share]) => share > 0.5)
    .map(([key, share]) => ({ taxa: new Set(key.split('\u0000')), share }))
    .sort((a, b) => b.taxa.size - a.taxa.size);
  const root: TreeNode = { name: '', children: [] };
  const made: { taxa: Set<string>; node: TreeNode }[] = [];
  const home = (taxa: Set<string>): TreeNode => {
    let at = root;
    let size = Infinity;
    for (const m of made)
      if (m.taxa.size < size && [...taxa].every((t) => m.taxa.has(t))) [at, size] = [m.node, m.taxa.size];
    return at;
  };
  for (const c of clusters) {
    const node: TreeNode = { name: '', support: Math.round(c.share * 100), children: [] };
    home(c.taxa).children.push(node);
    made.push({ taxa: c.taxa, node });
  }
  for (const name of order) home(new Set([name])).children.push(leaf(name));
  return root;
}

export { leaves };
