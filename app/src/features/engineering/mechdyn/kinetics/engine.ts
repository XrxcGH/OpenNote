// Particle and planar rigid-body dynamics. Coordinate kinematics comes from typed motion functions, rectangular
// (with normal and tangential parts) or polar. Two points on a rigid body get their relative velocity and
// acceleration and the instantaneous center. Impacts are central or oblique, with a coefficient of restitution. A
// body rolls down an incline by Newton's laws, checked by work and energy. Angles in rad, SI units,
// counterclockwise positive.
import { symbolic } from '../symbolic';
import { compileExpr, readExpr } from '../expr';
import { tex } from '../tex';
import { fail, finite, type MechStep, type Outcome, type Plot } from '../types';

// ---------- Coordinate kinematics ----------

export interface CoordsInput {
  system: 'rect' | 'polar';
  /** x(t) and y(t), or r(t) and theta(t) in radians. */
  first: string;
  second: string;
  t: number;
  /** End of the plotted time range, s. */
  tEnd: number;
}

export interface CoordsResult {
  position: [number, number];
  velocity: [number, number];
  acceleration: [number, number];
  speed: number;
  /** Tangential and normal acceleration, and the radius of curvature (null on a straight path or at rest). */
  at: number;
  an: number;
  rho: number | null;
  /** Polar only: radial and transverse components. */
  polar: { vr: number; vth: number; ar: number; ath: number } | null;
  path: Plot;
  steps: MechStep[];
}

export const COORDS_DEFAULTS: CoordsInput = { system: 'polar', first: '2t^2', second: 't', t: 1, tEnd: 2 };

type Fn = (t: number) => number;

function motion(
  text: string,
): { ok: true; f: Fn[]; latex: string[] } | { ok: false; error: 'exprSyntax' | 'exprUnknown'; name?: string } {
  const read = readExpr(text, ['t']);
  if (!read.ok) return read;
  const d1 = symbolic().derivativeOf(read.node, 't');
  const d2 = symbolic().derivativeOf(d1, 't');
  const nodes = [read.node, d1, d2];
  return {
    ok: true,
    f: nodes.map((n) => {
      const c = compileExpr(n, ['t']);
      return (t: number) => c([t]);
    }),
    latex: nodes.map(symbolic().latexOf),
  };
}

interface Components {
  position: [number, number];
  velocity: [number, number];
  acceleration: [number, number];
  polar: CoordsResult['polar'];
  steps: MechStep[];
}

/** The position, velocity, and acceleration at one time, from the two coordinates and their rates. */
function components(
  system: CoordsInput['system'],
  a: { latex: string[] },
  b: { latex: string[] },
  [p, p1, p2]: number[],
  [q, q1, q2]: number[],
  t: number,
): Components {
  const steps: MechStep[] = [];
  let position: [number, number], velocity: [number, number], acceleration: [number, number];
  let polar: CoordsResult['polar'] = null;
  if (system === 'rect') {
    position = [p, q];
    velocity = [p1, q1];
    acceleration = [p2, q2];
    steps.push({
      key: 'kinRectDerivatives',
      math: `\\dot x = ${a.latex[1]},\\ \\ddot x = ${a.latex[2]},\\quad \\dot y = ${b.latex[1]},\\ \\ddot y = ${b.latex[2]}`,
    });
    steps.push({
      key: 'kinRectValues',
      vars: { t: tex(t) },
      math: `\\mathbf v = (${tex(p1)},\\ ${tex(q1)})\\ \\mathrm{m/s},\\quad \\mathbf a = (${tex(p2)},\\ ${tex(q2)})\\ \\mathrm{m/s^2}`,
    });
  } else {
    const vr = p1,
      vth = p * q1,
      ar = p2 - p * q1 * q1,
      ath = p * q2 + 2 * p1 * q1;
    polar = { vr, vth, ar, ath };
    const c = Math.cos(q),
      s = Math.sin(q);
    position = [p * c, p * s];
    velocity = [vr * c - vth * s, vr * s + vth * c];
    acceleration = [ar * c - ath * s, ar * s + ath * c];
    steps.push({
      key: 'kinPolarDerivatives',
      math: `\\dot r = ${a.latex[1]},\\ \\ddot r = ${a.latex[2]},\\quad \\dot\\theta = ${b.latex[1]},\\ \\ddot\\theta = ${b.latex[2]}`,
    });
    steps.push({
      key: 'kinPolarValues',
      vars: { t: tex(t) },
      math:
        `r = ${tex(p)},\\ \\dot r = ${tex(p1)},\\ \\ddot r = ${tex(p2)},\\ ` +
        `\\theta = ${tex(q)},\\ \\dot\\theta = ${tex(q1)},\\ \\ddot\\theta = ${tex(q2)}`,
    });
    steps.push({
      key: 'kinPolarVelocity',
      math: `v_r = \\dot r = ${tex(vr)},\\quad v_\\theta = r\\dot\\theta = ${tex(vth)}\\ \\mathrm{m/s}`,
    });
    steps.push({
      key: 'kinPolarAcceleration',
      math:
        `a_r = \\ddot r - r\\dot\\theta^2 = ${tex(ar)},\\quad ` +
        `a_\\theta = r\\ddot\\theta + 2\\dot r\\dot\\theta = ${tex(ath)}\\ \\mathrm{m/s^2}`,
    });
  }
  return { position, velocity, acceleration, polar, steps };
}

