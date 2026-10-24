// Converging-diverging nozzle for any back pressure: the three critical back-pressure ratios, the flow regime,
// a normal shock inside the diverging section (placed by Brent's method so the exit pressure matches the back
// pressure), exit conditions, mass flow, and the pressure along the nozzle. Quasi-one-dimensional, isentropic
// except across the shock, calorically perfect gas.
import { AeroError, brent, checkGamma, eq, finite, num, positive, step, tex, type AeroStep, type XY } from '../common';
import { areaRatio, isentropicP, isentropicT, machFromArea, normalShock } from '../compressible/relations';

export type Regime =
  | 'noFlow'
  | 'subsonic'
  | 'chokedSubsonic'
  | 'shockInside'
  | 'shockAtExit'
  | 'overexpanded'
  | 'design'
  | 'underexpanded';

export interface NozzleInput {
  /** Exit to throat area ratio, at least 1. */
  readonly areaRatio: number;
  /** Stagnation pressure, Pa. */
  readonly p0: number;
  /** Stagnation temperature, K. */
  readonly T0: number;
  /** Back pressure, Pa. */
  readonly pb: number;
  readonly gamma: number;
  /** Gas constant, J/(kg K). */
  readonly R: number;
  /** Throat area, m^2. */
  readonly throat: number;
  /** Inlet to throat area ratio, for the pressure plot only (default 3). */
  readonly inlet?: number;
}

export interface NozzleResult {
  readonly regime: Regime;
  /** pb/p0 at the three critical conditions: choked with subsonic exit, normal shock at the exit, design. */
  readonly critical: readonly [number, number, number];
  readonly pbp0: number;
  readonly exitMach: number;
  /** Exit-plane static pressure, Pa (equals pb when the exit is subsonic). */
  readonly exitPressure: number;
  readonly exitTemperature: number;
  readonly exitVelocity: number;
  readonly massFlow: number;
  readonly choked: boolean;
  /** Shock area ratio As/At and the Mach number just upstream, when a shock stands in the nozzle. */
  readonly shock?: { readonly areaRatio: number; readonly M1: number; readonly p02p01: number; readonly x: number };
  readonly steps: readonly AeroStep[];
  /** p/p0 against position, -1 at the inlet, 0 at the throat, 1 at the exit. */
  readonly plot: { readonly p: readonly XY[]; readonly area: readonly XY[] };
}

const TOL = 1e-9;

/** Choked mass flow per unit throat area: p0 sqrt(gamma/(R T0)) (2/(gamma+1))^((gamma+1)/(2(gamma-1))). */
export function chokedMassFlow(p0: number, T0: number, At: number, g: number, R: number): number {
  return ((p0 * At) / Math.sqrt(T0)) * Math.sqrt(g / R) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));
}

/** The three critical back-pressure ratios of a nozzle of exit area ratio e. */
export function criticalRatios(e: number, g: number): [number, number, number] {
  const sub = machFromArea(e, g, 'subsonic').root;
  const sup = machFromArea(e, g, 'supersonic').root;
  const third = isentropicP(sup, g);
  return [isentropicP(sub, g), third * normalShock(sup, g).p2p1, third];
}

/** Exit pressure ratio pe/p0 with a normal shock at area ratio As/At. */
function exitWithShock(As: number, e: number, g: number) {
  const M1 = machFromArea(As, g, 'supersonic').root;
  const loss = normalShock(M1, g).p02p01;
  // Downstream of the shock the sonic area grows by 1/loss, so the exit sees Ae/A2* = e * loss.
  const Me = machFromArea(e * loss, g, 'subsonic').root;
  return { M1, loss, Me, pe: loss * isentropicP(Me, g) };
}

type Shock = NonNullable<NozzleResult['shock']>;

/** What every regime needs: the nozzle, the gas, the back pressure, and the steps so far. */
interface Setup {
  readonly e: number;
  readonly g: number;
  readonly p0: number;
  readonly pb: number;
  readonly r: number;
  readonly crit: readonly [number, number, number];
  readonly Msub: number;
  readonly Msup: number;
  readonly mChoked: number;
  readonly R: number;
  readonly T0: number;
  readonly At: number;
  readonly steps: AeroStep[];
}

/** The flow a regime settles on: exit Mach number and pressure, mass flow, and any shock. */
interface Flow {
  readonly regime: Regime;
  readonly Me: number;
  readonly pe: number;
  readonly mdot: number;
  readonly throatMach: number;
  /** Stagnation pressure at the exit, Pa: p0, less any shock loss. */
  readonly p0e: number;
  readonly shock?: Shock;
}

