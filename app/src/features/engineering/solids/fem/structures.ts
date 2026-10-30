// Line elements of the finite element tool: springs and bars along x, plane trusses, and plane frames. Each solve
// returns the element matrices (for the worked steps), the assembly map, the displacements, the reactions, and
// each element's forces. Loads are at the nodes. x is to the right, y is up, and rotations and moments turn
// counterclockwise. Everything is in base SI.
import { fail, positive, q, step, type KitStep } from '../kit/types';
import { assemble, solveHeld, type Placed } from './core';
import { apply, bar, frame, lineOf, truss } from './elements';

export type BarElement =
  | { readonly kind: 'bar'; readonly i: number; readonly j: number; readonly E: number; readonly A: number }
  | { readonly kind: 'spring'; readonly i: number; readonly j: number; readonly k: number };

export interface Node2 {
  readonly x: number;
  readonly y: number;
}

export interface Member {
  readonly i: number;
  readonly j: number;
  readonly E: number;
  readonly A: number;
  readonly I?: number;
}

/** Which of a node's freedoms are held: x, y, and (for frames) the rotation. */
export interface Support {
  readonly node: number;
  readonly x: boolean;
  readonly y: boolean;
  readonly r: boolean;
}

export interface NodeLoad {
  readonly node: number;
  readonly Fx: number;
  readonly Fy: number;
  readonly M: number;
}

export interface ElementMatrix {
  readonly k: readonly (readonly number[])[];
  readonly dofs: readonly number[];
}

const nodeCheck = (count: number, ...nodes: number[]) => {
  for (const n of nodes) if (!(Number.isInteger(n) && n >= 0 && n < count)) fail('nodeNumber', String(n + 1));
};

function mapStep(matrices: readonly ElementMatrix[]): KitStep {
  const map = matrices.map((m, e) => `${e + 1}: ${m.dofs.map((d) => d + 1).join(' ')}`).join('; ');
  return step('fem.assembly', 'K = \\sum_e L_e^{\\mathsf T} k_e L_e', { map });
}

const reducedStep = (free: number, total: number) =>
  step('fem.reduced', 'K_{ff}\\,u_f = F_f - K_{fs}\\,u_s', { free, total });

/** Springs and bars along x, one freedom per node. */
export function solveBars(
  nodes: readonly number[],
  elements: readonly BarElement[],
  loads: readonly NodeLoad[],
  held: readonly number[],
) {
  if (nodes.length < 2) fail('fewNodes');
  if (elements.length === 0) fail('noElements');
  const matrices: ElementMatrix[] = elements.map((e) => {
    nodeCheck(nodes.length, e.i, e.j);
    if (e.kind === 'spring') return { k: bar(positive(e.k, 'k'), 1), dofs: [e.i, e.j] };
    const L = Math.abs(nodes[e.j] - nodes[e.i]);
    if (!(L > 0)) fail('zeroElement');
    return { k: bar(positive(e.E, 'E') * positive(e.A, 'A'), L), dofs: [e.i, e.j] };
  });
  const { K, F } = assemble(nodes.length, matrices);
  loads.forEach((load) => {
    nodeCheck(nodes.length, load.node);
    F[load.node] += load.Fx;
  });
  if (held.length === 0) fail('mechanism');
  held.forEach((n) => nodeCheck(nodes.length, n));
  const solved = solveHeld(K, F, new Map(held.map((n) => [n, 0])));
  const forces = elements.map((e, n) => {
    const [ui, uj] = [solved.u[e.i], solved.u[e.j]];
    const sign = Math.sign(nodes[e.j] - nodes[e.i]);
    const N = matrices[n].k[1][1] * (uj - ui) * (e.kind === 'spring' ? 1 : sign);
    return { N, ...(e.kind === 'bar' ? { sigma: N / e.A } : {}) };
  });
  const steps: KitStep[] = [mapStep(matrices), reducedStep(solved.free.length, nodes.length)];
  steps.push(step('fem.barRecover', '\\sigma = \\frac{E}{L}(u_j - u_i), \\quad N = \\sigma A'));
  return { u: solved.u, reactions: solved.reactions, forces, matrices, steps };
}