export function solveCoords(input: CoordsInput): Outcome<CoordsResult> {
  if (!finite(input.t, input.tEnd)) return fail('notNumber');
  if (input.tEnd <= 0) return fail('positiveTime');
  const a = motion(input.first);
  if (!a.ok) return fail(a.error, a.name ? { name: a.name } : undefined);
  const b = motion(input.second);
  if (!b.ok) return fail(b.error, b.name ? { name: b.name } : undefined);
  const t = input.t;
  const [p, p1, p2] = a.f.map((f) => f(t));
  const [q, q1, q2] = b.f.map((f) => f(t));
  if (!finite(p, p1, p2, q, q1, q2)) return fail('undefinedAtTime');
  const { position, velocity, acceleration, polar, steps } = components(
    input.system,
    a,
    b,
    [p, p1, p2],
    [q, q1, q2],
    t,
  );
  const toXY =
    (fa: Fn[], fb: Fn[]) =>
    (s: number): [number, number] =>
      input.system === 'rect' ? [fa[0](s), fb[0](s)] : [fa[0](s) * Math.cos(fb[0](s)), fa[0](s) * Math.sin(fb[0](s))];
  const speed = Math.hypot(...velocity);
  const at = speed > 0 ? (velocity[0] * acceleration[0] + velocity[1] * acceleration[1]) / speed : 0;
  const cross = velocity[0] * acceleration[1] - velocity[1] * acceleration[0];
  const an = speed > 0 ? Math.abs(cross) / speed : Math.hypot(...acceleration);
  const rho = speed > 0 && an > 1e-12 * Math.max(1, Math.hypot(...acceleration)) ? speed ** 2 / an : null;
  steps.push({
    key: rho === null ? 'kinStraight' : 'kinNormalTangential',
    math:
      `v = ${tex(speed)},\\quad a_t = \\frac{\\mathbf v\\cdot\\mathbf a}{v} = ${tex(at)},\\quad ` +
      `a_n = \\frac{|\\mathbf v\\times\\mathbf a|}{v} = ${tex(an)}` +
      (rho === null ? '' : `,\\quad \\rho = v^2/a_n = ${tex(rho)}\\ \\mathrm{m}`),
  });
  const xy = toXY(a.f, b.f);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 300; i += 1) {
    const [x, y] = xy((input.tEnd * i) / 300);
    if (finite(x, y)) pts.push([x, y]);
  }
  return {
    ok: true,
    value: {
      position,
      velocity,
      acceleration,
      speed,
      at,
      an,
      rho,
      polar,
      path: {
        x: 'x',
        y: 'y',
        equal: true,
        series: [
          { name: 'path', points: pts },
          { name: 'point', points: [position] },
        ],
      },
      steps,
    },
  };
}

// ---------- Rigid body: relative motion of two points ----------

export interface RigidInput {
  A: [number, number];
  B: [number, number];
  vA: [number, number];
  aA: [number, number];
  omega: number;
  alpha: number;
}

export interface RigidResult {
  vB: [number, number];
  aB: [number, number];
  /** Instantaneous center of zero velocity, or null for pure translation. */
  ic: [number, number] | null;
  steps: MechStep[];
}

export const RIGID_DEFAULTS: RigidInput = { A: [0, 0], B: [0.3, 0.4], vA: [2, 0], aA: [0, 0], omega: 4, alpha: -2 };

