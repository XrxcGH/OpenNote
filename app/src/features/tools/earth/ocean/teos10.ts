// Seawater by TEOS-10: absolute salinity from practical salinity (reference composition, no regional anomaly),
// conservative temperature from potential temperature, density from the 75-term polynomial for specific volume
// (Roquet et al. 2015), potential density, and the freezing conservative temperature. The coefficients are the
// published ones (IOC, SCOR and IAPSO 2010; Roquet et al. 2015; McDougall et al. 2014), checked against GSW-C 3.05.
// SA in g/kg, temperatures in °C (ITS-90), sea pressure in dbar.
import { check } from '../core/problem';
import { potentialTemperature, toT68 } from './seawater';

export const TEOS10_SOURCE =
  'IOC, SCOR and IAPSO (2010), The international thermodynamic equation of seawater, TEOS-10; Roquet et al. (2015), ' +
  'Ocean Modelling 90; coefficients as in the GSW Oceanographic Toolbox (SCOR/IAPSO WG127)';

/** The reference salinity of standard seawater, g/kg, and its ratio to practical salinity 35. */
export const SSO = 35.16504;
const UPS = SSO / 35;
/** 1/(40 uPS): scales SA so that x² = 0.875 at SSO. */
const SFAC = 1 / (40 * UPS);
/** The 24 g/kg offset that keeps the square root real down to SA = 0, times SFAC. */
const OFFSET = 24 * SFAC;
/** The fixed specific heat that defines conservative temperature, J/(kg·K). */
export const CP0 = 3991.86795711963;

/** Specific volume coefficients v[i][j][k] for (Θ/40)^i (x)^j (p/10⁴ dbar)^k, keyed "ijk". 75 terms. */
const V: Readonly<Record<string, number>> = {
  '000': 1.0769995862e-3,
  '001': -6.0799143809e-5,
  '002': 9.9856169219e-6,
  '003': -1.1309361437e-6,
  '004': 1.053115308e-7,
  '005': -1.2647261286e-8,
  '006': 1.961350393e-9,
  '010': -3.1038981976e-4,
  '011': 2.4262468747e-5,
  '012': -5.8484432984e-7,
  '013': 3.6310188515e-7,
  '014': -1.1147125423e-7,
  '020': 6.6928067038e-4,
  '021': -3.4792460974e-5,
  '022': -4.8122251597e-6,
  '023': 1.674630378e-8,
  '030': -8.5047933937e-4,
  '031': 3.7470777305e-5,
  '032': 4.9263106998e-6,
  '040': 5.8086069943e-4,
  '041': -1.7322218612e-5,
  '042': -1.7811974727e-6,
  '050': -2.1092370507e-4,
  '051': 3.0927427253e-6,
  '060': 3.1932457305e-5,
  '100': -1.5649734675e-5,
  '101': 1.8505765429e-5,
  '102': -1.1736386731e-6,
  '103': -3.6527006553e-7,
  '104': 3.1454099902e-7,
  '110': 3.5009599764e-5,
  '111': -9.5677088156e-6,
  '112': -5.5699154557e-6,
  '113': -2.7295696237e-7,
  '120': -4.3592678561e-5,
  '121': 1.1100834765e-5,
  '122': 5.4620748834e-6,
  '130': 3.4532461828e-5,
  '131': -9.8447117844e-6,
  '132': -1.3544185627e-6,
  '140': -1.1959409788e-5,
  '141': 2.590922526e-6,
  '150': 1.3864594581e-6,
  '200': 2.7762106484e-5,
  '201': -1.1716606853e-5,
  '202': 2.130502874e-6,
  '203': 2.8695905159e-7,
  '210': -3.7435842344e-5,
  '211': -2.3678308361e-7,
  '212': 3.913738708e-7,
  '220': 3.590782276e-5,
  '221': 2.9283346295e-6,
  '222': -6.5731104067e-7,
  '230': -1.8698584187e-5,
  '231': -4.88261392e-7,
  '240': 3.8595339244e-6,
  '300': -1.6521159259e-5,
  '301': 7.9279656173e-6,
  '302': -4.6132540037e-7,
  '310': 2.4141479483e-5,
  '311': -3.4558773655e-6,
  '312': 7.7618888092e-9,
  '320': -1.4353633048e-5,
  '321': 3.1655306078e-7,
  '330': 2.2863324556e-6,
  '400': 6.9111322702e-6,
  '401': -3.4102187482e-6,
  '402': -6.3352916514e-8,
  '410': -8.7595873154e-6,
  '411': 1.2956717783e-6,
  '420': 4.3703680598e-6,
  '500': -8.053961554e-7,
  '501': 5.0736766814e-7,
  '510': -3.30527589e-7,
  '600': 2.0543094268e-7,
};
const TERMS = Object.entries(V).map(([key, c]) => [Number(key[0]), Number(key[1]), Number(key[2]), c] as const);

