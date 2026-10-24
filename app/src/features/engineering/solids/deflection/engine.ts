// Beam deflection. The beam solver of the structures tools gives the reactions and the bending moment, so
// indeterminate beams and internal hinges work. This tool then integrates EI v'' = M twice. The beam is cut at every
// support, load, and change of EI, so M is a cubic at most on each piece. Three-point Gauss rules are then exact:
// θ(b) = θ(a) + ∫κ ds and v(b) = v(a) + θ(a)(b − a) + ∫(b − s)κ ds, with κ = M/(EI). The two constants of
// integration, and a jump in slope at each hinge, come from the supports by least squares. The equations are
// consistent, so the answer is exact. Signs follow the beam block: loads point down and moments turn
// counterclockwise when positive, and v is up, so a sagging beam has v < 0. Everything is in base SI.
import { solveLinear } from '../../linalg';
import { solveBeam, type BeamLoad, type BeamModel, type BeamSupportKind } from '../../structures/beam';
import { brent, GAUSS3 } from '../kit/numeric';
import { fail, positive, q, step, type KitStep } from '../kit/types';

export type DeflectionLoad =
  | { readonly kind: 'point'; readonly x: number; readonly P: number }
  | { readonly kind: 'moment'; readonly x: number; readonly M: number }
  | { readonly kind: 'udl'; readonly x1: number; readonly x2: number; readonly w1: number; readonly w2: number };

export interface DeflectionInput {
  readonly L: number;
  readonly EI: number;
  readonly supports: readonly { readonly kind: BeamSupportKind; readonly x: number }[];
  readonly loads: readonly DeflectionLoad[];
  /** EI between x1 and x2 is `factor` times EI. Where they overlap, the last one wins. */
  readonly segments?: readonly { readonly x1: number; readonly x2: number; readonly factor: number }[];
  readonly at?: readonly number[];
}

export interface Reaction {
  readonly kind: BeamSupportKind;
  readonly x: number;
  readonly R: number;
  readonly M?: number;
}

/** M(x) = c0 + c1 x + c2 x² + c3 x³ from x = a to x = b, in base SI, with x from the left end. */
export interface MomentPiece {
  readonly a: number;
  readonly b: number;
  readonly c: readonly number[];
  readonly factor: number;
}

export interface DeflectionResult {
  readonly status: 'determinate' | 'indeterminate';
  readonly reactions: readonly Reaction[];
  readonly pieces: readonly MomentPiece[];
  readonly v0: number;
  readonly theta0: number;
  readonly jumps: readonly { readonly x: number; readonly jump: number }[];
  readonly vMax: { readonly x: number; readonly v: number };
  readonly thetaMax: { readonly x: number; readonly theta: number };
  readonly thetaA: number;
  readonly thetaB: number;
  readonly points: readonly { readonly x: number; readonly v: number; readonly theta: number; readonly M: number }[];
  readonly curve: readonly (readonly [number, number])[];
  readonly steps: KitStep[];
}

const SUBDIVISIONS = 240;

/** The beam solver in units of L and of the largest load, so tiny and huge beams read alike. */
function reactionsAndMoment(input: DeflectionInput) {
  const { L } = input;
  const sizes = input.loads.map((load) =>
    load.kind === 'point'
      ? Math.abs(load.P)
      : load.kind === 'moment'
        ? Math.abs(load.M) / L
        : (Math.abs(load.w1) + Math.abs(load.w2)) * L,
  );
  const F0 = Math.max(...sizes, 0) || 1;
  const loads: BeamLoad[] = input.loads.map((load, i) => {
    const id = `l${i}`;
    if (load.kind === 'point') return { id, kind: 'point', x: load.x / L, value: load.P / F0 };
    if (load.kind === 'moment') return { id, kind: 'moment', x: load.x / L, value: load.M / (F0 * L) };
    return {
      id,
      kind: 'distributed',
      x1: load.x1 / L,
      x2: load.x2 / L,
      w1: (load.w1 * L) / F0,
      w2: (load.w2 * L) / F0,
    };
  });
  const model: BeamModel = {
    length: 1,
    supports: input.supports.map((s, i) => ({ id: `s${i}`, kind: s.kind, x: s.x / L })),
    loads,
    segments: (input.segments ?? []).map((seg, i) => ({
      id: `e${i}`,
      x1: seg.x1 / L,
      x2: seg.x2 / L,
      factor: seg.factor,
    })),
    forceUnit: 'N',
    lengthUnit: 'm',
  };
  const beam = solveBeam(model);
  if (beam.status === 'none' || beam.status === 'unstable') fail('unstable');
  const reactions: Reaction[] = beam.reactions.map((r) => {
    const kind = input.supports[Number(r.support.slice(1))].kind;
    return { kind, x: r.x * L, R: r.force * F0, ...(r.moment === undefined ? {} : { M: r.moment * F0 * L }) };
  });
  return { status: beam.status, reactions, moment: (x: number) => beam.moment(x / L) * F0 * L };
}

