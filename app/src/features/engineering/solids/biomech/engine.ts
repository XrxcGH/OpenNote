// Biomechanics of tissues and joints. The viscoelastic models are springs and dashpots: Maxwell (in series),
// Kelvin–Voigt (in parallel), and the standard linear solid (a spring E∞ beside a Maxwell arm E1, η). Each has a
// creep compliance J(t) = a + b t + c(1 − e^(−t/τc)) and a relaxation modulus G(t) = p + r e^(−t/τr). So a step,
// or a ramp to a hold by Boltzmann superposition, has a closed form. So do the complex modulus and the energy lost
// in a cycle. The joint is a lever in a plane: a muscle and weights about a pin, solved by statics. Everything is
// in base SI.
import { fail, finite, notNegative, positive, q, step, type KitStep } from '../kit/types';

export type Model = 'maxwell' | 'kelvin' | 'sls';

export interface ModelInput {
  readonly model: Model;
  /** The spring of Maxwell and Kelvin–Voigt, or the Maxwell arm's spring of the standard linear solid. */
  readonly E: number;
  readonly eta: number;
  /** The standard linear solid's lone spring, its modulus at long times. */
  readonly Einf?: number;
}

export function constants(input: ModelInput) {
  const E = positive(input.E, 'E');
  const eta = positive(input.eta, 'η');
  if (input.model === 'maxwell') {
    return { creep: { a: 1 / E, b: 1 / eta, c: 0, tau: 1 }, relax: { p: 0, r: E, tau: eta / E }, impulse: 0 };
  }
  if (input.model === 'kelvin') {
    return { creep: { a: 0, b: 0, c: 1 / E, tau: eta / E }, relax: { p: E, r: 0, tau: 1 }, impulse: eta };
  }
  const Einf = positive(input.Einf ?? NaN, 'E∞');
  const tauC = (eta * (Einf + E)) / (Einf * E);
  return {
    creep: { a: 1 / (Einf + E), b: 0, c: E / (Einf * (Einf + E)), tau: tauC },
    relax: { p: Einf, r: E, tau: eta / E },
    impulse: 0,
  };
}

type Creep = ReturnType<typeof constants>['creep'];
type Relax = ReturnType<typeof constants>['relax'];

const J = (k: Creep, t: number) => k.a + k.b * t + k.c * (1 - Math.exp(-t / k.tau));
/** ∫₀ᵘ J dt. */
const Jint = (k: Creep, u: number) => k.a * u + (k.b * u * u) / 2 + k.c * (u - k.tau * (1 - Math.exp(-u / k.tau)));
const G = (k: Relax, t: number) => k.p + k.r * Math.exp(-t / k.tau);
const Gint = (k: Relax, u: number) => k.p * u + k.r * k.tau * (1 - Math.exp(-u / k.tau));

export interface HistoryInput extends ModelInput {
  /** The stress held in creep, or the strain held in relaxation. */
  readonly level: number;
  /** 0 for a step; else the time the load takes to ramp up. */
  readonly ramp: number;
  readonly t: number;
}

/** Strain under a stress stepped or ramped to `level` and then held. */
export function creep(input: HistoryInput) {
  const k = constants(input).creep;
  const s0 = finite(input.level, 'σ0');
  const tr = notNegative(input.ramp, 't_r');
  notNegative(input.t, 't');
  const at = (t: number) => {
    if (t < 0) return 0;
    if (tr === 0) return s0 * J(k, t);
    return (s0 / tr) * (Jint(k, t) - (t > tr ? Jint(k, t - tr) : 0));
  };
  return { at, value: at(input.t), creep: k, steps: creepSteps(input, k, at(input.t)) };
}

