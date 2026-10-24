// Pipe flow: friction factor, head loss, the three classic pipe problems, pump operating points, series and
// parallel pipes, and Hardy Cross loops.
import { brent, CalcError, fmt, G0, need, nonNegative, positive, type Step } from '../numeric';

export const LAMINAR_LIMIT = 2300;
export const TURBULENT_START = 4000;

export interface FluidProps {
  density: number;
  /** Dynamic viscosity (Pa s). */
  viscosity: number;
}

export interface PipeSpec {
  diameter: number;
  length: number;
  /** Absolute roughness (m), 0 for smooth. */
  roughness: number;
  /** Sum of minor-loss coefficients. */
  sumK: number;
}

export type FrictionRegime = 'laminar' | 'transitional' | 'turbulent';

export interface FrictionResult {
  f: number;
  regime: FrictionRegime;
  haaland: number;
  swameeJain: number;
}

export function reynolds(f: FluidProps, velocity: number, diameter: number): number {
  return (f.density * velocity * diameter) / f.viscosity;
}

/** Colebrook-White solved in x = 1/sqrt(f) by Brent's method. */
export function colebrook(re: number, relRough: number): number {
  positive(re, 'The Reynolds number');
  nonNegative(relRough, 'The relative roughness');
  need(relRough < 0.1, 'rough', 'The relative roughness e/D must be below 0.1 for these correlations.');
  const g = (x: number) => x + 2 * Math.log10(relRough / 3.7 + (2.51 * x) / re);
  return 1 / brent(g, 1, 100, 1e-14) ** 2;
}

export function haaland(re: number, relRough: number): number {
  return (-1.8 * Math.log10((relRough / 3.7) ** 1.11 + 6.9 / re)) ** -2;
}

export function swameeJain(re: number, relRough: number): number {
  return 0.25 / Math.log10(relRough / 3.7 + 5.74 / re ** 0.9) ** 2;
}

/**
 * Darcy friction factor: 64/Re when laminar, Colebrook when turbulent. The 2300 to 4000 band is flagged, and uses
 * the larger of the two.
 */
export function friction(re: number, relRough: number): FrictionResult {
  positive(re, 'The Reynolds number');
  nonNegative(relRough, 'The relative roughness');
  const lam = 64 / re;
  if (re < LAMINAR_LIMIT) return { f: lam, regime: 'laminar', haaland: lam, swameeJain: lam };
  const f = colebrook(re, relRough);
  const regime: FrictionRegime = re < TURBULENT_START ? 'transitional' : 'turbulent';
  return {
    f: regime === 'transitional' ? Math.max(f, lam) : f,
    regime,
    haaland: haaland(re, relRough),
    swameeJain: swameeJain(re, relRough),
  };
}

export interface PipeState {
  q: number;
  velocity: number;
  re: number;
  f: number;
  regime: FrictionRegime;
  haaland: number;
  swameeJain: number;
  /** Friction head loss f L/D V^2/2g (m). */
  frictionHead: number;
  minorHead: number;
  headLoss: number;
  pressureDrop: number;
  /** Hydraulic power lost to friction, rho g Q hL (W). */
  powerLoss: number;
  steps: Step[];
}

function validatePipe(p: PipeSpec, fl: FluidProps) {
  positive(p.diameter, 'The diameter');
  positive(p.length, 'The length');
  nonNegative(p.roughness, 'The roughness');
  nonNegative(p.sumK, 'The sum of minor-loss coefficients');
  positive(fl.density, 'The density');
  positive(fl.viscosity, 'The viscosity');
  need(
    p.roughness / p.diameter < 0.1,
    'rough',
    'The roughness is more than a tenth of the diameter, which is outside every friction correlation.',
  );
}

const JUMP_MESSAGE =
  'The target falls in the jump of the friction factor between laminar and turbulent flow (Re about 2300), ' +
  'where the head loss rises suddenly, so no flow rate gives exactly the value asked for. Choose a slightly ' +
  'different value.';

/** Whether a solved root reproduces its target: a root found on the laminar-to-turbulent jump does not. */
const reproduces = (value: number, target: number): boolean => Math.abs(value - target) <= 1e-6 * Math.abs(target);

