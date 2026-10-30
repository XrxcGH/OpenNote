// Fatigue and machine elements, after Shigley's Mechanical Engineering Design (Budynas and Nisbett). The endurance
// limit is Se = ka kb kc kd ke kf Se′, with Se′ = Sut/2 up to 1400 MPa. The surface factor ka = a Sut^b uses the
// constants of Noll and Lipson (1946), with Sut in MPa. The size factor is kb = 1.24 d^−0.107 from 2.79 to 51 mm, and
// 1.51 d^−0.157 from 51 to 254 mm, with d in mm. Fluctuating stresses go through Goodman, Gerber, ASME elliptic,
// Soderberg, and Langer. The other elements are a shaft by DE-Goodman, a bolted joint, a rolling bearing's rating life,
// a helical compression spring, and Lewis bending of a gear tooth. Everything is in base SI.
import { fail, finite, notNegative, positive, q, step, type KitStep } from '../kit/types';
import { LEWIS_Y, RACK_Y } from './data';

const MPa = 1e6;

export const SURFACES = {
  ground: { a: 1.58, b: -0.085 },
  machined: { a: 4.51, b: -0.265 },
  hotRolled: { a: 57.7, b: -0.718 },
  forged: { a: 272, b: -0.995 },
} as const;
export type Surface = keyof typeof SURFACES;

export const LOADING = { bending: 1, axial: 0.85, torsion: 0.59 } as const;
export type Loading = keyof typeof LOADING;

/** The standard normal variate z for each reliability, so ke = 1 − 0.08 z. */
export const RELIABILITY = { r50: 0, r90: 1.288, r95: 1.645, r99: 2.326, r999: 3.091, r9999: 3.719 } as const;
export type Reliability = keyof typeof RELIABILITY;

export interface MarinInput {
  readonly Sut: number;
  readonly surface: Surface;
  readonly loading: Loading;
  /** The diameter for kb; NaN for none (kb = 1). */
  readonly d: number;
  readonly reliability: Reliability;
  readonly kd: number;
  readonly kf: number;
}

export function endurance(input: MarinInput) {
  const Sut = positive(input.Sut, 'Sut');
  const prime = Sut <= 1400 * MPa ? 0.5 * Sut : 700 * MPa;
  const { a, b } = SURFACES[input.surface];
  const ka = a * (Sut / MPa) ** b;
  let kb = 1;
  if (input.loading !== 'axial' && Number.isFinite(input.d)) {
    const mm = positive(input.d, 'd') * 1e3;
    if (mm < 2.79 || mm > 254) fail('sizeRange');
    kb = mm <= 51 ? 1.24 * mm ** -0.107 : 1.51 * mm ** -0.157;
  }
  const kc = LOADING[input.loading];
  const ke = 1 - 0.08 * RELIABILITY[input.reliability];
  const kd = positive(input.kd, 'kd');
  const kf = positive(input.kf, 'kf');
  const Se = ka * kb * kc * kd * ke * kf * prime;
  const steps = [
    step('machine.prime', "S_e' = [[p]]", { p: q(prime, 'stress') }),
    step('machine.ka', 'k_a = a\\,S_{ut}^{\\,b} = [[a]] \\times ([[S]])^{[[b]]} = [[ka]]', {
      a,
      b,
      S: (Sut / MPa).toPrecision(6),
      ka,
    }),
    step('machine.kb', 'k_b = [[kb]]', { kb }),
    step(
      'machine.factors',
      'k_c = [[kc]], \\quad k_d = [[kd]], \\quad k_e = 1 - 0.08 z_a = [[ke]], \\quad k_f = [[kf]]',
      {
        kc,
        kd,
        ke,
        kf,
      },
    ),
    step('machine.Se', "S_e = k_a k_b k_c k_d k_e k_f S_e' = [[Se]]", { Se: q(Se, 'stress') }),
  ];
  return { prime, ka, kb, kc, kd, ke, kf, Se, steps };
}

export interface Fluctuating {
  readonly sa: number;
  readonly sm: number;
  readonly Se: number;
  readonly Sut: number;
  readonly Sy?: number;
}

