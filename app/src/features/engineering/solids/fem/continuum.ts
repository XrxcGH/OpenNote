// Plates, heat flow, and vibration in the finite element tool. A rectangle is meshed nx by ny, in four-node
// quadrilaterals or in triangles (each quadrilateral cut corner to corner); a plate with a central hole is meshed
// as its upper right quarter, mapped from the hole's edge out to the plate's edges. The plate is in plane stress,
// held on its left edge and loaded on its right; heat flows between fixed temperatures on the left and right
// edges, with the top and bottom insulated; and a bar vibrates with consistent mass. Everything is in base SI.
import { fail, positive, q, step, type KitStep } from '../kit/types';
import { assemble, modes, solveHeld, type Placed } from './core';
import { apply, bar, barMass, cst, heatLine, heatTriangle, planeStress, q4, q4B } from './elements';

export const MAX_CELLS = 400;

export interface Mesh {
  readonly x: readonly number[];
  readonly y: readonly number[];
  /** Each element's nodes, counterclockwise. */
  readonly elements: readonly (readonly number[])[];
  /** The nodes along each edge: left and right from the bottom up, bottom from left to right. */
  readonly left: readonly number[];
  readonly right: readonly number[];
  readonly bottom: readonly number[];
}

const cells = (nx: number, ny: number) => {
  if (!(Number.isInteger(nx) && Number.isInteger(ny) && nx >= 1 && ny >= 1)) fail('meshCount');
  if (nx * ny > MAX_CELLS) fail('meshSize', String(MAX_CELLS));
};

/** Cells between rows of nodes numbered a row at a time, each row `across` nodes long. */
function quads(across: number, rowCount: number, triangles: boolean): number[][] {
  const elements: number[][] = [];
  const id = (i: number, j: number) => j * across + i;
  for (let j = 0; j < rowCount - 1; j++)
    for (let i = 0; i < across - 1; i++) {
      const [a, b, c, d] = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
      if (triangles) elements.push([a, b, c], [a, c, d]);
      else elements.push([a, b, c, d]);
    }
  return elements;
}

export function rectangle(W: number, H: number, nx: number, ny: number, triangles: boolean): Mesh {
  positive(W, 'W');
  positive(H, 'H');
  cells(nx, ny);
  const x: number[] = [];
  const y: number[] = [];
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      x.push((W * i) / nx);
      y.push((H * j) / ny);
    }
  const up = [...Array(ny + 1).keys()];
  return {
    x,
    y,
    elements: quads(nx + 1, ny + 1, triangles),
    left: up.map((j) => j * (nx + 1)),
    right: up.map((j) => j * (nx + 1) + nx),
    bottom: [...Array(nx + 1).keys()],
  };
}

/**
 * The upper right quarter of a W by H plate with a central hole of diameter d. Rays run from the hole's edge to the
 * plate's right edge and then its top edge, `around` cells to each, and each ray is cut into `out` cells that
 * grow away from the hole, where the stress changes fastest. The left edge is x = 0 and the bottom is y = 0.
 */
export function holePlate(W: number, H: number, d: number, around: number, out: number, triangles: boolean): Mesh {
  const [b, h, a] = [positive(W, 'W') / 2, positive(H, 'H') / 2, positive(d, 'd') / 2];
  if (!(a < 0.9 * Math.min(b, h))) fail('holeSize');
  cells(2 * around, out);
  const corner = Math.atan2(h, b);
  const x: number[] = [];
  const y: number[] = [];
  // Node (ray r, ring k) is number r (out + 1) + k, so each ray's nodes run outward from the hole.
  for (let r = 0; r <= 2 * around; r++) {
    const first = r <= around;
    const angle = first ? (corner * r) / around : corner + ((Math.PI / 2 - corner) * (r - around)) / around;
    const [ox, oy] = first ? [b, (h * r) / around] : [b - (b * (r - around)) / around, h];
    for (let k = 0; k <= out; k++) {
      const s = (k / out) ** 1.5;
      x.push((1 - s) * a * Math.cos(angle) + s * ox);
      y.push((1 - s) * a * Math.sin(angle) + s * oy);
    }
  }
  const node = (r: number, k: number) => r * (out + 1) + k;
  return {
    x,
    y,
    elements: quads(out + 1, 2 * around + 1, triangles),
    left: [...Array(out + 1).keys()].map((k) => node(2 * around, k)),
    right: [...Array(around + 1).keys()].map((r) => node(r, out)),
    bottom: [...Array(out + 1).keys()].map((k) => node(0, k)),
  };
}