function criticalSteps(s: Setup): void {
  const [c1, c2, c3] = s.crit;
  const first = eq(
    `M_e = ${tex(s.Msub, 6)} \\Rightarrow \\frac{p_b}{p_0}`,
    '\\left(1 + \\frac{\\gamma - 1}{2} M_e^2\\right)^{-\\gamma/(\\gamma - 1)}',
    tex(c1, 6),
  );
  s.steps.push(step('nzFirst', first, { e: num(s.e, 6) }));
  s.steps.push(step('nzThird', `M_e = ${tex(s.Msup, 6)} \\Rightarrow \\frac{p_e}{p_0} = ${tex(c3, 6)}`));
  const second = eq(
    '\\frac{p_b}{p_0} = \\frac{p_e}{p_0} \\cdot \\frac{p_2}{p_1}(M_e)',
    `${tex(c3, 6)} \\times ${tex(normalShock(s.Msup, s.g).p2p1, 6)}`,
    tex(c2, 6),
  );
  s.steps.push(step('nzSecond', second));
}

/** Back pressure above the first critical value: subsonic everywhere, the throat not choked. */
function unchokedFlow(s: Setup): Flow {
  const { e, g, r } = s;
  const Me = Math.sqrt((2 / (g - 1)) * (Math.pow(r, -(g - 1) / g) - 1));
  const virtualThroat = areaRatio(Me, g) / e; // At / A*
  const throatMach = machFromArea(virtualThroat, g, 'subsonic').root;
  const math = eq(
    'M_e = \\sqrt{\\frac{2}{\\gamma - 1}\\left[\\left(\\frac{p_0}{p_b}\\right)^{(\\gamma - 1)/\\gamma} - 1\\right]}',
    tex(Me, 6),
  );
  s.steps.push(step('nzSubsonic', math, { r: num(r, 6), c1: num(s.crit[0], 6) }));
  // Unchoked: the flow behaves as if its sonic throat A* = At / (At/A*) were downstream.
  const mdot = chokedMassFlow(s.p0, s.T0, s.At / virtualThroat, g, s.R);
  return { regime: 'subsonic', Me, pe: s.pb, mdot, throatMach, p0e: s.p0 };
}

/** A normal shock in the diverging section, placed so the exit pressure equals the back pressure. */
function shockInsideFlow(s: Setup): Flow {
  const { e, g, r } = s;
  const found = brent((As: number) => exitWithShock(As, e, g).pe - r, 1 + 1e-12, e, 1e-13);
  const sh = exitWithShock(found.root, e, g);
  const shock: Shock = { areaRatio: found.root, M1: sh.M1, p02p01: sh.loss, x: Math.sqrt((found.root - 1) / (e - 1)) };
  s.steps.push(step('nzShockRegime', undefined, { r: num(r, 6), c1: num(s.crit[0], 6), c2: num(s.crit[1], 6) }));
  const exit = eq(
    '\\frac{p_e}{p_0}',
    '\\frac{p_{02}}{p_{01}}\\left(1 + \\frac{\\gamma - 1}{2}M_e^2\\right)^{-\\gamma/(\\gamma - 1)}',
  );
  const sonic = eq('\\frac{A_e}{A_2^*}', '\\frac{A_e}{A_t}\\frac{p_{02}}{p_{01}}');
  s.steps.push(
    step('nzShockSolve', `${exit}, \\quad ${sonic}`, {
      iterations: String(found.iterations),
      As: num(found.root, 6),
    }),
  );
  const result = [
    `M_1 = ${tex(sh.M1, 6)}`,
    `\\frac{p_{02}}{p_{01}} = ${tex(sh.loss, 6)}`,
    `M_e = ${tex(sh.Me, 6)}`,
  ].join(', \\quad ');
  s.steps.push(step('nzShockResult', result));
  return { regime: 'shockInside', Me: sh.Me, pe: s.pb, mdot: s.mChoked, throatMach: 1, p0e: s.p0 * sh.loss, shock };
}

/** Back pressure at or below the second critical value: a shock at the exit, or a supersonic exit. */
function supersonicFlow(s: Setup): Flow {
  const { r, Msup, g } = s;
  const [, c2, c3] = s.crit;
  const base = { mdot: s.mChoked, throatMach: 1 };
  if (r >= c2 * (1 - TOL)) {
    const sh = normalShock(Msup, g);
    s.steps.push(step('nzShockExit', undefined, { r: num(r, 6) }));
    const shock: Shock = { areaRatio: s.e, M1: Msup, p02p01: sh.p02p01, x: 1 };
    return { ...base, regime: 'shockAtExit', Me: sh.M2, pe: s.pb, p0e: s.p0 * sh.p02p01, shock };
  }
  const regime: Regime =
    Math.abs(r - c3) <= TOL * Math.max(c3, 1e-300) ? 'design' : r > c3 ? 'overexpanded' : 'underexpanded';
  const key = regime === 'design' ? 'nzDesign' : regime === 'overexpanded' ? 'nzOver' : 'nzUnder';
  s.steps.push(step(key, undefined, { r: num(r, 6), c2: num(c2, 6), c3: num(c3, 6) }));
  return { ...base, regime, Me: Msup, pe: c3 * s.p0, p0e: s.p0 };
}

