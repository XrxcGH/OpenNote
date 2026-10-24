// Planar linkages: the four-bar (Freudenstein constants and the half-angle form for the open and crossed circuits),
// the slider-crank with offset, and the inverted slider-crank. Velocities and accelerations come from
// differentiating the vector loop (2 x 2 linear solves), with the loop-closure residual as a check. Grashof class,
// transmission angle, toggle and limit positions, coupler point paths, and a sweep through the input's whole range.
// Ground pivot O2 at the origin, O4 on +x at distance d; angles from +x, counterclockwise positive; SI units.
import { rad, solve, wrap, type Mat } from '../num';
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';

export type LinkageType = 'fourbar' | 'slider' | 'inverted';
export type Circuit = 'open' | 'crossed';
export type GrashofClass =
  'crankRocker' | 'doubleCrank' | 'rockerCrank' | 'doubleRocker' | 'changePoint' | 'tripleRocker';

export interface LinkageInput {
  type: LinkageType;
  /** Crank (input) O2A. */
  a: number;
  /** Coupler AB, or the connecting rod. */
  b: number;
  /** Rocker O4B; for the slider-crank, the slider offset. */
  c: number;
  /** Ground O2O4 (four-bar and inverted slider-crank). */
  d: number;
  circuit: Circuit;
  theta2: number;
  omega2: number;
  alpha2: number;
  /** Coupler point: distance from A and angle from the line AB (from O4 along link 4 for the inverted slider-crank). */
  couplerDistance: number;
  couplerAngle: number;
}

export const LINKAGE_DEFAULTS: LinkageInput = {
  type: 'fourbar',
  a: 2,
  b: 7,
  c: 9,
  d: 6,
  circuit: 'open',
  theta2: rad(30),
  omega2: 10,
  alpha2: 0,
  couplerDistance: 3.5,
  couplerAngle: rad(30),
};

type P = [number, number];

export interface LinkageState {
  theta2: number;
  theta3: number;
  theta4: number;
  omega3: number;
  omega4: number;
  alpha3: number;
  alpha4: number;
  /** Slider-crank: slider position, velocity, and acceleration along x. Inverted: distance O4A along link 4 and its rates. */
  slider: { pos: number; vel: number; acc: number } | null;
  /** Inverted slider-crank: Coriolis acceleration 2 b-dot omega4. */
  coriolis: number | null;
  /** Transmission angle, folded into 0 to 90 degrees, rad. */
  transmission: number;
  joints: { O2: P; A: P; B: P; O4: P | null; C: P };
  coupler: { pos: P; vel: P; acc: P };
  residual: number;
  /** A toggle or change point: the linkage assembles, but the velocity matrix is singular, so the rates are NaN. */
  toggle: boolean;
}

export interface GrashofResult {
  s: number;
  l: number;
  pq: number;
  cls: GrashofClass;
}

/** Grashof condition: s + l against p + q, and which link is shortest. */
export function grashof(a: number, b: number, c: number, d: number): GrashofResult {
  const sorted = [a, b, c, d].sort((x, y) => x - y);
  const [s, , , l] = sorted;
  const pq = sorted[1] + sorted[2];
  const tol = 1e-12 * l;
  if (s + l > pq + tol) return { s, l, pq, cls: 'tripleRocker' };
  if (Math.abs(s + l - pq) <= tol) return { s, l, pq, cls: 'changePoint' };
  const cls: GrashofClass =
    d === s ? 'doubleCrank' : a === s ? 'crankRocker' : c === s ? 'rockerCrank' : 'doubleRocker';
  return { s, l, pq, cls };
}

/** The Freudenstein constants K1 to K5. */
export function freudenstein(a: number, b: number, c: number, d: number) {
  return {
    K1: d / a,
    K2: d / c,
    K3: (a * a - b * b + c * c + d * d) / (2 * a * c),
    K4: d / b,
    K5: (c * c - d * d - a * a - b * b) / (2 * a * b),
  };
}

