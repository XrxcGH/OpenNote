// Tidy drawings of trees, such as syntax trees, phylogenies, game trees, and dendrograms for clusters. The
// placement is Walker's algorithm in the linear-time form of Buchheim, Jünger, and Leipert (2002), for nodes of
// any size. Each parent sits over the midpoint of its first and last children, and no two boxes on a level
// overlap. The tree is also laid out from the right and the two drawings averaged. That keeps every constraint, and
// it makes a mirror-image tree give exactly the mirror-image drawing.
import { ensure } from '../errors';

export interface TreeInput {
  id: string;
  label?: string;
  /** The box size; defaults to 1 by 1. */
  width?: number;
  height?: number;
  /** A fixed depth coordinate, such as a merge height in a dendrogram; the layout's depth axis uses it as given. */
  depth?: number;
  children?: readonly TreeInput[];
}

export type TreeOrientation = 'down' | 'right' | 'radial';

export interface TreeOptions {
  orientation?: TreeOrientation;
  /** Space between the boxes of two siblings. */
  gap?: number;
  /** Space between the boxes of neighbors that are not siblings; defaults to `gap`. */
  subtreeGap?: number;
  /** Distance from one level to the next, when nodes have no fixed depth. */
  levelGap?: number;
  /** 'elbow' draws square corners (dendrograms, phylogenies); 'straight' joins centers. */
  edges?: 'straight' | 'elbow';
}

export interface LaidNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0 for the root. */
  level: number;
  parent: string | null;
}

export interface LaidEdge {
  from: string;
  to: string;
  points: [number, number][];
}

export interface TreeLayout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** The most nodes a drawing takes; larger trees are refused with a clear message. */
export const MAX_TREE_NODES = 5000;

interface Work {
  input: TreeInput;
  parent: Work | null;
  children: Work[];
  index: number;
  level: number;
  size: number;
  prelim: number;
  mod: number;
  change: number;
  shift: number;
  thread: Work | null;
  ancestor: Work;
}

function build(input: TreeInput, parent: Work | null, index: number, level: number, along: 'width' | 'height'): Work {
  const node = {
    input,
    parent,
    children: [] as Work[],
    index,
    level,
    size: input[along] ?? 1,
    prelim: 0,
    mod: 0,
    change: 0,
    shift: 0,
    thread: null,
  } as unknown as Work;
  node.ancestor = node;
  node.children = (input.children ?? []).map((c, i) => build(c, node, i, level + 1, along));
  return node;
}

const nextLeft = (v: Work): Work | null => v.children[0] ?? v.thread;
const nextRight = (v: Work): Work | null => v.children[v.children.length - 1] ?? v.thread;
const leftSibling = (v: Work): Work | null => (v.parent && v.index > 0 ? v.parent.children[v.index - 1] : null);

class Placer {
  constructor(
    private readonly gap: number,
    private readonly subtreeGap: number,
  ) {}

  distance(a: Work, b: Work): number {
    return (a.size + b.size) / 2 + (a.parent === b.parent ? this.gap : this.subtreeGap);
  }

  firstWalk(v: Work): void {
    const w = leftSibling(v);
    if (v.children.length === 0) {
      v.prelim = w ? w.prelim + this.distance(w, v) : 0;
      return;
    }
    let defaultAncestor = v.children[0];
    for (const child of v.children) {
      this.firstWalk(child);
      defaultAncestor = this.apportion(child, defaultAncestor);
    }
    executeShifts(v);
    const mid = (v.children[0].prelim + v.children[v.children.length - 1].prelim) / 2;
    if (w) {
      v.prelim = w.prelim + this.distance(w, v);
      v.mod = v.prelim - mid;
    } else {
      v.prelim = mid;
    }
  }

  apportion(v: Work, defaultAncestor: Work): Work {
    const w = leftSibling(v);
    if (!w || !v.parent) return defaultAncestor;
    let [vip, vop, vim, vom] = [v, v, w, v.parent.children[0]];
    let [sip, sop, sim, som] = [vip.mod, vop.mod, vim.mod, vom.mod];
    let ancestor = defaultAncestor;
    for (let r = nextRight(vim), l = nextLeft(vip); r && l; r = nextRight(vim), l = nextLeft(vip)) {
      [vim, vip] = [r, l];
      vom = nextLeft(vom) ?? vom;
      vop = nextRight(vop) ?? vop;
      vop.ancestor = v;
      const shift = vim.prelim + sim - (vip.prelim + sip) + this.distance(vim, vip);
      if (shift > 0) {
        moveSubtree(vim.ancestor.parent === v.parent ? vim.ancestor : ancestor, v, shift);
        sip += shift;
        sop += shift;
      }
      [sim, sip, som, sop] = [sim + vim.mod, sip + vip.mod, som + vom.mod, sop + vop.mod];
    }
    if (nextRight(vim) && !nextRight(vop)) {
      vop.thread = nextRight(vim);
      vop.mod += sim - sop;
    }
    if (nextLeft(vip) && !nextLeft(vom)) {
      vom.thread = nextLeft(vip);
      vom.mod += sip - som;
      ancestor = v;
    }
    return ancestor;
  }
}