export function solveRigid(input: RigidInput): Outcome<RigidResult> {
  const { A, B, vA, aA, omega: w, alpha: al } = input;
  if (!finite(...A, ...B, ...vA, ...aA, w, al)) return fail('notNumber');
  const r: [number, number] = [B[0] - A[0], B[1] - A[1]];
  if (r[0] === 0 && r[1] === 0) return fail('samePoint');
  // omega k x r = omega (-ry, rx)
  const vB: [number, number] = [vA[0] - w * r[1], vA[1] + w * r[0]];
  const aB: [number, number] = [aA[0] - al * r[1] - w * w * r[0], aA[1] + al * r[0] - w * w * r[1]];
  const ic: [number, number] | null = w === 0 ? null : [A[0] - vA[1] / w, A[1] + vA[0] / w];
  const steps: MechStep[] = [
    { key: 'kinRelative', math: `\\mathbf r_{B/A} = (${tex(r[0])},\\ ${tex(r[1])})\\ \\mathrm{m}` },
    {
      key: 'kinRelVelocity',
      math:
        `\\mathbf v_B = \\mathbf v_A + \\omega\\mathbf k\\times\\mathbf r_{B/A} = ` +
        `(${tex(vB[0])},\\ ${tex(vB[1])})\\ \\mathrm{m/s}`,
    },
    {
      key: 'kinRelAcceleration',
      math:
        `\\mathbf a_B = \\mathbf a_A + \\alpha\\mathbf k\\times\\mathbf r_{B/A} - \\omega^2\\mathbf r_{B/A} = ` +
        `(${tex(aB[0])},\\ ${tex(aB[1])})\\ \\mathrm{m/s^2}`,
    },
    ic === null
      ? { key: 'kinTranslation' }
      : {
          key: 'kinInstantCenter',
          math:
            `\\mathbf r_{IC} = \\mathbf r_A + \\frac{\\mathbf k\\times\\mathbf v_A}{\\omega} = ` +
            `(${tex(ic[0])},\\ ${tex(ic[1])})\\ \\mathrm{m}`,
        },
  ];
  return { ok: true, value: { vB, aB, ic, steps } };
}

// ---------- Impact ----------

export interface ImpactInput {
  m1: number;
  m2: number;
  /** Velocities before impact as (x, y); the line of impact is along x rotated by `line`. */
  v1: [number, number];
  v2: [number, number];
  e: number;
  /** Angle of the line of impact, rad (0 for central impact along x). */
  line: number;
}

export interface ImpactResult {
  v1: [number, number];
  v2: [number, number];
  /** Normal components before and after. */
  n1: number;
  n2: number;
  n1After: number;
  n2After: number;
  energyBefore: number;
  energyAfter: number;
  energyLost: number;
  impulse: number;
  steps: MechStep[];
}

export const IMPACT_DEFAULTS: ImpactInput = { m1: 2, m2: 3, v1: [5, 0], v2: [-1, 0], e: 0.8, line: 0 };

export function solveImpact(input: ImpactInput): Outcome<ImpactResult> {
  const { m1, m2, v1, v2, e, line } = input;
  if (!finite(m1, m2, ...v1, ...v2, e, line)) return fail('notNumber');
  if (m1 <= 0 || m2 <= 0) return fail('positiveMass');
  if (e < 0 || e > 1) return fail('restitutionRange');
  const n: [number, number] = [Math.cos(line), Math.sin(line)];
  const tn: [number, number] = [-n[1], n[0]];
  const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
  const n1 = dot(v1, n),
    n2 = dot(v2, n),
    t1 = dot(v1, tn),
    t2 = dot(v2, tn);
  if (n1 - n2 <= 0) return fail('noApproach');
  const M = m1 + m2;
  const n1After = ((m1 - e * m2) * n1 + (1 + e) * m2 * n2) / M;
  const n2After = ((m2 - e * m1) * n2 + (1 + e) * m1 * n1) / M;
  const back = (nn: number, tt: number): [number, number] => [nn * n[0] + tt * tn[0], nn * n[1] + tt * tn[1]];
  const out1 = back(n1After, t1),
    out2 = back(n2After, t2);
  const ke = (m: number, v: [number, number]) => 0.5 * m * dot(v, v);
  const energyBefore = ke(m1, v1) + ke(m2, v2);
  const energyAfter = ke(m1, out1) + ke(m2, out2);
  const impulse = m1 * (n1After - n1);
  const steps: MechStep[] = [
    {
      key: line === 0 ? 'kinImpactCentral' : 'kinImpactOblique',
      math: `v_{1n} = ${tex(n1)},\\ v_{2n} = ${tex(n2)}\\ \\mathrm{m/s}`,
    },
    {
      key: 'kinMomentum',
      math: `m_1 v_{1n} + m_2 v_{2n} = m_1 v_{1n}' + m_2 v_{2n}' = ${tex(m1 * n1 + m2 * n2)}\\ \\mathrm{kg\\,m/s}`,
    },
    {
      key: 'kinRestitution',
      math: `v_{2n}' - v_{1n}' = e\\,(v_{1n} - v_{2n}) = ${tex(e * (n1 - n2))}\\ \\mathrm{m/s}`,
    },
    {
      key: 'kinImpactSolve',
      math:
        `v_{1n}' = \\frac{(m_1 - e m_2)v_{1n} + (1+e)m_2 v_{2n}}{m_1+m_2} = ${tex(n1After)},\\quad ` +
        `v_{2n}' = ${tex(n2After)}\\ \\mathrm{m/s}`,
    },
    {
      key: 'kinEnergyLost',
      math:
        `\\Delta T = T_1 - T_2 = ${tex(energyBefore)} - ${tex(energyAfter)} = ` +
        `${tex(energyBefore - energyAfter)}\\ \\mathrm{J}`,
    },
  ];
  return {
    ok: true,
    value: {
      v1: out1,
      v2: out2,
      n1,
      n2,
      n1After,
      n2After,
      energyBefore,
      energyAfter,
      energyLost: energyBefore - energyAfter,
      impulse,
      steps,
    },
  };
}