/** Root of A t^2 + B t + C = 0 with t = tan(theta / 2), the open circuit taking the minus sign; null when imaginary. */
function halfAngle(A: number, B: number, C: number, sign: -1 | 1): number | null {
  const disc = B * B - 4 * A * C;
  if (disc < -1e-12 * Math.max(1, B * B)) return null;
  const r = Math.sqrt(Math.max(0, disc));
  const num = -B + sign * r,
    den = 2 * A;
  const num2 = 2 * C,
    den2 = -B - sign * r;
  // Both forms give the same tan(theta/2); use the one with the larger denominator so A or C near zero stays exact.
  return Math.abs(den) >= Math.abs(den2) ? wrap(2 * Math.atan2(num, den)) : wrap(2 * Math.atan2(num2, den2));
}

/** Four-bar link angles at one input angle by the half-angle form, or null where the linkage can't assemble. */
export function fourBarAngles(input: LinkageInput, theta2: number): { theta3: number; theta4: number } | null {
  const { a, b, c, d, circuit } = input;
  const { K1, K2, K3, K4, K5 } = freudenstein(a, b, c, d);
  const sign = circuit === 'open' ? -1 : 1;
  const cs = Math.cos(theta2),
    sn = Math.sin(theta2);
  const theta4 = halfAngle(cs - K1 - K2 * cs + K3, -2 * sn, K1 - (K2 + 1) * cs + K3, sign);
  const theta3 = halfAngle(cs - K1 + K4 * cs + K5, -2 * sn, K1 + (K4 - 1) * cs + K5, sign);
  if (theta4 === null || theta3 === null) return null;
  return { theta3, theta4 };
}

const add = (p: P, q: P): P => [p[0] + q[0], p[1] + q[1]];
const polar = (r: number, t: number): P => [r * Math.cos(t), r * Math.sin(t)];
/** Velocity and acceleration of a point at r from a pivot point with known motion, on a body turning at w, al. */
const rigid = (r: P, vBase: P, aBase: P, w: number, al: number): { v: P; a: P } => ({
  v: [vBase[0] - w * r[1], vBase[1] + w * r[0]],
  a: [aBase[0] - al * r[1] - w * w * r[0], aBase[1] + al * r[0] - w * w * r[1]],
});
/** The acute angle between two directions, 0 to 90 degrees. */
const acute = (t: number) => {
  const mu = Math.abs(wrap(t));
  return mu > Math.PI / 2 ? Math.PI - mu : mu;
};

/** The crank pin A and its motion. */
interface Crank {
  A: P;
  v: P;
  a: P;
}

function fourBarState(input: LinkageInput, theta2: number, crank: Crank): LinkageState | null {
  const { a, b, c, d, omega2: w2, alpha2: al2, couplerDistance: p, couplerAngle: delta } = input;
  const angles = fourBarAngles(input, theta2);
  if (!angles) return null;
  const { theta4 } = angles;
  const { A } = crank;
  const O4: P = [d, 0];
  const B = add(O4, polar(c, theta4));
  // theta3 from the joint positions keeps the pair on one circuit; the half-angle theta3 is the cross-check.
  const theta3 = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const [s2, c2, s3, c3, s4, c4] = [theta2, theta3, theta4].flatMap((t) => [Math.sin(t), Math.cos(t)]);
  const J: Mat = [
    [-b * s3, c * s4],
    [b * c3, -c * c4],
  ];
  // In line (a toggle or change point) the matrix is singular: the positions stand, the rates are undefined.
  const [w3, w4] = solve(J, [a * w2 * s2, -a * w2 * c2]) ?? [Number.NaN, Number.NaN];
  const [al3, al4] = solve(J, [
    a * al2 * s2 + a * w2 * w2 * c2 + b * w3 * w3 * c3 - c * w4 * w4 * c4,
    -a * al2 * c2 + a * w2 * w2 * s2 + b * w3 * w3 * s3 - c * w4 * w4 * s4,
  ]) ?? [Number.NaN, Number.NaN];
  const loop = add(add(A, polar(b, angles.theta3)), [-d - c * c4, -c * s4]);
  const r = polar(p, theta3 + delta);
  const cp = rigid(r, crank.v, crank.a, w3, al3);
  return {
    theta2,
    theta3,
    theta4,
    omega3: w3,
    omega4: w4,
    alpha3: al3,
    alpha4: al4,
    slider: null,
    coriolis: null,
    transmission: acute(theta3 - theta4),
    joints: { O2: [0, 0], A, B, O4, C: add(A, r) },
    coupler: { pos: add(A, r), vel: cp.v, acc: cp.a },
    residual: Math.hypot(...loop) / Math.max(a, b, c, d),
    toggle: !Number.isFinite(w3),
  };
}