/** Factors of safety for alternating stress σa and mean stress σm, with the mean stress in tension or zero. */
export function fluctuating(input: Fluctuating) {
  const sa = notNegative(input.sa, 'σa');
  const sm = finite(input.sm, 'σm');
  const Se = positive(input.Se, 'Se');
  const Sut = positive(input.Sut, 'Sut');
  if (Se >= Sut) fail('seAboveSut');
  if (sa === 0 && sm === 0) fail('noStress');
  const Sy = input.Sy !== undefined && Number.isFinite(input.Sy) ? positive(input.Sy, 'Sy') : undefined;
  const steps: KitStep[] = [];
  if (sm < 0) {
    // With the mean stress in compression, fatigue is governed by the alternating stress alone.
    const n = sa > 0 ? Se / sa : Infinity;
    steps.push(step('machine.compressive', 'n_f = \\frac{S_e}{\\sigma_a} = [[n]]', { n }));
    return { goodman: n, gerber: n, steps, ...(Sy ? { langer: Sy / (sa - sm), elliptic: n, soderberg: n } : {}) };
  }
  const goodman = 1 / (sa / Se + sm / Sut);
  const gerber =
    sm === 0
      ? Se / sa
      : sa === 0
        ? Sut / sm
        : 0.5 * (Sut / sm) ** 2 * (sa / Se) * (-1 + Math.sqrt(1 + ((2 * sm * Se) / (Sut * sa)) ** 2));
  steps.push(
    step('machine.goodman', '\\frac{1}{n} = \\frac{\\sigma_a}{S_e} + \\frac{\\sigma_m}{S_{ut}}, \\quad n = [[n]]', {
      n: goodman,
    }),
    step(
      'machine.gerber',
      'n = \\frac12\\left(\\frac{S_{ut}}{\\sigma_m}\\right)^2\\frac{\\sigma_a}{S_e}\\left[-1 + \\sqrt{1 +' +
        ' \\left(\\frac{2\\sigma_m S_e}{S_{ut}\\sigma_a}\\right)^2}\\right] = [[n]]',
      { n: gerber },
    ),
  );
  if (!Sy) return { goodman, gerber, steps };
  const elliptic = 1 / Math.sqrt((sa / Se) ** 2 + (sm / Sy) ** 2);
  const soderberg = 1 / (sa / Se + sm / Sy);
  const langer = Sy / (sa + sm);
  steps.push(
    step('machine.elliptic', 'n = \\left[(\\sigma_a/S_e)^2 + (\\sigma_m/S_y)^2\\right]^{-1/2} = [[n]]', {
      n: elliptic,
    }),
    step('machine.soderberg', '\\frac{1}{n} = \\frac{\\sigma_a}{S_e} + \\frac{\\sigma_m}{S_y}, \\quad n = [[n]]', {
      n: soderberg,
    }),
    step('machine.langer', 'n_y = \\frac{S_y}{\\sigma_a + \\sigma_m} = [[n]]', { n: langer }),
  );
  return { goodman, gerber, elliptic, soderberg, langer, steps };
}

/** Cycles to failure on the S-N line from f Sut at 10³ cycles to Se at 10⁶, for a fully reversed stress. */
export function cycles(sigmaRev: number, Sut: number, Se: number, f: number) {
  positive(sigmaRev, 'σrev');
  if (!(f > 0 && f < 1)) fail('fractionF');
  const a = (f * Sut) ** 2 / Se;
  const b = -Math.log10((f * Sut) / Se) / 3;
  if (sigmaRev <= Se) return { a, b, N: Infinity };
  if (sigmaRev >= f * Sut) fail('lowCycle');
  return { a, b, N: (sigmaRev / a) ** (1 / b) };
}

/** Miner's rule: the damage of n cycles at each of several levels, each with its own life N. */
export function miner(blocks: readonly { readonly n: number; readonly N: number }[]) {
  if (blocks.length === 0) fail('noBlocks');
  const D = blocks.reduce((sum, block) => sum + notNegative(block.n, 'n') / positive(block.N, 'N'), 0);
  return {
    D,
    steps: [step('machine.miner', 'D = \\sum \\frac{n_i}{N_i} = [[D]]', { D })],
  };
}

export interface ShaftInput {
  readonly Ma: number;
  readonly Mm: number;
  readonly Ta: number;
  readonly Tm: number;
  readonly Kf: number;
  readonly Kfs: number;
  readonly Se: number;
  readonly Sut: number;
  readonly n: number;
}

