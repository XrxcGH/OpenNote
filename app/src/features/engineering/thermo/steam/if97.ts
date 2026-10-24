// Water and steam by IAPWS-IF97, the industrial formulation of IAPWS (release R7-97(2012), free at iapws.org).
// The basic equations of regions 1, 2, 3, and 5 give every property from their derivatives. Region 4 is the
// saturation line, and B23 is the boundary between regions 2 and 3. Region 3 takes density and temperature, so a
// state given by T and p finds its density by a root search on the right side of the saturation line. Units: K,
// kPa, kg/m³, m³/kg, kJ/kg, and kJ/(kg K). The reference state is the release's: u = s = 0 for the saturated
// liquid at the triple point, the same as the saturated table of the chemistry tools.
import { brent } from '../common/num';
import { ThermoError } from '../common/types';

export const IF97_SOURCE = 'IAPWS-IF97, IAPWS R7-97(2012)';

/** Specific gas constant of water, kJ/(kg K). */
export const R_W = 0.461526;
export const T_CRIT = 647.096;
/** Critical pressure, kPa. */
export const P_CRIT = 22064;
export const RHO_CRIT = 322;
export const T_TRIPLE = 273.16;
/** Triple-point pressure, kPa. */
export const P_TRIPLE = 0.611657;
export const T_MIN = 273.15;
export const T_MAX = 2273.15;
/** Highest pressure of regions 1 to 3, kPa. */
export const P_MAX = 100000;
/** Highest pressure of region 5, kPa. */
export const P_MAX_5 = 50000;

export type Region = 1 | 2 | 3 | 5;

/** A single-phase state with every property the basic equations give. */
export interface WaterState {
  region: Region;
  T: number;
  p: number;
  v: number;
  u: number;
  h: number;
  s: number;
  cp: number;
  cv: number;
  w: number;
}

type Terms = readonly (readonly [number, number, number])[];

// Region 1: γ = Σ n (7.1 − π)^I (τ − 1.222)^J, π = p/16.53 MPa, τ = 1386 K/T.
const R1: Terms = [
  [0, -2, 0.14632971213167],
  [0, -1, -0.84548187169114],
  [0, 0, -0.3756360367204e1],
  [0, 1, 0.33855169168385e1],
  [0, 2, -0.95791963387872],
  [0, 3, 0.15772038513228],
  [0, 4, -0.16616417199501e-1],
  [0, 5, 0.81214629983568e-3],
  [1, -9, 0.28319080123804e-3],
  [1, -7, -0.60706301565874e-3],
  [1, -1, -0.18990068218419e-1],
  [1, 0, -0.32529748770505e-1],
  [1, 1, -0.21841717175414e-1],
  [1, 3, -0.5283835796993e-4],
  [2, -3, -0.47184321073267e-3],
  [2, 0, -0.30001780793026e-3],
  [2, 1, 0.47661393906987e-4],
  [2, 3, -0.44141845330846e-5],
  [2, 17, -0.72694996297594e-15],
  [3, -4, -0.31679644845054e-4],
  [3, 0, -0.28270797985312e-5],
  [3, 6, -0.85205128120103e-9],
  [4, -5, -0.22425281908e-5],
  [4, -2, -0.65171222895601e-6],
  [4, 10, -0.14341729937924e-12],
  [5, -8, -0.40516996860117e-6],
  [8, -11, -0.12734301741641e-8],
  [8, -6, -0.17424871230634e-9],
  [21, -29, -0.68762131295531e-18],
  [23, -31, 0.14478307828521e-19],
  [29, -38, 0.26335781662795e-22],
  [30, -39, -0.11947622640071e-22],
  [31, -40, 0.18228094581404e-23],
  [32, -41, -0.93537087292458e-25],
];

// Region 2, ideal part: γ° = ln π + Σ n° τ^J; residual part γʳ = Σ n π^I (τ − 0.5)^J, π = p/1 MPa, τ = 540 K/T.
const R2_IDEAL: readonly (readonly [number, number])[] = [
  [0, -0.96927686500217e1],
  [1, 0.10086655968018e2],
  [-5, -0.5608791128302e-2],
  [-4, 0.71452738081455e-1],
  [-3, -0.40710498223928],
  [-2, 0.14240819171444e1],
  [-1, -0.4383951131945e1],
  [2, -0.28408632460772],
  [3, 0.21268463753307e-1],
];

