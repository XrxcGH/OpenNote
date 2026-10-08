// The random-editing soak's plan and its verdict (A4-35). This file has no Playwright code, so a plain Node test
// can check it. The spec that drives the app is soak.spec.ts.
//
// The soak edits one page at random for a long time and takes a sample now and then: the memory the page keeps
// after a garbage collection, the nodes and listeners it holds, and how long a fixed burst of typing takes. A
// healthy app has flat lines. The verdict looks at the first quarter of the samples against the last quarter.

/** A small seeded generator, so a failing run can be replayed with the same seed. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ActionId =
  | 'type'
  | 'enter'
  | 'backspace'
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'move'
  | 'jump'
  | 'scroll'
  | 'switch'
  | 'list'
  | 'heading';

/** The actions and how often each comes up. Typing is most of what people do. */
export const WEIGHTS: Readonly<Record<ActionId, number>> = {
  type: 40,
  enter: 8,
  backspace: 10,
  undo: 6,
  redo: 3,
  bold: 3,
  italic: 3,
  move: 8,
  jump: 4,
  scroll: 5,
  switch: 4,
  list: 3,
  heading: 3,
};

export function pickAction(random: () => number): ActionId {
  const entries = Object.entries(WEIGHTS) as [ActionId, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let left = random() * total;
  for (const [id, weight] of entries) {
    left -= weight;
    if (left < 0) return id;
  }
  return 'type';
}

const WORDS = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'a', 'lazy', 'dog', 'cell', 'wall', 'ion', 'gate'];

/** A few words to type, drawn with the generator. */
export function someWords(random: () => number): string {
  const count = 1 + Math.floor(random() * 6);
  return Array.from({ length: count }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ');
}

/** One reading of the app while the soak runs. */
export interface Sample {
  /** Minutes since the soak began. */
  minute: number;
  /** Bytes of JavaScript heap in use right after a garbage collection. */
  heap: number;
  nodes: number;
  listeners: number;
  /** Milliseconds a fixed burst of typing took, from the first key to the last frame. */
  probeMs: number;
  actions: number;
}

export interface Limits {
  /** The most the retained heap may grow, last quarter against first, as a fraction. */
  heapGrowth: number;
  /** A growth smaller than this many bytes is noise, whatever the fraction. */
  heapFloor: number;
  /** The most the probe may slow down, last quarter against first, as a ratio. */
  slowdown: number;
  nodeGrowth: number;
  /** A node count below this many extra nodes is noise. */
  nodeFloor: number;
}

export const LIMITS: Limits = {
  heapGrowth: 0.5,
  heapFloor: 40 * 1024 * 1024,
  slowdown: 1.5,
  nodeGrowth: 0.5,
  nodeFloor: 5000,
};

export interface Verdict {
  ok: boolean;
  problems: string[];
  heapGrowth: number;
  slowdown: number;
  nodeGrowth: number;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The first and last quarters of the samples, after the first sample has warmed the caches. */
function quarters(samples: readonly Sample[]): [Sample[], Sample[]] {
  const settled = samples.slice(1);
  const size = Math.max(1, Math.floor(settled.length / 4));
  return [settled.slice(0, size), settled.slice(-size)];
}

/** Holds the samples, and the crashes seen, to the limits. Too few samples cannot show a trend, and say so. */
export function judge(samples: readonly Sample[], crashes: readonly string[], limits: Limits = LIMITS): Verdict {
  const problems: string[] = crashes.map((crash) => `Crash: ${crash}`);
  if (samples.length < 5) {
    problems.push(`Only ${samples.length} samples were taken. A trend needs at least 5.`);
    return { ok: false, problems, heapGrowth: 0, slowdown: 1, nodeGrowth: 0 };
  }
  const [first, last] = quarters(samples);
  const of = (from: Sample[], key: 'heap' | 'nodes' | 'probeMs') => median(from.map((sample) => sample[key]));
  const heapGrowth = of(last, 'heap') / of(first, 'heap') - 1;
  const heapBytes = of(last, 'heap') - of(first, 'heap');
  const nodeGrowth = of(last, 'nodes') / of(first, 'nodes') - 1;
  const nodeCount = of(last, 'nodes') - of(first, 'nodes');
  const slowdown = of(last, 'probeMs') / of(first, 'probeMs');
  if (heapGrowth > limits.heapGrowth && heapBytes > limits.heapFloor) {
    problems.push(
      `Memory grew ${(heapGrowth * 100).toFixed(0)}% (${(heapBytes / 1048576).toFixed(0)} MB) from the first quarter to the last.`,
    );
  }
  if (nodeGrowth > limits.nodeGrowth && nodeCount > limits.nodeFloor) {
    problems.push(`The page holds ${(nodeGrowth * 100).toFixed(0)}% more nodes (${nodeCount}) than at the start.`);
  }
  if (slowdown > limits.slowdown) {
    problems.push(`Typing slowed down ${slowdown.toFixed(2)} times from the first quarter to the last.`);
  }
  return { ok: problems.length === 0, problems, heapGrowth, slowdown, nodeGrowth };
}

/** The soak's length in minutes from OPENNOTE_SOAK_MINUTES. The default is the nightly run's two hours. */
export function soakMinutes(value: string | undefined): number {
  const minutes = Number(value ?? 120);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`OPENNOTE_SOAK_MINUTES is not a length: ${value}`);
  return minutes;
}
