// Plasma and space physics at course level: the characteristic lengths, frequencies, and speeds of a plasma, sheaths,
// a planet's dipole field and drift periods, the magnetopause standoff, and the fusion triple product. All inputs
// are SI with temperatures in kelvin; the steps show temperatures in electronvolts, as plasma texts do.
import { C } from '../shared/constants';
import { auto, fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail, need, nonNegative, positive } from '../shared/errors';
import { fmt, prefixed, prefixedTex, tex } from '../shared/format';
import type { PlotSpec } from '../shared/plot';

export type PlasmaKey =
  | 'debye'
  | 'debyeNumber'
  | 'plasmaFreqE'
  | 'plasmaFreqI'
  | 'gyroFreqE'
  | 'gyroFreqI'
  | 'gyroRadiusE'
  | 'gyroRadiusI'
  | 'coulombLog'
  | 'collisionFreq'
  | 'meanFreePath'
  | 'alfven'
  | 'ionAcoustic'
  | 'beta'
  | 'magneticPressure'
  | 'bohm'
  | 'floating'
  | 'sheath'
  | 'fieldAt'
  | 'fieldLine'
  | 'invariantLatitude'
  | 'driftPeriod'
  | 'standoff'
  | 'bowShock'
  | 'tripleProduct'
  | 'lawsonRatio'
  | 'dynamicPressure'
  | 'dipolePlot'
  | 'xRadii'
  | 'zRadii';

export const PLASMA_SOURCES = [
  'NRL Plasma Formulary (US Naval Research Laboratory, public domain): Coulomb logarithm and collision rate.',
] as const;

const eV = (kelvin: number) => (C.kB * kelvin) / C.e;
const TWO_PI = 2 * Math.PI;

/** Debye length √(ε₀ k T_e / (n e²)), in meters. */
export function debyeLength(ne: number, te: number): number {
  return Math.sqrt((C.eps0 * C.kB * positive(te, 'electronTemperature')) / (positive(ne, 'density') * C.e ** 2));
}

/** Plasma frequency (1/2π) √(n Z² e² / (ε₀ m)), in hertz. */
export function plasmaFrequency(n: number, mass: number, z = 1): number {
  return Math.sqrt((positive(n, 'density') * (z * C.e) ** 2) / (C.eps0 * positive(mass, 'mass'))) / TWO_PI;
}

/** Gyrofrequency |q| B / (2π m), in hertz. */
export function gyroFrequency(b: number, mass: number, z = 1): number {
  return (Math.abs(z) * C.e * nonNegative(b, 'field')) / (TWO_PI * positive(mass, 'mass'));
}

/** Alfvén speed B / √(μ₀ ρ) for an ion density and ion mass, in m/s. */
export function alfvenSpeed(b: number, ni: number, mi: number): number {
  return nonNegative(b, 'field') / Math.sqrt(C.mu0 * positive(ni, 'density') * positive(mi, 'mass'));
}

/** The NRL electron-ion Coulomb logarithm (densities in cm⁻³ and temperatures in eV inside the formula). */
export function coulombLog(ne: number, te: number, z = 1): number {
  const n = positive(ne, 'density') / 1e6;
  const t = eV(positive(te, 'electronTemperature'));
  return t < 10 * z * z ? 23 - Math.log(Math.sqrt(n) * z * t ** -1.5) : 24 - Math.log(Math.sqrt(n) / t);
}

export interface PlasmaInput {
  ne: number;
  te: number;
  ti: number;
  b: number;
  /** Ion mass in kilograms. */
  mi: number;
  z: number;
}

