// Multi-degree-of-freedom and continuous vibration, in SI units throughout. A lumped system is M, K, and C, typed
// in or built from a chain of masses, springs, and dampers. Its natural frequencies and mass-normalized modes come
// from the generalized symmetric eigenproblem. The free response is by modal superposition, and a harmonic force
// gives every mass a steady amplitude. A continuous member is a string, bar, shaft, or Euler-Bernoulli beam.
import { bracketScan, generalizedEigen, solve, type Mat } from '../num';
import { tex } from '../tex';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot, type Series } from '../types';

export interface ChainInput {
  masses: number[];
  /** n + 1 springs: wall to the first mass, between masses, last mass to the wall (0 when there is none). */
  springs: number[];
  dampers: number[];
}

/** M, K, and C of a chain of masses joined by springs and dampers. */
export function buildChain({ masses, springs, dampers }: ChainInput): { M: Mat; K: Mat; C: Mat } {
  const n = masses.length;
  const zero = () => Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const M = zero(),
    K = zero(),
    C = zero();
  const link = (A: Mat, i: number, value: number) => {
    // Element i joins mass i - 1 and mass i (index -1 and n are the walls).
    if (i - 1 >= 0) A[i - 1][i - 1] += value;
    if (i < n) A[i][i] += value;
    if (i - 1 >= 0 && i < n) {
      A[i - 1][i] -= value;
      A[i][i - 1] -= value;
    }
  };
  masses.forEach((m, i) => (M[i][i] = m));
  for (let i = 0; i <= n; i += 1) {
    link(K, i, springs[i] ?? 0);
    link(C, i, dampers[i] ?? 0);
  }
  return { M, K, C };
}

export interface LumpedInput {
  M: Mat;
  K: Mat;
  C: Mat;
  /** Modal damping ratio for the free response (used when C is all zero). */
  zeta: number;
  x0: number[];
  v0: number[];
  /** Harmonic force amplitude on each mass, N, at the forcing frequency. */
  force: number[];
  omega: number;
  duration: number;
}

export interface LumpedResult {
  omegas: number[];
  freqs: number[];
  /** Mass-normalized mode shapes, one array per mode. */
  modes: number[][];
  /** Each mode scaled so its largest entry is 1, for drawing. */
  shapes: number[][];
  /** det(K - w^2 M) = a w^4 + b w^2 + c for two degrees of freedom. */
  characteristic: [number, number, number] | null;
  amplitudes: number[] | null;
  response: Plot;
  frequency: Plot | null;
  modePlot: Plot;
  steps: MechStep[];
}

const sym = (A: Mat) =>
  A.every((row, i) => row.every((v, j) => Math.abs(v - A[j][i]) <= 1e-9 * Math.max(1, Math.abs(v))));

/** Steady complex amplitude of (K - w^2 M + i w C) X = F, returned as magnitudes. */
export function steadyAmplitudes(M: Mat, K: Mat, C: Mat, F: readonly number[], w: number): number[] | null {
  const n = M.length;
  const big: Mat = Array.from({ length: 2 * n }, () => new Array<number>(2 * n).fill(0));
  for (let i = 0; i < n; i += 1)
    for (let j = 0; j < n; j += 1) {
      const a = K[i][j] - w * w * M[i][j],
        b = w * C[i][j];
      big[i][j] = a;
      big[i][j + n] = -b;
      big[i + n][j] = b;
      big[i + n][j + n] = a;
    }
  const x = solve(big, [...F, ...new Array<number>(n).fill(0)]);
  return x ? Array.from({ length: n }, (_, i) => Math.hypot(x[i], x[i + n])) : null;
}

type Fail = ReturnType<typeof fail>;

function invalidLumped({ M, K, C, zeta, omega, duration, x0, v0, force }: LumpedInput): Fail | null {
  const n = M.length;
  if (n === 0) return fail('mdofEmpty');
  if (n > 12) return fail('mdofTooBig');
  if ([M, K, C].some((A) => A.length !== n || A.some((row) => row.length !== n))) return fail('mdofShape');
  if (!finite(...M.flat(), ...K.flat(), ...C.flat(), zeta, omega, duration, ...x0, ...v0, ...force))
    return fail('notNumber');
  if (!sym(M) || !sym(K) || !sym(C)) return fail('mdofSymmetric');
  if (zeta < 0) return fail('negativeDamping');
  return null;
}