/** Slider-crank: the slider moves along y = e (e is c), the connecting rod is b. */
function sliderState(input: LinkageInput, theta2: number, crank: Crank): LinkageState | null {
  const { a, b, c: e, omega2: w2, alpha2: al2, couplerDistance: p, couplerAngle: delta } = input;
  const { A } = crank;
  const u = a * Math.sin(theta2) - e;
  if (Math.abs(u) > b) return null;
  const sign = input.circuit === 'open' ? 1 : -1;
  const x = a * Math.cos(theta2) + sign * Math.sqrt(b * b - u * u);
  const B: P = [x, e];
  const theta3 = Math.atan2(e - A[1], x - A[0]);
  const [s2, c2, s3, c3] = [theta2, theta3].flatMap((t) => [Math.sin(t), Math.cos(t)]);
  if (Math.abs(c3) < 1e-12) return null;
  const w3 = (-a * w2 * c2) / (b * c3);
  const al3 = (a * (s2 * w2 * w2 - c2 * al2) + b * s3 * w3 * w3) / (b * c3);
  const v = -a * w2 * s2 - b * w3 * s3;
  const acc = -a * (al2 * s2 + w2 * w2 * c2) - b * (al3 * s3 + w3 * w3 * c3);
  const loop = add(add(A, polar(b, theta3)), [-x, -e]);
  const r = polar(p, theta3 + delta);
  const cp = rigid(r, crank.v, crank.a, w3, al3);
  return {
    theta2,
    theta3,
    theta4: 0,
    omega3: w3,
    omega4: 0,
    alpha3: al3,
    alpha4: 0,
    slider: { pos: x, vel: v, acc },
    coriolis: null,
    transmission: Math.PI / 2 - Math.asin(Math.min(1, Math.abs(u) / b)),
    joints: { O2: [0, 0], A, B, O4: null, C: add(A, r) },
    coupler: { pos: add(A, r), vel: cp.v, acc: cp.a },
    residual: Math.hypot(...loop) / Math.max(a, b),
    toggle: false,
  };
}

/** Inverted slider-crank: a block pinned at A slides along link 4, which turns about O4. */
function invertedState(input: LinkageInput, theta2: number, crank: Crank): LinkageState | null {
  const { a, d, couplerDistance: p, couplerAngle: delta } = input;
  const { A, v: rd, a: rdd } = crank;
  const O4: P = [d, 0];
  const r: P = [A[0] - d, A[1]];
  const len = Math.hypot(...r);
  if (len < 1e-9 * Math.max(a, d)) return null;
  const theta4 = Math.atan2(r[1], r[0]);
  const w4 = (r[0] * rd[1] - r[1] * rd[0]) / len ** 2;
  const bd = (r[0] * rd[0] + r[1] * rd[1]) / len;
  const al4 = (r[0] * rdd[1] - r[1] * rdd[0]) / len ** 2 - (2 * bd * w4) / len;
  const bdd = (r[0] * rdd[0] + r[1] * rdd[1] + rd[0] ** 2 + rd[1] ** 2 - bd * bd) / len;
  const cpR = polar(p, theta4 + delta);
  const cp = rigid(cpR, [0, 0], [0, 0], w4, al4);
  return {
    theta2,
    theta3: theta4,
    theta4,
    omega3: w4,
    omega4: w4,
    alpha3: al4,
    alpha4: al4,
    slider: { pos: len, vel: bd, acc: bdd },
    coriolis: 2 * bd * w4,
    transmission: acute(theta4 - theta2),
    joints: { O2: [0, 0], A, B: add(O4, polar(len, theta4)), O4, C: add(O4, cpR) },
    coupler: { pos: add(O4, cpR), vel: cp.v, acc: cp.a },
    residual: 0,
    toggle: false,
  };
}