export interface PlateInput {
  readonly W: number;
  readonly H: number;
  readonly t: number;
  readonly E: number;
  readonly nu: number;
  readonly nx: number;
  readonly ny: number;
  readonly element: 'cst' | 'q4';
  /** Rollers along the left edge (with the corner pinned), or the left edge clamped. */
  readonly support: 'roller' | 'clamped';
  /** A uniform tension on the right edge, or a total downward shear spread evenly over it. */
  readonly load: 'tension' | 'shear';
  readonly value: number;
  /**
   * A central hole's diameter. The plate is then modeled as its upper right quarter, held by symmetry, and in
   * tension, with nx cells from the hole to each outer edge and ny cells out from the hole.
   */
  readonly hole?: number;
}

/** σx, σy, τxy and the von Mises stress, at an element's center or at a node. */
export interface ElementStress {
  readonly s: readonly [number, number, number];
  readonly vm: number;
}

const mises = (s: readonly [number, number, number]): ElementStress => ({
  s,
  vm: Math.sqrt(s[0] ** 2 - s[0] * s[1] + s[1] ** 2 + 3 * s[2] ** 2),
});

/** The corners of a quadrilateral in ξ and η, in its node order. */
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;

export function solvePlate(p: PlateInput) {
  const holed = p.hole !== undefined && Number.isFinite(p.hole);
  const triangles = p.element === 'cst';
  const mesh = holed
    ? holePlate(p.W, p.H, p.hole ?? NaN, p.nx, p.ny, triangles)
    : rectangle(p.W, p.H, p.nx, p.ny, triangles);
  const t = positive(p.t, 't');
  const D = planeStress(p.E, p.nu);
  const built = mesh.elements.map((nodes) => {
    const xs = nodes.map((n) => mesh.x[n]);
    const ys = nodes.map((n) => mesh.y[n]);
    const { k, B } = triangles ? cst(xs, ys, D, t) : q4(xs, ys, D, t);
    return { k, B, xs, ys, nodes, dofs: nodes.flatMap((n) => [2 * n, 2 * n + 1]) };
  });
  const size = 2 * mesh.x.length;
  const { K, F } = assemble(size, built);
  // The right edge's load, shared by its nodes in proportion to the edge lengths they carry. The edge is evenly cut.
  const segments = mesh.right.length - 1;
  const tension = holed || p.load === 'tension';
  const height = holed ? p.H / 2 : p.H;
  mesh.right.forEach((n, j) => {
    const share = (j === 0 || j === segments ? 0.5 : 1) / segments;
    if (tension) F[2 * n] += p.value * t * height * share;
    else F[2 * n + 1] -= p.value * share;
  });
  const held = new Map<number, number>();
  mesh.left.forEach((n, j) => {
    held.set(2 * n, 0);
    if (!holed && (p.support === 'clamped' || j === 0)) held.set(2 * n + 1, 0);
  });
  // A quarter is held by symmetry: its left edge cannot move sideways, and its bottom cannot move up or down.
  if (holed) mesh.bottom.forEach((n) => held.set(2 * n + 1, 0));
  const solved = solveHeld(K, F, held);
  const ue = (b: (typeof built)[number]) => b.dofs.map((d) => solved.u[d]);
  const stressOf = (B: readonly (readonly number[])[], u: readonly number[]) =>
    apply(D, apply(B, u)) as [number, number, number];
  const stresses = built.map((b) => mises(stressOf(b.B, ue(b))));
  // Stresses at the nodes: each element's stress at that corner, averaged over the elements that meet there.
  const sum = mesh.x.map(() => [0, 0, 0]);
  const count = new Array<number>(mesh.x.length).fill(0);
  built.forEach((b, e) => {
    const u = ue(b);
    b.nodes.forEach((n, c) => {
      const s = triangles ? stresses[e].s : stressOf(q4B(b.xs, b.ys, CORNERS[c][0], CORNERS[c][1]).B, u);
      s.forEach((v, i) => (sum[n][i] += v));
      count[n] += 1;
    });
  });
  const nodal = sum.map((s, n) => mises(s.map((v) => v / count[n]) as [number, number, number]));
  const tip = mesh.right.reduce((total, n) => total + solved.u[2 * n + 1], 0) / mesh.right.length;
  const steps: KitStep[] = [
    step('fem.mesh', undefined, { elements: built.length, nodes: mesh.x.length, dofs: size }),
    ...(holed ? [step('fem.quarter', undefined, { a: q((p.hole ?? NaN) / 2, 'length') })] : []),
    triangles
      ? step(
          'fem.cst',
          'k_e = t A\\,B^{\\mathsf T} D B, \\quad B = \\frac{1}{2A}\\begin{bmatrix} b_1 & 0 & b_2 & 0 & b_3 & 0 \\\\ ' +
            '0 & c_1 & 0 & c_2 & 0 & c_3 \\\\ c_1 & b_1 & c_2 & b_2 & c_3 & b_3 \\end{bmatrix}',
        )
      : step(
          'fem.q4',
          'k_e = \\sum_{i,j=1}^{2} t\\,B^{\\mathsf T} D B\\,\\lvert J \\rvert ' +
            '\\quad \\text{at } \\xi, \\eta = \\pm 1/\\sqrt{3}',
        ),
    step(
      'fem.planeD',
      'D = \\frac{E}{1 - \\nu^2}\\begin{bmatrix} 1 & \\nu & 0 \\\\ \\nu & 1 & 0 ' +
        '\\\\ 0 & 0 & \\frac{1 - \\nu}{2} \\end{bmatrix}',
    ),
    step('fem.reduced', 'K_{ff}\\,u_f = F_f - K_{fs}\\,u_s', { free: solved.free.length, total: size }),
    step('fem.planeRecover', '\\sigma = D B u_e'),
    step('fem.nodal'),
  ];
  return { mesh, u: solved.u, reactions: solved.reactions, stresses, nodal, tip, element1: built[0].k, steps };
}

