// Aircraft performance with a parabolic drag polar CD = CD0 + k CL^2, and longitudinal static stability.
// Steady, level, unaccelerated flight unless a mode says otherwise; weight in newtons, SI internally.
import { AeroError, eq, finite, num, positive, sample, step, tex, type AeroStep, type XY } from '../common';

export const G = 9.80665;

export interface Polar {
  /** Weight, N. */
  readonly W: number;
  /** Wing area, m^2. */
  readonly S: number;
  readonly CD0: number;
  /** Induced drag factor k = 1/(pi e AR). */
  readonly k: number;
  /** Air density, kg/m^3. */
  readonly rho: number;
}

/** k from the Oswald efficiency and the aspect ratio. */
export function kOf(e: number, AR: number): number {
  positive(e, 'e');
  positive(AR, 'AR');
  if (e > 1) throw new AeroError('oswaldRange');
  return 1 / (Math.PI * e * AR);
}

function checkPolar(p: Polar): void {
  positive(p.W, 'W');
  positive(p.S, 'S');
  positive(p.CD0, 'C_{D0}');
  positive(p.k, 'k');
  positive(p.rho, 'ρ');
}

const speed = (p: Polar, W: number, CL: number) => Math.sqrt((2 * W) / (p.rho * p.S * CL));

export interface PolarResult {
  readonly CLminD: number;
  readonly LDmax: number;
  readonly VminD: number;
  readonly Dmin: number;
  readonly CLminP: number;
  readonly VminP: number;
  readonly Pmin: number;
  readonly LDminP: number;
  readonly wingLoading: number;
  readonly steps: readonly AeroStep[];
  /** Thrust required (N) and power required (W) against speed (m/s). */
  readonly plot: { readonly thrust: readonly XY[]; readonly power: readonly XY[] };
}

export function polar(p: Polar): PolarResult {
  checkPolar(p);
  const CLminD = Math.sqrt(p.CD0 / p.k);
  const LDmax = 1 / (2 * Math.sqrt(p.k * p.CD0));
  const VminD = speed(p, p.W, CLminD);
  const CLminP = Math.sqrt((3 * p.CD0) / p.k);
  const VminP = speed(p, p.W, CLminP);
  const CDminP = 4 * p.CD0;
  const LDminP = CLminP / CDminP;
  const Pmin = (p.W / LDminP) * VminP;
  const steps: AeroStep[] = [
    step('pfPolar', `C_D = C_{D0} + k C_L^2 = ${tex(p.CD0, 5)} + ${tex(p.k, 5)}\\,C_L^2`),
    step(
      'pfMinDrag',
      eq(
        'C_L^*',
        '\\sqrt{\\frac{C_{D0}}{k}}',
        `\\sqrt{\\frac{${tex(p.CD0, 5)}}{${tex(p.k, 5)}}}`,
        `${tex(CLminD, 5)}, \\quad \\left(\\frac{L}{D}\\right)_{max}`,
        '\\frac{1}{2\\sqrt{k C_{D0}}}',
        `${tex(LDmax, 5)}`,
      ),
    ),
    step(
      'pfSpeed',
      eq(
        'V_{minD}',
        '\\sqrt{\\frac{2W}{\\rho S C_L^*}}',
        `\\sqrt{\\frac{2 \\times ${tex(p.W, 6)}}{${tex(p.rho, 5)} \\times ${tex(p.S, 5)} \\times ${tex(CLminD, 5)}}}`,
        `${tex(VminD, 5)}\\ \\text{m/s}`,
      ),
    ),
    step(
      'pfMinPower',
      eq(
        'C_L',
        '\\sqrt{\\frac{3 C_{D0}}{k}}',
        `${tex(CLminP, 5)}, \\quad V_{minP}`,
        '\\frac{V_{minD}}{3^{1/4}}',
        `${tex(VminP, 5)}\\ \\text{m/s}, \\quad P_{min}`,
        `${tex(Pmin, 5)}\\ \\text{W}`,
      ),
    ),
  ];
  const D = (V: number) => {
    const q = 0.5 * p.rho * V * V;
    const CL = p.W / (q * p.S);
    return q * p.S * (p.CD0 + p.k * CL * CL);
  };
  const lo = 0.4 * VminP;
  const hi = 2.5 * VminD;
  return {
    CLminD,
    LDmax,
    VminD,
    Dmin: p.W / LDmax,
    CLminP,
    VminP,
    Pmin,
    LDminP,
    wingLoading: p.W / p.S,
    steps,
    plot: { thrust: sample(D, lo, hi, 100), power: sample((V) => D(V) * V, lo, hi, 100) },
  };
}