function creepSteps(input: HistoryInput, k: Creep, value: number): KitStep[] {
  const law = {
    maxwell: '\\varepsilon(t) = \\sigma_0\\left(\\frac{1}{E} + \\frac{t}{\\eta}\\right)',
    kelvin: '\\varepsilon(t) = \\frac{\\sigma_0}{E}\\left(1 - e^{-t E/\\eta}\\right)',
    sls:
      '\\varepsilon(t) = \\sigma_0\\left[\\frac{1}{E_\\infty + E_1} + \\frac{E_1}{E_\\infty(E_\\infty +' +
      ' E_1)}\\left(1 - e^{-t/\\tau_c}\\right)\\right]',
  }[input.model];
  const steps = [step(`biomech.${input.model}Creep` as const, law, { tau: q(k.tau, 'time') })];
  if (input.ramp > 0) {
    steps.push(
      step('biomech.rampCreep', '\\varepsilon(t) = \\frac{\\sigma_0}{t_r}\\int_{\\max(0, t - t_r)}^{t} J(s)\\,ds'),
    );
  }
  steps.push(step('biomech.creepAt', '\\varepsilon([[t]]) = [[e]]', { t: q(input.t, 'time'), e: value }));
  return steps;
}

/** Stress under a strain stepped or ramped to `level` and then held. */
export function relaxation(input: HistoryInput) {
  const c = constants(input);
  const e0 = finite(input.level, 'ε0');
  const tr = notNegative(input.ramp, 't_r');
  notNegative(input.t, 't');
  if (input.model === 'kelvin' && tr === 0) {
    // A dashpot cannot take a step in strain: the stress is an impulse at t = 0, then E ε0.
    const at = (t: number) => (t > 0 ? c.relax.p * e0 : NaN);
    return { at, value: at(input.t), steps: relaxSteps(input, c.relax, at(input.t)), impulse: true };
  }
  const at = (t: number) => {
    if (t < 0) return 0;
    if (tr === 0) return e0 * G(c.relax, t);
    const viscous = t < tr ? (c.impulse * e0) / tr : 0;
    return (e0 / tr) * (Gint(c.relax, t) - (t > tr ? Gint(c.relax, t - tr) : 0)) + viscous;
  };
  return { at, value: at(input.t), steps: relaxSteps(input, c.relax, at(input.t)), impulse: false };
}

function relaxSteps(input: HistoryInput, k: Relax, value: number): KitStep[] {
  const law = {
    maxwell: '\\sigma(t) = E\\varepsilon_0\\,e^{-t E/\\eta}',
    kelvin: '\\sigma(t) = E\\varepsilon(t) + \\eta\\,\\dot\\varepsilon(t)',
    sls: '\\sigma(t) = \\varepsilon_0\\left(E_\\infty + E_1 e^{-t/\\tau}\\right), \\quad \\tau = \\eta/E_1',
  }[input.model];
  const steps = [step(`biomech.${input.model}Relax` as const, law, { tau: q(k.tau, 'time') })];
  if (input.ramp > 0) {
    steps.push(
      step('biomech.rampRelax', '\\sigma(t) = \\frac{\\varepsilon_0}{t_r}\\int_{\\max(0, t - t_r)}^{t} G(s)\\,ds'),
    );
  }
  steps.push(step('biomech.relaxAt', '\\sigma([[t]]) = [[s]]', { t: q(input.t, 'time'), s: q(value, 'stress') }));
  return steps;
}

/** The storage and loss moduli at angular frequency ω, and the energy lost per cycle per volume at strain ε0. */
export function dynamic(input: ModelInput, omega: number, strain: number) {
  constants(input);
  positive(omega, 'ω');
  finite(strain, 'ε0');
  const { E, eta } = input;
  let storage: number;
  let loss: number;
  if (input.model === 'kelvin') {
    storage = E;
    loss = eta * omega;
  } else {
    const wt = (omega * eta) / E;
    const base = input.model === 'sls' ? (input.Einf ?? 0) : 0;
    storage = base + (E * wt * wt) / (1 + wt * wt);
    loss = (E * wt) / (1 + wt * wt);
  }
  const tanDelta = loss / storage;
  const energy = Math.PI * loss * strain * strain;
  const steps = [
    step(
      'biomech.complex',
      input.model === 'kelvin'
        ? "E^* = E + i\\eta\\omega: \\quad E' = [[s]], \\quad E'' = [[l]]"
        : "E^* = E_\\infty + E_1\\frac{i\\omega\\tau}{1 + i\\omega\\tau}: \\quad E' = [[s]], \\quad E'' = [[l]]",
      { s: q(storage, 'stress'), l: q(loss, 'stress') },
    ),
    step('biomech.tanDelta', "\\tan\\delta = \\frac{E''}{E'} = [[d]], \\quad \\delta = [[a]]", {
      d: tanDelta,
      a: q(Math.atan(tanDelta), 'angle'),
    }),
    step('biomech.energy', "W = \\pi E'' \\varepsilon_0^2 = [[W]]", { W: q(energy, 'stress') }),
  ];
  return { storage, loss, tanDelta, energy, steps };
}

