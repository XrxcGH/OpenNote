// Exact laminar viscous flow solutions: Couette-Poiseuille, pipe and annulus flow, power-law, Bingham and Casson fluids, Womersley pulsatile flow, Murray's law.
import { CalcError, fmt, need, nonNegative, positive, type Step } from '../numeric';

// --- complex helpers (tiny, local) -------------------------------------------------------------------------------

export interface Cx {
  re: number;
  im: number;
}
const cx = (re: number, im = 0): Cx => ({ re, im });
const add = (a: Cx, b: Cx): Cx => cx(a.re + b.re, a.im + b.im);
const sub = (a: Cx, b: Cx): Cx => cx(a.re - b.re, a.im - b.im);
const mul = (a: Cx, b: Cx): Cx => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Cx, s: number): Cx => cx(a.re * s, a.im * s);
const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
export const cabs = (a: Cx): number => Math.hypot(a.re, a.im);
const csqrt = (a: Cx): Cx => {
  const m = cabs(a);
  const re = Math.sqrt((m + a.re) / 2);
  const im = Math.sqrt(Math.max(0, (m - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
};
const ccos = (a: Cx): Cx => cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
const csin = (a: Cx): Cx => cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));

/** Bessel J0 and J1 of complex argument: power series up to |z| = 16, Hankel asymptotic expansion above. */
export function besselJc(order: 0 | 1, z: Cx): Cx {
  if (cabs(z) < 16) {
    const q = scale(mul(z, z), -0.25);
    let term = order === 0 ? cx(1) : scale(z, 0.5);
    let sum = term;
    for (let k = 1; k < 200; k++) {
      term = scale(mul(term, q), 1 / (k * (k + order)));
      sum = add(sum, term);
      if (cabs(term) < 1e-17 * cabs(sum)) break;
    }
    return sum;
  }
  const mu = 4 * order * order;
  let P = cx(1);
  let Q = cx(0);
  let t = cx(1);
  const eight = scale(z, 8);
  let prev = Infinity;
  for (let k = 1; k < 40; k++) {
    t = scale(div(t, eight), (mu - (2 * k - 1) ** 2) / k);
    const m = cabs(t);
    if (m > prev) break;
    prev = m;
    if (k % 2 === 1) Q = add(Q, scale(t, k % 4 === 1 ? 1 : -1));
    else P = add(P, scale(t, k % 4 === 2 ? -1 : 1));
  }
  const chi = sub(z, cx((order === 0 ? 0.25 : 0.75) * Math.PI));
  const pref = csqrt(div(cx(2 / Math.PI), z));
  return mul(pref, sub(mul(P, ccos(chi)), mul(Q, csin(chi))));
}

// --- Newtonian laminar flow --------------------------------------------------------------------------------------

export interface CouetteInput {
  /** Gap between the plates (m). */
  gap: number;
  /** Speed of the upper plate (m/s), the lower plate is at rest. */
  wallSpeed: number;
  /** Pressure gradient dp/dx (Pa/m); negative drives flow in +x. */
  dpdx: number;
  viscosity: number;
  points?: number;
}

export interface CouetteResult {
  y: number[];
  u: number[];
  /** Flow per unit width (m2/s). */
  flowPerWidth: number;
  lowerWallShear: number;
  upperWallShear: number;
  steps: Step[];
}

/** Plane Couette-Poiseuille flow between parallel plates: u = U y/h - (dp/dx)/(2 mu) y (h - y). */
export function couette(inp: CouetteInput): CouetteResult {
  positive(inp.gap, 'The gap');
  positive(inp.viscosity, 'The viscosity');
  need(
    Number.isFinite(inp.wallSpeed) && Number.isFinite(inp.dpdx),
    'number',
    'The wall speed and the pressure gradient must be numbers.',
  );
  const n = inp.points ?? 41;
  const { gap: h, wallSpeed: U, dpdx: G, viscosity: mu } = inp;
  const u = (y: number) => (U * y) / h - (G / (2 * mu)) * y * (h - y);
  const ys = Array.from({ length: n }, (_, i) => (h * i) / (n - 1));
  const q = (U * h) / 2 - (G * h ** 3) / (12 * mu);
  const tauLow = mu * (U / h - (G * h) / (2 * mu));
  const tauUp = mu * (U / h + (G * h) / (2 * mu));
  return {
    y: ys,
    u: ys.map(u),
    flowPerWidth: q,
    lowerWallShear: tauLow,
    upperWallShear: tauUp,
    steps: [
      { key: 'fhViscCouette', math: String.raw`u(y) = \frac{U y}{h} - \frac{1}{2\mu}\frac{dp}{dx}\,y(h-y)` },
      {
        key: 'fhViscCouetteQ',
        vars: { q: fmt(q) },
        math: `q = \\frac{U h}{2} - \\frac{h^3}{12\\mu}\\frac{dp}{dx} = ${fmt(q)}\\ \\mathrm{m^2/s}`,
      },
    ],
  };
}

export interface PipeInput {
  radius: number;
  length: number;
  /** Pressure drop over the length (Pa), positive in the flow direction. */
  dp: number;
  viscosity: number;
  points?: number;
}

export interface PipeFlowResult {
  q: number;
  meanSpeed: number;
  maxSpeed: number;
  wallShear: number;
  r: number[];
  u: number[];
  /** Wall shear rate (1/s). */
  wallShearRate: number;
  steps: Step[];
}

function checkPipe(p: PipeInput) {
  positive(p.radius, 'The radius');
  positive(p.length, 'The length');
  positive(p.viscosity, 'The viscosity');
  need(
    Number.isFinite(p.dp) && p.dp >= 0,
    'dp',
    'The pressure drop must be zero or more, measured in the direction of flow.',
  );
}

/** Hagen-Poiseuille flow in a circular pipe. */
export function poiseuille(inp: PipeInput): PipeFlowResult {
  checkPipe(inp);
  const { radius: R, length: L, dp, viscosity: mu } = inp;
  const n = inp.points ?? 41;
  const q = (Math.PI * R ** 4 * dp) / (8 * mu * L);
  const r = Array.from({ length: n }, (_, i) => (R * i) / (n - 1));
  const u = r.map((x) => (dp / (4 * mu * L)) * (R * R - x * x));
  const tw = (dp * R) / (2 * L);
  return {
    q,
    meanSpeed: q / (Math.PI * R * R),
    maxSpeed: (dp * R * R) / (4 * mu * L),
    wallShear: tw,
    wallShearRate: tw / mu,
    r,
    u,
    steps: [
      {
        key: 'fhViscPoiseuille',
        vars: { Q: fmt(q) },
        math: `Q = \\frac{\\pi R^4\\,\\Delta p}{8\\mu L} = ${fmt(q)}\\ \\mathrm{m^3/s}`,
      },
      {
        key: 'fhViscWallShear',
        vars: { t: fmt(tw) },
        math: `\\tau_w = \\frac{\\Delta p\\,R}{2L} = ${fmt(tw)}\\ \\mathrm{Pa}`,
      },
    ],
  };
}

export interface AnnulusInput {
  inner: number;
  outer: number;
  length: number;
  dp: number;
  viscosity: number;
}

/** Laminar flow in the annulus between two concentric cylinders (radii). */
export function annulus(inp: AnnulusInput): { q: number; velocityMax: number; rMax: number; steps: Step[] } {
  positive(inp.inner, 'The inner radius');
  positive(inp.outer, 'The outer radius');
  need(inp.outer > inp.inner, 'radii', 'The outer radius must be larger than the inner radius.');
  positive(inp.length, 'The length');
  positive(inp.viscosity, 'The viscosity');
  need(Number.isFinite(inp.dp) && inp.dp >= 0, 'dp', 'The pressure drop must be zero or more.');
  const { inner: a, outer: b, length: L, dp, viscosity: mu } = inp;
  const q = ((Math.PI * dp) / (8 * mu * L)) * (b ** 4 - a ** 4 - (b * b - a * a) ** 2 / Math.log(b / a));
  // maximum of u(r) = (dp/(4 mu L)) (b^2 - r^2 + (b^2 - a^2) ln(r/b)/ln(b/a)) at r^2 = (b^2 - a^2)/(2 ln(b/a))
  const rMax = Math.sqrt((b * b - a * a) / (2 * Math.log(b / a)));
  const u = (r: number) =>
    (dp / (4 * mu * L)) * (b * b - r * r + ((b * b - a * a) * Math.log(r / b)) / Math.log(b / a));
  return {
    q,
    velocityMax: u(rMax),
    rMax,
    steps: [
      {
        key: 'fhViscAnnulus',
        vars: { Q: fmt(q) },
        math: `Q = \\frac{\\pi\\Delta p}{8\\mu L}\\left[b^4 - a^4 - \\frac{(b^2-a^2)^2}{\\ln(b/a)}\\right] = ${fmt(q)}\\ \\mathrm{m^3/s}`,
      },
    ],
  };
}

// --- non-Newtonian pipe flow -------------------------------------------------------------------------------------

export interface PowerLawInput extends Omit<PipeInput, 'viscosity'> {
  /** Consistency index K (Pa s^n). */
  k: number;
  /** Flow behaviour index n. */
  n: number;
}

export function powerLaw(inp: PowerLawInput): PipeFlowResult & { apparentViscosityAtWall: number } {
  positive(inp.radius, 'The radius');
  positive(inp.length, 'The length');
  positive(inp.k, 'The consistency index K');
  positive(inp.n, 'The flow behaviour index n');
  need(Number.isFinite(inp.dp) && inp.dp >= 0, 'dp', 'The pressure drop must be zero or more.');
  const { radius: R, length: L, dp, k: K, n } = inp;
  const pts = inp.points ?? 41;
  const grad = dp / (2 * K * L); // (dp/dz) / (2K)
  const q = ((Math.PI * n * R ** 3) / (3 * n + 1)) * (R * grad) ** (1 / n);
  const e = (n + 1) / n;
  const r = Array.from({ length: pts }, (_, i) => (R * i) / (pts - 1));
  const u = r.map((x) => (n / (n + 1)) * grad ** (1 / n) * (R ** e - x ** e));
  const tw = (dp * R) / (2 * L);
  const gammaW = (tw / K) ** (1 / n);
  return {
    q,
    meanSpeed: q / (Math.PI * R * R),
    maxSpeed: u[0]!,
    wallShear: tw,
    wallShearRate: gammaW,
    apparentViscosityAtWall: tw / gammaW,
    r,
    u,
    steps: [
      {
        key: 'fhViscPowerLaw',
        vars: { Q: fmt(q) },
        math: `Q = \\frac{\\pi n R^3}{3n+1}\\left(\\frac{R\\,\\Delta p}{2KL}\\right)^{1/n} = ${fmt(q)}\\ \\mathrm{m^3/s}`,
      },
    ],
  };
}

export interface YieldInput extends PipeInput {
  /** Yield stress (Pa). */
  yieldStress: number;
}

export interface YieldResult extends PipeFlowResult {
  /** Radius of the unsheared plug (m); equals the pipe radius when nothing flows. */
  plugRadius: number;
  flows: boolean;
}

function yieldProfile(
  inp: YieldInput,
  q: number,
  plug: number,
  uPlug: number,
  uOf: (r: number) => number,
): YieldResult {
  const n = inp.points ?? 41;
  const r = Array.from({ length: n }, (_, i) => (inp.radius * i) / (n - 1));
  const tw = (inp.dp * inp.radius) / (2 * inp.length);
  return {
    q,
    meanSpeed: q / (Math.PI * inp.radius ** 2),
    maxSpeed: uPlug,
    wallShear: tw,
    wallShearRate: 0,
    r,
    u: r.map((x) => (x <= plug ? uPlug : uOf(x))),
    plugRadius: plug,
    flows: q > 0,
    steps: [],
  };
}

/** Bingham plastic in a pipe (Buckingham-Reiner): no flow until the wall shear stress exceeds the yield stress. */
export function bingham(inp: YieldInput): YieldResult {
  checkPipe(inp);
  nonNegative(inp.yieldStress, 'The yield stress');
  const tw = (inp.dp * inp.radius) / (2 * inp.length);
  if (tw <= inp.yieldStress)
    return {
      ...yieldProfile(inp, 0, inp.radius, 0, () => 0),
      steps: [{ key: 'fhViscNoFlow', vars: { tw: fmt(tw), ty: fmt(inp.yieldStress) } }],
    };
  const phi = inp.yieldStress / tw;
  const mu = inp.viscosity;
  const q = ((Math.PI * inp.radius ** 4 * inp.dp) / (8 * mu * inp.length)) * (1 - (4 / 3) * phi + phi ** 4 / 3);
  const plug = phi * inp.radius;
  const gradient = inp.dp / (2 * inp.length); // wall shear / R
  const uOf = (x: number) =>
    (gradient / (2 * mu)) * (inp.radius ** 2 - x * x) - (inp.yieldStress / mu) * (inp.radius - x);
  const res = yieldProfile(inp, q, plug, uOf(plug), uOf);
  res.steps = [
    {
      key: 'fhViscBingham',
      vars: { Q: fmt(q), rp: fmt(plug) },
      math: `Q = \\frac{\\pi R^4\\Delta p}{8\\mu L}\\left(1 - \\frac43\\varphi + \\frac{\\varphi^4}{3}\\right),\\ \\varphi = \\frac{\\tau_y}{\\tau_w} = ${fmt(phi)}`,
    },
  ];
  return res;
}

/** Casson fluid in a pipe: sqrt(tau) = sqrt(tau_y) + sqrt(mu_c shear rate), the usual model for blood. */
export function casson(inp: YieldInput): YieldResult {
  checkPipe(inp);
  nonNegative(inp.yieldStress, 'The yield stress');
  const tw = (inp.dp * inp.radius) / (2 * inp.length);
  if (tw <= inp.yieldStress)
    return {
      ...yieldProfile(inp, 0, inp.radius, 0, () => 0),
      steps: [{ key: 'fhViscNoFlow', vars: { tw: fmt(tw), ty: fmt(inp.yieldStress) } }],
    };
  const phi = inp.yieldStress / tw;
  const mu = inp.viscosity;
  const q =
    ((Math.PI * inp.radius ** 3 * tw) / (4 * mu)) * (1 - (16 / 7) * Math.sqrt(phi) + (4 / 3) * phi - phi ** 4 / 21);
  const plug = phi * inp.radius;
  // velocity from integrating the shear rate inward from the wall: u(r) = int_r^R gamma(tau(s)) ds with tau = tw s / R
  const gamma = (tau: number) => (tau <= inp.yieldStress ? 0 : (Math.sqrt(tau) - Math.sqrt(inp.yieldStress)) ** 2 / mu);
  const uOf = (x: number): number => {
    const m = 400;
    const h = (inp.radius - x) / m;
    let s = 0;
    for (let i = 0; i < m; i++) {
      const a = x + i * h;
      s +=
        (h *
          (gamma((tw * a) / inp.radius) +
            4 * gamma((tw * (a + h / 2)) / inp.radius) +
            gamma((tw * (a + h)) / inp.radius))) /
        6;
    }
    return s;
  };
  const res = yieldProfile(inp, q, plug, uOf(plug), uOf);
  res.steps = [
    {
      key: 'fhViscCasson',
      vars: { Q: fmt(q), rp: fmt(plug) },
      math: `Q = \\frac{\\pi R^3\\tau_w}{4\\mu_c}\\left[1 - \\frac{16}{7}\\sqrt\\varphi + \\frac43\\varphi - \\frac{\\varphi^4}{21}\\right],\\ \\varphi = ${fmt(phi)}`,
    },
  ];
  return res;
}

// --- pulsatile flow -----------------------------------------------------------------------------------------------

export interface WomersleyInput {
  radius: number;
  /** Frequency of the oscillation (Hz). */
  frequency: number;
  /** Kinematic viscosity (m2/s). */
  nu: number;
  density: number;
  /** Amplitude of the oscillating pressure gradient, -dp/dx = A cos(omega t) (Pa/m). */
  amplitude: number;
  /** Phases (radians) at which to report the profile. */
  phases?: number[];
  points?: number;
}

export interface WomersleyResult {
  alpha: number;
  omega: number;
  /** Phase-lag of the centerline velocity behind the pressure gradient (radians). */
  centerlineLag: number;
  centerlineAmplitude: number;
  flowAmplitude: number;
  flowPhase: number;
  wallShearAmplitude: number;
  wallShearPhase: number;
  r: number[];
  profiles: { phase: number; u: number[] }[];
  quasiSteadyCenterline: number;
  steps: Step[];
}

const I32 = cx(Math.cos((3 * Math.PI) / 4), Math.sin((3 * Math.PI) / 4)); // i^(3/2)

/** Womersley's solution for oscillating flow in a rigid circular tube. */
export function womersley(inp: WomersleyInput): WomersleyResult {
  positive(inp.radius, 'The radius');
  positive(inp.frequency, 'The frequency');
  positive(inp.nu, 'The kinematic viscosity');
  positive(inp.density, 'The density');
  need(Number.isFinite(inp.amplitude), 'amplitude', 'The pressure gradient amplitude must be a number.');
  const R = inp.radius;
  const omega = 2 * Math.PI * inp.frequency;
  const alpha = R * Math.sqrt(omega / inp.nu);
  if (alpha > 60)
    throw new CalcError(
      'range',
      'The Womersley number is above 60, where the profile is a thin Stokes layer; this tool stops at 60.',
    );
  const z = scale(I32, alpha);
  const j0z = besselJc(0, z);
  const pref = div(cx(inp.amplitude), cx(0, inp.density * omega)); // A / (i rho omega)
  const uHat = (frac: number): Cx => mul(pref, sub(cx(1), div(besselJc(0, scale(z, frac)), j0z)));
  const phases = inp.phases ?? [
    0,
    Math.PI / 4,
    Math.PI / 2,
    (3 * Math.PI) / 4,
    Math.PI,
    (5 * Math.PI) / 4,
    (3 * Math.PI) / 2,
    (7 * Math.PI) / 4,
  ];
  const n = inp.points ?? 41;
  const fr = Array.from({ length: n }, (_, i) => i / (n - 1));
  const uh = fr.map(uHat);
  const profiles = phases.map((ph) => ({
    phase: ph,
    u: uh.map((c) => c.re * Math.cos(ph) - c.im * Math.sin(ph)),
  }));
  const center = uh[0]!;
  const qHat = mul(scale(pref, Math.PI * R * R), sub(cx(1), scale(div(besselJc(1, z), mul(z, j0z)), 2)));
  const tauHat = scale(mul(pref, mul(div(besselJc(1, z), j0z), scale(z, 1 / R))), -inp.density * inp.nu);
  const quasi = (inp.amplitude * R * R) / (4 * inp.density * inp.nu);
  return {
    alpha,
    omega,
    centerlineAmplitude: cabs(center),
    centerlineLag: -Math.atan2(center.im, center.re),
    flowAmplitude: cabs(qHat),
    flowPhase: Math.atan2(qHat.im, qHat.re),
    wallShearAmplitude: cabs(tauHat),
    wallShearPhase: Math.atan2(tauHat.im, tauHat.re),
    r: fr.map((f) => f * R),
    profiles,
    quasiSteadyCenterline: quasi,
    steps: [
      {
        key: 'fhViscWomersleyNumber',
        vars: { a: fmt(alpha) },
        math: `\\alpha = R\\sqrt{\\omega/\\nu} = ${fmt(alpha)}`,
      },
      {
        key: 'fhViscWomersley',
        math: String.raw`u(r,t) = \mathrm{Re}\left\{\frac{A}{i\rho\omega}\left[1 - \frac{J_0(i^{3/2}\alpha r/R)}{J_0(i^{3/2}\alpha)}\right]e^{i\omega t}\right\}`,
      },
    ],
  };
}

// --- Murray's law ------------------------------------------------------------------------------------------------

export interface MurrayResult {
  childRadius: number;
  ratio: number;
  steps: Step[];
}

/** Murray's law: r_parent^3 = sum of r_child^3 for the lowest total vessel power. */
export function murraySymmetric(parentRadius: number, children = 2): MurrayResult {
  positive(parentRadius, 'The parent radius');
  need(Number.isInteger(children) && children >= 2, 'children', 'A branching has at least two children.');
  const ratio = children ** (-1 / 3);
  return {
    childRadius: parentRadius * ratio,
    ratio,
    steps: [
      {
        key: 'fhViscMurray',
        vars: { r: fmt(parentRadius * ratio), k: fmt(ratio, 5) },
        math: `r_c = r_p\\,N^{-1/3} = ${fmt(parentRadius * ratio)}\\ \\mathrm{m}`,
      },
    ],
  };
}

/** The second daughter of an asymmetric branching, given the parent and the first daughter. */
export function murrayAsymmetric(parentRadius: number, firstChild: number): number {
  positive(parentRadius, 'The parent radius');
  positive(firstChild, 'The first daughter radius');
  need(firstChild < parentRadius, 'radius', 'A daughter vessel must be narrower than its parent.');
  return (parentRadius ** 3 - firstChild ** 3) ** (1 / 3);
}