/** Problem type 1: flow rate known, find friction, and head loss. */
export function headLossFromFlow(fluid: FluidProps, pipe: PipeSpec, q: number, g = G0): PipeState {
  validatePipe(pipe, fluid);
  need(Number.isFinite(q) && q >= 0, 'flow', 'The flow rate must be zero or more.');
  const area = (Math.PI * pipe.diameter ** 2) / 4;
  const v = q / area;
  if (q === 0) {
    return {
      q,
      velocity: 0,
      re: 0,
      f: 0,
      regime: 'laminar',
      haaland: 0,
      swameeJain: 0,
      frictionHead: 0,
      minorHead: 0,
      headLoss: 0,
      pressureDrop: 0,
      powerLoss: 0,
      steps: [{ key: 'fhPipesNoFlow' }],
    };
  }
  const re = reynolds(fluid, v, pipe.diameter);
  const fr = friction(re, pipe.roughness / pipe.diameter);
  const head = v ** 2 / (2 * g);
  const hf = ((fr.f * pipe.length) / pipe.diameter) * head;
  const hm = pipe.sumK * head;
  const hl = hf + hm;
  const dp = fluid.density * g * hl;
  const steps: Step[] = [
    {
      key: 'fhPipesVelocity',
      vars: { V: fmt(v) },
      math: `V = \\frac{Q}{A} = \\frac{4Q}{\\pi D^2} = ${fmt(v)}\\ \\mathrm{m/s}`,
    },
    {
      key: 'fhPipesReynolds',
      vars: { Re: fmt(re, 6), regime: fr.regime },
      math: `Re = \\frac{\\rho V D}{\\mu} = ${fmt(re, 6)}`,
    },
    {
      key: fr.regime === 'laminar' ? 'fhPipesFrictionLaminar' : 'fhPipesFrictionTurbulent',
      vars: { f: fmt(fr.f), h: fmt(fr.haaland), s: fmt(fr.swameeJain) },
      math:
        fr.regime === 'laminar'
          ? `f = \\frac{64}{Re} = ${fmt(fr.f)}`
          : `\\frac{1}{\\sqrt f} = -2\\log_{10}\\left(\\frac{\\varepsilon/D}{3.7} + \\frac{2.51}{Re\\sqrt ` +
            `f}\\right) \\Rightarrow f = ${fmt(fr.f)}`,
    },
    {
      key: 'fhPipesHeadLoss',
      vars: { hl: fmt(hl) },
      math: `h_L = \\left(f\\frac{L}{D} + \\sum K\\right)\\frac{V^2}{2g} = ${fmt(hl)}\\ \\mathrm{m}`,
    },
    { key: 'fhPipesPressureDrop', vars: { dp: fmt(dp) }, math: `\\Delta p = \\rho g h_L = ${fmt(dp)}\\ \\mathrm{Pa}` },
  ];
  return {
    q,
    velocity: v,
    re,
    f: fr.f,
    regime: fr.regime,
    haaland: fr.haaland,
    swameeJain: fr.swameeJain,
    frictionHead: hf,
    minorHead: hm,
    headLoss: hl,
    pressureDrop: dp,
    powerLoss: fluid.density * g * q * hl,
    steps,
  };
}

/** The flow whose head loss is hl, and whether it reproduces hl (it does not when hl lies in the Re 2300 jump). */
function solveFlow(fluid: FluidProps, pipe: PipeSpec, hl: number, g: number): { q: number; exact: boolean } {
  validatePipe(pipe, fluid);
  need(Number.isFinite(hl) && hl > 0, 'headLoss', 'The head loss must be greater than zero to drive a flow.');
  const area = (Math.PI * pipe.diameter ** 2) / 4;
  // head loss rises monotonically with Q; bracket by doubling
  const h = (q: number) => headLossFromFlow(fluid, pipe, q, g).headLoss - hl;
  let hi = 1e-6 * area;
  let guard = 0;
  while (h(hi) < 0) {
    hi *= 2;
    if (++guard > 80) throw new CalcError('range', 'No flow rate in a reasonable range gives that head loss.');
  }
  const q = brent(h, 0, hi, 1e-15);
  return { q, exact: reproduces(headLossFromFlow(fluid, pipe, q, g).headLoss, hl) };
}

/** Problem type 2: head loss known, find the flow rate. */
export function flowFromHeadLoss(fluid: FluidProps, pipe: PipeSpec, hl: number, g = G0): PipeState {
  const { q, exact } = solveFlow(fluid, pipe, hl, g);
  if (!exact) throw new CalcError('jump', JUMP_MESSAGE);
  const state = headLossFromFlow(fluid, pipe, q, g);
  return { ...state, steps: [{ key: 'fhPipesSolveFlow', vars: { Q: fmt(q) } }, ...state.steps] };
}

