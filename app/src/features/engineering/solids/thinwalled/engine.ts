// Thin-walled sections idealized as booms and walls, as in aircraft structures (Megson). The booms carry all the
// direct stress, and the walls carry shear flow only, constant along each wall. x is to the right and y is up. Mx
// pulls on the booms at positive y and My on the booms at positive x, so σ = [(My Ixx − Mx Ixy)x + (Mx Iyy −
// My Ixy)y]/(Ixx Iyy − Ixy²). Sx and Sy point along +x and +y, and torques turn counterclockwise.
//
// The cells are the faces of the walls' drawing. Each closed cell is cut at one wall, and the open flows qb come
// from the booms' equilibrium: the flow out of a boom less the flow into it is −(kx x + ky y)B. A constant flow
// q0 in each cell then closes it. The q0s and Gθ′ follow from the cells' equal rate of twist and the moments
// about the origin. Each wall's flow is positive from its first boom to its second. Everything is in base SI.
import { solveLinear } from '../../linalg';
import { fail, notNegative, positive, q, step, type KitStep, type StepValue } from '../kit/types';

export interface Boom {
  readonly x: number;
  readonly y: number;
  readonly B: number;
}

/** A straight wall from boom i to boom j (counted from 0), of thickness t. */
export interface Wall {
  readonly i: number;
  readonly j: number;
  readonly t: number;
  /** The thickness of the skin that carries direct stress, when it is idealized into the booms; 0 or none for a
   * wall that carries shear only. */
  readonly tD?: number;
}

export interface ThinLoads {
  readonly Sx: number;
  readonly Sy: number;
  readonly T: number;
  readonly Mx: number;
  readonly My: number;
  /** Where the shear forces act: through the shear center, or at a point. */
  readonly at: 'shear' | { readonly x: number; readonly y: number };
  readonly G?: number;
}

/** A cell: its walls, each with +1 when the counterclockwise way round runs from i to j, and its area. */
export interface Cell {
  readonly walls: readonly { readonly wall: number; readonly dir: 1 | -1 }[];
  readonly A: number;
}

export interface Geometry {
  readonly booms: readonly Boom[];
  readonly walls: readonly Wall[];
  readonly cells: readonly Cell[];
  readonly lengths: readonly number[];
  /** Twice the area each wall sweeps about the origin: xi yj − yi xj. */
  readonly sweep: readonly number[];
  readonly xc: number;
  readonly yc: number;
  readonly Ixx: number;
  readonly Iyy: number;
  readonly Ixy: number;
}

const near = (a: number, b: number, scale: number) => Math.abs(a - b) <= 1e-9 * scale;

/** The bounded faces of the walls' drawing, each traced counterclockwise. */
function findCells(booms: readonly Boom[], walls: readonly Wall[], size: number): Cell[] {
  // Half-edges 2w (i to j) and 2w + 1 (j to i). At each boom they are sorted by angle.
  const out: number[][] = booms.map(() => []);
  walls.forEach((w, k) => {
    out[w.i].push(2 * k);
    out[w.j].push(2 * k + 1);
  });
  const from = (h: number) => (h % 2 === 0 ? walls[h >> 1].i : walls[h >> 1].j);
  const to = (h: number) => (h % 2 === 0 ? walls[h >> 1].j : walls[h >> 1].i);
  const angle = (h: number) => Math.atan2(booms[to(h)].y - booms[from(h)].y, booms[to(h)].x - booms[from(h)].x);
  out.forEach((list) => list.sort((a, b) => angle(a) - angle(b)));
  const seen = new Set<number>();
  const cells: Cell[] = [];
  for (let start = 0; start < 2 * walls.length; start++) {
    if (seen.has(start)) continue;
    const trace: number[] = [];
    let h = start;
    while (!seen.has(h)) {
      seen.add(h);
      trace.push(h);
      // Turn: at the far end, take the half-edge just clockwise of the way back.
      const list = out[to(h)];
      const back = list.indexOf(h ^ 1);
      h = list[(back - 1 + list.length) % list.length];
    }
    const twice = trace.reduce((sum, e) => {
      const [a, b] = [booms[from(e)], booms[to(e)]];
      return sum + (a.x * b.y - a.y * b.x);
    }, 0);
    if (twice > 1e-9 * size * size) {
      cells.push({ walls: trace.map((e) => ({ wall: e >> 1, dir: e % 2 === 0 ? 1 : -1 })), A: twice / 2 });
    }
  }
  return cells;
}