const STATE = { fourbar: fourBarState, slider: sliderState, inverted: invertedState };

/** The full state at one input angle, or null where the linkage can't assemble. */
export function linkageState(input: LinkageInput, theta2: number): LinkageState | null {
  const A = polar(input.a, theta2);
  const crank = rigid(A, [0, 0], [0, 0], input.omega2, input.alpha2);
  return STATE[input.type](input, theta2, { A, v: crank.v, a: crank.a });
}

export interface LinkageResult {
  state: LinkageState;
  grashof: GrashofResult | null;
  /** Input angles where the input can't go further (b and c in line), rad. */
  inputLimits: number[];
  /** Toggle positions of the output: crank and coupler in line, with the output angle there. */
  toggles: { theta2: number; theta4: number; extended: boolean }[];
  /** Slider-crank: stroke and the extreme slider positions. */
  stroke: { min: number; max: number } | null;
  sweep: LinkageState[];
  plots: { angles: Plot; velocities: Plot; accelerations: Plot; transmission: Plot; couplerCurve: Plot };
  steps: MechStep[];
}

const deg = (r: number) => (r * 180) / Math.PI;

/** Input angles where the coupler and rocker line up, so the input can't turn further. */
function fourBarLimits({ a, b, c, d }: LinkageInput): number[] {
  const limits: number[] = [];
  for (const reach of [b + c, Math.abs(b - c)]) {
    const cosT = (a * a + d * d - reach * reach) / (2 * a * d);
    if (Math.abs(cosT) <= 1) limits.push(Math.acos(cosT), -Math.acos(cosT));
  }
  return limits;
}

/** Toggle positions of the output: crank and coupler in line, so O2B is their sum or their difference. */
function fourBarToggles(input: LinkageInput): LinkageResult['toggles'] {
  const { a, b, c, d } = input;
  const toggles: LinkageResult['toggles'] = [];
  for (const [reach, extended] of [
    [b + a, true],
    [Math.abs(b - a), false],
  ] as const) {
    const cosB = (reach * reach + d * d - c * c) / (2 * reach * d);
    if (Math.abs(cosB) > 1) continue;
    for (const side of [1, -1]) {
      const phi = side * Math.acos(cosB);
      const B: P = polar(reach, phi);
      const t2 = wrap(extended ? phi : phi + (b > a ? Math.PI : 0));
      const t4 = Math.atan2(B[1], B[0] - d);
      const s = linkageState(input, t2);
      if (s && Math.abs(wrap(s.theta4 - t4)) < 1e-6) toggles.push({ theta2: t2, theta4: t4, extended });
    }
  }
  return toggles;
}

const VELOCITY_SYSTEM =
  '\\begin{bmatrix} -b\\sin\\theta_3 & c\\sin\\theta_4 \\\\ b\\cos\\theta_3 & -c\\cos\\theta_4 \\end{bmatrix}' +
  '\\begin{bmatrix}\\omega_3 \\\\ \\omega_4\\end{bmatrix} = ' +
  '\\begin{bmatrix} a\\omega_2\\sin\\theta_2 \\\\ -a\\omega_2\\cos\\theta_2 \\end{bmatrix}';