/** A plane truss, two freedoms per node. */
export function solveTruss(
  nodes: readonly Node2[],
  members: readonly Member[],
  supports: readonly Support[],
  loads: readonly NodeLoad[],
) {
  if (nodes.length < 2) fail('fewNodes');
  if (members.length === 0) fail('noElements');
  const lines = members.map((m) => {
    nodeCheck(nodes.length, m.i, m.j);
    return lineOf(nodes[m.i].x, nodes[m.i].y, nodes[m.j].x, nodes[m.j].y);
  });
  const matrices: ElementMatrix[] = members.map((m, e) => ({
    k: truss(positive(m.E, 'E') * positive(m.A, 'A'), lines[e]),
    dofs: [2 * m.i, 2 * m.i + 1, 2 * m.j, 2 * m.j + 1],
  }));
  const { K, F } = assemble(2 * nodes.length, matrices as Placed[]);
  for (const load of loads) {
    nodeCheck(nodes.length, load.node);
    F[2 * load.node] += load.Fx;
    F[2 * load.node + 1] += load.Fy;
  }
  const held = new Map<number, number>();
  for (const s of supports) {
    nodeCheck(nodes.length, s.node);
    if (s.x) held.set(2 * s.node, 0);
    if (s.y) held.set(2 * s.node + 1, 0);
  }
  const solved = solveHeld(K, F, held);
  const forces = members.map((m, e) => {
    const { L, c, s } = lines[e];
    const du = [solved.u[2 * m.j] - solved.u[2 * m.i], solved.u[2 * m.j + 1] - solved.u[2 * m.i + 1]];
    const N = ((m.E * m.A) / L) * (c * du[0] + s * du[1]);
    return { N, sigma: N / m.A };
  });
  const steps: KitStep[] = [
    step(
      'fem.trussElement',
      'k_e = \\frac{EA}{L}\\begin{bmatrix} c^2 & cs & -c^2 & -cs \\\\ cs & s^2 & -cs & -s^2 \\\\ ' +
        '-c^2 & -cs & c^2 & cs \\\\ -cs & -s^2 & cs & s^2 \\end{bmatrix}',
    ),
    mapStep(matrices),
    reducedStep(solved.free.length, 2 * nodes.length),
    step('fem.trussRecover', 'N = \\frac{EA}{L}\\left[c\\,(u_j - u_i) + s\\,(v_j - v_i)\\right]'),
  ];
  return { u: solved.u, reactions: solved.reactions, forces, matrices, lines, steps };
}

/** A plane frame of Euler–Bernoulli members, three freedoms per node. */
export function solveFrame(
  nodes: readonly Node2[],
  members: readonly Member[],
  supports: readonly Support[],
  loads: readonly NodeLoad[],
) {
  if (nodes.length < 2) fail('fewNodes');
  if (members.length === 0) fail('noElements');
  const built = members.map((m) => {
    nodeCheck(nodes.length, m.i, m.j);
    const line = lineOf(nodes[m.i].x, nodes[m.i].y, nodes[m.j].x, nodes[m.j].y);
    const EA = positive(m.E, 'E') * positive(m.A, 'A');
    const EI = m.E * positive(m.I ?? NaN, 'I');
    return {
      line,
      EA,
      EI,
      ...frame(EA, EI, line),
      dofs: [0, 1, 2].map((d) => 3 * m.i + d).concat([0, 1, 2].map((d) => 3 * m.j + d)),
    };
  });
  const { K, F } = assemble(3 * nodes.length, built);
  for (const load of loads) {
    nodeCheck(nodes.length, load.node);
    F[3 * load.node] += load.Fx;
    F[3 * load.node + 1] += load.Fy;
    F[3 * load.node + 2] += load.M;
  }
  const held = new Map<number, number>();
  for (const s of supports) {
    nodeCheck(nodes.length, s.node);
    if (s.x) held.set(3 * s.node, 0);
    if (s.y) held.set(3 * s.node + 1, 0);
    if (s.r) held.set(3 * s.node + 2, 0);
  }
  const solved = solveHeld(K, F, held);
  // End forces in each member's own axes: f = k_local T u_e.
  const ends = built.map((b) =>
    apply(
      b.local,
      apply(
        b.T,
        b.dofs.map((d) => solved.u[d]),
      ),
    ),
  );
  const steps: KitStep[] = [];
  if (built.length <= 10) {
    built.forEach((b, e) =>
      steps.push(
        step(
          'fem.frameTerms',
          '\\frac{EA}{L} = [[a]],\\ \\frac{12EI}{L^3} = [[b]],\\ \\frac{6EI}{L^2} = [[c]],\\ \\frac{4EI}{L} = [[d]]',
          {
            e: e + 1,
            a: q(b.EA / b.line.L, 'stiffness'),
            b: q((12 * b.EI) / b.line.L ** 3, 'stiffness'),
            c: q((6 * b.EI) / b.line.L ** 2, 'smallForce'),
            d: q((4 * b.EI) / b.line.L, 'smallMoment'),
          },
        ),
      ),
    );
  }
  steps.push(
    step('fem.frameRotate', 'k_e = T^{\\mathsf T} k_e^{\\prime} T'),
    mapStep(built),
    reducedStep(solved.free.length, 3 * nodes.length),
    step('fem.frameRecover', 'f_e^{\\prime} = k_e^{\\prime}\\,T\\,u_e'),
  );
  return { u: solved.u, reactions: solved.reactions, ends, lines: built.map((b) => b.line), matrices: built, steps };
}