const R2: Terms = [
  [1, 0, -0.17731742473213e-2],
  [1, 1, -0.17834862292358e-1],
  [1, 2, -0.45996013696365e-1],
  [1, 3, -0.57581259083432e-1],
  [1, 6, -0.5032527872793e-1],
  [2, 1, -0.33032641670203e-4],
  [2, 2, -0.18948987516315e-3],
  [2, 4, -0.39392777243355e-2],
  [2, 7, -0.43797295650573e-1],
  [2, 36, -0.26674547914087e-4],
  [3, 0, 0.20481737692309e-7],
  [3, 1, 0.43870667284435e-6],
  [3, 3, -0.3227767723857e-4],
  [3, 6, -0.15033924542148e-2],
  [3, 35, -0.40668253562649e-1],
  [4, 1, -0.78847309559367e-9],
  [4, 2, 0.12790717852285e-7],
  [4, 3, 0.48225372718507e-6],
  [5, 7, 0.22922076337661e-5],
  [6, 3, -0.16714766451061e-10],
  [6, 16, -0.21171472321355e-2],
  [6, 35, -0.23895741934104e2],
  [7, 0, -0.5905956432427e-17],
  [7, 11, -0.12621808899101e-5],
  [7, 25, -0.38946842435739e-1],
  [8, 8, 0.11256211360459e-10],
  [8, 36, -0.82311340897998e1],
  [9, 13, 0.19809712802088e-7],
  [10, 4, 0.10406965210174e-18],
  [10, 10, -0.10234747095929e-12],
  [10, 14, -0.10018179379511e-8],
  [16, 29, -0.80882908646985e-10],
  [16, 50, 0.10693031879409],
  [18, 57, -0.33662250574171],
  [20, 20, 0.89185845355421e-24],
  [20, 35, 0.30629316876232e-12],
  [20, 48, -0.42002467698208e-5],
  [21, 21, -0.59056029685639e-25],
  [22, 53, 0.37826947613457e-5],
  [23, 39, -0.12768608934681e-14],
  [24, 26, 0.73087610595061e-28],
  [24, 40, 0.55414715350778e-16],
  [24, 58, -0.9436970724121e-6],
];

// Region 3: φ = n₁ ln δ + Σ n δ^I τ^J, δ = ρ/322 kg/m³, τ = 647.096 K/T.
const R3_N1 = 0.10658070028513e1;
const R3: Terms = [
  [0, 0, -0.15732845290239e2],
  [0, 1, 0.20944396974307e2],
  [0, 2, -0.76867707878716e1],
  [0, 7, 0.26185947787954e1],
  [0, 10, -0.2808078114862e1],
  [0, 12, 0.12053369696517e1],
  [0, 23, -0.84566812812502e-2],
  [1, 2, -0.12654315477714e1],
  [1, 6, -0.11524407806681e1],
  [1, 15, 0.88521043984318],
  [1, 17, -0.64207765181607],
  [2, 0, 0.38493460186671],
  [2, 2, -0.85214708824206],
  [2, 6, 0.48972281541877e1],
  [2, 7, -0.30502617256965e1],
  [2, 22, 0.39420536879154e-1],
  [2, 26, 0.12558408424308],
  [3, 0, -0.2799932969871],
  [3, 2, 0.1389979956946e1],
  [3, 4, -0.2018991502357e1],
  [3, 16, -0.82147637173963e-2],
  [3, 26, -0.47596035734923],
  [4, 0, 0.439840744735e-1],
  [4, 2, -0.44476435428739],
  [4, 4, 0.90572070719733],
  [4, 26, 0.70522450087967],
  [5, 1, 0.10770512626332],
  [5, 3, -0.32913623258954],
  [5, 26, -0.50871062041158],
  [6, 0, -0.22175400873096e-1],
  [6, 2, 0.94260751665092e-1],
  [6, 26, 0.16436278447961],
  [7, 2, -0.13503372241348e-1],
  [8, 26, -0.14834345352472e-1],
  [9, 2, 0.57922953628084e-3],
  [9, 26, 0.32308904703711e-2],
  [10, 0, 0.80964802996215e-4],
  [10, 1, -0.16557679795037e-3],
  [11, 26, -0.44923899061815e-4],
];