function connected(count: number, walls: readonly Wall[]): boolean {
  const reach = new Set([0]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const w of walls) {
      if (reach.has(w.i) !== reach.has(w.j)) {
        reach.add(w.i);
        reach.add(w.j);
        grew = true;
      }
    }
  }
  return reach.size === count;
}

/** Checks the booms and walls and finds the cells, the centroid, and the second moments of the boom areas. */
export function thinGeometry(booms: readonly Boom[], walls: readonly Wall[]): Geometry {
  if (booms.length < 2) fail('fewBooms');
  if (walls.length === 0) fail('noWalls');
  booms.forEach((b) => notNegative(b.B, 'B'));
  const size = Math.max(...booms.map((b) => Math.hypot(b.x, b.y)), 1e-300);
  const pairs = new Set<string>();
  const lengths = walls.map((w) => {
    if (!(w.i >= 0 && w.j >= 0 && w.i < booms.length && w.j < booms.length) || w.i === w.j) fail('wallBooms');
    positive(w.t, 't');
    const key = `${Math.min(w.i, w.j)}-${Math.max(w.i, w.j)}`;
    if (pairs.has(key)) fail('wallTwice');
    pairs.add(key);
    const L = Math.hypot(booms[w.j].x - booms[w.i].x, booms[w.j].y - booms[w.i].y);
    if (near(L, 0, size)) fail('zeroWall');
    return L;
  });
  if (!connected(booms.length, walls)) fail('apart');
  const cells = findCells(booms, walls, size);
  if (cells.length !== walls.length - booms.length + 1) fail('crossing');
  const area = booms.reduce((sum, b) => sum + b.B, 0);
  const [xc, yc] =
    area > 0
      ? [booms.reduce((s, b) => s + b.B * b.x, 0) / area, booms.reduce((s, b) => s + b.B * b.y, 0) / area]
      : [booms.reduce((s, b) => s + b.x, 0) / booms.length, booms.reduce((s, b) => s + b.y, 0) / booms.length];
  const Ixx = booms.reduce((s, b) => s + b.B * (b.y - yc) ** 2, 0);
  const Iyy = booms.reduce((s, b) => s + b.B * (b.x - xc) ** 2, 0);
  const Ixy = booms.reduce((s, b) => s + b.B * (b.x - xc) * (b.y - yc), 0);
  const sweep = walls.map((w) => booms[w.i].x * booms[w.j].y - booms[w.i].y * booms[w.j].x);
  return { booms, walls, cells, lengths, sweep, xc, yc, Ixx, Iyy, Ixy };
}

/** The walls of a spanning tree from boom 0; each cell is cut at one of the others. */
function cutWalls(g: Geometry): Set<number> {
  const inTree = new Set<number>();
  const reached = new Set([0]);
  let grew = true;
  while (grew) {
    grew = false;
    g.walls.forEach((w, k) => {
      if (reached.has(w.i) !== reached.has(w.j)) {
        reached.add(w.i);
        reached.add(w.j);
        inTree.add(k);
        grew = true;
      }
    });
  }
  return new Set(g.walls.map((_, k) => k).filter((k) => !inTree.has(k)));
}

/** The open flows from the booms' equilibrium, with the cut walls carrying none. */
function openFlows(g: Geometry, Sx: number, Sy: number, cut: Set<number>): number[] {
  const D = g.Ixx * g.Iyy - g.Ixy ** 2;
  const shear = Sx !== 0 || Sy !== 0;
  if (shear && !(D > 0)) fail('inertiaMatrix');
  const kx = shear ? (Sx * g.Ixx - Sy * g.Ixy) / D : 0;
  const ky = shear ? (Sy * g.Iyy - Sx * g.Ixy) / D : 0;
  const tree = g.walls.map((_, k) => k).filter((k) => !cut.has(k));
  // One equation per boom but the last (they sum to zero): out − in = −(kx x + ky y)B.
  const rows = g.booms
    .slice(0, -1)
    .map((_, r) => tree.map((k) => (g.walls[k].i === r ? 1 : 0) - (g.walls[k].j === r ? 1 : 0)));
  const rhs = g.booms.slice(0, -1).map((b) => -(kx * (b.x - g.xc) + ky * (b.y - g.yc)) * b.B);
  const solved = tree.length === 0 ? [] : solveLinear(rows, rhs);
  if (!solved) fail('apart');
  const flows = g.walls.map(() => 0);
  tree.forEach((k, n) => (flows[k] = solved[n]));
  return flows;
}