export type Engine = 'jet' | 'prop';

export interface RangeInput extends Polar {
  readonly engine: Engine;
  /** Fuel weight fraction burned: final weight = W (1 - fuel). */
  readonly fuelFraction: number;
  /** Jet: thrust-specific fuel consumption, 1/s (weight of fuel per unit thrust per second). */
  readonly ct?: number;
  /** Propeller: power-specific fuel consumption, 1/m (weight of fuel per unit energy). */
  readonly cp?: number;
  /** Propeller efficiency. */
  readonly etaP?: number;
}

export interface RangeResult {
  /** Best-range CL and CD, and the range (m) at constant altitude (jet) or for the propeller. */
  readonly CLrange: number;
  readonly CDrange: number;
  readonly range: number;
  /** Jet only: constant speed and CL (cruise climb) range with the same CL, m. */
  readonly rangeCruiseClimb?: number;
  readonly CLendurance: number;
  readonly endurance: number;
  readonly Wf: number;
  readonly steps: readonly AeroStep[];
}

export function rangeEndurance(input: RangeInput): RangeResult {
  checkPolar(input);
  const fuel = finite(input.fuelFraction, 'W_fuel/W');
  if (!(fuel > 0 && fuel < 1)) throw new AeroError('fuelFraction');
  const Wi = input.W;
  const Wf = Wi * (1 - fuel);
  const steps: AeroStep[] = [];
  const ln = Math.log(Wi / Wf);
  if (input.engine === 'jet') {
    const ct = positive(input.ct ?? NaN, 'c_t');
    const CL = Math.sqrt(input.CD0 / (3 * input.k));
    const CD = input.CD0 + input.k * CL * CL;
    const range =
      (2 / ct) * Math.sqrt(2 / (input.rho * input.S)) * (Math.sqrt(CL) / CD) * (Math.sqrt(Wi) - Math.sqrt(Wf));
    const Vi = speed(input, Wi, CL);
    const cruiseClimb = (Vi / ct) * (CL / CD) * ln;
    const CLe = Math.sqrt(input.CD0 / input.k);
    const endurance = (1 / ct) * (CLe / (2 * input.CD0)) * ln;
    steps.push(
      step(
        'pfJetRangeCL',
        `C_L = \\sqrt{\\frac{C_{D0}}{3k}} = ${tex(CL, 5)}, \\quad C_D = \\frac{4}{3}C_{D0} = ${tex(CD, 5)}`,
      ),
    );
    steps.push(
      step(
        'pfJetRange',
        eq(
          'R',
          '\\frac{2}{c_t}\\sqrt{\\frac{2}{\\rho S}}\\frac{\\sqrt{C_L}}{C_D}\\left(\\sqrt{W_i} - \\sqrt{W_f}\\right)',
          `\\frac{2}{${tex(ct, 5)}}\\sqrt{\\frac{2}{${tex(input.rho, 5)} \\times ${tex(input.S, 5)}}}` +
            `\\,\\frac{\\sqrt{${tex(CL, 5)}}}{${tex(CD, 5)}}\\left(\\sqrt{${tex(Wi, 6)}} - \\sqrt{${tex(Wf, 6)}}\\right)`,
          `${tex(range / 1000, 5)}\\ \\text{km}`,
        ),
      ),
    );
    steps.push(
      step(
        'pfJetCruiseClimb',
        `R = \\frac{V_i}{c_t}\\frac{C_L}{C_D}\\ln\\frac{W_i}{W_f} = ${tex(cruiseClimb / 1000, 5)}\\ \\text{km}`,
        { V: num(Vi, 5) },
      ),
    );
    steps.push(
      step(
        'pfJetEndurance',
        eq(
          'E',
          '\\frac{1}{c_t}\\left(\\frac{L}{D}\\right)_{max}\\ln\\frac{W_i}{W_f}',
          `${tex(endurance / 3600, 5)}\\ \\text{h}`,
        ),
      ),
    );
    return { CLrange: CL, CDrange: CD, range, rangeCruiseClimb: cruiseClimb, CLendurance: CLe, endurance, Wf, steps };
  }
  const cp = positive(input.cp ?? NaN, 'c_p');
  const eta = positive(input.etaP ?? NaN, 'η_p');
  if (eta > 1) throw new AeroError('efficiencyRange', { name: 'η_p' });
  const CL = Math.sqrt(input.CD0 / input.k);
  const CD = 2 * input.CD0;
  const range = (eta / cp) * (CL / CD) * ln;
  const CLe = Math.sqrt((3 * input.CD0) / input.k);
  const CDe = 4 * input.CD0;
  const endurance =
    (eta / cp) *
    Math.sqrt(2 * input.rho * input.S) *
    (Math.pow(CLe, 1.5) / CDe) *
    (1 / Math.sqrt(Wf) - 1 / Math.sqrt(Wi));
  steps.push(
    step(
      'pfPropRange',
      eq(
        'R',
        '\\frac{\\eta_p}{c}\\left(\\frac{L}{D}\\right)_{max}\\ln\\frac{W_i}{W_f}',
        `\\frac{${tex(eta, 4)}}{${tex(cp, 5)}} \\times ${tex(CL / CD, 5)} \\times \\ln ${tex(Wi / Wf, 5)}`,
        `${tex(range / 1000, 5)}\\ \\text{km}`,
      ),
    ),
  );
  steps.push(
    step(
      'pfPropEndurance',
      eq(
        'E',
        '\\frac{\\eta_p}{c}\\sqrt{2\\rho S}\\frac{C_L^{3/2}}{C_D}\\left(W_f^{-1/2} - W_i^{-1/2}\\right)',
        `${tex(endurance / 3600, 5)}\\ \\text{h}`,
      ),
      { CL: num(CLe, 5) },
    ),
  );
  return { CLrange: CL, CDrange: CD, range, CLendurance: CLe, endurance, Wf, steps };
}

