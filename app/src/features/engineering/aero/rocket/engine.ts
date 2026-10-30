// Ideal rocket performance from chamber conditions: frozen, calorically perfect, one-dimensional isentropic
// expansion. It gives the characteristic velocity, the exit state, the thrust coefficient, the specific impulse,
// the thrust, the mass flow, thrust against altitude through the standard atmosphere, and the rocket equation.
import { AeroError, checkGamma, eq, finite, num, positive, step, tex, type AeroStep, type XY } from '../common';
import { H_TOP, standard } from '../atmosphere/engine';
import { isentropicP, isentropicT, machFromArea, areaRatio } from '../compressible/relations';

export const R_UNIVERSAL = 8314.462618; // J/(kmol K), CODATA 2018
export const G0 = 9.80665;

export type ExitMode = 'areaRatio' | 'exitPressure' | 'optimum';

export interface RocketInput {
  /** Chamber temperature, K. */
  readonly Tc: number;
  /** Molar mass of the exhaust, kg/kmol. */
  readonly molarMass: number;
  readonly gamma: number;
  /** Chamber pressure, Pa. */
  readonly pc: number;
  readonly mode: ExitMode;
  /** Exit to throat area ratio (mode areaRatio). */
  readonly areaRatio?: number;
  /** Exit pressure, Pa (mode exitPressure). */
  readonly pe?: number;
  /** Ambient pressure, Pa (0 for vacuum). */
  readonly pa: number;
  /** Throat area, m^2. */
  readonly throat: number;
  /** Initial to final mass ratio for the rocket equation (optional). */
  readonly massRatio?: number;
}

export interface RocketResult {
  readonly R: number;
  readonly cStar: number;
  readonly exitMach: number;
  readonly pe: number;
  readonly Te: number;
  readonly areaRatio: number;
  readonly exitVelocity: number;
  readonly CF: number;
  readonly CFmomentum: number;
  readonly CFpressure: number;
  readonly Isp: number;
  readonly c: number;
  readonly thrust: number;
  readonly massFlow: number;
  readonly deltaV?: number;
  /** pe/pa below about 0.4 risks flow separation (Summerfield criterion); null in vacuum. */
  readonly separationRisk: boolean;
  readonly steps: readonly AeroStep[];
  /** Thrust in N against geopotential altitude in km (standard atmosphere). */
  readonly plot: readonly XY[];
}

/** Characteristic velocity c* = sqrt(gamma R Tc) / (gamma sqrt((2/(gamma+1))^((gamma+1)/(gamma-1)))). */
export function cStarOf(g: number, R: number, Tc: number): number {
  return Math.sqrt(g * R * Tc) / (g * Math.sqrt(Math.pow(2 / (g + 1), (g + 1) / (g - 1))));
}

/** Momentum part of the thrust coefficient for exit pressure ratio pe/pc. */
export function cfMomentum(g: number, pepc: number): number {
  return Math.sqrt(
    ((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1)) * (1 - Math.pow(pepc, (g - 1) / g)),
  );
}

/** Delta-v from the Tsiolkovsky rocket equation, m/s. */
export function deltaV(Isp: number, massRatio: number): number {
  positive(Isp, 'I_sp');
  if (!(massRatio >= 1)) throw new AeroError('massRatio');
  return Isp * G0 * Math.log(massRatio);
}

function cStarStep(g: number, R: number, Tc: number, cStar: number): AeroStep {
  const G = tex(g, 4);
  const formula =
    'c^* = \\frac{\\sqrt{\\gamma R T_c}}{\\gamma\\sqrt{\\left(\\frac{2}{\\gamma + 1}\\right)^{\\frac{\\gamma + 1}{\\gamma - 1}}}}';
  const sub =
    `\\frac{\\sqrt{${G} \\times ${tex(R, 6)} \\times ${tex(Tc, 6)}}}` +
    `{${G}\\sqrt{(2/${tex(g + 1, 4)})^{${tex((g + 1) / (g - 1), 5)}}}}`;
  return step('rkCStar', eq(formula, sub, `${tex(cStar, 6)}\\ \\text{m/s}`), { R: num(R, 6) });
}

/** The exit Mach number and area ratio, from the area ratio, an exit pressure, or optimum expansion. */
function exitState(input: RocketInput, g: number, pc: number, pa: number, steps: AeroStep[]) {
  if (input.mode === 'areaRatio') {
    const eps = finite(input.areaRatio ?? NaN, 'ε');
    if (eps < 1) throw new AeroError('areaRatioBelowOne');
    const found = machFromArea(eps, g, 'supersonic');
    const formula =
      '\\varepsilon = \\frac{1}{M_e}\\left[\\frac{2}{\\gamma + 1}\\left(1 + \\frac{\\gamma - 1}{2}M_e^2\\right)\\right]' +
      '^{\\frac{\\gamma + 1}{2(\\gamma - 1)}}';
    const math = eq(formula, `${tex(eps, 6)} \\Rightarrow M_e = ${tex(found.root, 6)}`);
    steps.push(step('rkExitMach', math, { iterations: String(found.iterations) }));
    return { eps, Me: found.root };
  }
  if (input.mode === 'optimum' && pa <= 0) throw new AeroError('optimumVacuum');
  const pe = input.mode === 'optimum' ? pa : positive(input.pe ?? NaN, 'p_e');
  const ratio = pe / pc;
  if (ratio >= isentropicP(1, g)) throw new AeroError('exitPressureHigh', { max: num(pc * isentropicP(1, g)) });
  const Me = Math.sqrt((2 / (g - 1)) * (Math.pow(ratio, -(g - 1) / g) - 1));
  const eps = areaRatio(Me, g);
  const formula =
    'M_e = \\sqrt{\\frac{2}{\\gamma - 1}\\left[\\left(\\frac{p_c}{p_e}\\right)^{(\\gamma - 1)/\\gamma} - 1\\right]}';
  const math = `${eq(formula, tex(Me, 6))}, \\quad \\varepsilon = ${tex(eps, 6)}`;
  steps.push(step(input.mode === 'optimum' ? 'rkOptimum' : 'rkFromPe', math));
  return { eps, Me };
}

