// On-design parametric cycle analysis of turbojet, turbofan, and ramjet engines, in the station numbers and τ, π
// notation of the standard propulsion texts. Ideal: reversible components, one calorically perfect gas, and the
// fuel's mass neglected. Non-ideal: polytropic efficiencies, the efficiency of each burner and the shaft, pressure
// losses, a separate cp and γ for the hot section, and the fuel's mass carried through the turbine and nozzle.
import { AeroError, checkGamma, eq, finite, num, positive, step, tex } from '../common';
import type { AeroStep, XY } from '../common';

export type EngineType = 'turbojet' | 'turbofan' | 'ramjet';

/** Component figures for the non-ideal cycle; every one is 1 for the ideal cycle. */
export interface Losses {
  /** Diffuser pressure ratio before ram recovery, burner, core nozzle, and fan nozzle pressure ratios. */
  readonly piDmax: number;
  readonly piB: number;
  readonly piN: number;
  readonly piFn: number;
  /** Polytropic efficiencies of the compressor, fan, and turbine. */
  readonly ec: number;
  readonly ef: number;
  readonly et: number;
  readonly etaB: number;
  readonly etaM: number;
  readonly etaAB: number;
  readonly piAB: number;
  /** Ambient over exit static pressure for the core, then the fan: 1 when a nozzle expands to ambient. */
  readonly p0p9: number;
  readonly p0p19: number;
}

export const IDEAL: Losses = {
  piDmax: 1,
  piB: 1,
  piN: 1,
  piFn: 1,
  ec: 1,
  ef: 1,
  et: 1,
  etaB: 1,
  etaM: 1,
  etaAB: 1,
  piAB: 1,
  p0p9: 1,
  p0p19: 1,
};

export interface CycleInput {
  readonly type: EngineType;
  readonly ideal: boolean;
  readonly M0: number;
  /** Ambient static temperature, K, and pressure, Pa. */
  readonly T0: number;
  readonly P0: number;
  /** Cold-section (and, ideal, the only) gas; hot-section gas for the non-ideal cycle. cp in J/(kg K). */
  readonly gammaC: number;
  readonly cpC: number;
  readonly gammaT: number;
  readonly cpT: number;
  /** Fuel heating value, J/kg, and turbine inlet total temperature, K. */
  readonly hPR: number;
  readonly Tt4: number;
  /** Overall compressor pressure ratio Pt3/Pt2 (it includes the fan's core stream). */
  readonly piC: number;
  readonly piF: number;
  /** Bypass ratio: fan-stream over core air mass flow. */
  readonly alpha: number;
  /** Afterburner exit total temperature, K (turbojet only). */
  readonly Tt7?: number;
  readonly losses: Losses;
}

export interface Station {
  readonly id: string;
  readonly Tt: number;
  readonly Pt: number;
}

export interface Ratios {
  readonly tauR: number;
  readonly piR: number;
  readonly etaR: number;
  readonly piD: number;
  readonly tauL: number;
  readonly tauC: number;
  readonly etaC: number;
  readonly tauF: number;
  readonly etaF: number;
  readonly tauT: number;
  readonly piT: number;
  readonly etaT: number;
  readonly tauLAB?: number;
}

export interface CycleResult {
  readonly ratios: Ratios;
  readonly a0: number;
  readonly V0: number;
  /** Fuel-air ratios: main burner (per core air), afterburner, and their sum. */
  readonly f: number;
  readonly fAB: number;
  readonly fO: number;
  readonly M9: number;
  readonly V9: number;
  readonly T9: number;
  readonly M19?: number;
  readonly V19?: number;
  /** Thrust per unit of total air mass flow, N s/kg; fuel consumption per unit thrust, kg/(N s). */
  readonly specificThrust: number;
  readonly S: number;
  readonly etaTh: number;
  readonly etaP: number;
  readonly etaO: number;
  /** Core thrust over fan thrust (turbofan). */
  readonly FR?: number;
  readonly stations: readonly Station[];
  readonly steps: readonly AeroStep[];
}

interface Gas {
  readonly g: number;
  readonly cp: number;
  readonly R: number;
  /** (γ - 1)/γ, the exponent between total pressure and temperature ratios. */
  readonly e: number;
}

const gasOf = (g: number, cp: number, name: string): Gas => {
  checkGamma(g);
  positive(cp, name);
  return { g, cp, R: ((g - 1) / g) * cp, e: (g - 1) / g };
};