function moveSubtree(wm: Work, wp: Work, shift: number): void {
  const subtrees = wp.index - wm.index;
  wp.change -= shift / subtrees;
  wp.shift += shift;
  wm.change += shift / subtrees;
  wp.prelim += shift;
  wp.mod += shift;
}

function executeShifts(v: Work): void {
  let shift = 0;
  let change = 0;
  for (let i = v.children.length - 1; i >= 0; i -= 1) {
    const w = v.children[i];
    w.prelim += shift;
    w.mod += shift;
    change += w.change;
    shift += w.shift + change;
  }
}

/** The breadth coordinate of every node, by id, from one left-to-right pass. */
function breadths(input: TreeInput, options: Required<Omit<TreeOptions, 'edges'>>): Map<string, number> {
  const along = options.orientation === 'right' ? 'height' : 'width';
  const root = build(input, null, 0, 0, along);
  new Placer(options.gap, options.subtreeGap).firstWalk(root);
  const out = new Map<string, number>();
  const walk = (v: Work, m: number): void => {
    out.set(v.input.id, v.prelim + m);
    for (const c of v.children) walk(c, m + v.mod);
  };
  walk(root, -root.prelim);
  return out;
}

function mirror(input: TreeInput): TreeInput {
  return { ...input, children: [...(input.children ?? [])].reverse().map(mirror) };
}

function checkTree(input: TreeInput): number {
  const ids = new Set<string>();
  const visit = (node: TreeInput): void => {
    ensure(!ids.has(node.id), 'shape', node.id);
    ids.add(node.id);
    ensure(ids.size <= MAX_TREE_NODES, 'tooLarge', String(MAX_TREE_NODES));
    for (const c of node.children ?? []) visit(c);
  };
  visit(input);
  return ids.size;
}

/** Lays out a tree. Node ids must be unique. */
export function layoutTree(input: TreeInput, options: TreeOptions = {}): TreeLayout {
  checkTree(input);
  const gap = options.gap ?? 0.5;
  const full = {
    orientation: options.orientation ?? 'down',
    gap,
    subtreeGap: options.subtreeGap ?? gap,
    levelGap: options.levelGap ?? 1.5,
  };
  const left = breadths(input, full);
  const right = breadths(mirror(input), full);
  const breadth = new Map([...left].map(([id, b]) => [id, (b - (right.get(id) ?? 0)) / 2]));
  const nodes = place(input, breadth, full);
  return { nodes, edges: route(nodes, full.orientation, options.edges ?? 'straight'), bounds: boundsOf(nodes) };
}

function place(input: TreeInput, breadth: Map<string, number>, options: Required<Omit<TreeOptions, 'edges'>>) {
  const nodes: LaidNode[] = [];
  const visit = (node: TreeInput, parent: string | null, level: number): void => {
    const depth = node.depth ?? level * options.levelGap;
    const b = breadth.get(node.id) ?? 0;
    const [x, y] = options.orientation === 'right' ? [depth, b] : [b, depth];
    const label = node.label ?? node.id;
    nodes.push({ id: node.id, label, x, y, width: node.width ?? 1, height: node.height ?? 1, level, parent });
    for (const c of node.children ?? []) visit(c, node.id, level + 1);
  };
  visit(input, null, 0);
  return options.orientation === 'radial' ? toRadial(nodes, options.gap) : nodes;
}

/** Wraps the breadth axis once around the circle (with one gap between the ends) and uses depth as the radius. */
function toRadial(nodes: LaidNode[], gap: number): LaidNode[] {
  const xs = nodes.map((n) => n.x);
  const lo = Math.min(...xs) - gap / 2 - 0.5;
  const span = Math.max(...xs) + gap / 2 + 0.5 - lo;
  return nodes.map((n) => {
    const angle = ((n.x - lo) / span) * 2 * Math.PI;
    return { ...n, x: n.y * Math.cos(angle), y: n.y * Math.sin(angle) };
  });
}

function route(nodes: readonly LaidNode[], orientation: TreeOrientation, style: 'straight' | 'elbow'): LaidEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: LaidEdge[] = [];
  for (const child of nodes) {
    const parent = child.parent === null ? undefined : byId.get(child.parent);
    if (!parent) continue;
    const points: [number, number][] = [[parent.x, parent.y]];
    if (style === 'elbow' && orientation === 'down') points.push([child.x, parent.y]);
    if (style === 'elbow' && orientation === 'right') points.push([parent.x, child.y]);
    points.push([child.x, child.y]);
    edges.push({ from: parent.id, to: child.id, points });
  }
  return edges;
}

function boundsOf(nodes: readonly LaidNode[]): TreeLayout['bounds'] {
  return {
    minX: Math.min(...nodes.map((n) => n.x - n.width / 2)),
    minY: Math.min(...nodes.map((n) => n.y - n.height / 2)),
    maxX: Math.max(...nodes.map((n) => n.x + n.width / 2)),
    maxY: Math.max(...nodes.map((n) => n.y + n.height / 2)),
  };
}
