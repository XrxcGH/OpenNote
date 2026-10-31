// First-order CMOS timing and power: the Elmore delay of an RC tree, dynamic switching power, and logical-effort
// sizing of a path. Resistances in kilohms and capacitances in picofarads give delays in nanoseconds.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines, num, numbers } from '../core/util';

export interface RcNode {
  name: string;
  parent: string | null;
  r: number;
  c: number;
}

/** Lines of "name parent R C"; a parent of - or in is the driving source. */
export function parseRcTree(text: string): RcNode[] {
  const nodes = lines(text).map((line, i) => {
    const parts = line.split(/[\s,]+/);
    if (parts.length !== 4) fail('rcLine', { line: i + 1 });
    const values = numbers(`${parts[2]} ${parts[3]}`);
    if (!values || values.some((v) => v < 0)) fail('rcValues', { line: i + 1 });
    return {
      name: parts[0],
      parent: ['-', 'in', 'src', 'source'].includes(parts[1].toLowerCase()) ? null : parts[1],
      r: values![0],
      c: values![1],
    };
  });
  if (nodes.length === 0) fail('rcEmpty');
  const byName = new Map(nodes.map((n) => [n.name, n]));
  if (byName.size !== nodes.length) fail('rcTwice');
  for (const n of nodes) if (n.parent !== null && !byName.has(n.parent)) fail('rcParent', { name: n.parent });
  for (const n of nodes) pathTo(n.name, byName);
  return nodes;
}

function pathTo(name: string, byName: Map<string, RcNode>): string[] {
  const path: string[] = [];
  for (let at: string | null = name; at !== null; at = byName.get(at)!.parent) {
    if (path.includes(at)) fail('rcLoop', { name: at });
    path.push(at);
  }
  return path;
}

/** The Elmore delay at `target`: the sum over every capacitor of C times the resistance its path shares with target's. */
export function elmore(nodes: readonly RcNode[], target: string): { tau: number; steps: Step[] } {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  if (!byName.has(target)) fail('rcTarget', { name: target });
  const mine = new Set(pathTo(target, byName));
  const steps: Step[] = [];
  let tau = 0;
  for (const k of nodes) {
    const shared = pathTo(k.name, byName)
      .filter((p) => mine.has(p))
      .reduce((s, p) => s + byName.get(p)!.r, 0);
    tau += shared * k.c;
    steps.push(step('elmoreTerm', { node: k.name, c: num(k.c), r: num(shared), term: num(shared * k.c) }));
  }
  return { tau, steps };
}

/** Dynamic power P = alpha C V^2 f in watts, from SI inputs. */
export function dynamicPower(alpha: number, c: number, v: number, f: number): number {
  if (alpha < 0 || alpha > 1) fail('alpha');
  if (c < 0 || f < 0) fail('negative');
  return alpha * c * v * v * f;
}

export interface Effort {
  G: number;
  B: number;
  H: number;
  F: number;
  N: number;
  stageEffort: number;
  delay: number;
  /** Input capacitance of each stage, from the first, in the units of Cin. */
  sizes: number[];
}

/** Logical effort: path effort F = GBH, best stage effort F^(1/N), delay N F^(1/N) + P, and the gate sizes. */
export function logicalEffort(
  g: readonly number[],
  p: readonly number[],
  b: readonly number[],
  cin: number,
  cout: number,
): Effort {
  const N = g.length;
  if (N === 0 || p.length !== N) fail('effortLengths');
  const branch = b.length === 0 ? Array(N).fill(1) : b;
  if (branch.length !== N) fail('effortLengths');
  if (cin <= 0 || cout <= 0 || g.some((x) => x <= 0) || branch.some((x) => x < 1)) fail('effortValues');
  const G = g.reduce((s, x) => s * x, 1);
  const B = branch.reduce((s, x) => s * x, 1);
  const H = cout / cin;
  const F = G * B * H;
  const stageEffort = F ** (1 / N);
  const delay = N * stageEffort + p.reduce((s, x) => s + x, 0);
  const sizes: number[] = Array(N).fill(0);
  // Stage i drives b_i times the next stage's input; the last stage drives the load.
  let next = cout;
  for (let i = N - 1; i >= 0; i -= 1) {
    sizes[i] = (g[i] * branch[i] * next) / stageEffort;
    next = sizes[i];
  }
  return { G, B, H, F, N, stageEffort, delay, sizes };
}