export interface ClimbInput extends Polar {
  readonly engine: Engine;
  /** Jet: thrust available, N. */
  readonly thrust?: number;
  /** Propeller: power available (shaft power times propeller efficiency), W. */
  readonly power?: number;
  /** Height for the glide range, m (optional). */
  readonly height?: number;
}

export interface ClimbResult {
  readonly maxClimbRate: number;
  readonly speedForMaxClimb: number;
  readonly maxClimbAngle?: number;
  readonly glideAngle: number;
  readonly glideRange?: number;
  readonly minSinkRate: number;
  readonly minSinkSpeed: number;
  readonly steps: readonly AeroStep[];
}

export function climbGlide(input: ClimbInput): ClimbResult {
  checkPolar(input);
  const pol = polar(input);
  const steps: AeroStep[] = [];
  const WS = input.W / input.S;
  let maxClimbRate: number;
  let speedForMaxClimb: number;
  let maxClimbAngle: number | undefined;
  if (input.engine === 'jet') {
    const T = positive(input.thrust ?? NaN, 'T_A');
    const TW = T / input.W;
    const LD = pol.LDmax;
    const Z = 1 + Math.sqrt(1 + 3 / (LD * LD * TW * TW));
    speedForMaxClimb = Math.sqrt(((TW * WS) / (3 * input.rho * input.CD0)) * Z);
    maxClimbRate =
      Math.sqrt((WS * Z) / (3 * input.rho * input.CD0)) *
      Math.pow(TW, 1.5) *
      (1 - Z / 6 - 3 / (2 * TW * TW * LD * LD * Z));
    if (TW * LD <= 1) throw new AeroError('cannotClimb');
    maxClimbAngle = Math.asin(Math.min(1, TW - 1 / LD));
    steps.push(
      step(
        'pfJetClimb',
        eq(
          'Z',
          '1 + \\sqrt{1 + \\frac{3}{(L/D)_{max}^2 (T/W)^2}}',
          `${tex(Z, 5)}, \\quad (R/C)_{max}`,
          '\\left[\\frac{(W/S) Z}{3\\rho C_{D0}}\\right]^{1/2}\\left(\\frac{T}{W}\\right)^{3/2}' +
            '\\left[1 - \\frac{Z}{6} - \\frac{3}{2(T/W)^2(L/D)_{max}^2 Z}\\right]',
          `${tex(maxClimbRate, 5)}\\ \\text{m/s}`,
        ),
      ),
    );
    steps.push(
      step(
        'pfJetClimbAngle',
        eq(
          '\\sin\\theta_{max}',
          '\\frac{T}{W} - \\frac{1}{(L/D)_{max}} \\Rightarrow \\theta_{max}',
          `${tex(maxClimbAngle / (Math.PI / 180), 4)}^\\circ`,
        ),
      ),
    );
  } else {
    const P = positive(input.power ?? NaN, 'ηP');
    // Maximum excess power is at the minimum power speed for a propeller with constant power available.
    speedForMaxClimb = pol.VminP;
    maxClimbRate = (P - pol.Pmin) / input.W;
    if (maxClimbRate <= 0) throw new AeroError('cannotClimb');
    steps.push(
      step(
        'pfPropClimb',
        eq(
          '(R/C)_{max}',
          '\\frac{\\eta P - P_{R,min}}{W}',
          `\\frac{${tex(P, 6)} - ${tex(pol.Pmin, 6)}}{${tex(input.W, 6)}}`,
          `${tex(maxClimbRate, 5)}\\ \\text{m/s}`,
        ),
      ),
    );
  }
  const glideAngle = Math.atan(1 / pol.LDmax);
  steps.push(
    step(
      'pfGlide',
      eq(
        '\\tan\\theta_{min}',
        '\\frac{1}{(L/D)_{max}} \\Rightarrow \\theta_{min}',
        `${tex(glideAngle / (Math.PI / 180), 4)}^\\circ`,
      ),
    ),
  );
  const minSinkRate = pol.VminP * Math.sin(Math.atan(1 / pol.LDminP));
  steps.push(
    step(
      'pfMinSink',
      `V_v = V \\sin\\theta = ${tex(minSinkRate, 4)}\\ \\text{m/s at } V = ${tex(pol.VminP, 4)}\\ \\text{m/s}`,
    ),
  );
  let glideRange: number | undefined;
  if (input.height !== undefined && Number.isFinite(input.height)) {
    const h = positive(input.height, 'h', true);
    glideRange = h * pol.LDmax;
    steps.push(step('pfGlideRange', `R = h\\left(\\frac{L}{D}\\right)_{max} = ${tex(glideRange, 5)}\\ \\text{m}`));
  }
  return {
    maxClimbRate,
    speedForMaxClimb,
    ...(maxClimbAngle === undefined ? {} : { maxClimbAngle }),
    glideAngle,
    ...(glideRange === undefined ? {} : { glideRange }),
    minSinkRate,
    minSinkSpeed: pol.VminP,
    steps,
  };
}