/** Heywood's fit for a central hole in a strip in tension: Kt on the net section, and on the gross section. */
export function heywood(W: number, d: number) {
  const net = 2 + (1 - d / W) ** 3;
  return { net, gross: net / (1 - d / W) };
}

export interface Heat1DElement {
  readonly i: number;
  readonly j: number;
  readonly k: number;
  readonly A: number;
}

/** Steady conduction along a line: fixed temperatures, heat put in at nodes, and a uniform source. */
export function solveHeat1D(
  nodes: readonly number[],
  elements: readonly Heat1DElement[],
  temperatures: readonly { readonly node: number; readonly T: number }[],
  inputs: readonly { readonly node: number; readonly Q: number }[],
  source: number,
) {
  if (nodes.length < 2) fail('fewNodes');
  if (elements.length === 0) fail('noElements');
  if (temperatures.length === 0) fail('noTemperature');
  const check = (n: number) => {
    if (!(Number.isInteger(n) && n >= 0 && n < nodes.length)) fail('nodeNumber', String(n + 1));
  };
  const built: Placed[] = elements.map((e) => {
    check(e.i);
    check(e.j);
    const L = Math.abs(nodes[e.j] - nodes[e.i]);
    if (!(L > 0)) fail('zeroElement');
    return { ...heatLine(positive(e.k, 'k') * positive(e.A, 'A'), L, source, e.A), dofs: [e.i, e.j] };
  });
  const { K, F } = assemble(nodes.length, built);
  inputs.forEach((one) => {
    check(one.node);
    F[one.node] += one.Q;
  });
  const held = new Map<number, number>();
  temperatures.forEach((one) => {
    check(one.node);
    held.set(one.node, one.T);
  });
  const solved = solveHeld(K, F, held);
  const flux = elements.map((e) => (-e.k * (solved.u[e.j] - solved.u[e.i])) / (nodes[e.j] - nodes[e.i]));
  const steps = [
    step(
      'fem.heatLine',
      'k_e = \\frac{kA}{L}\\begin{bmatrix} 1 & -1 \\\\ -1 & 1 \\end{bmatrix}, \\quad f_e = ' +
        '\\frac{\\dot q A L}{2}\\begin{bmatrix} 1 \\\\ 1 \\end{bmatrix}',
    ),
    step('fem.reduced', 'K_{ff}\\,T_f = F_f - K_{fs}\\,T_s', { free: solved.free.length, total: nodes.length }),
    step('fem.heatRecover', "q'' = -k\\,\\frac{T_j - T_i}{x_j - x_i}"),
  ];
  return { T: solved.u, flows: solved.reactions, flux, steps };
}

export interface Heat2DInput {
  readonly W: number;
  readonly H: number;
  readonly t: number;
  readonly k: number;
  readonly nx: number;
  readonly ny: number;
  readonly T1: number;
  readonly T2: number;
  readonly source: number;
}

