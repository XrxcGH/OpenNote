// Syntax trees from labeled brackets ([S [NP the cat] [VP sat]]) and dependency trees from a word list with heads.
// A label ending in ^ marks a phrase drawn as a triangle over its words, unanalyzed. Errors are codes under the
// tool's errors strings; a bracket error also says at which character it was found.

export interface SyntaxNode {
  label: string;
  /** Words under the node, in order; a node has either children or words for a triangle, or both. */
  children: SyntaxNode[];
  /** True for a word, which has no children. */
  leaf: boolean;
  /** True when the phrase is drawn as a triangle over its words. */
  triangle: boolean;
}

export class BracketError extends Error {
  constructor(
    code: string,
    readonly position: number,
  ) {
    super(code);
  }
}

/** Parses labeled brackets. Words are separated by spaces; a bracket opens with its label right after it. */
export function parseBrackets(source: string): SyntaxNode {
  const text = source.trim();
  if (text === '') throw new Error('empty');
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const word = (): string => {
    const start = i;
    while (i < text.length && !/[\s[\]]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const node = (): SyntaxNode => {
    const open = i;
    i++; // the [
    skip();
    const raw = word();
    if (raw === '') throw new BracketError('label', open);
    const triangle = raw.length > 1 && raw.endsWith('^');
    const label = triangle ? raw.slice(0, -1) : raw;
    const children: SyntaxNode[] = [];
    for (;;) {
      skip();
      if (i >= text.length) throw new BracketError('unclosed', open);
      if (text[i] === ']') {
        i++;
        break;
      }
      if (text[i] === '[') children.push(node());
      else children.push({ label: word(), children: [], leaf: true, triangle: false });
    }
    if (triangle && children.some((c) => !c.leaf)) throw new BracketError('triangle', open);
    return { label, children, leaf: false, triangle };
  };
  skip();
  if (text[i] !== '[') throw new BracketError('start', i);
  const root = node();
  skip();
  if (i < text.length) throw new BracketError(text[i] === ']' ? 'extraClose' : 'trailing', i);
  return root;
}

export interface TreeStats {
  leaves: string[];
  /** Levels from the root to the deepest word, counting both. */
  depth: number;
  phrases: number;
}

export function treeStats(root: SyntaxNode): TreeStats {
  const leaves: string[] = [];
  let phrases = 0;
  const visit = (n: SyntaxNode, level: number): number => {
    if (n.leaf) {
      leaves.push(n.label);
      return level;
    }
    phrases++;
    return Math.max(level, ...n.children.map((c) => visit(c, level + 1)));
  };
  const depth = visit(root, 1);
  return { leaves, depth, phrases };
}

/** The tree back as brackets, one level a line, for the steps. */
export function bracketOutline(root: SyntaxNode): string[] {
  const lines: string[] = [];
  const visit = (n: SyntaxNode, depth: number) => {
    const pad = '  '.repeat(depth);
    if (n.leaf) lines.push(`${pad}${n.label}`);
    else {
      lines.push(`${pad}${n.label}${n.triangle ? ' (triangle)' : ''}`);
      for (const c of n.children) visit(c, depth + 1);
    }
  };
  visit(root, 0);
  return lines;
}

export interface Dependency {
  index: number;
  word: string;
  /** 0 for the root. */
  head: number;
  relation: string;
}

/**
 * Reads one word a line: the word, the number of its head (0 for the root), and the relation, such as
 * "cat 2 nsubj". Words are numbered from 1 in the order given.
 */
export function parseDependencies(source: string): Dependency[] {
  const lines = source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  if (lines.length === 0) throw new Error('empty');
  if (lines.length > 200) throw new Error('tooMany');
  const deps = lines.map((line, k): Dependency => {
    const parts = line.split(/\s+/);
    if (parts.length < 2) throw new Error('depLine');
    const head = Number(parts[1]);
    if (!Number.isInteger(head) || head < 0) throw new Error('depHead');
    return { index: k + 1, word: parts[0], head, relation: parts.slice(2).join(' ') };
  });
  for (const d of deps) {
    if (d.head > deps.length || d.head === d.index) throw new Error('depHead');
  }
  if (deps.filter((d) => d.head === 0).length !== 1) throw new Error('depRoot');
  for (const d of deps) {
    const seen = new Set<number>();
    let at = d;
    while (at.head !== 0) {
      if (seen.has(at.index)) throw new Error('depCycle');
      seen.add(at.index);
      at = deps[at.head - 1];
    }
  }
  return deps;
}

/**
 * Pairs of arcs that cross when drawn above the words, each arc named by its dependent's number: a non-projective
 * tree has at least one pair.
 */
export function crossingArcs(deps: readonly Dependency[]): [number, number][] {
  const arcs = deps
    .filter((d) => d.head !== 0)
    .map((d) => ({ dep: d.index, lo: Math.min(d.index, d.head), hi: Math.max(d.index, d.head) }));
  const out: [number, number][] = [];
  for (let a = 0; a < arcs.length; a++) {
    for (let b = a + 1; b < arcs.length; b++) {
      const x = arcs[a];
      const y = arcs[b];
      if ((x.lo < y.lo && y.lo < x.hi && x.hi < y.hi) || (y.lo < x.lo && x.lo < y.hi && y.hi < x.hi)) {
        out.push([x.dep, y.dep]);
      }
    }
  }
  return out;
}