/** Ram recovery of a supersonic inlet (the military specification curve); 1 at subsonic speeds. */
export function ramRecovery(M0: number): number {
  if (M0 <= 1) return 1;
  if (M0 < 5) return 1 - 0.075 * Math.pow(M0 - 1, 1.35);
  return 800 / (Math.pow(M0, 4) + 935);
}

const unitRange = (value: number, name: string) => {
  finite(value, name);
  if (!(value > 0 && value <= 1)) throw new AeroError('efficiencyRange', { name });
};

function checkInput(input: CycleInput): void {
  const M0 = finite(input.M0, 'M₀');
  if (M0 < 0) throw new AeroError('notNegative', { name: 'M₀' });
  if (input.type === 'ramjet' && M0 === 0) throw new AeroError('ramjetStatic');
  positive(input.T0, 'T₀');
  positive(input.P0, 'P₀');
  positive(input.hPR, 'hPR');
  positive(input.Tt4, 'Tt4');
  if (input.type !== 'ramjet' && !(finite(input.piC, 'πc') >= 1)) throw new AeroError('ratioBelowOne', { name: 'πc' });
  if (input.type === 'turbofan') {
    if (!(finite(input.piF, 'πf') >= 1)) throw new AeroError('ratioBelowOne', { name: 'πf' });
    if (finite(input.alpha, 'α') < 0) throw new AeroError('notNegative', { name: 'α' });
  }
  if (input.Tt7 !== undefined) positive(input.Tt7, 'Tt7');
  if (input.ideal) return;
  const L = input.losses;
  const named: [number, string][] = [
    [L.piDmax, 'πd,max'],
    [L.piB, 'πb'],
    [L.piN, 'πn'],
    [L.piFn, 'πfn'],
    [L.ec, 'ec'],
    [L.ef, 'ef'],
    [L.et, 'et'],
    [L.etaB, 'ηb'],
    [L.etaM, 'ηm'],
    [L.etaAB, 'ηAB'],
    [L.piAB, 'πAB'],
  ];
  named.forEach(([value, name]) => unitRange(value, name));
  positive(L.p0p9, 'P₀/P₉');
  positive(L.p0p19, 'P₀/P₁₉');
}

interface Compression {
  readonly tauR: number;
  readonly piR: number;
  readonly etaR: number;
  readonly piD: number;
  readonly piC: number;
  readonly tauC: number;
  readonly etaC: number;
  readonly piF: number;
  readonly tauF: number;
  readonly etaF: number;
  readonly alpha: number;
}

/** τ for a pressure ratio π at polytropic efficiency e, and the adiabatic efficiency that matches it. */
function stage(pi: number, gas: Gas, e: number): { tau: number; eta: number } {
  const tau = Math.pow(pi, gas.e / e);
  return { tau, eta: pi === 1 ? 1 : (Math.pow(pi, gas.e) - 1) / (tau - 1) };
}

function compression(input: CycleInput, cold: Gas, L: Losses): Compression {
  const tauR = 1 + ((cold.g - 1) / 2) * input.M0 * input.M0;
  const etaR = input.ideal ? 1 : ramRecovery(input.M0);
  const piC = input.type === 'ramjet' ? 1 : input.piC;
  const fan = input.type === 'turbofan';
  const piF = fan ? input.piF : 1;
  const c = stage(piC, cold, L.ec);
  const f = stage(piF, cold, L.ef);
  return {
    tauR,
    piR: Math.pow(tauR, 1 / cold.e),
    etaR,
    piD: L.piDmax * etaR,
    piC,
    tauC: c.tau,
    etaC: c.eta,
    piF,
    tauF: f.tau,
    etaF: f.eta,
    alpha: fan ? input.alpha : 0,
  };
}

interface HotSection {
  readonly tauL: number;
  readonly f: number;
  readonly tauT: number;
  readonly piT: number;
  readonly etaT: number;
  readonly tauLAB?: number;
  readonly fAB: number;
}

/** Fuel for a burner raising the total temperature ratio from `from` to `to` (both cp Tt/(cpc T0)). */
function fuel(ideal: boolean, from: number, to: number, eta: number, hRatio: number, flow: number): number {
  if (ideal) return (to - from) / hRatio;
  if (eta * hRatio <= to) throw new AeroError('fuelTooHot');
  return (flow * (to - from)) / (eta * hRatio - to);
}