export interface FlowResult {
  readonly flows: readonly number[];
  readonly open: readonly number[];
  readonly q0: readonly number[];
  /** G times the rate of twist; for an open section, from St Venant torsion of the torque about the shear center. */
  readonly Gtheta: number;
  readonly cut: readonly number[];
}

/** The shear flows for shear forces through the origin and a moment M about it. */
function closeCells(g: Geometry, Sx: number, Sy: number, M: number): FlowResult {
  const cut = cutWalls(g);
  const open = openFlows(g, Sx, Sy, cut);
  const C = g.cells.length;
  if (C === 0) return { flows: open, open, q0: [], Gtheta: 0, cut: [] };
  // Unknowns: q0 of each cell, then Gθ′. Flow in wall e: open[e] + Σ dir·q0 of the cells round it.
  const inCell = g.walls.map(() => [] as { cell: number; dir: number }[]);
  g.cells.forEach((cell, c) => cell.walls.forEach(({ wall, dir }) => inCell[wall].push({ cell: c, dir })));
  const rows: number[][] = [];
  const rhs: number[] = [];
  g.cells.forEach((cell) => {
    const row = new Array<number>(C + 1).fill(0);
    let known = 0;
    for (const { wall, dir } of cell.walls) {
      const w = (dir * g.lengths[wall]) / g.walls[wall].t / (2 * cell.A);
      known += w * open[wall];
      for (const other of inCell[wall]) row[other.cell] += w * other.dir;
    }
    row[C] = -1;
    rows.push(row);
    rhs.push(-known);
  });
  const moment = new Array<number>(C + 1).fill(0);
  g.cells.forEach((cell, c) => (moment[c] = 2 * cell.A));
  rows.push(moment);
  rhs.push(M - open.reduce((sum, value, e) => sum + value * g.sweep[e], 0));
  const solved = solveLinear(rows, rhs);
  if (!solved) fail('apart');
  const q0 = solved.slice(0, C);
  const flows = open.map((value, e) => value + inCell[e].reduce((sum, one) => sum + one.dir * q0[one.cell], 0));
  return { flows, open, q0, Gtheta: solved[C], cut: [...cut] };
}

/** The shear center: where a shear force makes no twist (closed), or where the open flows' moment acts. */
export function shearCenter(g: Geometry): { x: number; y: number } | null {
  if (!(g.Ixx * g.Iyy - g.Ixy ** 2 > 0)) return null;
  if (g.cells.length === 0) {
    const momentOf = (Sx: number, Sy: number) =>
      openFlows(g, Sx, Sy, new Set()).reduce((sum, value, e) => sum + value * g.sweep[e], 0);
    return { x: momentOf(0, 1), y: -momentOf(1, 0) };
  }
  const twist = closeCells(g, 0, 0, 1).Gtheta;
  return { x: -closeCells(g, 0, 1, 0).Gtheta / twist, y: closeCells(g, 1, 0, 0).Gtheta / twist };
}

export interface ThinResult {
  readonly g: Geometry;
  readonly flows: FlowResult;
  readonly center: { x: number; y: number } | null;
  readonly sigma: readonly number[];
  /** St Venant torsion of an open section: its J and the torque about the shear center. */
  readonly openTorsion?: { readonly J: number; readonly T: number; readonly tauMax: number };
  readonly steps: KitStep[];
}

/**
 * Boom idealization of a skin that carries direct stress (Megson). Take a wall of effective thickness tD and length
 * b between booms i and j. It adds tD b/6 (2 + σj/σi) to boom i, and tD b/6 (2 + σi/σj) to boom j. The stress ratio
 * comes from the bending moment, or from the shear's moment when no moment is given. The ratio depends on the areas it
 * gives, so it is worked out again until the areas settle. A boom on the neutral axis takes nothing.
 */
