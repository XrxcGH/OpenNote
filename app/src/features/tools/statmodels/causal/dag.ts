// Causal diagrams. A diagram is a list of arrows such as "Z -> X". d-separation is tested by the reachability
// ("Bayes ball") algorithm: a trail stays open through a chain or fork whose middle is not conditioned on, and
// through a collider only when the collider or one of its descendants is. A set S satisfies the back-door criterion
// for X on Y when no member descends from X and S d-separates X from Y once the arrows out of X are removed.
import { fail } from '../kit/types';

export interface Dag {
  readonly nodes: readonly string[];
  readonly parents: ReadonlyMap<string, readonly string[]>;
  readonly children: ReadonlyMap<string, readonly string[]>;
  readonly edges: readonly (readonly [string, string])[];
}

export const MAX_ADJUST_NODES = 12;

/** Reads arrows separated by commas, semicolons, or lines: "A -> B", "A → B", or chains such as "A -> B -> C". */
export function parseDag(text: string): Dag {
  const edges: [string, string][] = [];
  const nodes: string[] = [];
  const add = (name: string) => {
    if (!nodes.includes(name)) nodes.push(name);
  };
  text
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .forEach((piece) => {
      const names = piece.split(/\s*(?:->|→)\s*/).map((s) => s.trim());
      if (names.length < 2 || names.some((n) => n === '' || /\s|<|>|-/.test(n))) fail('dagArrow', piece);
      names.forEach(add);
      for (let i = 1; i < names.length; i++) {
        if (names[i - 1] === names[i]) fail('dagSelf', names[i]);
        if (!edges.some(([a, b]) => a === names[i - 1] && b === names[i])) edges.push([names[i - 1], names[i]]);
      }
    });
  if (edges.length === 0) fail('dagEmpty');
  const parents = new Map<string, string[]>(nodes.map((n) => [n, []]));
  const children = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) {
    parents.get(b)?.push(a);
    children.get(a)?.push(b);
  }
  const dag = { nodes, parents, children, edges };
  const cycle = findCycle(dag);
  if (cycle) fail('dagCycle', cycle.join(' → '));
  return dag;
}

function findCycle(dag: Dag): string[] | null {
  const state = new Map<string, number>();
  const path: string[] = [];
  const visit = (n: string): string[] | null => {
    state.set(n, 1);
    path.push(n);
    for (const c of dag.children.get(n) ?? []) {
      if (state.get(c) === 1) return [...path.slice(path.indexOf(c)), c];
      if (!state.has(c)) {
        const found = visit(c);
        if (found) return found;
      }
    }
    path.pop();
    state.set(n, 2);
    return null;
  };
  for (const n of dag.nodes) {
    if (state.has(n)) continue;
    const found = visit(n);
    if (found) return found;
  }
  return null;
}

const reach = (start: string, next: (n: string) => readonly string[]): Set<string> => {
  const seen = new Set<string>();
  const stack = [...next(start)];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...next(n));
  }
  return seen;
};

export const descendants = (dag: Dag, n: string) => reach(n, (m) => dag.children.get(m) ?? []);
export const ancestors = (dag: Dag, n: string) => reach(n, (m) => dag.parents.get(m) ?? []);

/** The diagram without the arrows out of a node. */
function cutOut(dag: Dag, x: string): Dag {
  const edges = dag.edges.filter(([a]) => a !== x);
  return {
    nodes: dag.nodes,
    edges,
    parents: new Map(dag.nodes.map((n) => [n, edges.filter(([, b]) => b === n).map(([a]) => a)])),
    children: new Map(dag.nodes.map((n) => [n, edges.filter(([a]) => a === n).map(([, b]) => b)])),
  };
}