// ---------- Rolling down an incline ----------

export type RollingShape = 'disk' | 'hoop' | 'sphere' | 'shell' | 'custom';
/** k^2 / r^2 for each shape about its center. */
export const SHAPE_FACTOR: Record<Exclude<RollingShape, 'custom'>, number> = {
  disk: 1 / 2,
  hoop: 1,
  sphere: 2 / 5,
  shell: 2 / 3,
};

export interface RollingInput {
  shape: RollingShape;
  /** I / (m r^2) when the shape is custom. */
  factor: number;
  angle: number;
  mass: number;
  radius: number;
  g: number;
  /** Distance rolled from rest, m. */
  distance: number;
  /** Friction coefficient; 0 or less means "enough to roll". */
  mu: number;
}

export interface RollingResult {
  factor: number;
  acceleration: number;
  alpha: number;
  friction: number;
  muNeeded: number;
  slipping: boolean;
  speed: number;
  steps: MechStep[];
}

export const ROLLING_DEFAULTS: RollingInput = {
  shape: 'disk',
  factor: 0.5,
  angle: Math.PI / 6,
  mass: 1,
  radius: 0.1,
  g: 9.81,
  distance: 1,
  mu: 0,
};

export function solveRolling(input: RollingInput): Outcome<RollingResult> {
  const { angle, mass, radius, g, distance, mu } = input;
  const factor = input.shape === 'custom' ? input.factor : SHAPE_FACTOR[input.shape];
  if (!finite(factor, angle, mass, radius, g, distance, mu)) return fail('notNumber');
  if (mass <= 0) return fail('positiveMass');
  if (radius <= 0) return fail('positiveRadius');
  if (factor <= 0 || factor > 1) return fail('shapeFactor');
  if (angle <= 0 || angle >= Math.PI / 2) return fail('inclineAngle');
  if (g <= 0) return fail('positiveGravity');
  if (distance < 0) return fail('negativeDistance');
  const s = Math.sin(angle),
    c = Math.cos(angle);
  const rollA = (g * s) / (1 + factor);
  const muNeeded = (factor / (1 + factor)) * Math.tan(angle);
  const slipping = mu > 0 && mu < muNeeded;
  const acceleration = slipping ? g * (s - mu * c) : rollA;
  const friction = slipping ? mu * mass * g * c : mass * g * s - mass * rollA;
  const alpha = slipping ? (friction * radius) / (factor * mass * radius * radius) : rollA / radius;
  const speed = Math.sqrt(2 * acceleration * distance);
  const steps: MechStep[] = [
    {
      key: 'kinRollingEquations',
      math: `m a = m g\\sin\\theta - f,\\quad I\\alpha = f r,\\quad a = \\alpha r,\\quad I = ${tex(factor)}\\,m r^2`,
    },
    {
      key: 'kinRollingAcceleration',
      math:
        `a = \\frac{g\\sin\\theta}{1 + I/(m r^2)} = ` +
        `\\frac{${tex(g)}\\sin ${tex((angle * 180) / Math.PI)}^\\circ}{1 + ${tex(factor)}} = ${tex(rollA)}\\ \\mathrm{m/s^2}`,
    },
    {
      key: slipping ? 'kinRollingSlips' : 'kinRollingGrips',
      vars: { needed: tex(muNeeded), mu: tex(mu) },
      math: `\\mu_\\text{needed} = \\frac{I/(m r^2)}{1 + I/(m r^2)}\\tan\\theta = ${tex(muNeeded)}`,
    },
    slipping
      ? {
          key: 'kinSlidingSpeed',
          math: `a = g(\\sin\\theta - \\mu\\cos\\theta),\\quad v = \\sqrt{2 a d} = ${tex(speed)}\\ \\mathrm{m/s}`,
        }
      : {
          key: 'kinRollingEnergy',
          math: `m g d\\sin\\theta = \\tfrac12 m v^2 + \\tfrac12 I\\omega^2 \\Rightarrow v = ${tex(speed)}\\ \\mathrm{m/s}`,
        },
  ];
  return { ok: true, value: { factor, acceleration, alpha, friction, muNeeded, slipping, speed, steps } };
}