function thrustSteps(o: { g: number; pepc: number; pe: number; CFm: number; CFp: number; CF: number }): AeroStep[] {
  const pRatio = eq(
    '\\frac{p_e}{p_c} = \\left(1 + \\frac{\\gamma - 1}{2}M_e^2\\right)^{-\\gamma/(\\gamma - 1)}',
    `${tex(o.pepc, 6)} \\Rightarrow p_e = ${tex(o.pe, 6)}\\ \\text{Pa}`,
  );
  const momentum =
    '\\sqrt{\\frac{2\\gamma^2}{\\gamma - 1}\\left(\\frac{2}{\\gamma + 1}\\right)^{\\frac{\\gamma + 1}{\\gamma - 1}}' +
    '\\left[1 - \\left(\\frac{p_e}{p_c}\\right)^{\\frac{\\gamma - 1}{\\gamma}}\\right]}';
  const cf = eq(
    `C_F = ${momentum} + \\frac{p_e - p_a}{p_c}\\varepsilon`,
    `${tex(o.CFm, 6)} + (${tex(o.CFp, 6)})`,
    tex(o.CF, 6),
  );
  return [step('rkExitPressure', pRatio), step('rkCF', cf)];
}

function deltaVStep(Isp: number, massRatio: number, dv: number): AeroStep {
  const math = eq(
    '\\Delta v = I_{sp} g_0 \\ln\\frac{m_0}{m_f}',
    `${tex(Isp, 6)} \\times 9.80665 \\times \\ln ${tex(massRatio, 6)}`,
    `${tex(dv, 6)}\\ \\text{m/s}`,
  );
  return step('rkDeltaV', math);
}

/** Thrust in N against geopotential altitude in km, through the standard atmosphere. */
function thrustByAltitude(CFm: number, pe: number, pc: number, eps: number, At: number): XY[] {
  const plot: XY[] = [];
  for (let i = 0; i <= 80; i += 1) {
    const km = (i * H_TOP) / 80 / 1000;
    plot.push({ x: km, y: (CFm + ((pe - standard(km * 1000).p) / pc) * eps) * pc * At });
  }
  return plot;
}

export function rocket(input: RocketInput): RocketResult {
  const g = checkGamma(input.gamma);
  const Tc = positive(input.Tc, 'T_c');
  const pc = positive(input.pc, 'p_c');
  const pa = positive(input.pa, 'p_a', true);
  const At = positive(input.throat, 'A_t');
  const R = R_UNIVERSAL / positive(input.molarMass, 'M');
  const cStar = cStarOf(g, R, Tc);
  const steps: AeroStep[] = [cStarStep(g, R, Tc, cStar)];
  const { eps, Me } = exitState(input, g, pc, pa, steps);
  const pepc = isentropicP(Me, g);
  const pe = pc * pepc;
  const Te = Tc * isentropicT(Me, g);
  const CFm = cfMomentum(g, pepc);
  const CFp = ((pe - pa) / pc) * eps;
  const CF = CFm + CFp;
  steps.push(...thrustSteps({ g, pepc, pe, CFm, CFp, CF }));
  const Isp = (cStar * CF) / G0;
  const massFlow = (pc * At) / cStar;
  const thrust = CF * pc * At;
  const isp = eq('I_{sp} = \\frac{c^* C_F}{g_0}', `\\frac{${tex(cStar, 6)} \\times ${tex(CF, 6)}}{9.80665}`);
  steps.push(step('rkIsp', `${isp} = ${tex(Isp, 6)}\\ \\text{s}`));
  const flow = `\\dot m = \\frac{p_c A_t}{c^*} = ${tex(massFlow, 6)}\\ \\text{kg/s}`;
  steps.push(step('rkThrust', `F = C_F p_c A_t = ${tex(thrust, 6)}\\ \\text{N}, \\quad ${flow}`));
  const separationRisk = pa > 0 && pe < 0.4 * pa;
  if (pa > 0)
    steps.push(step(separationRisk ? 'rkSeparation' : 'rkNoSeparation', undefined, { ratio: num(pe / pa, 4) }));
  const ratio = input.massRatio;
  const dv = ratio !== undefined && Number.isFinite(ratio) ? deltaV(Isp, ratio) : undefined;
  if (dv !== undefined && ratio !== undefined) steps.push(deltaVStep(Isp, ratio, dv));
  return {
    R,
    cStar,
    exitMach: Me,
    pe,
    Te,
    areaRatio: eps,
    exitVelocity: Me * Math.sqrt(g * R * Te),
    CF,
    CFmomentum: CFm,
    CFpressure: CFp,
    Isp,
    c: cStar * CF,
    thrust,
    massFlow,
    ...(dv === undefined ? {} : { deltaV: dv }),
    separationRisk,
    steps,
    plot: thrustByAltitude(CFm, pe, pc, eps, At),
  };
}
