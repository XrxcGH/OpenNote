// Trees for the phylogenetics tool: a plain node model, Newick reading and writing, rerooting on an outgroup,
// ladderizing, and the questions a student asks of a tree (common ancestors, monophyly, sister groups).
import { fail } from '../shared';

export interface TreeNode {
  name: string;
  /** Length of the branch above this node, when the tree has lengths. */
  length?: number;
  /** A label on an internal node, such as a bootstrap percentage. */
  support?: number;
  children: TreeNode[];
}

export const leaf = (name: string, length?: number): TreeNode =>
  length === undefined ? { name, children: [] } : { name, length, children: [] };

export const isLeaf = (node: TreeNode): boolean => node.children.length === 0;

export function leaves(node: TreeNode): string[] {
  return isLeaf(node) ? [node.name] : node.children.flatMap(leaves);
}

export function clone(node: TreeNode): TreeNode {
  return { ...node, children: node.children.map(clone) };
}

/** Every node, parents before children. */
export function nodes(root: TreeNode): TreeNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

export const hasLengths = (root: TreeNode): boolean =>
  nodes(root)
    .slice(1)
    .every((n) => n.length !== undefined);

// ---- Newick ----

/** Reads a Newick string such as ((A:1,B:2):0.5,C:3); with quoted names, internal labels, and [comments]. */
export function readNewick(text: string): TreeNode {
  const src = text.replace(/\[[^\]]*\]/g, '').trim();
  if (src === '') return fail('phylo.e.noNewick');
  let i = 0;
  const peek = () => src[i] ?? '';
  const skip = () => {
    while (/\s/.test(peek())) i += 1;
  };
  const name = (): string => {
    skip();
    if (peek() === "'") {
      i += 1;
      let out = '';
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") {
          out += "'";
          i += 2;
        } else if (src[i] === "'") {
          i += 1;
          return out;
        } else out += src[i++];
      }
      return fail('phylo.e.newickQuote');
    }
    let out = '';
    while (i < src.length && !'(),:;'.includes(peek())) out += src[i++];
    return out.trim().replace(/_/g, ' ');
  };
  const length = (): number | undefined => {
    skip();
    if (peek() !== ':') return undefined;
    i += 1;
    skip();
    const start = i;
    while (i < src.length && /[-+0-9.eE]/.test(peek())) i += 1;
    const value = Number(src.slice(start, i));
    if (start === i || !Number.isFinite(value)) return fail('phylo.e.newickLength', { at: String(start + 1) });
    return value;
  };
  const node = (): TreeNode => {
    skip();
    const out: TreeNode = { name: '', children: [] };
    if (peek() === '(') {
      i += 1;
      for (;;) {
        out.children.push(node());
        skip();
        if (peek() === ',') {
          i += 1;
          continue;
        }
        if (peek() === ')') {
          i += 1;
          break;
        }
        return fail('phylo.e.newickBracket', { at: String(i + 1) });
      }
      const label = name();
      const support = Number(label);
      if (label !== '' && Number.isFinite(support)) out.support = support;
      else out.name = label;
    } else {
      out.name = name();
      if (out.name === '') return fail('phylo.e.newickName', { at: String(i + 1) });
    }
    const len = length();
    if (len !== undefined) out.length = len;
    return out;
  };
  const root = node();
  skip();
  if (peek() === ';') i += 1;
  skip();
  if (i < src.length) return fail('phylo.e.newickExtra', { at: String(i + 1) });
  const names = leaves(root);
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) return fail('phylo.e.duplicateTaxon', { name: n });
    seen.add(n);
  }
  return root;
}

/** A number for Newick: up to 10 significant figures with no trailing zeros. */
export function newickNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(10)));
}