function frequencies(p: PlasmaInput): { items: Item<PlasmaKey>[]; steps: Step<PlasmaKey>[] } {
  const ni = p.ne / p.z;
  const fpe = plasmaFrequency(p.ne, C.me);
  const fpi = plasmaFrequency(ni, p.mi, p.z);
  const fce = gyroFrequency(p.b, C.me);
  const fci = gyroFrequency(p.b, p.mi, p.z);
  const vte = Math.sqrt((C.kB * p.te) / C.me);
  const vti = Math.sqrt((C.kB * p.ti) / p.mi);
  const rce = p.b > 0 ? vte / (TWO_PI * fce) : Infinity;
  const rci = p.b > 0 ? vti / (TWO_PI * fci) : Infinity;
  return {
    items: [
      auto('plasmaFreqE', fpe, 'Hz'),
      auto('plasmaFreqI', fpi, 'Hz'),
      auto('gyroFreqE', fce, 'Hz'),
      auto('gyroFreqI', fci, 'Hz'),
      auto('gyroRadiusE', rce, 'm'),
      auto('gyroRadiusI', rci, 'm'),
    ],
    steps: [
      {
        key: 'plasmaFreqE',
        text: `f_pe = (1/2π) √(n_e e² / (ε₀ mₑ)) = ${prefixed(fpe, 'Hz')}`,
        tex: `f_{pe} = \\frac{1}{2\\pi}\\sqrt{\\frac{n_e e^2}{\\varepsilon_0 m_e}} = ${prefixedTex(fpe, 'Hz')}`,
      },
      { key: 'plasmaFreqI', text: `f_pi = (1/2π) √(n_i Z² e² / (ε₀ m_i)) = ${prefixed(fpi, 'Hz')}` },
      {
        key: 'gyroFreqE',
        text: `f_ce = e B / (2π mₑ) = ${prefixed(fce, 'Hz')}`,
        tex: `f_{ce} = \\frac{eB}{2\\pi m_e} = ${prefixedTex(fce, 'Hz')}`,
      },
      { key: 'gyroFreqI', text: `f_ci = Z e B / (2π m_i) = ${prefixed(fci, 'Hz')}` },
      {
        key: 'gyroRadiusE',
        text: `r_e = v_te / ω_ce, v_te = √(k T_e / mₑ) = ${prefixed(vte, 'm/s')}, so r_e = ${prefixed(rce, 'm')}`,
      },
      {
        key: 'gyroRadiusI',
        text: `r_i = v_ti / ω_ci, v_ti = √(k T_i / m_i) = ${prefixed(vti, 'm/s')}, so r_i = ${prefixed(rci, 'm')}`,
      },
    ],
  };
}

function collisions(p: PlasmaInput): { items: Item<PlasmaKey>[]; steps: Step<PlasmaKey>[] } {
  const lnL = coulombLog(p.ne, p.te, p.z);
  const teV = eV(p.te);
  const nu = 2.91e-6 * (p.ne / 1e6) * lnL * teV ** -1.5;
  const vte = Math.sqrt((C.kB * p.te) / C.me);
  const mfp = vte / nu;
  const regime = teV < 10 * p.z * p.z ? `23 − ln(n_e^½ Z T_e^(−3/2))` : `24 − ln(n_e^½ / T_e)`;
  return {
    items: [fixed('coulombLog', lnL, '', 4), auto('collisionFreq', nu, 'Hz'), auto('meanFreePath', mfp, 'm')],
    steps: [
      {
        key: 'coulombLog',
        text: `ln Λ = ${regime} with n_e in cm⁻³ and T_e = ${fmt(teV)} eV, so ln Λ = ${fmt(lnL, 4)}`,
      },
      { key: 'collisionFreq', text: `ν_e = 2.91×10⁻⁶ n_e ln Λ T_e^(−3/2) s⁻¹ = ${prefixed(nu, 'Hz')}` },
      { key: 'meanFreePath', text: `λ_mfp = v_te / ν_e = ${prefixed(mfp, 'm')}` },
    ],
  };
}

/** The characteristic parameters of a plasma. */
export function plasmaParameters(input: PlasmaInput): Calc<PlasmaKey> {
  const p = {
    ...input,
    ne: positive(input.ne, 'density'),
    te: positive(input.te, 'electronTemperature'),
    ti: nonNegative(input.ti, 'ionTemperature'),
    b: nonNegative(input.b, 'field'),
    mi: positive(input.mi, 'ionMass'),
    z: positive(input.z, 'charge'),
  };
  const ld = debyeLength(p.ne, p.te);
  const nd = (4 / 3) * Math.PI * p.ne * ld ** 3;
  const f = frequencies(p);
  const c = collisions(p);
  const ni = p.ne / p.z;
  const va = p.b > 0 ? alfvenSpeed(p.b, ni, p.mi) : 0;
  const cs = Math.sqrt((p.z * C.kB * p.te + 3 * C.kB * p.ti) / p.mi);
  const pb = p.b ** 2 / (2 * C.mu0);
  const beta = pb > 0 ? (p.ne * C.kB * p.te + ni * C.kB * p.ti) / pb : Infinity;
  return {
    items: [
      auto('debye', ld, 'm'),
      fixed('debyeNumber', nd, ''),
      ...f.items,
      ...c.items,
      auto('alfven', va, 'm/s'),
      auto('ionAcoustic', cs, 'm/s'),
      fixed('beta', beta, ''),
      auto('magneticPressure', pb, 'Pa'),
    ],
    steps: [
      {
        key: 'debye',
        text:
          `λ_D = √(ε₀ k T_e / (n_e e²)) = √(${fmt(C.eps0)} × ${fmt(eV(p.te))} eV / (${fmt(p.ne)} m⁻³ × e)) = ` +
          `${prefixed(ld, 'm')}`,
        tex: `\\lambda_D = \\sqrt{\\frac{\\varepsilon_0 k T_e}{n_e e^2}} = ${prefixedTex(ld, 'm')}`,
      },
      { key: 'debyeNumber', text: `N_D = (4π/3) n_e λ_D³ = ${fmt(nd)}` },
      ...f.steps,
      ...c.steps,
      {
        key: 'alfven',
        text: `v_A = B / √(μ₀ n_i m_i) = ${prefixed(va, 'm/s')}`,
        tex: `v_A = \\frac{B}{\\sqrt{\\mu_0 n_i m_i}} = ${prefixedTex(va, 'm/s')}`,
      },
      { key: 'ionAcoustic', text: `c_s = √((Z k T_e + 3 k T_i) / m_i) = ${prefixed(cs, 'm/s')}` },
      { key: 'magneticPressure', text: `p_B = B² / (2μ₀) = ${prefixed(pb, 'Pa')}` },
      { key: 'beta', text: `β = (n_e k T_e + n_i k T_i) / p_B = ${fmt(beta)}` },
    ],
  };
}