function checkInput(input: DeflectionInput) {
  const L = positive(input.L, 'L');
  positive(input.EI, 'EI');
  const on = (x: number) => {
    if (!Number.isFinite(x) || x < -1e-12 * L || x > L * (1 + 1e-12)) fail('offBeam');
  };
  input.supports.forEach((s) => on(s.x));
  if (!input.supports.some((s) => s.kind !== 'hinge')) fail('unstable');
  for (const load of input.loads) {
    if (load.kind === 'udl') {
      on(load.x1);
      on(load.x2);
      if (!(load.x2 > load.x1)) fail('udlOrder');
      if (!Number.isFinite(load.w1 + load.w2)) fail('notFinite', 'w');
    } else {
      on(load.x);
      if (!Number.isFinite(load.kind === 'point' ? load.P : load.M))
        fail('notFinite', load.kind === 'point' ? 'P' : 'M');
    }
  }
  for (const seg of input.segments ?? []) {
    on(seg.x1);
    on(seg.x2);
    positive(seg.factor, 'EI factor');
  }
  (input.at ?? []).forEach(on);
}

/** The places the moment's formula changes, so M is one polynomial between each pair. */
function breakpoints(input: DeflectionInput): number[] {
  const xs = [0, input.L, ...input.supports.map((s) => s.x)];
  for (const load of input.loads) {
    if (load.kind === 'udl') xs.push(load.x1, load.x2);
    else xs.push(load.x);
  }
  for (const seg of input.segments ?? []) xs.push(seg.x1, seg.x2);
  const sorted = xs.map((x) => Math.min(input.L, Math.max(0, x))).sort((a, b) => a - b);
  return sorted.filter((x, i) => i === 0 || x - sorted[i - 1] > 1e-9 * input.L);
}

function factorAt(input: DeflectionInput, x: number): number {
  let factor = 1;
  for (const seg of input.segments ?? []) if (x > seg.x1 && x < seg.x2) factor = seg.factor;
  return factor;
}

/** The cubic through M at four points of [a, b]. */
function fitCubic(M: (x: number) => number, a: number, b: number): number[] {
  const xs = [0, 1 / 3, 2 / 3, 1].map((u) => a + (b - a) * (0.001 + 0.998 * u));
  const scale = Math.max(Math.abs(a), Math.abs(b));
  // Fit in x/scale, which keeps the matrix well conditioned, then turn the coefficients back to x.
  const c = solveLinear(
    xs.map((x) => [1, x / scale, (x / scale) ** 2, (x / scale) ** 3]),
    xs.map(M),
  ) ?? [0, 0, 0, 0];
  return c.map((value, k) => value / scale ** k);
}

/** The breakpoints, with each piece cut finer for the curve. */
function nodesOf(breaks: readonly number[], L: number): number[] {
  const X: number[] = [0];
  for (let i = 0; i < breaks.length - 1; i++) {
    const [a, b] = [breaks[i], breaks[i + 1]];
    const n = Math.max(4, Math.ceil((SUBDIVISIONS * (b - a)) / L));
    for (let k = 1; k <= n; k++) X.push(k === n ? b : a + ((b - a) * k) / n);
  }
  return X;
}