export function idealize(
  booms: readonly Boom[],
  walls: readonly Wall[],
  loads: Pick<ThinLoads, 'Sx' | 'Sy' | 'Mx' | 'My'>,
): { booms: Boom[]; added: number[]; steps: KitStep[] } {
  const typed = booms.map((b) => b.B);
  if (!walls.some((w) => (w.tD ?? 0) > 0)) return { booms: [...booms], added: typed.map(() => 0), steps: [] };
  walls.forEach((w) => notNegative(w.tD ?? 0, 'tD'));
  const bending = loads.Mx !== 0 || loads.My !== 0;
  const [Mx, My] = bending ? [loads.Mx, loads.My] : [loads.Sy, loads.Sx];
  if (Mx === 0 && My === 0) fail('idealizeLoad');
  const length = (w: Wall) => {
    if (!(w.i >= 0 && w.j >= 0 && w.i < booms.length && w.j < booms.length) || w.i === w.j) fail('wallBooms');
    return Math.hypot(booms[w.j].x - booms[w.i].x, booms[w.j].y - booms[w.i].y);
  };
  // A first guess: the skin's area shared equally, as for equal stresses at both ends.
  let added = typed.map(() => 0);
  walls.forEach((w) => {
    const half = ((w.tD ?? 0) * length(w)) / 2;
    added[w.i] += half;
    added[w.j] += half;
  });
  for (let round = 0; round < 50; round++) {
    const areas = typed.map((B, n) => B + added[n]);
    const sigma = stressShape(booms, areas, Mx, My);
    const top = Math.max(...sigma.map(Math.abs));
    const next = typed.map(() => 0);
    const share = (from: number, to: number, w: Wall) =>
      Math.abs(sigma[from]) <= 1e-9 * top ? 0 : (((w.tD ?? 0) * length(w)) / 6) * (2 + sigma[to] / sigma[from]);
    walls.forEach((w) => {
      next[w.i] += share(w.i, w.j, w);
      next[w.j] += share(w.j, w.i, w);
    });
    const change = Math.max(...next.map((value, n) => Math.abs(value - added[n])));
    added = next;
    if (change <= 1e-12 * Math.max(...areas)) break;
  }
  const out = booms.map((b, n) => ({ ...b, B: typed[n] + added[n] }));
  const vars: Record<string, StepValue> = {};
  const parts = out.map((b, n) => {
    vars[`B${n}`] = q(b.B, 'area');
    return `B_{${n + 1}} = [[B${n}]]`;
  });
  return {
    booms: out,
    added,
    steps: [
      step(
        bending ? 'thinwalled.idealize' : 'thinwalled.idealizeShear',
        'B_i = B_{i,0} + \\sum \\frac{t_D b}{6}\\left(2 + \\frac{\\sigma_j}{\\sigma_i}\\right)',
      ),
      step('thinwalled.idealized', parts.join(',\\quad '), vars),
    ],
  };
}

/** The direct stress at each boom for a moment, up to a factor, with these boom areas. */
function stressShape(booms: readonly Boom[], areas: readonly number[], Mx: number, My: number): number[] {
  const A = areas.reduce((s, B) => s + B, 0);
  if (!(A > 0)) fail('inertiaMatrix');
  const xc = booms.reduce((s, b, n) => s + areas[n] * b.x, 0) / A;
  const yc = booms.reduce((s, b, n) => s + areas[n] * b.y, 0) / A;
  const Ixx = booms.reduce((s, b, n) => s + areas[n] * (b.y - yc) ** 2, 0);
  const Iyy = booms.reduce((s, b, n) => s + areas[n] * (b.x - xc) ** 2, 0);
  const Ixy = booms.reduce((s, b, n) => s + areas[n] * (b.x - xc) * (b.y - yc), 0);
  const D = Ixx * Iyy - Ixy ** 2;
  if (!(D > 0)) fail('inertiaMatrix');
  return booms.map((b) => ((My * Ixx - Mx * Ixy) * (b.x - xc) + (Mx * Iyy - My * Ixy) * (b.y - yc)) / D);
}

export function thinWalled(typedBooms: readonly Boom[], walls: readonly Wall[], loads: ThinLoads): ThinResult {
  const ideal = idealize(typedBooms, walls, loads);
  const booms = ideal.booms;
  const g = thinGeometry(booms, walls);
  const center = shearCenter(g);
  const D = g.Ixx * g.Iyy - g.Ixy ** 2;
  if ((loads.Mx !== 0 || loads.My !== 0) && !(D > 0)) fail('inertiaMatrix');
  const at = loads.at === 'shear' ? center : loads.at;
  if (!at && (loads.Sx !== 0 || loads.Sy !== 0)) fail('inertiaMatrix');
  const point = at ?? { x: 0, y: 0 };
  const M = loads.T + point.x * loads.Sy - point.y * loads.Sx;
  const flows = closeCells(g, loads.Sx, loads.Sy, M);
  const sigma = g.booms.map((b) =>
    D > 0
      ? ((loads.My * g.Ixx - loads.Mx * g.Ixy) * (b.x - g.xc) + (loads.Mx * g.Iyy - loads.My * g.Ixy) * (b.y - g.yc)) /
        D
      : 0,
  );
  let openTorsion: ThinResult['openTorsion'];
  let result = flows;
  if (g.cells.length === 0) {
    const J = g.walls.reduce((sum, w, e) => sum + (g.lengths[e] * w.t ** 3) / 3, 0);
    const Tsc = loads.T + (point.x - (center?.x ?? 0)) * loads.Sy - (point.y - (center?.y ?? 0)) * loads.Sx;
    openTorsion = { J, T: Tsc, tauMax: (Math.abs(Tsc) * Math.max(...g.walls.map((w) => w.t))) / J };
    result = { ...flows, Gtheta: Tsc / J };
  }
  return {
    g,
    flows: result,
    center,
    sigma,
    ...(openTorsion ? { openTorsion } : {}),
    steps: [...ideal.steps, ...thinSteps(g, result, loads, center, M)],
  };
}