/** The number of terms, for the step text and a test that none went missing. */
export const SPECVOL_TERMS = TERMS.length;

function inRange(sa: number, ct: number, p: number): void {
  check(Number.isFinite(sa) && sa >= 0 && sa <= 42.2, 'teosSalinity');
  check(Number.isFinite(ct) && ct >= -2.5 && ct <= 40, 'teosTemperature');
  check(Number.isFinite(p) && p >= 0 && p <= 10000, 'pressure');
}

/** Absolute salinity (g/kg) from practical salinity with the reference-composition ratio and no anomaly. */
export function referenceSalinity(sp: number): number {
  check(Number.isFinite(sp) && sp >= 0 && sp <= 42, 'salinity');
  return UPS * sp;
}

/** Specific volume (m³/kg) from the 75-term polynomial. */
export function specificVolume(sa: number, ct: number, p: number): number {
  inRange(sa, ct, p);
  const x = Math.sqrt(SFAC * sa + OFFSET);
  const y = ct / 40;
  const z = p / 1e4;
  let v = 0;
  for (const [i, j, k, c] of TERMS) v += c * y ** i * x ** j * z ** k;
  return v;
}

/** In-situ density (kg/m³) from the 75-term specific volume. */
export const teosDensity = (sa: number, ct: number, p: number): number => 1 / specificVolume(sa, ct, p);

/** Potential density anomaly σ₀ (kg/m³) referenced to the sea surface. */
export const sigma0 = (sa: number, ct: number): number => teosDensity(sa, ct, 0) - 1000;

/** Conservative temperature (°C) from potential temperature θ (°C, ITS-90, referenced to 0 dbar). */
export function conservativeTemperature(sa: number, pt: number): number {
  check(Number.isFinite(sa) && sa >= 0 && sa <= 42.2, 'teosSalinity');
  check(Number.isFinite(pt) && pt >= -12 && pt <= 40, 'teosTemperature');
  const x2 = SFAC * sa;
  const x = Math.sqrt(x2);
  const y = pt / 40;
  const pure =
    61.01362420681071 +
    y *
      (168776.46138048015 +
        y *
          (-2735.2785605119625 +
            y *
              (2574.2164453821433 +
                y *
                  (-1536.6644434977543 + y * (545.7340497931629 + (-50.91091728474331 - 18.30489878927802 * y) * y)))));
  const salty =
    268.5520265845071 +
    y *
      (-12019.028203559312 +
        y *
          (3734.858026725145 +
            y *
              (-2046.7671145057618 + y * (465.28655623826234 + (-0.6370820302376359 - 10.650848542359153 * y) * y)))) +
    x *
      (937.2099110620707 +
        y * (588.1802812170108 + y * (248.39476522971285 + (-3.871557904936333 - 2.6268019854268356 * y) * y)) +
        x *
          (-1687.914374187449 +
            x * (246.9598888781377 + x * (123.59576582457964 - 48.5891069025409 * x)) +
            y *
              (936.3206544460336 +
                y *
                  (-942.7827304544439 + y * (369.4389437509002 + (-33.83664947895248 - 9.987880382780322 * y) * y)))));
  return (pure + x2 * salty) / CP0;
}