type Moment = (x: number) => number;

/** The particular solution, with v and θ zero at the left end and no jumps, exact anywhere on the beam. */
function particularOf(input: DeflectionInput, X: readonly number[], moment: Moment) {
  const factors = X.slice(0, -1).map((x, i) => input.EI * factorAt(input, (x + X[i + 1]) / 2));
  const local = (i: number, x: number) => {
    const [a, half] = [X[i], (x - X[i]) / 2];
    let dTheta = 0;
    let dV = 0;
    for (const [u, w] of GAUSS3) {
      const s = a + half * (1 + u);
      const k = moment(s) / factors[i];
      dTheta += w * k * half;
      dV += w * (x - s) * k * half;
    }
    return { dTheta, dV };
  };
  const vp = [0];
  const tp = [0];
  for (let i = 0; i < X.length - 1; i++) {
    const { dTheta, dV } = local(i, X[i + 1]);
    vp.push(vp[i] + tp[i] * (X[i + 1] - X[i]) + dV);
    tp.push(tp[i] + dTheta);
  }
  const pieceOf = (x: number) => {
    let lo = 0;
    let hi = X.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (X[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return (x: number) => {
    const i = pieceOf(x);
    const { dTheta, dV } = local(i, x);
    return { v: vp[i] + tp[i] * (x - X[i]) + dV, theta: tp[i] + dTheta };
  };
}

type Curve = (x: number) => { v: number; theta: number };

/** v0, θ0, and each interior hinge's jump in slope, from the supports by least squares (in units of L). */
function constantsOf(input: DeflectionInput, particular: Curve) {
  const { L } = input;
  const hinges = input.supports
    .filter((s) => s.kind === 'hinge' && s.x > 1e-9 * L && s.x < L * (1 - 1e-9))
    .map((s) => s.x);
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const s of input.supports) {
    if (s.kind === 'hinge') continue;
    const p = particular(s.x);
    rows.push([1, s.x / L, ...hinges.map((h) => Math.max(s.x - h, 0) / L)]);
    rhs.push(-p.v);
    if (s.kind === 'fixed') {
      rows.push([0, 1, ...hinges.map((h) => (s.x > h ? 1 : 0))]);
      rhs.push(-p.theta * L);
    }
  }
  const n = [...Array(2 + hinges.length).keys()];
  const normal = n.map((r) => n.map((c) => rows.reduce((sum, row) => sum + row[r] * row[c], 0)));
  const right = n.map((r) => rows.reduce((sum, row, k) => sum + row[r] * rhs[k], 0));
  const unknowns = solveLinear(normal, right);
  if (!unknowns) fail('unstable');
  const [v0, theta0] = [unknowns[0], unknowns[1] / L];
  const jumps = hinges.map((x, k) => ({ x, jump: unknowns[2 + k] / L }));
  const at: Curve = (x) => {
    const p = particular(x);
    let v = p.v + v0 + theta0 * x;
    let theta = p.theta + theta0;
    for (const { x: h, jump } of jumps) {
      if (x > h) {
        v += jump * (x - h);
        theta += jump;
      }
    }
    return { v, theta };
  };
  return { v0, theta0, jumps, at };
}

/** The largest |f| over the nodes and the roots of g inside each piece, where f peaks. */
function largest(X: readonly number[], L: number, f: (x: number) => number, g: (x: number) => number) {
  let best = { x: 0, value: 0 };
  const consider = (x: number) => {
    const value = f(x);
    if (Math.abs(value) > Math.abs(best.value)) best = { x, value };
  };
  X.forEach(consider);
  for (let i = 0; i < X.length - 1; i++) {
    const [a, b] = [X[i] + 1e-12 * L, X[i + 1] - 1e-12 * L];
    if (g(a) * g(b) < 0) {
      const root = brent(g, a, b, 1e-13 * L);
      if (root !== null) consider(root);
    }
  }
  return best;
}

export function beamDeflection(input: DeflectionInput): DeflectionResult {
  checkInput(input);
  const { L } = input;
  const { status, reactions, moment } = reactionsAndMoment(input);
  const breaks = breakpoints(input);
  const X = nodesOf(breaks, L);
  const { v0, theta0, jumps, at } = constantsOf(input, particularOf(input, X, moment));
  const peak = largest(
    X,
    L,
    (x) => at(x).v,
    (x) => at(x).theta,
  );
  const steepest = largest(X, L, (x) => at(x).theta, moment);
  const pieces: MomentPiece[] = breaks.slice(0, -1).map((a, i) => ({
    a,
    b: breaks[i + 1],
    c: fitCubic(moment, a, breaks[i + 1]),
    factor: factorAt(input, (a + breaks[i + 1]) / 2),
  }));
  const result = {
    status,
    reactions,
    pieces,
    v0,
    theta0,
    jumps,
    vMax: { x: peak.x, v: peak.value },
    thetaMax: { x: steepest.x, theta: steepest.value },
    thetaA: at(0).theta,
    thetaB: at(L).theta,
    points: (input.at ?? []).map((x) => ({ x, ...at(x), M: moment(x) })),
    curve: X.map((x) => [x, at(x).v] as const),
  };
  return { ...result, steps: deflectionSteps(input, result) };
}

function deflectionSteps(input: DeflectionInput, r: Omit<DeflectionResult, 'steps'>): KitStep[] {
  const steps: KitStep[] = [];
  const vars: Record<string, ReturnType<typeof q>> = {};
  const terms = r.reactions.map((one, i) => {
    vars[`R${i}`] = q(one.R, 'bigForce');
    vars[`x${i}`] = q(one.x, 'span');
    if (one.M !== undefined) vars[`M${i}`] = q(one.M, 'bigMoment');
    return `R([[x${i}]]) = [[R${i}]]` + (one.M === undefined ? '' : `,\\ M([[x${i}]]) = [[M${i}]]`);
  });
  steps.push(
    step(
      r.status === 'determinate' ? 'deflection.reactions' : 'deflection.indeterminate',
      terms.join(',\\quad '),
      vars,
    ),
  );
  steps.push(step('deflection.curvature', "EI\\,v''(x) = M(x)"));
  steps.push(
    step(
      'deflection.integrate',
      "EI\\,v'(x) = \\int_0^x M\\,ds + EI\\,\\theta_0, \\quad " +
        'EI\\,v(x) = \\int_0^x\\!\\!\\int_0^s M\\,dt\\,ds + EI\\,\\theta_0 x + EI\\,v_0',
    ),
  );
  const conditions = input.supports
    .filter((s) => s.kind !== 'hinge')
    .flatMap((s, i) => {
      vars[`b${i}`] = q(s.x, 'span');
      return s.kind === 'fixed' ? [`v([[b${i}]]) = 0`, `v'([[b${i}]]) = 0`] : [`v([[b${i}]]) = 0`];
    });
  steps.push(step('deflection.conditions', conditions.join(',\\quad '), vars));
  const jumps = r.jumps.map((_one, i) => `\\Delta\\theta([[h${i}]]) = [[j${i}]]`);
  r.jumps.forEach((one, i) => {
    vars[`h${i}`] = q(one.x, 'span');
    vars[`j${i}`] = q(one.jump, 'radians');
  });
  steps.push(
    step('deflection.constants', ['\\theta_0 = [[t0]]', 'v_0 = [[v0]]', ...jumps].join(',\\quad '), {
      ...vars,
      t0: q(r.theta0, 'radians'),
      v0: q(r.v0, 'deflection'),
    }),
  );
  if (r.jumps.length > 0) steps.push(step('deflection.hinge'));
  steps.push(
    step('deflection.maximum', 'v_{max} = [[v]] \\text{ at } x = [[x]]', {
      v: q(r.vMax.v, 'deflection'),
      x: q(r.vMax.x, 'span'),
    }),
  );
  return steps;
}