/** Bohm speed, floating potential, and Child-law sheath thickness for a plasma wall. */
export function sheath(ne: number, te: number, mi: number, voltage?: number): Calc<PlasmaKey> {
  const ld = debyeLength(ne, te);
  const t = eV(te);
  const ub = Math.sqrt((C.kB * te) / positive(mi, 'ionMass'));
  const vf = (t / 2) * Math.log(mi / (TWO_PI * C.me));
  const v0 = voltage === undefined ? vf : positive(voltage, 'sheathVoltage');
  const s = (Math.SQRT2 / 3) * ld * ((2 * v0) / t) ** 0.75;
  return {
    items: [auto('bohm', ub, 'm/s'), fixed('floating', vf, 'V'), auto('sheath', s, 'm'), auto('debye', ld, 'm')],
    steps: [
      {
        key: 'bohm',
        text: `u_B = √(k T_e / m_i) = ${prefixed(ub, 'm/s')}`,
        tex: `u_B = \\sqrt{\\frac{kT_e}{m_i}} = ${prefixedTex(ub, 'm/s')}`,
      },
      { key: 'floating', text: `V_f = (T_e / 2e) ln(m_i / (2π mₑ)) = ${fmt(vf)} V` },
      {
        key: 'sheath',
        text: `s = (√2 / 3) λ_D (2 V₀ / T_e)^(3/4) with V₀ = ${fmt(v0)} V, so s = ${prefixed(s, 'm')}`,
        tex: `s = \\frac{\\sqrt{2}}{3}\\lambda_D\\left(\\frac{2V_0}{T_e}\\right)^{3/4} = ${prefixedTex(s, 'm')}`,
      },
    ],
  };
}

/** Kinetic energy to the drift's p v / 2, which equals the energy for slow particles. */
function driftEnergy(kinetic: number, mass: number): number {
  const rest = mass * C.c ** 2;
  return (kinetic * (kinetic + 2 * rest)) / (2 * (kinetic + rest));
}

export interface DipoleInput {
  /** The equatorial surface field, in tesla. */
  b0: number;
  /** The planet's radius, in meters. */
  radius: number;
  l: number;
  /** Magnetic latitude, in radians. */
  latitude: number;
  /** Kinetic energy, in joules. */
  energy: number;
  mass: number;
  z: number;
}

function fieldLines(l: number): PlotSpec<PlasmaKey> {
  const series = [...new Set([2, 4, 6, l])]
    .sort((a, b) => a - b)
    .map((shell, i) => {
      const edge = Math.acos(Math.sqrt(1 / shell));
      const pts: [number, number][] = [];
      for (let k = 0; k <= 80; k++) {
        const lat = -edge + (2 * edge * k) / 80;
        const r = shell * Math.cos(lat) ** 2;
        pts.push([r * Math.cos(lat), r * Math.sin(lat)]);
      }
      return {
        points: pts,
        kind: shell === l ? ('line' as const) : ('dash' as const),
        label: `L = ${fmt(shell, 3)}`,
        tone: i,
      };
    });
  const planet: [number, number][] = Array.from({ length: 61 }, (_, k) => {
    const a = (Math.PI * k) / 60 - Math.PI / 2;
    return [Math.cos(a), Math.sin(a)];
  });
  return {
    title: 'dipolePlot',
    xLabel: 'xRadii',
    yLabel: 'zRadii',
    series: [...series, { points: planet, kind: 'line', tone: 3 }],
    x: [0, Math.max(6, l) * 1.05],
    y: [-Math.max(6, l) * 0.6, Math.max(6, l) * 0.6],
  };
}