/** The velocity and acceleration steps, or at a toggle the reason there are none. */
function rateSteps(state: LinkageState, rates: string): MechStep[] {
  if (state.toggle) {
    const det = `\\det J = bc\\sin(\\theta_3 - \\theta_4) = 0`;
    return [{ key: 'linkToggle', vars: { angle: fmt(deg(state.theta2), 4) }, math: det }];
  }
  return [
    { key: 'linkVelocity', math: `${VELOCITY_SYSTEM}:\\ ${rates}` },
    {
      key: 'linkAcceleration',
      math: `\\alpha_3 = ${tex(state.alpha3)},\\ \\alpha_4 = ${tex(state.alpha4)}\\ \\mathrm{rad/s^2}`,
    },
  ];
}

function fourBarSteps(input: LinkageInput, state: LinkageState, g: GrashofResult): MechStep[] {
  const { a, b, c, d, theta2 } = input;
  const K = freudenstein(a, b, c, d);
  const cs = Math.cos(theta2),
    sn = Math.sin(theta2);
  const [A4, B4, C4] = [cs - K.K1 - K.K2 * cs + K.K3, -2 * sn, K.K1 - (K.K2 + 1) * cs + K.K3];
  const [D3, E3, F3] = [cs - K.K1 + K.K4 * cs + K.K5, -2 * sn, K.K1 + (K.K4 - 1) * cs + K.K5];
  const sign = input.circuit === 'open' ? '-' : '+';
  const relation = g.cls === 'tripleRocker' ? '>' : g.cls === 'changePoint' ? '=' : '<';
  const constants = [
    `K_1 = \\frac da = ${tex(K.K1)}`,
    `K_2 = \\frac dc = ${tex(K.K2)}`,
    `K_3 = \\frac{a^2 - b^2 + c^2 + d^2}{2ac} = ${tex(K.K3)}`,
    `K_4 = \\frac db = ${tex(K.K4)}`,
    `K_5 = \\frac{c^2 - d^2 - a^2 - b^2}{2ab} = ${tex(K.K5)}`,
  ];
  const t4 = `\\theta_4 = 2\\arctan\\frac{-B ${sign} \\sqrt{B^2 - 4AC}}{2A} = ${tex(deg(state.theta4))}^\\circ`;
  const t3 = `\\theta_3 = 2\\arctan\\frac{-E ${sign} \\sqrt{E^2 - 4DF}}{2D} = ${tex(deg(state.theta3))}^\\circ`;
  const rates = `\\omega_3 = ${tex(state.omega3)},\\ \\omega_4 = ${tex(state.omega4)}\\ \\mathrm{rad/s}`;
  const steps: MechStep[] = [
    { key: 'linkLoop', math: `a e^{i\\theta_2} + b e^{i\\theta_3} - c e^{i\\theta_4} - d = 0` },
    {
      key: `linkGrashof_${g.cls}`,
      vars: { s: fmt(g.s), l: fmt(g.l), sl: fmt(g.s + g.l), pq: fmt(g.pq) },
      math: `s + l = ${tex(g.s + g.l)}\\ ${relation}\\ p + q = ${tex(g.pq)}`,
    },
    { key: 'linkConstants', math: constants.join(',\\ ') },
    {
      key: 'linkTheta4',
      vars: { circuit: input.circuit },
      math: `A = ${tex(A4)},\\ B = ${tex(B4)},\\ C = ${tex(C4)}:\\quad ${t4}`,
    },
    { key: 'linkTheta3', math: `D = ${tex(D3)},\\ E = ${tex(E3)},\\ F = ${tex(F3)}:\\quad ${t3}` },
    ...rateSteps(state, rates),
    {
      key: 'linkTransmission',
      vars: { angle: fmt(deg(state.transmission), 4) },
      math: `\\mu = |\\theta_4 - \\theta_3| = ${tex(deg(state.transmission))}^\\circ`,
    },
  ];
  if (deg(state.transmission) < 40) steps.push({ key: 'linkTransmissionLow' });
  return steps;
}