export function solveHeat2D(p: Heat2DInput) {
  const mesh = rectangle(p.W, p.H, p.nx, p.ny, true);
  const kc = positive(p.k, 'k');
  const t = positive(p.t, 't');
  const built: Placed[] = mesh.elements.map((nodes) => ({
    ...heatTriangle(
      nodes.map((n) => mesh.x[n]),
      nodes.map((n) => mesh.y[n]),
      kc,
      t,
      p.source,
    ),
    dofs: nodes,
  }));
  const { K, F } = assemble(mesh.x.length, built);
  const held = new Map<number, number>();
  mesh.left.forEach((n) => held.set(n, p.T1));
  mesh.right.forEach((n) => held.set(n, p.T2));
  const solved = solveHeld(K, F, held);
  // Heat into the plate through the left edge: the reactions there.
  const left = mesh.left.reduce((total, n) => total + (solved.reactions.get(n) ?? 0), 0);
  const steps = [
    step('fem.mesh', undefined, { elements: built.length, nodes: mesh.x.length, dofs: mesh.x.length }),
    step(
      'fem.heatTriangle',
      'k_e = \\frac{k t}{4A}\\left[b_i b_j + c_i c_j\\right], \\quad f_e = \\frac{\\dot q A t}{3}',
    ),
    step('fem.reduced', 'K_{ff}\\,T_f = F_f - K_{fs}\\,T_s', { free: solved.free.length, total: mesh.x.length }),
  ];
  return { mesh, T: solved.u, left, steps };
}

export type Ends = 'fixedFree' | 'fixedFixed' | 'freeFree';

export interface ModalInput {
  readonly L: number;
  readonly E: number;
  readonly rho: number;
  readonly A: number;
  readonly n: number;
  readonly ends: Ends;
}

/** The exact natural frequencies of a uniform bar in axial vibration, lowest first. */
export function exactBar(input: ModalInput, count: number): number[] {
  const c = Math.sqrt(input.E / input.rho) / input.L;
  return [...Array(count).keys()].map((k) =>
    input.ends === 'fixedFree'
      ? ((2 * k + 1) * Math.PI * c) / 2
      : input.ends === 'fixedFixed'
        ? (k + 1) * Math.PI * c
        : k * Math.PI * c,
  );
}

function barModes(input: ModalInput, n: number) {
  const h = input.L / n;
  const built: Placed[] = [...Array(n).keys()].map((e) => ({
    k: bar(input.E * input.A, h),
    m: barMass(input.rho * input.A, h),
    dofs: [e, e + 1],
  }));
  const { K, M } = assemble(n + 1, built, true);
  const held = input.ends === 'fixedFree' ? [0] : input.ends === 'fixedFixed' ? [0, n] : [];
  const free = [...Array(n + 1).keys()].filter((d) => !held.includes(d));
  if (free.length === 0) fail('meshCount');
  return { found: modes(K, M ?? [], free), free };
}

export function solveModal(input: ModalInput) {
  positive(input.L, 'L');
  positive(input.E, 'E');
  positive(input.rho, 'ρ');
  positive(input.A, 'A');
  if (!(Number.isInteger(input.n) && input.n >= 1 && input.n <= 200)) fail('meshCount');
  const { found, free } = barModes(input, input.n);
  const exact = exactBar(input, found.length);
  const convergence = [1, 2, 4, 8, 16, 32]
    .filter((n) => n >= (input.ends === 'fixedFixed' ? 2 : 1))
    .map((n) => {
      const first = barModes(input, n).found.find((m) => m.omega > 1e-9 * exact[exact.length - 1]);
      return { n, omega: first?.omega ?? NaN };
    });
  const steps = [
    step(
      'fem.barMass',
      'k_e = \\frac{EA}{h}\\begin{bmatrix} 1 & -1 \\\\ -1 & 1 \\end{bmatrix}, \\quad m_e = ' +
        '\\frac{\\rho A h}{6}\\begin{bmatrix} 2 & 1 \\\\ 1 & 2 \\end{bmatrix}',
    ),
    step('fem.eigen', '\\left(K - \\omega^2 M\\right)\\phi = 0'),
    step('fem.firstMode', '\\omega_1 = [[w]], \\quad \\omega_{1,exact} = [[x]]', {
      w: q(found.find((m) => m.omega > 1e-9 * (exact[exact.length - 1] || 1))?.omega ?? NaN, 'angularSpeed'),
      x: q(exact.find((w) => w > 0) ?? NaN, 'angularSpeed'),
    }),
  ];
  return { found, exact, free, convergence, steps };
}