const hasDamper = (C: Mat) => C.some((row) => row.some((v) => v !== 0));

/** uᵀ A v. */
const quadratic = (A: Mat, u: readonly number[], v: readonly number[]) =>
  u.reduce((s, ui, i) => s + ui * A[i].reduce((t, a, j) => t + a * (v[j] ?? 0), 0), 0);

/** A mode scaled so its largest entry is 1, for drawing. */
const peakScaled = (phi: readonly number[]) => {
  const big = phi.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0) || 1;
  return phi.map((v) => v / big);
};

/** The eigenproblem in words and LaTeX; for two degrees of freedom, the characteristic quadratic in ω². */
function eigenSteps(M: Mat, K: Mat, omegas: readonly number[], modes: readonly number[][]) {
  const n = M.length;
  const steps: MechStep[] = [{ key: 'mdofEquation', math: `\\left(K - \\omega^2 M\\right)\\boldsymbol\\phi = 0` }];
  let characteristic: [number, number, number] | null = null;
  if (n === 2) {
    const a = M[0][0] * M[1][1] - M[0][1] ** 2;
    const b = -(K[0][0] * M[1][1] + K[1][1] * M[0][0] - 2 * K[0][1] * M[0][1]);
    const c = K[0][0] * K[1][1] - K[0][1] ** 2;
    characteristic = [a, b, c];
    const term = (v: number) => `${v < 0 ? '-' : '+'} ${tex(Math.abs(v))}`;
    steps.push({
      key: 'mdofCharacteristic',
      math: `\\det(K - \\omega^2 M) = ${tex(a)}\\,\\omega^4 ${term(b)}\\,\\omega^2 ${term(c)} = 0`,
    });
  } else steps.push({ key: 'mdofEigen', vars: { n: String(n) } });
  const frequencies = omegas.map((w, i) => `\\omega_{${i + 1}} = ${tex(w)}\\ \\mathrm{rad/s}`);
  steps.push({ key: 'mdofFrequencies', math: frequencies.join(',\\quad ') });
  const shapes = modes.map((phi, i) => `\\boldsymbol\\phi_{${i + 1}} = (${phi.map((v) => tex(v, 4)).join(',\\ ')})`);
  steps.push({ key: 'mdofNormalize', math: shapes.join(',\\quad ') });
  return { steps, characteristic };
}