function hotSection(input: CycleInput, cold: Gas, hot: Gas, k: Compression, L: Losses): HotSection {
  const hRatio = input.hPR / (cold.cp * input.T0);
  const tauL = (hot.cp * input.Tt4) / (cold.cp * input.T0);
  const Tt3 = input.T0 * k.tauR * k.tauC;
  if (input.Tt4 <= Tt3) throw new AeroError('burnerCold', { Tt3: num(Tt3, 5) });
  const f = fuel(input.ideal, k.tauR * k.tauC, tauL, L.etaB, hRatio, 1);
  const flow = input.ideal ? 1 : 1 + f;
  const work = k.tauC - 1 + k.alpha * (k.tauF - 1);
  const tauT = 1 - (k.tauR * work) / (L.etaM * flow * tauL);
  if (!(tauT > 0)) throw new AeroError('turbineWork');
  const piT = Math.pow(tauT, 1 / (hot.e * L.et));
  const etaT = tauT === 1 ? 1 : (1 - tauT) / (1 - Math.pow(tauT, 1 / L.et));
  if (input.Tt7 === undefined) return { tauL, f, tauT, piT, etaT, fAB: 0 };
  const tauLAB = (hot.cp * input.Tt7) / (cold.cp * input.T0);
  if (tauLAB <= tauL * tauT) throw new AeroError('afterburnerCold', { Tt5: num(input.Tt4 * tauT, 5) });
  const fAB = fuel(input.ideal, tauL * tauT, tauLAB, L.etaAB, hRatio, flow);
  return { tauL, f, tauT, piT, etaT, tauLAB, fAB };
}

interface Exit {
  readonly ratio: number;
  readonly M: number;
  /** Exit static temperature over T0, and exit velocity over a0. */
  readonly T: number;
  readonly V: number;
}

/** A nozzle exit from its total-to-static pressure ratio and total temperature (over T0). */
function exit(ratio: number, Tt: number, gas: Gas, cold: Gas, code: 'coreExpand' | 'fanExpand'): Exit {
  if (!(ratio > 1)) throw new AeroError(code, { ratio: num(ratio, 4) });
  const T = Tt / Math.pow(ratio, gas.e);
  const M = Math.sqrt((2 / (gas.g - 1)) * (Math.pow(ratio, gas.e) - 1));
  return { ratio, M, T, V: M * Math.sqrt((gas.g * gas.R * T) / (cold.g * cold.R)) };
}

function stations(input: CycleInput, k: Compression, h: HotSection, L: Losses): Station[] {
  const { T0, P0, type } = input;
  const out: Station[] = [{ id: '0', Tt: T0 * k.tauR, Pt: P0 * k.piR }];
  const s2 = { id: '2', Tt: T0 * k.tauR, Pt: P0 * k.piR * k.piD };
  out.push(s2);
  if (type === 'turbofan') out.push({ id: '13', Tt: s2.Tt * k.tauF, Pt: s2.Pt * k.piF });
  const s3 = type === 'ramjet' ? s2 : { id: '3', Tt: s2.Tt * k.tauC, Pt: s2.Pt * k.piC };
  if (type !== 'ramjet') out.push(s3);
  const s4 = { id: '4', Tt: input.Tt4, Pt: s3.Pt * L.piB };
  out.push(s4);
  let last = s4;
  if (type !== 'ramjet') out.push((last = { id: '5', Tt: s4.Tt * h.tauT, Pt: s4.Pt * h.piT }));
  if (input.Tt7 !== undefined) out.push((last = { id: '7', Tt: input.Tt7, Pt: last.Pt * L.piAB }));
  out.push({ id: '9', Tt: last.Tt, Pt: last.Pt * L.piN });
  if (type === 'turbofan') out.push({ id: '19', Tt: s2.Tt * k.tauF, Pt: s2.Pt * k.piF * L.piFn });
  return out;
}