// Region 4, the saturation line.
const N4 = [
  0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.1202082470247e5, -0.32325550322333e7,
  0.1491510861353e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3,
] as const;

// Region 5: γ° = ln π + Σ n° τ^J and γʳ = Σ n π^I τ^J, π = p/1 MPa, τ = 1000 K/T.
const R5_IDEAL: readonly (readonly [number, number])[] = [
  [0, -0.13179983674201e2],
  [1, 0.68540841634434e1],
  [-3, -0.24805148933466e-1],
  [-2, 0.36901534980333],
  [-1, -0.31161318213925e1],
  [2, -0.32961626538917],
];

const R5: Terms = [
  [1, 1, 0.15736404855259e-2],
  [1, 2, 0.90153761673944e-3],
  [1, 3, -0.50270077677648e-2],
  [2, 3, 0.22440037409485e-5],
  [2, 9, -0.41163275453471e-5],
  [3, 7, 0.37965629054302e-7],
];

// B23: p = n₁ + n₂ T + n₃ T² (MPa, K) and its inverse.
const B23 = [0, 0.34805185628969e3, -0.11671859879975e1, 0.10192970039326e-2, 0.57254459862746e3, 0.1391883977887e2];

/** Saturation pressure at T (K), kPa, from 273.15 K to the critical point. */
export function psat(T: number): number {
  if (!(T >= T_MIN && T <= T_CRIT)) throw new ThermoError('steamSatRange');
  const theta = T + N4[9] / (T - N4[10]);
  const A = theta * theta + N4[1] * theta + N4[2];
  const B = N4[3] * theta * theta + N4[4] * theta + N4[5];
  const C = N4[6] * theta * theta + N4[7] * theta + N4[8];
  return ((2 * C) / (-B + Math.sqrt(B * B - 4 * A * C))) ** 4 * 1000;
}

/** Saturation temperature at p (kPa), K, from 611.213 Pa to the critical point. */
export function tsat(p: number): number {
  if (!(p >= 0.611213 && p <= P_CRIT)) throw new ThermoError('steamSatRange');
  const beta = (p / 1000) ** 0.25;
  const E = beta * beta + N4[3] * beta + N4[6];
  const F = N4[1] * beta * beta + N4[4] * beta + N4[7];
  const G = N4[2] * beta * beta + N4[5] * beta + N4[8];
  const D = (2 * G) / (-F - Math.sqrt(F * F - 4 * E * G));
  const sum = N4[10] + D;
  return (sum - Math.sqrt(sum * sum - 4 * (N4[9] + N4[10] * D))) / 2;
}

/** The pressure on the region 2-3 boundary at T (K), kPa. */
export const pB23 = (T: number): number => (B23[1] + B23[2] * T + B23[3] * T * T) * 1000;
/** The temperature on the region 2-3 boundary at p (kPa), K. */
export const tB23 = (p: number): number => B23[4] + Math.sqrt((p / 1000 - B23[5]) / B23[3]);

/** The Gibbs-energy derivatives a region gives: γ, γ_π, γ_ππ, γ_τ, γ_ττ, γ_πτ. */
interface Gibbs {
  g: number;
  gp: number;
  gpp: number;
  gt: number;
  gtt: number;
  gpt: number;
}

function region1Gibbs(pi: number, tau: number): Gibbs {
  const a = 7.1 - pi;
  const b = tau - 1.222;
  const out: Gibbs = { g: 0, gp: 0, gpp: 0, gt: 0, gtt: 0, gpt: 0 };
  for (const [I, J, n] of R1) {
    const aI = a ** I;
    const bJ = b ** J;
    out.g += n * aI * bJ;
    out.gp -= n * I * a ** (I - 1) * bJ;
    out.gpp += n * I * (I - 1) * a ** (I - 2) * bJ;
    out.gt += n * aI * J * b ** (J - 1);
    out.gtt += n * aI * J * (J - 1) * b ** (J - 2);
    out.gpt -= n * I * a ** (I - 1) * J * b ** (J - 1);
  }
  return out;
}