/** Problem type 3: flow and head loss known, find the diameter. */
export function diameterFromFlow(
  fluid: FluidProps,
  pipe: Omit<PipeSpec, 'diameter'>,
  q: number,
  hl: number,
  g = G0,
): PipeState & { diameter: number } {
  positive(q, 'The flow rate');
  need(Number.isFinite(hl) && hl > 0, 'headLoss', 'The head loss must be greater than zero.');
  const h = (d: number) => headLossFromFlow(fluid, { ...pipe, diameter: d }, q, g).headLoss - hl;
  // the smaller the diameter, the larger the loss
  let lo = 1e-4;
  const hi = 10;
  // roughness limits the smallest admissible diameter
  if (pipe.roughness > 0) lo = Math.max(lo, pipe.roughness * 10.0001);
  if (h(lo) < 0 || h(hi) > 0)
    throw new CalcError(
      'range',
      'No pipe diameter between about 0.1 mm and 10 m gives that head loss for this flow rate.',
    );
  const d = brent(h, lo, hi, 1e-15);
  const state = headLossFromFlow(fluid, { ...pipe, diameter: d }, q, g);
  if (!reproduces(state.headLoss, hl)) throw new CalcError('jump', JUMP_MESSAGE);
  return { ...state, diameter: d, steps: [{ key: 'fhPipesSolveDiameter', vars: { D: fmt(d) } }, ...state.steps] };
}

/** Pump curve H = c0 + c1 Q + c2 Q^2 + ..., coefficients in ascending powers (m and m3/s). */
export const evalPoly = (c: readonly number[], x: number): number => c.reduceRight((s, a) => s * x + a, 0);

export interface OperatingPoint {
  q: number;
  head: number;
  steps: Step[];
}

/** The pump and system curves cross at the operating point: H_pump(Q) = H_system(Q). */
export function operatingPoint(
  pump: (q: number) => number,
  system: (q: number) => number,
  qMax: number,
): OperatingPoint {
  positive(qMax, 'The largest flow to search');
  const diff = (q: number) => pump(q) - system(q);
  if (diff(0) <= 0)
    throw new CalcError(
      'noFlow',
      'The pump cannot lift the liquid: at zero flow its head is below the static head of the system.',
    );
  if (diff(qMax) > 0)
    throw new CalcError('range', 'The curves do not cross below the largest flow searched; raise the limit.');
  const q = brent(diff, 0, qMax, 1e-15);
  const head = pump(q);
  if (Math.abs(diff(q)) > 1e-6 * Math.max(Math.abs(head), 1e-9))
    throw new CalcError(
      'jump',
      'The pump curve crosses the system curve where the system head jumps (laminar to turbulent flow at Re about ' +
        '2300), so there is no operating point there. Change the pump curve or the pipe a little.',
    );
  return {
    q,
    head,
    steps: [
      {
        key: 'fhPipesOperating',
        vars: { Q: fmt(q), H: fmt(head) },
        math: `H_{pump}(Q) = H_{system}(Q) \\Rightarrow Q = ${fmt(q)}\\ \\mathrm{m^3/s},\\ H = ${fmt(head)}\\ \\mathrm{m}`,
      },
    ],
  };
}

/** System curve of one pipe: static head plus the pipe's head loss at each flow. */
export function pipeSystemCurve(fluid: FluidProps, pipe: PipeSpec, staticHead: number, g = G0): (q: number) => number {
  return (q) => staticHead + headLossFromFlow(fluid, pipe, Math.max(q, 0), g).headLoss;
}

/** Pipes in series carry the same flow, and the head losses add. */
export function seriesLoss(
  fluid: FluidProps,
  pipes: PipeSpec[],
  q: number,
  g = G0,
): { headLoss: number; parts: PipeState[] } {
  need(pipes.length > 0, 'pipes', 'Add at least one pipe.');
  const parts = pipes.map((p) => headLossFromFlow(fluid, p, q, g));
  return { headLoss: parts.reduce((s, p) => s + p.headLoss, 0), parts };
}

