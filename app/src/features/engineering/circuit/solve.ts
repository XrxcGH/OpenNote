// The DC solver for a circuit (item 10): modified nodal analysis. Grid points joined by wires and terminals become
// nodes, the grounds are the 0 V reference, each resistor stamps its conductance, and each voltage source adds its
// current as an unknown. The answers are every node's voltage, every part's current, and the power each delivers.
import { clean, solveLinear, zeros } from '../linalg';
import { terminals } from './model';
import type { CircuitModel, CircuitPart, Pt } from './model';

export interface NodeInfo {
  /** 0 is ground; others count from 1 in the order the parts reach them. */
  index: number;
  voltage: number;
  /** A grid point of the node, to label it in the drawing. */
  at: Pt;
}

export interface BranchInfo {
  part: string;
  /** Node indexes of the part's two ends. */
  from: number;
  to: number;
  /**
   * Amperes from `from` to `to` through the part. For a source that is from its first terminal to its second,
   * so a battery that drives current out of its + end has a positive current.
   */
  current: number;
  /** Volts at `to` minus volts at `from`. */
  voltage: number;
  /** Watts the part delivers to the rest of the circuit; a resistor's is negative, as it takes power. */
  power: number;
}

export type CircuitStatus = 'solved' | 'empty' | 'noGround' | 'floating' | 'singular' | 'badValue';

export interface CircuitResult {
  status: CircuitStatus;
  nodes: NodeInfo[];
  branches: BranchInfo[];
  /** Part ID to the node index of each terminal. */
  ends: Map<string, number[]>;
  /** For 'floating': the parts with no path to ground through resistors and voltage sources. */
  floating?: string[];
}

const key = (p: Pt) => `${p.x},${p.y}`;

class Joints {
  private parent = new Map<string, string>();
  find(k: string): string {
    let root = this.parent.get(k) ?? k;
    if (root !== k) {
      root = this.find(root);
      this.parent.set(k, root);
    }
    return root;
  }
  join(a: string, b: string) {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/**
 * The grid points a wire joins: its two ends, and any point along it (when it runs along the grid) where another
 * part's terminal or another wire's end lands, a T junction. Two wires that only cross mid-span are not joined, as
 * on a schematic drawn without a junction dot; split one at the crossing to join them.
 */
function wirePoints(part: CircuitPart, anchors: ReadonlySet<string>): Pt[] {
  const [a, b] = terminals(part);
  if (a.x !== b.x && a.y !== b.y) return [a, b];
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  const out: Pt[] = [a, b];
  for (let i = 1; i < steps; i++) {
    const point = { x: a.x + Math.sign(b.x - a.x) * i, y: a.y + Math.sign(b.y - a.y) * i };
    if (anchors.has(key(point))) out.push(point);
  }
  return out;
}

export function solveCircuit(model: CircuitModel): CircuitResult {
  const joints = new Joints();
  const elements = model.parts.filter((p) => p.kind === 'resistor' || p.kind === 'voltage' || p.kind === 'current');
  const empty = (status: CircuitStatus): CircuitResult => ({ status, nodes: [], branches: [], ends: new Map() });
  if (elements.length === 0) return empty('empty');
  const anchors = new Set(model.parts.flatMap((p) => terminals(p).map(key)));
  for (const wire of model.parts.filter((p) => p.kind === 'wire')) {
    const points = wirePoints(wire, anchors).map(key);
    for (const point of points.slice(1)) joints.join(points[0], point);
  }
  const grounds = model.parts.filter((p) => p.kind === 'ground').map((p) => joints.find(key(p)));
  if (grounds.length === 0) return empty('noGround');
  for (const ground of grounds.slice(1)) joints.join(grounds[0], ground);
  const groundRoot = joints.find(grounds[0]);
  if (elements.some((p) => p.kind === 'resistor' && !(p.value > 0))) return empty('badValue');

  // Node numbers, in the order the parts reach them.
  const numbers = new Map<string, number>([[groundRoot, 0]]);
  const where = new Map<number, Pt>();
  const ends = new Map<string, number[]>();
  for (const part of [...elements, ...model.parts.filter((p) => p.kind === 'ground')]) {
    ends.set(
      part.id,
      terminals(part).map((point) => {
        const root = joints.find(key(point));
        if (!numbers.has(root)) numbers.set(root, numbers.size);
        const n = numbers.get(root)!;
        if (!where.has(n)) where.set(n, point);
        return n;
      }),
    );
  }
  const n = numbers.size - 1;

  // Nodes with no path to ground through resistors and voltage sources have no defined voltage; name their parts.
  const reached = new Set([0]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const part of elements) {
      if (part.kind === 'current') continue;
      const [p, q] = ends.get(part.id)!;
      if (reached.has(p) !== reached.has(q)) {
        reached.add(p).add(q);
        grew = true;
      }
    }
  }
  const floating = elements.filter((part) => ends.get(part.id)!.some((node) => !reached.has(node)));
  if (floating.length > 0) return { ...empty('floating'), floating: floating.map((part) => part.id) };

  const sources = elements.filter((p) => p.kind === 'voltage');
  const size = n + sources.length;
  const A = zeros(size, size);
  const b = new Array<number>(size).fill(0);
  const row = (node: number) => node - 1;
  for (const part of elements) {
    const [p, q] = ends.get(part.id)!;
    if (part.kind === 'resistor') {
      const g = 1 / part.value;
      if (p > 0) A[row(p)][row(p)] += g;
      if (q > 0) A[row(q)][row(q)] += g;
      if (p > 0 && q > 0) {
        A[row(p)][row(q)] -= g;
        A[row(q)][row(p)] -= g;
      }
    } else if (part.kind === 'current') {
      // Current leaves node p into the source and comes out at node q.
      if (p > 0) b[row(p)] -= part.value;
      if (q > 0) b[row(q)] += part.value;
    }
  }
  sources.forEach((source, k) => {
    const [minus, plus] = ends.get(source.id)!;
    const r = n + k;
    // The unknown is the current into the + terminal through the source to the − terminal.
    if (plus > 0) {
      A[row(plus)][r] += 1;
      A[r][row(plus)] += 1;
    }
    if (minus > 0) {
      A[row(minus)][r] -= 1;
      A[r][row(minus)] -= 1;
    }
    b[r] = source.value;
  });
  const solution = size === 0 ? [] : solveLinear(A, b);
  if (!solution) return empty('singular');
  const volts = (node: number) => (node === 0 ? 0 : solution[row(node)]);
  const nodes: NodeInfo[] = [...where.entries()]
    .sort(([a], [z]) => a - z)
    .map(([index, at]) => ({ index, voltage: clean(volts(index)), at }));
  const branches = elements.map((part): BranchInfo => {
    const [from, to] = ends.get(part.id)!;
    const voltage = volts(to) - volts(from);
    let current: number;
    let power: number;
    if (part.kind === 'resistor') {
      current = -voltage / part.value;
      power = -(voltage * voltage) / part.value;
    } else if (part.kind === 'voltage') {
      current = -solution[n + sources.indexOf(part)];
      power = current * voltage;
    } else {
      current = part.value;
      power = current * voltage;
    }
    return { part: part.id, from, to, current: clean(current), voltage: clean(voltage), power: clean(power) };
  });
  return { status: 'solved', nodes, branches, ends };
}