export function cycle(input: CycleInput): CycleResult {
  checkInput(input);
  const L = input.ideal ? IDEAL : input.losses;
  const cold = gasOf(input.gammaC, input.cpC, 'cp');
  const hot = input.ideal ? cold : gasOf(input.gammaT, input.cpT, 'cpt');
  const k = compression(input, cold, L);
  const h = hotSection(input, cold, hot, k, L);
  const fO = h.f + h.fAB;
  const m9 = input.ideal ? 1 : 1 + fO;
  const a0 = Math.sqrt(cold.g * cold.R * input.T0);
  const M0 = input.M0;
  const core = exit(
    L.p0p9 * k.piR * k.piD * k.piC * L.piB * h.piT * (input.Tt7 === undefined ? 1 : L.piAB) * L.piN,
    ((h.tauLAB ?? h.tauL * h.tauT) * cold.cp) / hot.cp,
    hot,
    cold,
    'coreExpand',
  );
  const coreF = m9 * core.V - M0 + (m9 * hot.R * core.T * (1 - L.p0p9)) / (cold.R * core.V * cold.g);
  const fan =
    input.type === 'turbofan'
      ? exit(L.p0p19 * k.piR * k.piD * k.piF * L.piFn, k.tauR * k.tauF, cold, cold, 'fanExpand')
      : undefined;
  const fanF = fan ? fan.V - M0 + (fan.T * (1 - L.p0p19)) / (fan.V * cold.g) : 0;
  const alpha = k.alpha;
  const specificThrust = (a0 / (1 + alpha)) * (coreF + alpha * fanF);
  const kinetic = m9 * core.V * core.V + alpha * (fan ? fan.V * fan.V : 0) - (1 + alpha) * M0 * M0;
  const etaTh = (a0 * a0 * kinetic) / (2 * fO * input.hPR);
  const etaP = kinetic > 0 ? (2 * M0 * (1 + alpha) * specificThrust) / (a0 * kinetic) : 0;
  const ratios: Ratios = {
    ...k,
    tauL: h.tauL,
    tauT: h.tauT,
    piT: h.piT,
    etaT: h.etaT,
    ...(h.tauLAB === undefined ? {} : { tauLAB: h.tauLAB }),
  };
  const result = {
    ratios,
    a0,
    V0: M0 * a0,
    f: h.f,
    fAB: h.fAB,
    fO,
    M9: core.M,
    V9: core.V * a0,
    T9: core.T * input.T0,
    ...(fan ? { M19: fan.M, V19: fan.V * a0 } : {}),
    // The thrust ratio only means something when the fan stream carries air and pushes.
    ...(fan && alpha > 0 && fanF > 0 ? { FR: coreF / fanF } : {}),
    specificThrust,
    S: specificThrust > 0 ? fO / ((1 + alpha) * specificThrust) : Infinity,
    etaTh,
    etaP,
    etaO: etaTh * etaP,
    stations: stations(input, k, h, L),
  };
  return { ...result, steps: cycleSteps(input, result, core.ratio, fan?.ratio) };
}

type Done = Omit<CycleResult, 'steps'>;

function compressionSteps(input: CycleInput, r: Done): AeroStep[] {
  const k = r.ratios;
  const steps: AeroStep[] = [
    step(
      'jeRam',
      `\\tau_r = 1 + \\tfrac{\\gamma_c - 1}{2} M_0^2 = ${tex(k.tauR)},\\quad \\pi_r = \\tau_r^{\\gamma_c/(\\gamma_c - 1)} = ${tex(k.piR)}`,
      { a0: num(r.a0, 5), V0: num(r.V0, 5) },
    ),
  ];
  if (!input.ideal)
    steps.push(step('jeDiffuser', `\\pi_d = \\pi_{d,max}\\,\\eta_r = ${tex(k.piD)}`, { etaR: num(k.etaR, 5) }));
  steps.push(
    step(
      'jeTauL',
      eq(input.ideal ? '\\tau_\\lambda = T_{t4}/T_0' : '\\tau_\\lambda = c_{pt} T_{t4}/(c_{pc} T_0)', tex(k.tauL)),
    ),
  );
  if (input.type !== 'ramjet') {
    const ex = input.ideal ? '(\\gamma_c - 1)/\\gamma_c' : '(\\gamma_c - 1)/(\\gamma_c e_c)';
    steps.push(step('jeCompressor', `\\tau_c = \\pi_c^{${ex}} = ${tex(k.tauC)}`, { etaC: num(k.etaC, 4) }));
  }
  if (input.type === 'turbofan') {
    const ex = input.ideal ? '(\\gamma_c - 1)/\\gamma_c' : '(\\gamma_c - 1)/(\\gamma_c e_f)';
    steps.push(step('jeFan', `\\tau_f = \\pi_f^{${ex}} = ${tex(k.tauF)}`, { etaF: num(k.etaF, 4) }));
  }
  return steps;
}