export interface TurnInput {
  /** True airspeed, m/s. */
  readonly V: number;
  /** Bank angle, degrees (level coordinated turn). */
  readonly bank: number;
}

export interface TurnResult {
  readonly n: number;
  readonly radius: number;
  readonly rate: number;
  readonly steps: readonly AeroStep[];
}

export function turn(input: TurnInput): TurnResult {
  const V = positive(input.V, 'V');
  const bank = finite(input.bank, 'φ');
  if (!(bank > 0 && bank < 90)) throw new AeroError('bankRange');
  const phi = (bank * Math.PI) / 180;
  const n = 1 / Math.cos(phi);
  const root = Math.sqrt(n * n - 1);
  const radius = (V * V) / (G * root);
  const rate = (G * root) / V;
  return {
    n,
    radius,
    rate,
    steps: [
      step('pfLoadFactor', `n = \\frac{1}{\\cos\\phi} = \\frac{1}{\\cos ${tex(bank, 4)}^\\circ} = ${tex(n, 5)}`),
      step(
        'pfTurnRadius',
        eq(
          'R',
          '\\frac{V^2}{g\\sqrt{n^2 - 1}}',
          `\\frac{${tex(V, 5)}^2}{9.80665 \\times ${tex(root, 5)}}`,
          `${tex(radius, 5)}\\ \\text{m}`,
        ),
      ),
      step(
        'pfTurnRate',
        eq(
          '\\omega',
          '\\frac{g\\sqrt{n^2 - 1}}{V}',
          `${tex(rate, 5)}\\ \\text{rad/s}`,
          `${tex((rate * 180) / Math.PI, 4)}^\\circ/\\text{s}`,
        ),
      ),
    ],
  };
}

