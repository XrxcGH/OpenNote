// Compliant mechanisms: large deflection of flexures by the pseudo-rigid-body model (PRBM), checked against the exact
// elastica. The elastica is EI dtheta/ds = M with dM/ds = Fx sin(theta) - Fy cos(theta), solved by shooting on the
// root moment (Brent on a bracket scan, fourth-order Runge-Kutta along the beam). PRBM constants for an end force are
// gamma = 0.85, K_Theta = 2.65, c_theta = 1.24 (Howell and Midha, 1995), and for an end moment alone gamma = 0.7346,
// K_Theta = 2.0643, c_theta = 1.5164 (Howell, Compliant Mechanisms, 2001); a small-length flexural pivot uses K = EI/l.
// The beam starts along +x, fixed at the origin; forces are in N, lengths in m, angles in rad.
import { bracketScan } from '../num';
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';

export const PRBM = { gamma: 0.85, kTheta: 2.65, cTheta: 1.24, maxTheta: (64.3 * Math.PI) / 180 } as const;
/** The end-moment constants: the beam bends into a circular arc, and the model tracks it to Theta = 124.4 degrees. */
export const PRBM_MOMENT = {
  gamma: 0.7346,
  kTheta: 2.0643,
  cTheta: 1.5164,
  maxTheta: (124.4 * Math.PI) / 180,
} as const;
export const SOURCES = [
  // checks-disable-next-line length: one citation, kept whole so it reads as written
  'Howell, L. L., and Midha, A., Parametric deflection approximations for end-loaded, large-deflection beams in compliant mechanisms, ASME Journal of Mechanical Design 117 (1995).',
  'Howell, L. L., Compliant Mechanisms, Wiley (2001), chapter 5.',
];

export type FlexureType = 'cantilever' | 'fixedGuided' | 'pivot';

export interface CompliantInput {
  type: FlexureType;
  /** Flexure length, m. */
  length: number;
  E: number;
  /** Rectangular section: width and thickness (the bending direction), m. */
  width: number;
  thickness: number;
  force: number;
  /** Direction of the force from the undeformed beam axis, rad (90 degrees is square to it). */
  forceAngle: number;
  /** End moment, N m, counterclockwise positive (cantilever and pivot). */
  moment: number;
  /** Rigid segment beyond a flexural pivot, m. */
  rigidLength: number;
}

export const COMPLIANT_DEFAULTS: CompliantInput = {
  type: 'cantilever',
  length: 0.05,
  E: 1.4e9,
  width: 0.006,
  thickness: 0.001,
  force: 1,
  forceAngle: Math.PI / 2,
  moment: 0,
  rigidLength: 0.04,
};

interface Segment {
  length: number;
  /** Infinity for a rigid segment. */
  EI: number;
}

export interface ElasticaResult {
  a: number;
  b: number;
  theta: number;
  rootMoment: number;
  /** Largest bending moment magnitude in the flexible parts, and the axial force there. */
  maxMoment: number;
  /** Total potential energy: strain energy less the work of the end force and moment, J. */
  energy: number;
  axialAtMax: number;
  points: [number, number][];
}