const quote = (name: string): string => (/^[^\s(),:;'[\]]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`);

export function writeNewick(root: TreeNode): string {
  const write = (n: TreeNode): string => {
    const inner = isLeaf(n)
      ? quote(n.name)
      : `(${n.children.map(write).join(',')})${n.support !== undefined ? newickNumber(n.support) : n.name ? quote(n.name) : ''}`;
    return n.length === undefined ? inner : `${inner}:${newickNumber(n.length)}`;
  };
  return `${write(root)};`;
}

// ---- Rerooting and ladderizing ----

interface Edge {
  to: number;
  length: number | undefined;
}

/** Roots the tree on the branch to `outgroup`, halving that branch; a node left with one child is merged away. */
export function reroot(root: TreeNode, outgroup: string): TreeNode {
  const all = nodes(root);
  const index = new Map(all.map((n, k) => [n, k]));
  const adj: Edge[][] = all.map(() => []);
  for (const n of all) {
    for (const c of n.children) {
      adj[index.get(n)!]!.push({ to: index.get(c)!, length: c.length });
      adj[index.get(c)!]!.push({ to: index.get(n)!, length: c.length });
    }
  }
  const target = all.findIndex((n) => isLeaf(n) && n.name === outgroup);
  if (target === -1) return fail('phylo.e.unknownTaxon', { name: outgroup });
  const neighbor = adj[target]![0]!;
  const build = (at: number, from: number, length: number | undefined): TreeNode => {
    const src = all[at]!;
    const kids = adj[at]!.filter((e) => e.to !== from).map((e) => build(e.to, at, e.length));
    const out: TreeNode = { name: src.name, children: kids };
    if (src.support !== undefined && kids.length > 0) out.support = src.support;
    if (length !== undefined) out.length = length;
    if (kids.length === 1) {
      const only = kids[0]!;
      const merged = length === undefined && only.length === undefined ? undefined : (length ?? 0) + (only.length ?? 0);
      return merged === undefined ? { ...only, length: undefined } : { ...only, length: merged };
    }
    return out;
  };
  const half = neighbor.length === undefined ? undefined : neighbor.length / 2;
  const top: TreeNode = {
    name: '',
    children: [build(target, neighbor.to, half), build(neighbor.to, target, half)],
  };
  return stripUndefined(top);
}

function stripUndefined(node: TreeNode): TreeNode {
  const out: TreeNode = { name: node.name, children: node.children.map(stripUndefined) };
  if (node.length !== undefined) out.length = node.length;
  if (node.support !== undefined) out.support = node.support;
  return out;
}

/** Sorts every node's children so the smaller clade comes first. */
export function ladderize(root: TreeNode): TreeNode {
  const out = { ...root, children: root.children.map(ladderize) };
  out.children.sort((a, b) => leaves(a).length - leaves(b).length);
  return out;
}

// ---- Questions ----

/** The smallest clade holding every named taxon. */
export function mrca(root: TreeNode, taxa: readonly string[]): TreeNode {
  const known = new Set(leaves(root));
  for (const t of taxa) if (!known.has(t)) fail('phylo.e.unknownTaxon', { name: t });
  let best = root;
  const visit = (n: TreeNode) => {
    const set = new Set(leaves(n));
    if (taxa.every((t) => set.has(t)) && set.size < leaves(best).length) best = n;
    n.children.forEach(visit);
  };
  visit(root);
  return best;
}

/** Whether the taxa form a clade on this rooted tree. */
export const isMonophyletic = (root: TreeNode, taxa: readonly string[]): boolean =>
  leaves(mrca(root, taxa)).length === new Set(taxa).size;

/** The taxa in the sister group of a clade: the rest of its parent's clade. */
export function sisters(root: TreeNode, taxa: readonly string[]): string[] {
  const clade = mrca(root, taxa);
  const parent = nodes(root).find((n) => n.children.includes(clade));
  if (!parent) return [];
  return parent.children.filter((c) => c !== clade).flatMap(leaves);
}

/** The splits (bipartitions) of a tree as sorted taxon lists on the side without the first taxon. */
export function splits(root: TreeNode, order: readonly string[]): string[] {
  const first = order[0]!;
  const total = order.length;
  const out = new Set<string>();
  for (const n of nodes(root).slice(1)) {
    if (isLeaf(n)) continue;
    const set = new Set(leaves(n));
    const side = set.has(first) ? order.filter((t) => !set.has(t)) : order.filter((t) => set.has(t));
    if (side.length >= 2 && side.length <= total - 2) out.add(side.join('\u0000'));
  }
  return [...out];
}