function hotSteps(input: CycleInput, r: Done): AeroStep[] {
  const k = r.ratios;
  const fTex = input.ideal
    ? '\\dfrac{c_p T_0 (\\tau_\\lambda - \\tau_r \\tau_c)}{h_{PR}}'
    : '\\dfrac{\\tau_\\lambda - \\tau_r \\tau_c}{\\eta_b h_{PR}/(c_{pc} T_0) - \\tau_\\lambda}';
  const steps: AeroStep[] = [step('jeFuel', eq('f', fTex, tex(r.f, 5)))];
  if (input.type !== 'ramjet') {
    const fanWork = input.type === 'turbofan' ? ' + \\alpha(\\tau_f - 1)' : '';
    const flow = input.ideal ? '' : '\\eta_m (1 + f)';
    steps.push(
      step(
        'jeTurbine',
        `\\tau_t = 1 - \\dfrac{\\tau_r}{${flow}\\tau_\\lambda}\\left(\\tau_c - 1${fanWork}\\right) = ${tex(k.tauT)}` +
          `,\\quad \\pi_t = ${tex(k.piT)}`,
        { etaT: num(k.etaT, 4) },
      ),
    );
  }
  if (k.tauLAB !== undefined)
    steps.push(step('jeAfterburner', eq('f_{AB}', tex(r.fAB, 5)), { tauLAB: num(k.tauLAB, 5), fO: num(r.fO, 5) }));
  return steps;
}

function cycleSteps(input: CycleInput, r: Done, core: number, fan: number | undefined): AeroStep[] {
  const steps = [...compressionSteps(input, r), ...hotSteps(input, r)];
  steps.push(
    step('jeCoreNozzle', `\\dfrac{P_{t9}}{P_9} = ${tex(core, 5)},\\quad M_9 = ${tex(r.M9, 5)}`, {
      V9: num(r.V9, 5),
      T9: num(r.T9, 5),
    }),
  );
  if (fan !== undefined && r.V19 !== undefined && r.M19 !== undefined)
    steps.push(
      step('jeFanNozzle', `\\dfrac{P_{t19}}{P_{19}} = ${tex(fan, 5)},\\quad M_{19} = ${tex(r.M19, 5)}`, {
        V19: num(r.V19, 5),
      }),
    );
  const fanTerm = input.type === 'turbofan' ? ' + \\alpha\\left(V_{19} - V_0\\right)' : '';
  const mass = input.ideal ? '' : '(1 + f_O)';
  steps.push(
    step(
      'jeThrust',
      eq(
        '\\dfrac{F}{\\dot m_0}',
        `\\dfrac{1}{1 + \\alpha}\\left[${mass}V_9 - V_0${fanTerm}\\right]`,
        `${tex(r.specificThrust, 5)}\\ \\mathrm{N\\,s/kg}`,
      ),
      { pressure: input.ideal ? '@w.expanded' : '@w.pressureTerm' },
    ),
    step('jeTsfc', eq('S', '\\dfrac{f_O}{(1 + \\alpha) F/\\dot m_0}', `${tex(r.S * 1e6, 5)}\\ \\mathrm{mg/(N\\,s)}`)),
    step(
      'jeEfficiency',
      `\\eta_T = ${tex(r.etaTh, 5)},\\quad \\eta_P = ${tex(r.etaP, 5)},\\quad \\eta_O = \\eta_T \\eta_P = ${tex(r.etaO, 5)}`,
    ),
  );
  return steps;
}

/** One quantity of the cycle against compressor pressure ratio (or flight Mach number, for a ramjet). */
export function sweep(input: CycleInput, pick: (r: CycleResult) => number, count = 60): XY[] {
  const ram = input.type === 'ramjet';
  const top = ram
    ? Math.min(6, 0.98 * Math.sqrt((2 / (input.gammaC - 1)) * (input.Tt4 / input.T0 - 1)))
    : Math.max(40, 1.5 * input.piC);
  const bottom = ram ? 0.2 : 1.5;
  const points: XY[] = [];
  for (let i = 0; i <= count; i += 1) {
    const x = bottom + ((top - bottom) * i) / count;
    try {
      const y = pick(cycle(ram ? { ...input, M0: x } : { ...input, piC: x }));
      if (Number.isFinite(y)) points.push({ x, y });
    } catch (error) {
      if (!(error instanceof AeroError)) throw error;
    }
  }
  return points;
}
