// Harris matrices: stratigraphic relations between contexts (above, below, cuts, cut by, equal to), checked for
// contradictions with Tarjan's strongly connected components, reduced to the relations a matrix draws, and laid
// out in layers from the latest context at the top.
import { check, Problem } from '../core/problem';

export const MAX_CONTEXTS = 2000;

export interface Relation {
  upper: string;
  lower: string;
  /** The line it came from, counting from 1. */
  line: number;
}

export interface Parsed {
  relations: Relation[];
  /** Groups of contexts recorded as equal (one deposit seen in two places). */
  equal: string[][];
  contexts: string[];
}

const ABOVE = /^(.+?)\s+(above|over|cuts|seals|fills|>)\s+(.+)$/i;
const BELOW = /^(.+?)\s+(below|under|cut by|sealed by|filled by|<)\s+(.+)$/i;
const SAME = /^(.+?)\s+(=|equals|same as)\s+(.+)$/i;

/** Reads one relation per line; blank lines and lines starting with # are skipped. */
export function parseRelations(text: string): Parsed {
  const relations: Relation[] = [];
  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    seen.add(id);
    return id;
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const same = SAME.exec(line);
    if (same) {
      pairs.push([add(same[1].trim()), add(same[3].trim())]);
      return;
    }
    const above = ABOVE.exec(line);
    const below = BELOW.exec(line);
    const m = above ?? below;
    if (!m) throw new Problem('relation', { line: i + 1 });
    const [first, second] = [add(m[1].trim()), add(m[3].trim())];
    relations.push(above ? { upper: first, lower: second, line: i + 1 } : { upper: second, lower: first, line: i + 1 });
  });
  check(seen.size > 0, 'noRelations');
  check(seen.size <= MAX_CONTEXTS, 'tooMany', { max: MAX_CONTEXTS });
  // Union equal contexts into groups.
  const parent = new Map<string, string>([...seen].map((id) => [id, id]));
  const root = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r);
    return r;
  };
  for (const [a, b] of pairs) parent.set(root(a), root(b));
  const groups = new Map<string, string[]>();
  for (const id of seen) groups.set(root(id), [...(groups.get(root(id)) ?? []), id]);
  return {
    relations,
    equal: [...groups.values()].filter((g) => g.length > 1),
    contexts: [...seen],
  };
}

export interface Matrix {
  /** One node per context, or per group of equal contexts, labeled "4 = 7". */
  nodes: { id: string; label: string }[];
  /** Relations kept after the transitive reduction, upper over lower, as node ids. */
  edges: [string, string][];
  /** Relations dropped because another path already implies them. */
  redundant: Relation[];
}

/** Tarjan's strongly connected components of a directed graph given as adjacency lists. */
export function components(count: number, next: readonly number[][]): number[][] {
  const index = new Array<number>(count).fill(-1);
  const low = new Array<number>(count).fill(0);
  const onStack = new Array<boolean>(count).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  for (let start = 0; start < count; start++) {
    if (index[start] >= 0) continue;
    // An explicit stack of (node, next child position), so long chains do not overflow the call stack.
    const work: [number, number][] = [[start, 0]];
    index[start] = low[start] = counter++;
    stack.push(start);
    onStack[start] = true;
    while (work.length) {
      const top = work[work.length - 1];
      const [v, k] = top;
      if (k < next[v].length) {
        top[1]++;
        const w = next[v][k];
        if (index[w] < 0) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        continue;
      }
      work.pop();
      if (work.length) low[work[work.length - 1][0]] = Math.min(low[work[work.length - 1][0]], low[v]);
      if (low[v] === index[v]) {
        const group: number[] = [];
        let w: number;
        do {
          w = stack.pop()!;
          onStack[w] = false;
          group.push(w);
        } while (w !== v);
        out.push(group);
      }
    }
  }
  return out;
}

/**
 * Builds the matrix: merges equal contexts, refuses contradictions (a cycle names its contexts), and keeps an
 * edge u → v only when no other path from u reaches v.
 */
export function buildMatrix(parsed: Parsed): Matrix {
  const groupOf = new Map<string, string>();
  for (const group of parsed.equal) for (const id of group) groupOf.set(id, group.join(' = '));
  const node = (id: string) => groupOf.get(id) ?? id;
  const ids = [...new Set(parsed.contexts.map(node))];
  const at = new Map(ids.map((id, i) => [id, i]));
  const next: number[][] = ids.map(() => []);
  const edgeOf = new Map<string, Relation>();
  for (const rel of parsed.relations) {
    const u = at.get(node(rel.upper))!;
    const v = at.get(node(rel.lower))!;
    if (u === v) throw new Problem('cycle', { list: ids[u] });
    const key = `${u} ${v}`;
    if (!edgeOf.has(key)) {
      edgeOf.set(key, rel);
      next[u].push(v);
    }
  }
  const loops = components(ids.length, next).filter((g) => g.length > 1);
  if (loops.length) {
    throw new Problem('cycle', {
      list: loops
        .map((g) =>
          g
            .map((i) => ids[i])
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .join(', '),
        )
        .join('; '),
    });
  }
  const reach = (from: number, skip: number): Set<number> => {
    const seen = new Set<number>();
    const todo = next[from].filter((w) => w !== skip);
    while (todo.length) {
      const w = todo.pop()!;
      if (seen.has(w)) continue;
      seen.add(w);
      todo.push(...next[w]);
    }
    return seen;
  };
  const edges: [string, string][] = [];
  const redundant: Relation[] = [];
  next.forEach((children, u) => {
    for (const v of children) {
      if (reach(u, v).has(v)) redundant.push(edgeOf.get(`${u} ${v}`)!);
      else edges.push([ids[u], ids[v]]);
    }
  });
  return { nodes: ids.map((id) => ({ id, label: id })), edges, redundant };
}