function thinSteps(g: Geometry, r: FlowResult, loads: ThinLoads, center: { x: number; y: number } | null, M: number) {
  const steps: KitStep[] = [
    step('thinwalled.centroid', '\\bar x = \\frac{\\sum B x}{\\sum B} = [[x]], \\quad \\bar y = [[y]]', {
      x: q(g.xc, 'length'),
      y: q(g.yc, 'length'),
    }),
    step('thinwalled.inertia', 'I_{xx} = \\sum B y^2 = [[Ixx]], \\quad I_{yy} = [[Iyy]], \\quad I_{xy} = [[Ixy]]', {
      Ixx: q(g.Ixx, 'inertia'),
      Iyy: q(g.Iyy, 'inertia'),
      Ixy: q(g.Ixy, 'inertia'),
    }),
  ];
  if (loads.Mx !== 0 || loads.My !== 0) {
    steps.push(
      step(
        'thinwalled.direct',
        '\\sigma = \\frac{M_y I_{xx} - M_x I_{xy}}{I_{xx}I_{yy} - I_{xy}^2}\\,x' +
          ' + \\frac{M_x I_{yy} - M_y I_{xy}}{I_{xx}I_{yy} - I_{xy}^2}\\,y',
      ),
    );
  }
  if (g.cells.length > 0)
    steps.push(step('thinwalled.cut', undefined, { walls: r.cut.map((k) => wallName(g, k)).join(', ') }));
  steps.push(
    step(
      'thinwalled.open',
      'q_{out} - q_{in} = -\\frac{S_x I_{xx} - S_y I_{xy}}{I_{xx}I_{yy} - I_{xy}^2} B x' +
        ' - \\frac{S_y I_{yy} - S_x I_{xy}}{I_{xx}I_{yy} - I_{xy}^2} B y',
    ),
  );
  if (g.cells.length > 0) {
    steps.push(
      step(
        'thinwalled.twist',
        "G\\theta' = \\frac{1}{2A_k}\\oint_k q\\,\\frac{ds}{t} \\quad \\text{for every cell } k",
      ),
      step(
        'thinwalled.moment',
        '\\sum q_b\\,(x_i y_j - y_i x_j) + \\sum 2 A_k q_{0,k} = T + x_p S_y - y_p S_x = [[M]]',
        {
          M: q(M, 'smallMoment'),
        },
      ),
    );
    const vars: Record<string, ReturnType<typeof q>> = { G: q(r.Gtheta, 'stressPerLength') };
    r.q0.forEach((value, k) => (vars[`q${k}`] = q(value, 'lineLoad')));
    steps.push(
      step(
        'thinwalled.solve',
        [...r.q0.map((_, k) => `q_{0,${k + 1}} = [[q${k}]]`), "G\\theta' = [[G]]"].join(',\\quad '),
        vars,
      ),
    );
  } else {
    steps.push(step('thinwalled.openTwist', "G\\theta' = \\frac{T_{SC}}{J}, \\quad J = \\sum \\frac{L t^3}{3}"));
  }
  if (center) {
    steps.push(
      step('thinwalled.center', 'x_{SC} = [[x]], \\quad y_{SC} = [[y]]', {
        x: q(center.x, 'length'),
        y: q(center.y, 'length'),
      }),
    );
  }
  return steps;
}

/** A wall's name, by its booms counted from 1. */
export const wallName = (g: Geometry, k: number) => `${g.walls[k].i + 1}–${g.walls[k].j + 1}`;