/** Whether x and y are d-separated given the set z. */
export function dSeparated(dag: Dag, x: string, y: string, z: readonly string[]): boolean {
  const given = new Set(z);
  const openColliders = new Set<string>(z);
  for (const n of z) for (const a of ancestors(dag, n)) openColliders.add(a);
  // Visit (node, direction): 'up' means reached from a child, 'down' from a parent.
  const seen = new Set<string>();
  const queue: [string, 'up' | 'down'][] = [[x, 'up']];
  while (queue.length) {
    const [n, dir] = queue.shift() as [string, 'up' | 'down'];
    const key = `${n}|${dir}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (n === y && !given.has(n)) return false;
    const parents = dag.parents.get(n) ?? [];
    const children = dag.children.get(n) ?? [];
    if (dir === 'up' && !given.has(n)) {
      parents.forEach((p) => queue.push([p, 'up']));
      children.forEach((c) => queue.push([c, 'down']));
    } else if (dir === 'down') {
      if (!given.has(n)) children.forEach((c) => queue.push([c, 'down']));
      if (openColliders.has(n)) parents.forEach((p) => queue.push([p, 'up']));
    }
  }
  return true;
}

/** Whether z satisfies the back-door criterion for the effect of x on y. */
export function isBackdoorSet(dag: Dag, x: string, y: string, z: readonly string[]): boolean {
  const desc = descendants(dag, x);
  if (z.some((n) => desc.has(n) || n === x || n === y)) return false;
  return dSeparated(cutOut(dag, x), x, y, z);
}

export interface Adjustment {
  /** Every minimal back-door set, smallest first. */
  readonly minimal: readonly (readonly string[])[];
  readonly candidates: readonly string[];
  readonly mediators: readonly string[];
  readonly treatmentDescendants: readonly string[];
  readonly colliders: readonly string[];
  readonly confounders: readonly string[];
  readonly openPaths: number;
}

/** Lists the minimal back-door sets by enumeration over the nodes that do not descend from x. */
export function adjustmentSets(dag: Dag, x: string, y: string): Adjustment {
  for (const n of [x, y]) if (!dag.nodes.includes(n)) fail('dagNode', n);
  if (x === y) fail('sameColumn');
  const desc = descendants(dag, x);
  const candidates = dag.nodes.filter((n) => n !== x && n !== y && !desc.has(n));
  if (candidates.length > MAX_ADJUST_NODES) fail('dagTooLarge', String(MAX_ADJUST_NODES));
  const valid: string[][] = [];
  for (let mask = 0; mask < 1 << candidates.length; mask++) {
    const set = candidates.filter((_, i) => mask & (1 << i));
    if (valid.some((v) => v.every((n) => set.includes(n)))) continue;
    if (isBackdoorSet(dag, x, y, set)) valid.push(set);
  }
  valid.sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
  const minimal = valid.filter(
    (v) => !valid.some((u) => u !== v && u.length < v.length && u.every((n) => v.includes(n))),
  );
  const yAnc = ancestors(dag, y);
  const xAnc = ancestors(dag, x);
  return {
    minimal,
    candidates,
    mediators: dag.nodes.filter((n) => desc.has(n) && yAnc.has(n)),
    treatmentDescendants: dag.nodes.filter((n) => desc.has(n) && n !== y),
    colliders: dag.nodes.filter((n) => n !== y && (dag.parents.get(n)?.length ?? 0) >= 2),
    confounders: dag.nodes.filter((n) => xAnc.has(n) && yAnc.has(n) && !desc.has(n)),
    openPaths: dSeparated(cutOut(dag, x), x, y, []) ? 0 : 1,
  };
}

/** Layers for drawing: each node one below its deepest parent. */
export function layers(dag: Dag): string[][] {
  const depth = new Map<string, number>();
  const at = (n: string): number => {
    const known = depth.get(n);
    if (known !== undefined) return known;
    const d = Math.max(-1, ...(dag.parents.get(n) ?? []).map(at)) + 1;
    depth.set(n, d);
    return d;
  };
  dag.nodes.forEach(at);
  const out: string[][] = [];
  for (const n of dag.nodes) (out[depth.get(n) as number] ??= []).push(n);
  return out;
}