/** Potential temperature (°C) from conservative temperature, by bisection on the monotonic Θ(θ). */
export function potentialFromConservative(sa: number, ct: number): number {
  let lo = -12;
  let hi = 40;
  check(ct >= conservativeTemperature(sa, lo) && ct <= conservativeTemperature(sa, hi), 'teosTemperature');
  for (let n = 0; n < 80; n++) {
    const mid = (lo + hi) / 2;
    if (conservativeTemperature(sa, mid) < ct) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const FREEZE = [
  0.017947064327968738, -6.076099099929818, 4.883198653547851, -11.88081601230542, 13.34658511480257,
  -8.722761043208607, 2.082038908808201, -7.389420998107497, -2.110913185058476, 0.2295491578006229,
  -0.9891538123307282, -0.08987150128406496, 0.3831132432071728, 1.054318231187074, 1.065556599652796,
  -0.7997496801694032, 0.3850133554097069, -2.078616693017569, 0.8756340772729538, -2.079022768390933,
  1.596435439942262, 0.1338002171109174, 1.242891021876471,
];

/**
 * The conservative temperature (°C) at which seawater freezes, from the TEOS-10 polynomial, with `air` the
 * fraction of saturation by dissolved air (0 air-free, 1 saturated).
 */
export function freezingConservative(sa: number, p: number, air = 0): number {
  check(Number.isFinite(sa) && sa >= 0 && sa <= 42.2, 'teosSalinity');
  check(Number.isFinite(p) && p >= 0 && p <= 10000, 'pressure');
  check(Number.isFinite(air) && air >= 0 && air <= 1, 'air');
  const c = FREEZE;
  const s = sa / 100;
  const x = Math.sqrt(s);
  const q = p / 1e4;
  const dry =
    c[0] +
    s * (c[1] + x * (c[2] + x * (c[3] + x * (c[4] + x * (c[5] + c[6] * x))))) +
    q * (c[7] + q * (c[8] + c[9] * q)) +
    s *
      q *
      (c[10] +
        q * (c[12] + q * (c[15] + c[21] * s)) +
        s * (c[13] + c[17] * q + c[19] * s) +
        x * (c[11] + q * (c[14] + c[18] * q) + s * (c[16] + c[20] * q + c[22] * s)));
  // Dissolved air lowers the freezing point by up to about 2.4 mK.
  const a = 0.502500117621 / SSO;
  const b = 0.05700064989972;
  return dry - air * 1e-3 * (2.4 - a * sa) * (1 + b * (1 - sa / SSO));
}

export interface TeosSample {
  readonly sa: number;
  readonly pt: number;
  readonly ct: number;
  readonly v: number;
  readonly rho: number;
  readonly sigma0: number;
  readonly ctFreeze: number;
  readonly ptFreeze: number;
}

/**
 * Every TEOS-10 property of one sample from practical salinity, in-situ temperature (°C, ITS-90), and sea
 * pressure (dbar). Potential temperature comes from the EOS-80 adiabatic lapse rate, which agrees with TEOS-10 to
 * about a millikelvin in the ocean.
 */
export function teosSample(sp: number, t90: number, p: number, air = 0): TeosSample {
  const sa = referenceSalinity(sp);
  const pt = potentialTemperature(sp, toT68(t90), p) / 1.00024;
  const ct = conservativeTemperature(sa, pt);
  const v = specificVolume(sa, ct, p);
  const ctFreeze = freezingConservative(sa, p, air);
  return {
    sa,
    pt,
    ct,
    v,
    rho: 1 / v,
    sigma0: sigma0(sa, ct),
    ctFreeze,
    ptFreeze: potentialFromConservative(sa, ctFreeze),
  };
}