/** The elastica of a chain of flexible and rigid segments under an end force and moment, or null if none is found. */
export function elastica(segments: readonly Segment[], Fx: number, Fy: number, M0: number): ElasticaResult | null {
  const total = segments.reduce((s, g) => s + g.length, 0);
  const STEPS = 1600;
  const h = total / STEPS;
  const ei = (s: number) => {
    let acc = 0;
    for (const g of segments) {
      acc += g.length;
      if (s < acc - 1e-12 * total) return g.EI;
    }
    return segments[segments.length - 1].EI;
  };
  // State [x, y, theta, M]: x' = cos, y' = sin, theta' = M / EI, M' = Fx sin(theta) - Fy cos(theta).
  const rhs = (s: number, y: readonly number[]) => [
    Math.cos(y[2]),
    Math.sin(y[2]),
    Number.isFinite(ei(s)) ? y[3] / ei(s) : 0,
    Fx * Math.sin(y[2]) - Fy * Math.cos(y[2]),
  ];
  const shoot = (m0: number, keep = false) => {
    let y = [0, 0, 0, m0];
    const pts: [number, number][] = [[0, 0]];
    let maxM = Math.abs(m0),
      axial = Fx,
      strain = 0;
    for (let i = 0; i < STEPS; i += 1) {
      const s = i * h + h * 1e-9;
      const k1 = rhs(s, y);
      const k2 = rhs(
        s + h / 2,
        y.map((v, j) => v + (h / 2) * k1[j]),
      );
      const k3 = rhs(
        s + h / 2,
        y.map((v, j) => v + (h / 2) * k2[j]),
      );
      const k4 = rhs(
        s + h,
        y.map((v, j) => v + h * k3[j]),
      );
      y = y.map((v, j) => v + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
      if (keep) {
        pts.push([y[0], y[1]]);
        if (Number.isFinite(ei(s + h / 2))) strain += (h * y[3] * y[3]) / (2 * ei(s + h / 2));
        if (Number.isFinite(ei(s + h / 2)) && Math.abs(y[3]) > maxM) {
          maxM = Math.abs(y[3]);
          axial = Fx * Math.cos(y[2]) + Fy * Math.sin(y[2]);
        }
      }
    }
    const energy = strain - Fx * y[0] - Fy * y[1] - M0 * y[2];
    return { y, pts, maxM, axial, energy };
  };
  const reach = 1.02 * (total * Math.hypot(Fx, Fy) + Math.abs(M0)) + 1e-12;
  const roots = bracketScan((m) => shoot(m).y[3] - M0, -reach, reach, 160);
  if (roots.length === 0) return null;
  // Of several equilibria (after buckling), keep the stable one, the lowest total potential energy; the straight shape
  // under a compressive load past the critical load is an equilibrium too, but an unstable one. A tie (a symmetric
  // buckle) goes to the root nearest the small-deflection answer, then to the positive one.
  const linear = total * Fy + M0;
  const ends = roots.map((r) => ({ r, end: shoot(r, true) }));
  const scale = total * Math.hypot(Fx, Fy) + Math.abs(M0) + 1e-300;
  const better = (p: (typeof ends)[number], q: (typeof ends)[number]) => {
    const de = p.end.energy - q.end.energy;
    if (Math.abs(de) > 1e-9 * scale) return de < 0;
    const dl = Math.abs(p.r - linear) - Math.abs(q.r - linear);
    return Math.abs(dl) > 1e-9 * scale ? dl < 0 : p.r > q.r;
  };
  const { r: root, end } = ends.reduce((best, p) => (better(p, best) ? p : best));
  return {
    a: end.y[0],
    b: end.y[1],
    theta: end.y[2],
    rootMoment: root,
    maxMoment: end.maxM,
    energy: end.energy,
    axialAtMax: end.axial,
    points: end.pts.filter((_, i) => i % 8 === 0 || i === end.pts.length - 1),
  };
}

export interface CompliantResult {
  I: number;
  EI: number;
  /** PL^2/EI, the load index. */
  loadIndex: number;
  exact: ElasticaResult;
  prbm: {
    Theta: number;
    a: number;
    b: number;
    endAngle: number;
    K: number;
    pivot: [number, number];
    inRange: boolean;
    /** Which published constants the model used. */
    constants: 'force' | 'moment';
  };
  /** Distance between the two tip positions over the length, as a fraction. */
  positionError: number;
  /** Euler critical load of the flexure's compressive mode, N, and whether the compressive end load reaches it. */
  critical: number | null;
  buckled: boolean;
  stress: { bending: number; axial: number; max: number };
  shape: Plot;
  steps: MechStep[];
}

const deg = (radians: number) => tex((radians * 180) / Math.PI);

/** The exact shape: one elastica, a flexure with its rigid link, or two S-shaped halves for a guided beam. */
function exactShape(input: CompliantInput, EI: number, Fx: number, Fy: number): ElasticaResult | null {
  const { type, length: L, moment, rigidLength } = input;
  if (type === 'cantilever') return elastica([{ length: L, EI }], Fx, Fy, moment);
  if (type === 'pivot')
    return elastica(
      [
        { length: L, EI },
        { length: rigidLength, EI: Infinity },
      ],
      Fx,
      Fy,
      moment,
    );
  const half = elastica([{ length: L / 2, EI }], Fx, Fy, 0);
  if (!half) return null;
  // The second half is the first turned half a turn about the midpoint.
  const turned = [...half.points].reverse().map(([x, y]) => [2 * half.a - x, 2 * half.b - y] as [number, number]);
  return { ...half, a: 2 * half.a, b: 2 * half.b, theta: 0, points: [...half.points, ...turned] };
}

interface Model {
  K: number;
  link: number;
  pivot: [number, number];
  torque: (T: number) => number;
  endAngle: (T: number) => number;
}

/** The PRBM constants for the load: an end moment alone has its own; an end force, with or without a moment, uses
 * the end-force ones (approximate once a moment is added). */
export const constantsFor = (input: CompliantInput) =>
  input.type === 'cantilever' && input.force === 0 && input.moment !== 0 ? PRBM_MOMENT : PRBM;

/** The pseudo-rigid-body model: a pin at the characteristic pivot with a torsion spring. */
function prbmModel(input: CompliantInput, EI: number, Fx: number, Fy: number, steps: MechStep[]): Model {
  const { type, length: L, moment, rigidLength } = input;
  const { gamma, kTheta, cTheta } = constantsFor(input);
  if (type === 'pivot') {
    const K = EI / L;
    const link = L / 2 + rigidLength;
    steps.push({ key: 'compliantPivotSpring', math: `K = \\frac{EI}{l} = ${tex(K)}\\ \\mathrm{N\\,m/rad}` });
    const torque = (T: number) => link * (Fy * Math.cos(T) - Fx * Math.sin(T)) + moment;
    return { K, link, pivot: [L / 2, 0], torque, endAngle: (T) => T };
  }
  const guided = type === 'fixedGuided';
  const len = guided ? L / 2 : L;
  const K = (gamma * kTheta * EI) / len;
  const link = gamma * len;
  const momentOnly = constantsFor(input) === PRBM_MOMENT;
  steps.push({
    key: guided ? 'compliantGuidedSpring' : momentOnly ? 'compliantPrbmMomentSpring' : 'compliantPrbmSpring',
    math:
      `K = \\gamma K_\\Theta\\frac{EI}{${guided ? 'L/2' : 'L'}} = ${gamma} \\times ${kTheta} \\times ` +
      `\\frac{${tex(EI)}}{${tex(len)}} = ${tex(K)}\\ \\mathrm{N\\,m/rad}`,
  });
  const torque = (T: number) => link * (Fy * Math.cos(T) - Fx * Math.sin(T)) + (guided ? 0 : moment);
  return { K, link, pivot: [(1 - gamma) * len, 0], torque, endAngle: (T) => (guided ? 0 : cTheta * T) };
}

interface Solved {
  Theta: number;
  tip: [number, number];
  shape: [number, number][];
}

/** Balances the spring against the load for the pseudo-rigid angle, and places the tip. */
function balanceModel(type: FlexureType, model: Model, steps: MechStep[]): Solved | null {
  const { K, link, pivot, torque, endAngle } = model;
  const roots = bracketScan((T) => K * T - torque(T), -Math.PI, Math.PI, 720);
  if (roots.length === 0) return null;
  const Theta = roots.reduce((best, r) => (Math.abs(r) < Math.abs(best) ? r : best));
  let [pa, pb] = [pivot[0] + link * Math.cos(Theta), pivot[1] + link * Math.sin(Theta)];
  let shape: [number, number][] = [[0, 0], pivot, [pa, pb]];
  if (type === 'fixedGuided') {
    // Two half-models, the second turned half a turn about the midpoint.
    shape = [[0, 0], pivot, [pa, pb], [2 * pa - pivot[0], 2 * pb - pivot[1]], [2 * pa, 2 * pb]];
    pa *= 2;
    pb *= 2;
  }
  const arm = type === 'pivot' ? '(l/2 + R)' : '\\gamma L';
  const end = type === 'fixedGuided' ? '' : ' + M_0';
  steps.push({
    key: 'compliantBalance',
    math: `K\\Theta = ${arm}\\left(F_y\\cos\\Theta - F_x\\sin\\Theta\\right)${end}\\ \\Rightarrow\\ \\Theta = ${deg(Theta)}^\\circ`,
  });
  const factor = type === 'cantilever' ? 'c_\\theta\\Theta = ' : '';
  steps.push({
    key: type === 'fixedGuided' ? 'compliantGuidedTip' : 'compliantPrbmTip',
    math: `a = ${tex(pa)}\\ \\mathrm{m},\\ b = ${tex(pb)}\\ \\mathrm{m},\\ \\theta_0 = ${factor}${deg(endAngle(Theta))}^\\circ`,
  });
  return { Theta, tip: [pa, pb], shape };
}

/** The exact shape with its steps, and whether a compressive end load has buckled the flexure. */
function exactWithSteps(input: CompliantInput, EI: number, Fx: number, Fy: number, steps: MechStep[]) {
  const exact = exactShape(input, EI, Fx, Fy);
  if (!exact) return null;
  // A cantilever buckles at pi^2 EI / (4 L^2); a fixed-guided beam is two such halves of length L/2.
  const { type, length: L } = input;
  const half = type === 'fixedGuided' ? L / 2 : L;
  const critical = type === 'pivot' ? null : (Math.PI ** 2 * EI) / (4 * half * half);
  const buckled = critical !== null && -Fx >= critical;
  steps.push({
    key: 'compliantElastica',
    math: `EI\\frac{d\\theta}{ds} = M,\\quad \\frac{dM}{ds} = F_x\\sin\\theta - F_y\\cos\\theta,\\quad \\theta(0) = 0`,
  });
  steps.push({
    key: 'compliantElasticaResult',
    math:
      `M(0) = ${tex(exact.rootMoment)}\\ \\mathrm{N\\,m}:\\quad a = ${tex(exact.a)}\\ \\mathrm{m},\\ ` +
      `b = ${tex(exact.b)}\\ \\mathrm{m},\\ \\theta_0 = ${deg(exact.theta)}^\\circ`,
  });
  if (critical !== null && buckled) {
    const arm = type === 'fixedGuided' ? '(L/2)' : 'L';
    steps.push({
      key: 'compliantBuckled',
      vars: { ratio: fmt(-Fx / critical, 4) },
      math: `P_{cr} = \\frac{\\pi^2 EI}{4${arm}^2} = ${tex(critical)}\\ \\mathrm{N}`,
    });
  }
  return { exact, critical, buckled };
}

export function solveCompliant(input: CompliantInput): Outcome<CompliantResult> {
  const { type, length: L, E, width, thickness, force, forceAngle, moment, rigidLength } = input;
  if (!finite(L, E, width, thickness, force, forceAngle, moment, rigidLength)) return fail('notNumber');
  if (L <= 0) return fail('positiveLength');
  if (E <= 0 || width <= 0 || thickness <= 0) return fail('positiveProperties');
  if (type === 'pivot' && rigidLength <= 0) return fail('pivotRigid');
  if (type === 'fixedGuided' && moment !== 0) return fail('guidedMoment');
  const I = (width * thickness ** 3) / 12;
  const EI = E * I;
  const Fx = force * Math.cos(forceAngle);
  const Fy = force * Math.sin(forceAngle);
  const steps: MechStep[] = [
    {
      key: 'compliantSection',
      math: `I = \\frac{wt^3}{12} = ${tex(I)}\\ \\mathrm{m^4},\\quad EI = ${tex(EI)}\\ \\mathrm{N\\,m^2}`,
    },
  ];
  const reach = type === 'pivot' ? L + rigidLength : L;
  const loadIndex = (force * reach * reach) / EI;
  const solvedExact = exactWithSteps(input, EI, Fx, Fy, steps);
  if (!solvedExact) return fail('noConvergence');
  const { exact, critical, buckled } = solvedExact;
  const model = prbmModel(input, EI, Fx, Fy, steps);
  if (type === 'cantilever' && force !== 0 && moment !== 0) steps.push({ key: 'compliantCombinedLoad' });
  const solved = balanceModel(type, model, steps);
  if (!solved) return fail('noConvergence');
  const { Theta, tip } = solved;
  const inRange = type === 'pivot' || Math.abs(Theta) <= constantsFor(input).maxTheta;
  const limit = (constantsFor(input).maxTheta * 180) / Math.PI;
  if (!inRange) steps.push({ key: 'compliantOutOfRange', vars: { limit: fmt(limit, 3) } });
  const positionError = Math.hypot(tip[0] - exact.a, tip[1] - exact.b) / reach;
  steps.push({ key: 'compliantCompare', vars: { percent: fmt(100 * positionError, 3) } });
  const c = thickness / 2;
  const area = width * thickness;
  const bending = (exact.maxMoment * c) / I;
  const axial = exact.axialAtMax / area;
  const max = bending + Math.abs(axial);
  steps.push({
    key: 'compliantStress',
    math:
      `\\sigma_{\\max} = \\frac{|M|_{\\max}\\,c}{I} + \\frac{|N|}{A} = ` +
      `\\frac{${tex(exact.maxMoment)} \\times ${tex(c)}}{${tex(I)}} + ` +
      `\\frac{${tex(Math.abs(exact.axialAtMax))}}{${tex(area)}} = ${tex(max / 1e6)}\\ \\mathrm{MPa}`,
  });
  const undeformed: [number, number][] = [
    [0, 0],
    [reach, 0],
  ];
  return {
    ok: true,
    value: {
      I,
      EI,
      loadIndex,
      exact,
      prbm: {
        Theta,
        a: tip[0],
        b: tip[1],
        endAngle: model.endAngle(Theta),
        K: model.K,
        pivot: model.pivot,
        inRange,
        constants: constantsFor(input) === PRBM_MOMENT ? 'moment' : 'force',
      },
      positionError,
      critical,
      buckled,
      stress: { bending, axial, max },
      shape: {
        x: 'x',
        y: 'y',
        equal: true,
        series: [
          { name: 'undeformed', points: undeformed },
          { name: 'elastica', points: exact.points },
          { name: 'prbm', points: solved.shape },
        ],
      },
      steps,
    },
  };
}