/** A dipole field: field strength on a field line, the line's shape, invariant latitude, and the drift period. */
export function dipole(input: DipoleInput): Calc<PlasmaKey> {
  const b0 = positive(input.b0, 'field');
  const l = positive(input.l, 'lShell');
  if (l < 1) need('atLeastOne', 'lShell');
  const lat = input.latitude;
  const r = l * Math.cos(lat) ** 2;
  if (r < 1 - 1e-12) fail('belowSurface');
  const b = (b0 / r ** 3) * Math.sqrt(1 + 3 * Math.sin(lat) ** 2);
  const inv = Math.acos(Math.sqrt(1 / l));
  const w = driftEnergy(positive(input.energy, 'energy'), positive(input.mass, 'mass'));
  const period = (TWO_PI * Math.abs(input.z) * C.e * b0 * positive(input.radius, 'radius') ** 2) / (3 * l * w);
  return {
    items: [
      auto('fieldAt', b, 'T'),
      fixed('fieldLine', r, ''),
      fixed('invariantLatitude', (inv * 180) / Math.PI, '°'),
      auto('driftPeriod', period, 's'),
    ],
    steps: [
      { key: 'fieldLine', text: `r = L cos² λ = ${fmt(l)} × cos²(${fmt((lat * 180) / Math.PI)}°) = ${fmt(r)} R` },
      {
        key: 'fieldAt',
        text: `B = B₀ (R/r)³ √(1 + 3 sin² λ) = ${prefixed(b, 'T')}`,
        tex: `B = B_0\\left(\\frac{R}{r}\\right)^3\\sqrt{1 + 3\\sin^2\\lambda} = ${prefixedTex(b, 'T')}`,
      },
      { key: 'invariantLatitude', text: `Λ = arccos √(1/L) = ${fmt((inv * 180) / Math.PI)}°` },
      {
        key: 'driftPeriod',
        text:
          `T_d = 2π q B₀ R² / (3 L W) with W = p v / 2 = ${fmt(w / C.e)} eV, ` +
          `so T_d = ${prefixed(period, 's')} (${fmt(period / 60, 4)} min)`,
        tex: `T_d = \\frac{2\\pi q B_0 R^2}{3 L W} = ${tex(period / 60, 4)}\\,\\mathrm{min}`,
      },
    ],
    plot: fieldLines(l),
  };
}

/** Magnetopause standoff by pressure balance with the factor-2 compression, and the bow-shock rule of thumb. */
export function magnetopause(b0: number, n: number, v: number, mi: number): Calc<PlasmaKey> {
  const rho = positive(n, 'density') * positive(mi, 'ionMass');
  const dyn = rho * positive(v, 'speed') ** 2;
  const ratio = (2 * positive(b0, 'field') ** 2) / (C.mu0 * dyn);
  const r = ratio ** (1 / 6);
  const shock = r * (1 + 1.1 / 4);
  return {
    items: [fixed('standoff', r, '', 4), fixed('bowShock', shock, '', 3), auto('dynamicPressure', dyn, 'Pa')],
    steps: [
      { key: 'dynamicPressure', text: `ρ v² = ${fmt(rho)} kg/m³ × (${fmt(v)} m/s)² = ${prefixed(dyn, 'Pa')}` },
      {
        key: 'standoff',
        text: `r_mp / R = (2 B₀² / (μ₀ ρ v²))^(1/6) = (${fmt(ratio)})^(1/6) = ${fmt(r, 4)}`,
        tex: `\\frac{r_{mp}}{R} = \\left(\\frac{2B_0^2}{\\mu_0\\rho v^2}\\right)^{1/6} = ${tex(r, 4)}`,
      },
      { key: 'bowShock', text: `r_bs ≈ r_mp (1 + 1.1 / 4) = ${fmt(shock, 3)} R (strong shock, density jump 4)` },
    ],
  };
}

/** The D-T ignition triple product used for comparison, in keV s m⁻³ (about, near 15 keV). */
export const IGNITION = 3e21;

/** The fusion triple product n T τ_E against the D-T ignition value. */
export function lawson(n: number, t: number, tau: number): Calc<PlasmaKey> {
  const keV = eV(positive(t, 'temperature')) / 1e3;
  const product = positive(n, 'density') * keV * positive(tau, 'confinement');
  const ratio = product / IGNITION;
  return {
    items: [fixed('tripleProduct', product, 'keV s m⁻³'), fixed('lawsonRatio', ratio, '', 3)],
    steps: [
      {
        key: 'tripleProduct',
        text: `n T τ_E = ${fmt(n)} m⁻³ × ${fmt(keV)} keV × ${fmt(tau)} s = ${fmt(product)} keV s m⁻³`,
        tex: `nT\\tau_E = ${tex(product)}\\,\\mathrm{keV\\,s\\,m^{-3}}`,
      },
      { key: 'lawsonRatio', text: `${fmt(product)} / ${fmt(IGNITION)} = ${fmt(ratio, 3)}` },
    ],
  };
}