/** Region 2 or 5: ideal plus residual parts. */
function gasGibbs(
  pi: number,
  tau: number,
  ideal: readonly (readonly [number, number])[],
  residual: Terms,
  shift: number,
): { ideal: Gibbs; res: Gibbs } {
  const io: Gibbs = { g: Math.log(pi), gp: 1 / pi, gpp: -1 / (pi * pi), gt: 0, gtt: 0, gpt: 0 };
  for (const [J, n] of ideal) {
    io.g += n * tau ** J;
    io.gt += n * J * tau ** (J - 1);
    io.gtt += n * J * (J - 1) * tau ** (J - 2);
  }
  const b = tau - shift;
  const r: Gibbs = { g: 0, gp: 0, gpp: 0, gt: 0, gtt: 0, gpt: 0 };
  for (const [I, J, n] of residual) {
    r.g += n * pi ** I * b ** J;
    r.gp += n * I * pi ** (I - 1) * b ** J;
    r.gpp += n * I * (I - 1) * pi ** (I - 2) * b ** J;
    r.gt += n * pi ** I * J * b ** (J - 1);
    r.gtt += n * pi ** I * J * (J - 1) * b ** (J - 2);
    r.gpt += n * I * pi ** (I - 1) * J * b ** (J - 1);
  }
  return { ideal: io, res: r };
}

/** Region 1, compressed liquid: T in K, p in kPa. */
export function region1(T: number, p: number): WaterState {
  const pi = p / 16530;
  const tau = 1386 / T;
  const g = region1Gibbs(pi, tau);
  const RT = R_W * T;
  const cp = -R_W * tau * tau * g.gtt;
  const shift = g.gp - tau * g.gpt;
  return {
    region: 1,
    T,
    p,
    v: (RT / p) * pi * g.gp,
    u: RT * (tau * g.gt - pi * g.gp),
    h: RT * tau * g.gt,
    s: R_W * (tau * g.gt - g.g),
    cp,
    cv: R_W * (-tau * tau * g.gtt + (shift * shift) / g.gpp),
    w: Math.sqrt((1000 * RT * g.gp * g.gp) / ((shift * shift) / (tau * tau * g.gtt) - g.gpp)),
  };
}

function gasRegion(region: 2 | 5, T: number, p: number): WaterState {
  const pi = p / 1000;
  const tau = (region === 2 ? 540 : 1000) / T;
  const { ideal: o, res: r } = region === 2 ? gasGibbs(pi, tau, R2_IDEAL, R2, 0.5) : gasGibbs(pi, tau, R5_IDEAL, R5, 0);
  const RT = R_W * T;
  const gt = o.gt + r.gt;
  const gtt = o.gtt + r.gtt;
  const gp = o.gp + r.gp;
  const top = 1 + pi * r.gp - tau * pi * r.gpt;
  return {
    region,
    T,
    p,
    v: (RT / p) * pi * gp,
    u: RT * (tau * gt - pi * gp),
    h: RT * tau * gt,
    s: R_W * (tau * gt - (o.g + r.g)),
    cp: -R_W * tau * tau * gtt,
    cv: R_W * (-tau * tau * gtt - (top * top) / (1 - pi * pi * r.gpp)),
    w: Math.sqrt(
      (1000 * RT * (1 + 2 * pi * r.gp + pi * pi * r.gp * r.gp)) /
        (1 - pi * pi * r.gpp + (top * top) / (tau * tau * gtt)),
    ),
  };
}

/** Region 2, vapor: T in K, p in kPa. */
export const region2 = (T: number, p: number): WaterState => gasRegion(2, T, p);
/** Region 5, high-temperature vapor: T in K, p in kPa. */
export const region5 = (T: number, p: number): WaterState => gasRegion(5, T, p);