/** One modal coordinate's free motion from q(0) = a, q'(0) = b, exact for any damping ratio. */
function modal(w: number, z: number, a: number, b: number, t: number): number {
  if (w === 0) return a + b * t;
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return Math.exp(-z * w * t) * (a * Math.cos(wd * t) + ((b + z * w * a) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return Math.exp(-w * t) * (a + (b + w * a) * t);
  const r1 = -w * (z - Math.sqrt(z * z - 1));
  const r2 = -w * (z + Math.sqrt(z * z - 1));
  const c2 = (b - r1 * a) / (r2 - r1);
  return (a - c2) * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
}

const massSeries = (n: number): Series[] =>
  Array.from({ length: n }, (_, i) => ({ name: 'mass', vars: { n: String(i + 1) }, points: [] }));

/**
 * The free response by modal superposition over the undamped modes. Each mode takes ζ = φᵀCφ / 2ω when there are
 * dampers (proportional damping, cross terms dropped), or the one ratio typed.
 */
function freeResponse(input: LumpedInput, omegas: readonly number[], modes: readonly number[][]): Plot {
  const { M, C, zeta, x0, v0, duration } = input;
  const zetas = hasDamper(C)
    ? omegas.map((w, k) => (w > 0 ? quadratic(C, modes[k], modes[k]) / (2 * w) : 0))
    : omegas.map(() => zeta);
  const a = modes.map((phi) => quadratic(M, phi, x0));
  const b = modes.map((phi) => quadratic(M, phi, v0));
  const first = omegas.find((w) => w > 0);
  const span = duration > 0 ? duration : first ? (16 * Math.PI) / first : 10;
  const series = massSeries(M.length);
  for (let s = 0; s <= 600; s += 1) {
    const t = (span * s) / 600;
    const q = omegas.map((w, k) => modal(w, zetas[k], a[k], b[k], t));
    series.forEach((line, i) => line.points.push([t, modes.reduce((sum, phi, k) => sum + phi[i] * q[k], 0)]));
  }
  return { x: 'time', y: 'displacement', series };
}

/** Steady amplitudes at the forcing frequency, and every mass's amplitude swept up to 1.5 times the top mode. */
function forcedResponse(
  { M, K, C, force, omega }: LumpedInput,
  top: number,
): Outcome<{ amplitudes: number[]; plot: Plot; step: MechStep }> {
  if (omega <= 0) return fail('positiveFrequency');
  const amplitudes = steadyAmplitudes(M, K, C, force, omega);
  if (!amplitudes) return fail('mdofResonance');
  const lhs = '\\left(K - \\omega^2 M + i\\omega C\\right)\\mathbf X = \\mathbf F';
  const X = amplitudes.map((v) => tex(v, 4)).join(',\\ ');
  const step: MechStep = { key: 'mdofForced', math: `${lhs}:\\ |\\mathbf X| = (${X})\\ \\mathrm{m}` };
  // Undamped peaks run to infinity, so the sweep is cut at 20 times the larger of the static and forced amplitudes.
  const still = steadyAmplitudes(M, K, C, force, 0) ?? [];
  const cap = 20 * Math.max(...amplitudes, ...still, Number.MIN_VALUE);
  const series = massSeries(M.length);
  for (let s = 1; s <= 600; s += 1) {
    const w = (top * s) / 600;
    const amp = steadyAmplitudes(M, K, C, force, w);
    series.forEach((line, i) => line.points.push([w, amp && amp[i] <= cap ? amp[i] : Number.NaN]));
  }
  return { ok: true, value: { amplitudes, step, plot: { x: 'forcingFrequency', y: 'amplitude', series } } };
}

const modeShapePlot = (shapes: readonly number[][]): Plot => ({
  x: 'massNumber',
  y: 'modeShape',
  series: shapes.slice(0, 6).map((shape, k) => ({
    name: 'mode',
    vars: { n: String(k + 1) },
    points: shape.map((v, i): [number, number] => [i + 1, v]),
  })),
});

export function solveLumped(input: LumpedInput): Outcome<LumpedResult> {
  const bad = invalidLumped(input);
  if (bad) return bad;
  const { M, K } = input;
  const n = M.length;
  const eig = generalizedEigen(K, M);
  if (!eig) return fail('mdofMassDefinite');
  const top = Math.max(1, Math.abs(eig.values[n - 1]));
  if (eig.values.some((l) => l < -1e-9 * top)) return fail('mdofUnstable');
  // Round-off leaves a rigid-body mode a hair off zero; call it zero.
  const omegas = eig.values.map((l) => (l <= 1e-12 * top ? 0 : Math.sqrt(l)));
  const freqs = omegas.map((w) => w / (2 * Math.PI));
  const modes = omegas.map((_, k) => eig.vectors.map((row) => row[k]));
  const shapes = modes.map(peakScaled);
  const { steps, characteristic } = eigenSteps(M, K, omegas, modes);
  if (hasDamper(input.C)) steps.push({ key: 'mdofModalDamping' });
  let amplitudes: number[] | null = null;
  let frequency: Plot | null = null;
  if (input.force.some((f) => f !== 0)) {
    const forced = forcedResponse(input, 1.5 * (omegas[n - 1] || 1));
    if (!forced.ok) return forced;
    ({ amplitudes, plot: frequency } = forced.value);
    steps.push(forced.value.step);
  }
  const response = freeResponse(input, omegas, modes);
  const modePlot = modeShapePlot(shapes);
  return {
    ok: true,
    value: { omegas, freqs, modes, shapes, characteristic, amplitudes, response, frequency, modePlot, steps },
  };
}

// ---------- Continuous members ----------

export type MemberKind = 'string' | 'bar' | 'shaft' | 'beam';
export type BeamEnds = 'pinned-pinned' | 'fixed-free' | 'fixed-fixed' | 'free-free' | 'fixed-pinned';
export type AxialEnds = 'fixed-fixed' | 'fixed-free' | 'free-free';

export interface ContinuousInput {
  kind: MemberKind;
  ends: BeamEnds | AxialEnds;
  length: number;
  /** String tension, N. */
  tension: number;
  /** String mass per length, kg/m. */
  massPerLength: number;
  /** Young's modulus (bar, beam) or shear modulus (shaft), Pa. */
  modulus: number;
  density: number;
  /** Beam second moment of area, m^4, and cross-section area, m^2. */
  I: number;
  A: number;
  modes: number;
}

export interface ContinuousResult {
  /** beta_n L for beams, or the factor in the frequency formula for the others. */
  roots: number[];
  omegas: number[];
  freqs: number[];
  modePlot: Plot;
  steps: MechStep[];
}

const BEAM_EQUATION: Record<BeamEnds, (x: number) => number> = {
  // Divided by cosh x so the roots stay well scaled.
  'pinned-pinned': (x) => Math.sin(x),
  'fixed-free': (x) => Math.cos(x) + 1 / Math.cosh(x),
  'fixed-fixed': (x) => Math.cos(x) - 1 / Math.cosh(x),
  'free-free': (x) => Math.cos(x) - 1 / Math.cosh(x),
  'fixed-pinned': (x) => Math.sin(x) - Math.cos(x) * Math.tanh(x),
};

const BEAM_LATEX: Record<BeamEnds, string> = {
  'pinned-pinned': '\\sin\\beta L = 0',
  'fixed-free': '\\cos\\beta L\\cosh\\beta L + 1 = 0',
  'fixed-fixed': '\\cos\\beta L\\cosh\\beta L - 1 = 0',
  'free-free': '\\cos\\beta L\\cosh\\beta L - 1 = 0',
  'fixed-pinned': '\\tan\\beta L = \\tanh\\beta L',
};

/** The first `count` positive roots of a beam's frequency equation. */
export function beamRoots(ends: BeamEnds, count: number): number[] {
  const roots = bracketScan(BEAM_EQUATION[ends], 0.5, Math.PI * (count + 1.5), 200 * (count + 2)).filter(
    (x) => x > 1e-6,
  );
  return roots.slice(0, count);
}

function beamShape(ends: BeamEnds, bl: number, x: number): number {
  const b = bl * x;
  const ch = Math.cosh(bl),
    c = Math.cos(bl),
    sh = Math.sinh(bl),
    s = Math.sin(bl);
  switch (ends) {
    case 'pinned-pinned':
      return Math.sin(b);
    case 'fixed-free': {
      const sigma = (ch + c) / (sh + s);
      return Math.cosh(b) - Math.cos(b) - sigma * (Math.sinh(b) - Math.sin(b));
    }
    case 'fixed-fixed':
    case 'fixed-pinned': {
      const sigma = (ch - c) / (sh - s);
      return Math.cosh(b) - Math.cos(b) - sigma * (Math.sinh(b) - Math.sin(b));
    }
    case 'free-free': {
      const sigma = (ch - c) / (sh - s);
      return Math.cosh(b) + Math.cos(b) - sigma * (Math.sinh(b) + Math.sin(b));
    }
  }
}

const AXIAL_ENDS: readonly string[] = ['fixed-fixed', 'fixed-free', 'free-free'];

function invalidMember(input: ContinuousInput): Fail | null {
  const { kind, ends, length: L, modes } = input;
  if (!finite(L, input.tension, input.massPerLength, input.modulus, input.density, input.I, input.A, modes))
    return fail('notNumber');
  if (L <= 0) return fail('positiveLength');
  if (!Number.isInteger(modes) || modes < 1 || modes > 8) return fail('modeCount');
  if (kind === 'beam') {
    if (input.modulus <= 0 || input.density <= 0 || input.I <= 0 || input.A <= 0) return fail('positiveProperties');
    return Object.hasOwn(BEAM_EQUATION, ends) ? null : fail('mdofEnds');
  }
  if (kind === 'string') {
    if (input.tension <= 0 || input.massPerLength <= 0) return fail('positiveProperties');
    return ends === 'fixed-fixed' ? null : fail('mdofEnds');
  }
  if (input.modulus <= 0 || input.density <= 0) return fail('positiveProperties');
  return AXIAL_ENDS.includes(ends) ? null : fail('mdofEnds');
}

interface Modes {
  roots: number[];
  omegas: number[];
  /** Mode k's shape at x / L. */
  shape: (k: number, x: number) => number;
  steps: MechStep[];
}

function beamModes(input: ContinuousInput): Modes {
  const ends = input.ends as BeamEnds;
  const roots = beamRoots(ends, input.modes);
  const scale = Math.sqrt((input.modulus * input.I) / (input.density * input.A * input.length ** 4));
  const omegas = roots.map((r) => r * r * scale);
  const formula = '\\omega_n = (\\beta_n L)^2\\sqrt{\\frac{EI}{\\rho A L^4}}';
  const first = `\\omega_1 = ${tex(omegas[0])}\\ \\mathrm{rad/s},\\ f_1 = ${tex(omegas[0] / (2 * Math.PI))}\\ \\mathrm{Hz}`;
  const steps: MechStep[] = [
    { key: 'mdofBeamEquation', math: BEAM_LATEX[ends] },
    { key: 'mdofBeamRoots', math: roots.map((r, i) => `\\beta_{${i + 1}}L = ${tex(r, 6)}`).join(',\\quad ') },
    { key: 'mdofBeamFrequency', math: `${formula} = (\\beta_n L)^2 \\times ${tex(scale)}:\\ ${first}` },
  ];
  if (ends === 'free-free') steps.push({ key: 'mdofRigidModes' });
  return { roots, omegas, shape: (k, x) => beamShape(ends, roots[k], x), steps };
}

const WAVE_SPEED = {
  string: ['mdofStringSpeed', '\\sqrt{T/\\mu}'],
  bar: ['mdofBarSpeed', '\\sqrt{E/\\rho}'],
  shaft: ['mdofShaftSpeed', '\\sqrt{G/\\rho}'],
} as const;

/** Strings, bars, and shafts: the wave equation, with half-wave or quarter-wave modes. */
function waveModes(input: ContinuousInput): Modes {
  const { kind, ends, length: L } = input;
  const c =
    kind === 'string' ? Math.sqrt(input.tension / input.massPerLength) : Math.sqrt(input.modulus / input.density);
  const quarter = ends === 'fixed-free';
  const roots = Array.from({ length: input.modes }, (_, i) =>
    quarter ? ((2 * i + 1) * Math.PI) / 2 : (i + 1) * Math.PI,
  );
  const omegas = roots.map((r) => (r * c) / L);
  const [key, speed] = WAVE_SPEED[kind as keyof typeof WAVE_SPEED];
  const first = `\\omega_1 = ${tex(omegas[0])}\\ \\mathrm{rad/s}`;
  const steps: MechStep[] = [
    { key, math: `c = ${speed} = ${tex(c)}\\ \\mathrm{m/s}` },
    quarter
      ? { key: 'mdofAxialQuarter', math: `\\omega_n = \\frac{(2n-1)\\pi c}{2L}:\\ ${first}` }
      : { key: 'mdofAxialHalf', math: `\\omega_n = \\frac{n\\pi c}{L}:\\ ${first}` },
  ];
  const shape = (k: number, x: number) => (ends === 'free-free' ? Math.cos(roots[k] * x) : Math.sin(roots[k] * x));
  return { roots, omegas, shape, steps };
}

export function solveContinuous(input: ContinuousInput): Outcome<ContinuousResult> {
  const bad = invalidMember(input);
  if (bad) return bad;
  const { roots, omegas, shape, steps } = input.kind === 'beam' ? beamModes(input) : waveModes(input);
  const L = input.length;
  const freqs = omegas.map((w) => w / (2 * Math.PI));
  const series: Series[] = omegas.slice(0, 6).map((_, k) => {
    const raw = Array.from({ length: 201 }, (_, i) => shape(k, i / 200));
    const big = raw.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0) || 1;
    return { name: 'mode', vars: { n: String(k + 1) }, points: raw.map((v, i) => [(i / 200) * L, v / big]) };
  });
  steps.push({ key: 'mdofFirstFrequency', vars: { f: fmt(freqs[0]) } });
  return { ok: true, value: { roots, omegas, freqs, modePlot: { x: 'position', y: 'modeShape', series }, steps } };
}