function sliderSteps(input: LinkageInput, state: LinkageState): { steps: MechStep[]; stroke: LinkageResult['stroke'] } {
  const { a, b, c } = input;
  const slider = state.slider!;
  const x = `x = a\\cos\\theta_2 ${input.circuit === 'open' ? '+' : '-'} \\sqrt{b^2 - (a\\sin\\theta_2 - e)^2}`;
  const w3 = `\\omega_3 = \\frac{-a\\omega_2\\cos\\theta_2}{b\\cos\\theta_3} = ${tex(state.omega3)}\\ \\mathrm{rad/s}`;
  const v = `\\dot x = -a\\omega_2\\sin\\theta_2 - b\\omega_3\\sin\\theta_3 = ${tex(slider.vel)}`;
  const acc =
    '\\ddot x = -a(\\alpha_2\\sin\\theta_2 + \\omega_2^2\\cos\\theta_2) - ' +
    `b(\\alpha_3\\sin\\theta_3 + \\omega_3^2\\cos\\theta_3) = ${tex(slider.acc)}`;
  const steps: MechStep[] = [
    { key: 'linkSliderPosition', math: `${x} = ${tex(slider.pos)}` },
    { key: 'linkSliderVelocity', math: `${w3},\\quad ${v}` },
    { key: 'linkSliderAcceleration', math: `\\alpha_3 = ${tex(state.alpha3)}\\ \\mathrm{rad/s^2},\\quad ${acc}` },
  ];
  if (b < a + Math.abs(c)) {
    steps.push({ key: 'linkSliderLimited' });
    return { steps, stroke: null };
  }
  const far = Math.sqrt((a + b) ** 2 - c * c),
    near = Math.sqrt((b - a) ** 2 - c * c);
  steps.push({ key: 'linkStroke', vars: { stroke: fmt(far - near) } });
  const open = input.circuit === 'open';
  return { steps, stroke: { min: open ? near : -far, max: open ? far : -near } };
}

function invertedSteps(state: LinkageState): MechStep[] {
  const slider = state.slider!;
  const w4 = `\\omega_4 = \\frac{\\mathbf r\\times\\dot{\\mathbf r}}{b^2} = ${tex(state.omega4)}\\ \\mathrm{rad/s}`;
  const bd = `\\dot b = \\frac{\\mathbf r\\cdot\\dot{\\mathbf r}}{b} = ${tex(slider.vel)}`;
  const al4 = `\\alpha_4 = ${tex(state.alpha4)}\\ \\mathrm{rad/s^2}`;
  const geometry = `b = |\\mathbf r| = ${tex(slider.pos)},\\quad \\theta_4 = ${tex(deg(state.theta4))}^\\circ`;
  return [
    { key: 'linkInvertedGeometry', math: `\\mathbf r = \\mathbf A - \\mathbf O_4,\\quad ${geometry}` },
    { key: 'linkInvertedVelocity', math: `${w4},\\quad ${bd}` },
    {
      key: 'linkInvertedAcceleration',
      math: `${al4},\\quad \\ddot b = ${tex(slider.acc)},\\quad 2\\dot b\\omega_4 = ${tex(state.coriolis!)}`,
    },
  ];
}

type Pick = (s: LinkageState) => number;
type Pair = [number, number];