/** Region 3 from density (kg/m³) and temperature (K). */
export function region3(rho: number, T: number): WaterState {
  const delta = rho / RHO_CRIT;
  const tau = T_CRIT / T;
  let f = R3_N1 * Math.log(delta);
  let fd = R3_N1 / delta;
  let fdd = -R3_N1 / (delta * delta);
  let ft = 0;
  let ftt = 0;
  let fdt = 0;
  for (const [I, J, n] of R3) {
    const dI = delta ** I;
    const tJ = tau ** J;
    f += n * dI * tJ;
    fd += n * I * delta ** (I - 1) * tJ;
    fdd += n * I * (I - 1) * delta ** (I - 2) * tJ;
    ft += n * dI * J * tau ** (J - 1);
    ftt += n * dI * J * (J - 1) * tau ** (J - 2);
    fdt += n * I * delta ** (I - 1) * J * tau ** (J - 1);
  }
  const RT = R_W * T;
  const top = delta * fd - delta * tau * fdt;
  const bottom = 2 * delta * fd + delta * delta * fdd;
  return {
    region: 3,
    T,
    p: rho * RT * delta * fd,
    v: 1 / rho,
    u: RT * tau * ft,
    h: RT * (tau * ft + delta * fd),
    s: R_W * (tau * ft - f),
    cp: R_W * (-tau * tau * ftt + (top * top) / bottom),
    cv: -R_W * tau * tau * ftt,
    w: Math.sqrt(1000 * RT * (bottom - (top * top) / (tau * tau * ftt))),
  };
}

/** Every density in region 3 where p(ρ, T) equals p, from a scan of 50 to 1100 kg/m³. */
function region3Roots(T: number, p: number): number[] {
  const f = (rho: number) => region3(rho, T).p - p;
  const roots: number[] = [];
  const n = 420;
  let a = 50;
  let fa = f(a);
  for (let i = 1; i <= n; i++) {
    const b = 50 + (1050 * i) / n;
    const fb = f(b);
    if (fa === 0) roots.push(a);
    else if (fa * fb < 0) roots.push(brent(f, a, b, 1e-13));
    a = b;
    fa = fb;
  }
  return roots;
}

/** Region 3 from T and p: the liquid-like root above the saturation pressure, the vapor-like one below it. */
export function region3TP(T: number, p: number, side: 'liquid' | 'vapor' | 'auto' = 'auto'): WaterState {
  const roots = region3Roots(T, p);
  if (!roots.length) throw new ThermoError('noRoot');
  const liquid = side === 'liquid' || (side === 'auto' && T < T_CRIT && p >= psat(T));
  return region3(liquid ? roots[roots.length - 1] : roots[0], T);
}

/** Which region a state given by T (K) and p (kPa) falls in, and the boundary that decided it. */
export function regionOf(T: number, p: number): { region: Region; test: RegionTest } {
  if (!(T >= T_MIN && T <= T_MAX)) throw new ThermoError('steamRange');
  if (!(p > 0)) throw new ThermoError('notPositive', { name: 'p' });
  if (T > 1073.15) {
    if (p > P_MAX_5) throw new ThermoError('steamRange');
    return { region: 5, test: 'aboveRegion2' };
  }
  if (p > P_MAX) throw new ThermoError('steamRange');
  if (T <= 623.15) return p > psat(T) ? { region: 1, test: 'abovePsat' } : { region: 2, test: 'belowPsat' };
  if (p > pB23(T)) return { region: 3, test: 'aboveB23' };
  return { region: 2, test: 'belowB23' };
}

export type RegionTest = 'abovePsat' | 'belowPsat' | 'aboveB23' | 'belowB23' | 'aboveRegion2' | 'saturated';

/** A single-phase state from T (K) and p (kPa). */
export function stateTP(T: number, p: number, side: 'liquid' | 'vapor' | 'auto' = 'auto'): WaterState {
  const { region } = regionOf(T, p);
  if (region === 1) return region1(T, p);
  if (region === 2) return region2(T, p);
  if (region === 5) return region5(T, p);
  return region3TP(T, p, side);
}

/** Saturated liquid and vapor at T (K): regions 1 and 2 up to 623.15 K, region 3 above. */
export function saturation(T: number): { p: number; liquid: WaterState; vapor: WaterState } {
  const p = psat(T);
  if (T <= 623.15) return { p, liquid: region1(T, p), vapor: region2(T, p) };
  const roots = region3Roots(T, p);
  if (!roots.length) throw new ThermoError('noRoot');
  return { p, liquid: region3(roots[roots.length - 1], T), vapor: region3(roots[0], T) };
}