export interface JointInput {
  /** The segment's angle above horizontal, from the joint. */
  readonly phi: number;
  /** Muscle insertion distance from the joint and the angle between the muscle and the segment. */
  readonly dm: number;
  readonly alpha: number;
  /** Weights (down) and their distances from the joint along the segment. */
  readonly loads: readonly { readonly W: number; readonly d: number }[];
}

/** A muscle holding a segment against weights about a pin joint: the muscle force and the joint's reaction. */
export function joint(input: JointInput) {
  const dm = positive(input.dm, 'd_m');
  const alpha = finite(input.alpha, 'α');
  const phi = finite(input.phi, 'φ');
  if (Math.abs(Math.sin(alpha)) < 1e-9) fail('muscleLine');
  for (const load of input.loads) {
    finite(load.W, 'W');
    notNegative(load.d, 'd');
  }
  const lever = Math.cos(phi);
  const moment = input.loads.reduce((sum, load) => sum + load.W * load.d * lever, 0);
  const F = moment / (dm * Math.sin(alpha));
  // The muscle pulls along the segment turned by α, counterclockwise from it.
  const [ux, uy] = [Math.cos(phi + alpha), Math.sin(phi + alpha)];
  const weight = input.loads.reduce((sum, load) => sum + load.W, 0);
  const Rx = -F * ux;
  const Ry = -F * uy + weight;
  const R = Math.hypot(Rx, Ry);
  const steps = [
    step('biomech.jointMoment', 'F_m d_m \\sin\\alpha = \\sum W_i d_i \\cos\\phi = [[M]]', {
      M: q(moment, 'smallMoment'),
    }),
    step('biomech.muscle', 'F_m = \\frac{[[M]]}{[[d]] \\sin\\alpha} = [[F]]', {
      M: q(moment, 'smallMoment'),
      d: q(dm, 'length'),
      F: q(F, 'smallForce'),
    }),
    step(
      'biomech.reaction',
      'R_x = -F_m\\cos(\\phi + \\alpha) = [[Rx]], \\quad R_y = \\sum W - F_m \\sin(\\phi + \\alpha) = [[Ry]]',
      {
        Rx: q(Rx, 'smallForce'),
        Ry: q(Ry, 'smallForce'),
      },
    ),
  ];
  return { F, Rx, Ry, R, direction: Math.atan2(Ry, Rx), moment, steps };
}

/** Bounds on the modulus of a two-phase composite such as bone: Voigt (equal strain) and Reuss (equal stress). */
export function mixture(Vf: number, Ef: number, Em: number) {
  if (!(Vf >= 0 && Vf <= 1)) fail('fraction');
  positive(Ef, 'E_f');
  positive(Em, 'E_m');
  const voigt = Vf * Ef + (1 - Vf) * Em;
  const reuss = 1 / (Vf / Ef + (1 - Vf) / Em);
  const steps = [
    step('biomech.voigt', 'E_{V} = V_f E_f + (1 - V_f) E_m = [[E]]', { E: q(voigt, 'modulus') }),
    step('biomech.reuss', 'E_{R} = \\left(\\frac{V_f}{E_f} + \\frac{1 - V_f}{E_m}\\right)^{-1} = [[E]]', {
      E: q(reuss, 'modulus'),
    }),
  ];
  return { voigt, reuss, steps };
}