/** The DE-Goodman shaft diameter (Shigley eq. 7-8). */
export function shaftDiameter(s: ShaftInput) {
  const [Se, Sut, n] = [positive(s.Se, 'Se'), positive(s.Sut, 'Sut'), positive(s.n, 'n')];
  const A = Math.sqrt(4 * (s.Kf * s.Ma) ** 2 + 3 * (s.Kfs * s.Ta) ** 2);
  const B = Math.sqrt(4 * (s.Kf * s.Mm) ** 2 + 3 * (s.Kfs * s.Tm) ** 2);
  if (A === 0 && B === 0) fail('noStress');
  const d = (((16 * n) / Math.PI) * (A / Se + B / Sut)) ** (1 / 3);
  return {
    d,
    A,
    B,
    steps: [
      step('machine.shaftAB', 'A = \\sqrt{4(K_f M_a)^2 + 3(K_{fs} T_a)^2} = [[A]], \\quad B = [[B]]', {
        A: q(A, 'smallMoment'),
        B: q(B, 'smallMoment'),
      }),
      step(
        'machine.shaft',
        'd = \\left[\\frac{16 n}{\\pi}\\left(\\frac{A}{S_e} + \\frac{B}{S_{ut}}\\right)\\right]^{1/3} = [[d]]',
        {
          d: q(d, 'length'),
        },
      ),
    ],
  };
}

export interface BoltInput {
  readonly At: number;
  readonly Sp: number;
  readonly fraction: number;
  readonly C: number;
  readonly P: number;
}

export function boltedJoint(b: BoltInput) {
  const At = positive(b.At, 'At');
  const Sp = positive(b.Sp, 'Sp');
  if (!(b.fraction > 0 && b.fraction <= 1)) fail('preloadFraction');
  if (!(b.C > 0 && b.C < 1)) fail('jointConstant');
  const P = notNegative(b.P, 'P');
  const Fi = b.fraction * At * Sp;
  const Fb = b.C * P + Fi;
  const Fm = (1 - b.C) * P - Fi;
  const separation = Fi / (1 - b.C);
  const steps = [
    step('machine.preload', 'F_i = [[f]] A_t S_p = [[Fi]]', { f: b.fraction, Fi: q(Fi, 'bigForce') }),
    step('machine.boltLoad', 'F_b = C P + F_i = [[Fb]], \\quad F_m = (1 - C) P - F_i = [[Fm]]', {
      Fb: q(Fb, 'bigForce'),
      Fm: q(Fm, 'bigForce'),
    }),
    step('machine.separation', 'P_0 = \\frac{F_i}{1 - C} = [[P0]]', { P0: q(separation, 'bigForce') }),
  ];
  return {
    Fi,
    Fb,
    Fm,
    sigmaB: Fb / At,
    separation,
    closed: Fm < 0,
    nLoad: P > 0 ? (Sp * At - Fi) / (b.C * P) : Infinity,
    nSeparation: P > 0 ? Fi / (P * (1 - b.C)) : Infinity,
    steps,
  };
}

/** The rating life L10 in revolutions, a = 3 for ball and 10/3 for roller bearings. */
export function bearingLife(C: number, P: number, kind: 'ball' | 'roller') {
  positive(C, 'C');
  positive(P, 'P');
  const a = kind === 'ball' ? 3 : 10 / 3;
  const L10 = (C / P) ** a * 1e6;
  return {
    a,
    L10,
    steps: [step('machine.bearing', 'L_{10} = \\left(\\frac{C}{P}\\right)^{a} 10^6 = [[L]]', { L: L10 })],
  };
}

export function spring(d: number, D: number, N: number, G: number, F?: number) {
  positive(d, 'd');
  positive(D, 'D');
  positive(N, 'N');
  positive(G, 'G');
  if (D <= d) fail('springIndex');
  const k = (G * d ** 4) / (8 * D ** 3 * N);
  const C = D / d;
  const KB = (4 * C + 2) / (4 * C - 3);
  const steps = [
    step('machine.springRate', 'k = \\frac{G d^4}{8 D^3 N} = [[k]]', { k: q(k, 'stiffness') }),
    step('machine.springIndex', 'C = D/d = [[C]], \\quad K_B = \\frac{4C + 2}{4C - 3} = [[KB]]', { C, KB }),
  ];
  if (F === undefined || !Number.isFinite(F)) return { k, C, KB, steps };
  const tau = (KB * 8 * F * D) / (Math.PI * d ** 3);
  steps.push(
    step('machine.springStress', '\\tau = K_B\\frac{8 F D}{\\pi d^3} = [[t]], \\quad y = F/k = [[y]]', {
      t: q(tau, 'stress'),
      y: q(F / k, 'deflection'),
    }),
  );
  return { k, C, KB, tau, y: F / k, steps };
}