/** Pipes in parallel share the same head loss, and the flows add: find the split of a total flow. */
export function parallelSplit(
  fluid: FluidProps,
  pipes: PipeSpec[],
  total: number,
  g = G0,
): { headLoss: number; flows: number[]; parts: PipeState[] } {
  need(pipes.length > 1, 'pipes', 'Parallel pipes need at least two branches.');
  positive(total, 'The total flow');
  const sumFlow = (hl: number) => (hl <= 0 ? 0 : pipes.reduce((s, p) => s + solveFlow(fluid, p, hl, g).q, 0));
  let hi = 1e-6;
  let guard = 0;
  while (sumFlow(hi) < total) {
    hi *= 2;
    if (++guard > 80) throw new CalcError('range', 'The branches cannot carry that flow with a reasonable head loss.');
  }
  const hl = brent((x) => sumFlow(x) - total, 0, hi, 1e-13);
  if (Math.abs(sumFlow(hl) - total) > 1e-6 * total || pipes.some((p) => !solveFlow(fluid, p, hl, g).exact))
    throw new CalcError('jump', JUMP_MESSAGE);
  const parts = pipes.map((p) => flowFromHeadLoss(fluid, p, hl, g));
  return { headLoss: hl, flows: parts.map((p) => p.q), parts };
}

export interface HardyCrossInput {
  fluid: FluidProps;
  pipes: PipeSpec[];
  /** Each loop lists pipe indices with a sign: +1 when the assumed flow in that pipe runs clockwise around the loop, -1 otherwise. */
  loops: { pipe: number; sign: 1 | -1 }[][];
  /**
   * Assumed flow in each pipe (m3/s), positive in the pipe's own reference direction. The initial guess must satisfy
   * continuity at every node.
   */
  flows: number[];
  g?: number;
  tol?: number;
  maxIter?: number;
}

export interface HardyCrossResult {
  flows: number[];
  iterations: number;
  loopResidual: number[];
  headLoss: number[];
}

/** Hardy Cross loop correction with the head loss h = r Q |Q|, r refreshed from the friction factor each pass. */
export function hardyCross(inp: HardyCrossInput): HardyCrossResult {
  const g = inp.g ?? G0;
  const tol = inp.tol ?? 1e-8;
  const maxIter = inp.maxIter ?? 200;
  need(inp.loops.length > 0, 'loops', 'Define at least one loop.');
  need(inp.flows.length === inp.pipes.length, 'flows', 'Give one assumed flow for every pipe.');
  inp.pipes.forEach((p) => validatePipe(p, inp.fluid));
  const q = [...inp.flows];
  const r = (i: number): number => {
    const flow = Math.max(Math.abs(q[i]!), 1e-9);
    const s = headLossFromFlow(inp.fluid, inp.pipes[i]!, flow, g);
    return s.headLoss / (flow * flow);
  };
  const head = (i: number) => r(i) * q[i]! * Math.abs(q[i]!);
  let it = 0;
  for (; it < maxIter; it++) {
    let worst = 0;
    for (const loop of inp.loops) {
      let num = 0;
      let den = 0;
      for (const { pipe, sign } of loop) {
        num += sign * head(pipe);
        den += 2 * r(pipe) * Math.abs(q[pipe]!);
      }
      need(den > 0, 'singular', 'A loop has no flow in any pipe, so it cannot be corrected.');
      const dq = -num / den;
      for (const { pipe, sign } of loop) q[pipe] = q[pipe]! + sign * dq;
      worst = Math.max(worst, Math.abs(dq));
    }
    if (worst < tol) {
      it++;
      break;
    }
  }
  need(
    it < maxIter,
    'converge',
    'The loop corrections did not settle: check that the assumed flows satisfy continuity at every node.',
  );
  const loopResidual = inp.loops.map((loop) => loop.reduce((s, { pipe, sign }) => s + sign * head(pipe), 0));
  return { flows: q, iterations: it, loopResidual, headLoss: q.map((_, i) => head(i)) };
}

export interface NetworkPipe extends PipeSpec {
  /** Names of the nodes at the two ends; a positive flow runs from `from` to `to`. */
  from: string;
  to: string;
}

export interface BuiltNetwork {
  nodes: string[];
  /** A starting flow in each pipe that satisfies continuity at every node (m3/s). */
  flows: number[];
  /** One independent loop for each pipe left out of a spanning tree, with the traversal direction as the sign. */
  loops: { pipe: number; sign: 1 | -1 }[][];
}

/**
 * Builds what Hardy Cross needs from the nodes. `external` is the flow entering the network at a node (negative where
 * it leaves). The starting flows come from a spanning tree, so continuity holds from the first pass, and the loops are
 * the fundamental loops of that tree.
 */