/** Plots against the input angle, with breaks where the linkage can't assemble or an angle wraps past 360°. */
function sweepPlots(type: LinkageType, states: readonly (LinkageState | null)[]): LinkageResult['plots'] {
  const series = (pick: Pick): Pair[] => states.map((s, i) => [i, s ? pick(s) : Number.NaN]);
  const angle = (pick: Pick): Pair[] => {
    const points = series((s) => ((deg(pick(s)) % 360) + 360) % 360);
    return points.map(([x, y], i) => [x, i > 0 && Math.abs(y - points[i - 1][1]) > 180 ? Number.NaN : y]);
  };
  const fourbar = type === 'fourbar';
  const slider = type === 'slider';
  return {
    angles: {
      x: 'inputAngle',
      y: 'linkAngle',
      series: [
        ...(type !== 'inverted' ? [{ name: 'theta3' as const, points: angle((s) => s.theta3) }] : []),
        ...(type !== 'slider' ? [{ name: 'theta4' as const, points: angle((s) => s.theta4) }] : []),
      ],
    },
    velocities: {
      x: 'inputAngle',
      y: slider ? 'sliderVelocity' : 'angularVelocity',
      series: slider
        ? [{ name: 'slider', points: series((s) => s.slider!.vel) }]
        : [
            ...(fourbar ? [{ name: 'omega3' as const, points: series((s) => s.omega3) }] : []),
            { name: 'omega4', points: series((s) => s.omega4) },
          ],
    },
    accelerations: {
      x: 'inputAngle',
      y: slider ? 'sliderAcceleration' : 'angularAcceleration',
      series: slider
        ? [{ name: 'slider', points: series((s) => s.slider!.acc) }]
        : [
            ...(fourbar ? [{ name: 'alpha3' as const, points: series((s) => s.alpha3) }] : []),
            { name: 'alpha4', points: series((s) => s.alpha4) },
          ],
    },
    transmission: {
      x: 'inputAngle',
      y: 'transmissionAngle',
      series: [{ name: 'transmission', points: series((s) => deg(s.transmission)) }],
    },
    couplerCurve: {
      x: 'x',
      y: 'y',
      equal: true,
      series: [{ name: 'couplerCurve', points: states.map((s) => (s ? s.coupler.pos : [Number.NaN, Number.NaN])) }],
    },
  };
}

function invalidLinkage(input: LinkageInput): Fail | null {
  const { type, a, b, c, d, theta2 } = input;
  if (!finite(a, b, c, d, theta2, input.omega2, input.alpha2, input.couplerDistance, input.couplerAngle))
    return fail('notNumber');
  if (a <= 0 || (type !== 'inverted' && b <= 0) || (type === 'fourbar' && c <= 0) || (type !== 'slider' && d <= 0))
    return fail('positiveLinks');
  if (input.couplerDistance < 0) return fail('negativeDistance');
  return null;
}

type Fail = ReturnType<typeof fail>;

export function solveLinkage(input: LinkageInput): Outcome<LinkageResult> {
  const bad = invalidLinkage(input);
  if (bad) return bad;
  const { type } = input;
  const state = linkageState(input, input.theta2);
  if (!state)
    return fail(type === 'inverted' ? 'linkThroughPivot' : 'linkNoAssembly', { angle: fmt(deg(input.theta2), 4) });
  const g = type === 'fourbar' ? grashof(input.a, input.b, input.c, input.d) : null;
  let steps: MechStep[];
  let inputLimits: number[] = [];
  let toggles: LinkageResult['toggles'] = [];
  let stroke: LinkageResult['stroke'] = null;
  if (g) {
    steps = fourBarSteps(input, state, g);
    inputLimits = fourBarLimits(input);
    toggles = fourBarToggles(input);
    if (toggles.length) steps.push({ key: 'linkToggles', vars: { count: String(toggles.length) } });
    steps.push({ key: 'linkResidual', vars: { residual: fmt(state.residual, 2) } });
  } else if (type === 'slider') ({ steps, stroke } = sliderSteps(input, state));
  else steps = invertedSteps(state);
  // Sweep the input through a full turn, a state per degree (null where it can't assemble).
  const states = Array.from({ length: 361 }, (_, i) => linkageState(input, rad(i)));
  const sweep = states.filter((s): s is LinkageState => s !== null);
  const plots = sweepPlots(type, states);
  return { ok: true, value: { state, grashof: g, inputLimits, toggles, stroke, sweep, plots, steps } };
}