export const FINISH = {
  none: null,
  cast: [3.05, false],
  cut: [6.1, false],
  hobbed: [3.56, true],
  shaved: [5.56, true],
} as const;
export type Finish = keyof typeof FINISH;

/** Lewis bending stress σ = Kv Wt/(F m Y), with Barth's dynamic factor from the pitch-line velocity (in m/s). */
export function lewis(Wt: number, F: number, m: number, Y: number, finish: Finish, V?: number) {
  positive(Wt, 'Wt');
  positive(F, 'F');
  positive(m, 'm');
  positive(Y, 'Y');
  const rule = FINISH[finish];
  let Kv = 1;
  if (rule) {
    const v = notNegative(V ?? NaN, 'V');
    const [c, root] = rule;
    Kv = root ? (c + Math.sqrt(v)) / c : (c + v) / c;
  }
  const sigma = (Kv * Wt) / (F * m * Y);
  return {
    Kv,
    sigma,
    steps: [
      step('machine.kv', 'K_v = [[Kv]]', { Kv }),
      step('machine.lewis', '\\sigma = \\frac{K_v W_t}{F m Y} = [[s]]', { s: q(sigma, 'stress') }),
    ],
  };
}

/**
 * The Lewis form factor for a number of teeth, read from the 20° full-depth table with straight-line interpolation
 * between its rows, and in 1/N between 400 teeth and a rack.
 */
export function lewisY(teeth: number): { Y: number; step: KitStep } {
  if (!Number.isFinite(teeth) || teeth < LEWIS_Y[0][0]) fail('fewTeeth', String(LEWIS_Y[0][0]));
  let Y: number;
  const last = LEWIS_Y[LEWIS_Y.length - 1];
  if (teeth >= last[0]) Y = RACK_Y + (last[1] - RACK_Y) * (last[0] / teeth);
  else {
    const i = LEWIS_Y.findIndex(([n]) => n > teeth);
    const [[n0, y0], [n1, y1]] = [LEWIS_Y[i - 1], LEWIS_Y[i]];
    Y = y0 + ((y1 - y0) * (teeth - n0)) / (n1 - n0);
  }
  return { Y, step: step('machine.lewisY', 'Y(N_t = [[N]]) = [[Y]]', { N: teeth, Y }) };
}

export interface BoltStiffnessInput {
  /** Nominal diameter. */
  readonly d: number;
  readonly At: number;
  /** Grip: the thickness of the members clamped. */
  readonly l: number;
  /** The threaded length within the grip; the rest of the grip is the unthreaded shank. */
  readonly lt: number;
  readonly E: number;
  readonly Em: number;
}

/**
 * The bolt's stiffness as a shank and a threaded part in series, kb = Ad At E/(Ad lt + At ld), and the members' by
 * two 30° frusta from a washer face 1.5 d across, km = 0.5774 π Em d / (2 ln(5 (0.5774 l + 0.5 d)/(0.5774 l + 2.5 d))),
 * for members of one material. The joint constant is C = kb/(kb + km).
 */
export function boltStiffness(b: BoltStiffnessInput) {
  const d = positive(b.d, 'd');
  const At = positive(b.At, 'At');
  const l = positive(b.l, 'l');
  const lt = notNegative(b.lt, 'lt');
  if (lt > l) fail('threadLength');
  const E = positive(b.E, 'E');
  const Em = positive(b.Em, 'Em');
  const Ad = (Math.PI * d * d) / 4;
  const ld = l - lt;
  const kb = (Ad * At * E) / (Ad * lt + At * ld);
  const km = (0.5774 * Math.PI * Em * d) / (2 * Math.log((5 * (0.5774 * l + 0.5 * d)) / (0.5774 * l + 2.5 * d)));
  const C = kb / (kb + km);
  const steps = [
    step('machine.boltStiffness', 'k_b = \\frac{A_d A_t E}{A_d l_t + A_t l_d} = [[kb]]', {
      kb: q(kb, 'stiffness'),
    }),
    step(
      'machine.memberStiffness',
      'k_m = \\frac{0.5774 \\pi E_m d}{2 \\ln\\left(5 \\frac{0.5774 l + 0.5 d}{0.5774 l + 2.5 d}\\right)} = [[km]]',
      { km: q(km, 'stiffness') },
    ),
    step('machine.jointConstant', 'C = \\frac{k_b}{k_b + k_m} = [[C]]', { C }),
  ];
  return { Ad, kb, km, C, steps };
}