export function buildNetwork(pipes: NetworkPipe[], external: Record<string, number>): BuiltNetwork {
  need(pipes.length > 0, 'pipes', 'Add at least one pipe.');
  pipes.forEach((p, i) => {
    need(p.from !== p.to, 'node', `Pipe ${i + 1} starts and ends at the same node.`);
    need(p.from !== '' && p.to !== '', 'node', `Pipe ${i + 1} needs a node at each end.`);
  });
  const nodes = [...new Set([...pipes.flatMap((p) => [p.from, p.to]), ...Object.keys(external)])];
  Object.entries(external).forEach(([name, flow]) => {
    need(Number.isFinite(flow), 'node', `The flow at node ${name} must be a number.`);
    need(
      pipes.some((p) => p.from === name || p.to === name),
      'node',
      `Node ${name} has a flow but no pipe reaches it.`,
    );
  });
  const total = nodes.reduce((s, n) => s + (external[n] ?? 0), 0);
  const scale = Math.max(...nodes.map((n) => Math.abs(external[n] ?? 0)), 1e-12);
  need(
    Math.abs(total) <= 1e-9 * scale,
    'balance',
    `The flows entering and leaving the network must balance: they differ by ${fmt(total)} m³/s.`,
  );
  // spanning tree by breadth-first search from the first node
  const parent = new Map<string, { node: string; pipe: number }>();
  const order = [nodes[0]!];
  const seen = new Set(order);
  for (let at = 0; at < order.length; at++) {
    const u = order[at]!;
    pipes.forEach((p, i) => {
      const v = p.from === u ? p.to : p.to === u ? p.from : undefined;
      if (v !== undefined && !seen.has(v)) {
        seen.add(v);
        parent.set(v, { node: u, pipe: i });
        order.push(v);
      }
    });
  }
  need(order.length === nodes.length, 'connected', 'Every node must be joined to the others by pipes.');
  const flows = new Array<number>(pipes.length).fill(0);
  const subtree = new Map(nodes.map((n) => [n, external[n] ?? 0]));
  for (let k = order.length - 1; k > 0; k--) {
    const u = order[k]!;
    const { node: p, pipe } = parent.get(u)!;
    const s = subtree.get(u)!;
    // everything entering the subtree below u leaves it through the pipe to its parent
    flows[pipe] = pipes[pipe]!.from === u ? s : -s;
    subtree.set(p, subtree.get(p)! + s);
  }
  const treePipes = new Set([...parent.values()].map((e) => e.pipe));
  const up = (u: string) => {
    const edge = parent.get(u)!;
    return { sign: (pipes[edge.pipe]!.from === u ? 1 : -1) as 1 | -1, edge };
  };
  const ancestors = (u: string): string[] => {
    const out = [u];
    while (parent.has(out.at(-1)!)) out.push(parent.get(out.at(-1)!)!.node);
    return out;
  };
  const loops = pipes.flatMap((p, i) => {
    if (treePipes.has(i)) return [];
    // travel along the pipe from -> to, then back through the tree from `to` to `from`
    const fromUp = ancestors(p.from);
    const toUp = ancestors(p.to);
    const common = toUp.find((n) => fromUp.includes(n))!;
    const loop: { pipe: number; sign: 1 | -1 }[] = [{ pipe: i, sign: 1 }];
    for (let u = p.to; u !== common; u = parent.get(u)!.node) {
      const { sign, edge } = up(u);
      loop.push({ pipe: edge.pipe, sign });
    }
    const down: { pipe: number; sign: 1 | -1 }[] = [];
    for (let u = p.from; u !== common; u = parent.get(u)!.node) {
      const { sign, edge } = up(u);
      // walking from the common node down to u is the opposite of walking up from u
      down.push({ pipe: edge.pipe, sign: -sign as 1 | -1 });
    }
    return [[...loop, ...down.reverse()]];
  });
  return { nodes, flows, loops };
}

/** The flow that fails to balance at each node (m3/s), given the flows in the pipes and the flow entering the node. */
export function nodeImbalance(
  pipes: NetworkPipe[],
  flows: number[],
  external: Record<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (name: string, v: number) => out.set(name, (out.get(name) ?? 0) + v);
  Object.entries(external).forEach(([n, v]) => add(n, v));
  pipes.forEach((p, i) => {
    add(p.from, -flows[i]!);
    add(p.to, flows[i]!);
  });
  return out;
}