function regimeFlow(s: Setup): Flow {
  const [c1, c2] = s.crit;
  if (s.r >= 1 - TOL) return { regime: 'noFlow', Me: 0, pe: s.pb, mdot: 0, throatMach: 0, p0e: s.p0 };
  if (s.r > c1 * (1 + TOL)) return unchokedFlow(s);
  if (s.r >= c1 * (1 - TOL)) {
    s.steps.push(step('nzChokedSub', undefined, { r: num(s.r, 6) }));
    return { regime: 'chokedSubsonic', Me: s.Msub, pe: c1 * s.p0, mdot: s.mChoked, throatMach: 1, p0e: s.p0 };
  }
  return s.r > c2 * (1 + TOL) ? shockInsideFlow(s) : supersonicFlow(s);
}

function setup(input: NozzleInput): Setup {
  const g = checkGamma(input.gamma);
  const e = finite(input.areaRatio, 'Ae/At');
  if (e < 1) throw new AeroError('areaRatioBelowOne');
  const p0 = positive(input.p0, 'p₀');
  const T0 = positive(input.T0, 'T₀');
  const pb = positive(input.pb, 'p_b', true);
  const R = positive(input.R, 'R');
  const At = positive(input.throat, 'A_t');
  if (pb > p0 * (1 + 1e-12)) throw new AeroError('backflow');
  const Msub = machFromArea(e, g, 'subsonic').root;
  const Msup = machFromArea(e, g, 'supersonic').root;
  const mChoked = chokedMassFlow(p0, T0, At, g, R);
  return { e, g, p0, pb, r: pb / p0, crit: criticalRatios(e, g), Msub, Msup, mChoked, R, T0, At, steps: [] };
}

export function nozzle(input: NozzleInput): NozzleResult {
  const s = setup(input);
  const inlet = Math.max(input.inlet ?? 3, 1.05);
  criticalSteps(s);
  const flow = regimeFlow(s);
  const { g, R, T0 } = s;
  const Te = T0 * isentropicT(flow.Me, g);
  if (flow.regime !== 'noFlow') {
    const formula =
      '\\dot m = \\frac{p_0 A^*}{\\sqrt{T_0}}\\sqrt{\\frac{\\gamma}{R}}' +
      '\\left(\\frac{2}{\\gamma + 1}\\right)^{\\frac{\\gamma + 1}{2(\\gamma - 1)}}';
    s.steps.push(step('nzMassFlow', eq(formula, `${tex(flow.mdot, 6)}\\ \\text{kg/s}`)));
  }
  return {
    regime: flow.regime,
    critical: s.crit,
    pbp0: s.r,
    exitMach: flow.Me,
    exitPressure: flow.pe,
    exitTemperature: Te,
    exitVelocity: flow.Me * Math.sqrt(g * R * Te),
    massFlow: flow.mdot,
    choked: flow.regime !== 'noFlow' && flow.regime !== 'subsonic',
    ...(flow.shock ? { shock: flow.shock } : {}),
    steps: s.steps,
    plot: profile(s.e, inlet, g, flow.regime, flow.throatMach, flow.shock, flow.p0e / s.p0),
  };
}

/** p/p0 along a nozzle with parabolic converging and diverging walls: A/At = 1 + (end - 1) x^2. */
function profile(
  e: number,
  inlet: number,
  g: number,
  regime: Regime,
  Mt: number,
  shock: NozzleResult['shock'],
  exitP0: number,
) {
  const p: XY[] = [];
  const area: XY[] = [];
  const n = 60;
  // The sonic area the subsonic upstream flow sees: At when choked, larger when not.
  const aStar = regime === 'noFlow' ? Infinity : Mt >= 1 ? 1 : 1 / areaRatio(Mt, g);
  for (let i = -n; i <= n; i += 1) {
    const x = i / n;
    const A = x < 0 ? 1 + (inlet - 1) * x * x : 1 + (e - 1) * x * x;
    area.push({ x, y: A });
    let ratio: number;
    if (regime === 'noFlow') ratio = 1;
    else if (x <= 0 || regime === 'subsonic' || regime === 'chokedSubsonic') {
      ratio = A / aStar <= 1 + 1e-12 ? isentropicP(Mt, g) : isentropicP(machFromArea(A / aStar, g, 'subsonic').root, g);
    } else if (shock && x > shock.x) {
      const M = machFromArea(Math.max(A * shock.p02p01, 1), g, 'subsonic').root;
      ratio = exitP0 * isentropicP(M, g);
    } else {
      ratio = isentropicP(machFromArea(Math.max(A, 1), g, 'supersonic').root, g);
    }
    p.push({ x, y: ratio });
  }
  return { p, area };
}
