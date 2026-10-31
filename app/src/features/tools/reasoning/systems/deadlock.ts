// Deadlock. The Banker's algorithm finds a safe sequence (or shows there is none) and tests a request, and a
// resource-allocation graph with single-instance resources is checked for a cycle.
import { fail, lines, matrix, numbers } from '../core/util';

export interface Banker {
  alloc: number[][];
  max: number[][];
  available: number[];
}

export function checkBanker(b: Banker): void {
  const n = b.alloc.length;
  const m = b.available.length;
  if (b.max.length !== n || b.alloc.some((r) => r.length !== m) || b.max.some((r) => r.length !== m))
    fail('bankerShape');
  if (b.alloc.some((r, i) => r.some((x, j) => x > b.max[i][j]))) fail('allocOverMax');
  if ([...b.alloc.flat(), ...b.max.flat(), ...b.available].some((x) => x < 0)) fail('negativeCount');
}

export function safety(b: Banker): {
  safe: boolean;
  order: number[];
  need: number[][];
  steps: { p: number; work: number[] }[];
} {
  checkBanker(b);
  const need = b.max.map((r, i) => r.map((x, j) => x - b.alloc[i][j]));
  const work = [...b.available];
  const finished = new Array<boolean>(b.alloc.length).fill(false);
  const order: number[] = [];
  const steps: { p: number; work: number[] }[] = [];
  for (let progress = true; progress;) {
    progress = false;
    for (let i = 0; i < b.alloc.length; i += 1) {
      if (finished[i] || need[i].some((x, j) => x > work[j])) continue;
      b.alloc[i].forEach((x, j) => (work[j] += x));
      finished[i] = true;
      order.push(i);
      steps.push({ p: i, work: [...work] });
      progress = true;
    }
  }
  return { safe: order.length === b.alloc.length, order, need, steps };
}

/** Whether granting process p the request keeps the state safe. */
export function request(b: Banker, p: number, req: readonly number[]) {
  checkBanker(b);
  if (!Number.isInteger(p) || p < 0 || p >= b.alloc.length) fail('noProcess', { p });
  if (req.length !== b.available.length) fail('bankerShape');
  const need = b.max[p].map((x, j) => x - b.alloc[p][j]);
  if (req.some((x, j) => x > need[j])) return { granted: false, reason: 'overNeed' as const };
  if (req.some((x, j) => x > b.available[j])) return { granted: false, reason: 'mustWait' as const };
  const next: Banker = {
    alloc: b.alloc.map((r, i) => (i === p ? r.map((x, j) => x + req[j]) : [...r])),
    max: b.max,
    available: b.available.map((x, j) => x - req[j]),
  };
  const s = safety(next);
  return { granted: s.safe, reason: s.safe ? ('safe' as const) : ('unsafe' as const), after: s };
}

export const parseMatrix = (text: string, what: string): number[][] =>
  matrix(text) ?? fail('matrixField', { field: what });
export const parseVector = (text: string, what: string): number[] => {
  const v = numbers(text);
  return v && v.length ? v : fail('vectorField', { field: what });
};

/** Edges `P1 -> R1` (a request) and `R1 -> P2` (an assignment); a cycle means deadlock with single instances. */
export function ragCycle(text: string): { cycle: string[] | null; nodes: string[]; edges: [string, string][] } {
  const edges: [string, string][] = [];
  for (const part of lines(text)
    .flatMap((l) => l.split(/[,;]/))
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^(\S+)\s*(?:->|→)\s*(\S+)$/.exec(part);
    if (!m) fail('ragLine', { line: part });
    edges.push([m![1], m![2]]);
  }
  if (!edges.length) fail('noEdges');
  const nodes = [...new Set(edges.flat())];
  const color = new Map<string, number>();
  const stack: string[] = [];
  let cycle: string[] | null = null;
  const visit = (u: string) => {
    color.set(u, 1);
    stack.push(u);
    for (const [a, b] of edges) {
      if (a !== u || cycle) continue;
      if (color.get(b) === 1) cycle = [...stack.slice(stack.indexOf(b)), b];
      else if (!color.has(b)) visit(b);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const q of nodes) if (!color.has(q) && !cycle) visit(q);
  return { cycle, nodes, edges };
}