export interface StabilityInput {
  /** Aerodynamic center of the wing-body, fraction of mean chord. */
  readonly hac: number;
  /** Horizontal tail volume ratio. */
  readonly VH: number;
  /** Tail to wing-body lift-slope ratio a_t/a. */
  readonly slopeRatio: number;
  /** Downwash gradient d epsilon / d alpha. */
  readonly downwash: number;
  /** Center of gravity, fraction of mean chord. */
  readonly hcg: number;
  /** Wing-body lift slope a, per rad (optional, for Cm_alpha). */
  readonly a?: number;
}

export interface StabilityResult {
  readonly hn: number;
  readonly margin: number;
  readonly stable: boolean;
  readonly CmAlpha?: number;
  readonly steps: readonly AeroStep[];
}

export function stability(input: StabilityInput): StabilityResult {
  const hac = finite(input.hac, 'h_ac');
  const VH = positive(input.VH, 'V_H', true);
  const ratio = positive(input.slopeRatio, 'a_t/a', true);
  const de = finite(input.downwash, 'dε/dα');
  const hcg = finite(input.hcg, 'h_cg');
  if (de < 0 || de >= 1) throw new AeroError('downwashRange');
  const hn = hac + VH * ratio * (1 - de);
  const margin = hn - hcg;
  const steps: AeroStep[] = [
    step(
      'pfNeutral',
      eq(
        'h_n',
        'h_{ac} + V_H\\frac{a_t}{a}\\left(1 - \\frac{d\\varepsilon}{d\\alpha}\\right)',
        `${tex(hac, 4)} + ${tex(VH, 4)} \\times ${tex(ratio, 4)} \\times (1 - ${tex(de, 4)})`,
        `${tex(hn, 5)}`,
      ),
    ),
    step(margin > 0 ? 'pfStable' : 'pfUnstable', `h_n - h_{cg} = ${tex(hn, 5)} - ${tex(hcg, 4)} = ${tex(margin, 5)}`),
  ];
  let CmAlpha: number | undefined;
  if (input.a !== undefined && Number.isFinite(input.a)) {
    CmAlpha = -positive(input.a, 'a') * margin;
    steps.push(step('pfCmAlpha', `C_{M\\alpha} = -a(h_n - h_{cg}) = ${tex(CmAlpha, 5)}\\ \\text{per rad}`));
  }
  return { hn, margin, stable: margin > 0, ...(CmAlpha === undefined ? {} : { CmAlpha }), steps };
}
