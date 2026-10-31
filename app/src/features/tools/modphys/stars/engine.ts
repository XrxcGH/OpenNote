// Stars, light, and exoplanets at course level. Inputs are SI; magnitudes are plain numbers. The solar values are
// the IAU 2015 nominal ones, and the habitable-zone coefficients are typed from the published fit named in SOURCES.
import { ASTRO, C, MASS_SUN } from '../shared/constants';
import { auto, fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail, fraction, nonNegative, positive } from '../shared/errors';
import { fmt, prefixed, prefixedTex, tex } from '../shared/format';
import type { PlotSpec } from '../shared/plot';

export type StarKey =
  | 'distance'
  | 'distanceLy'
  | 'modulus'
  | 'absolute'
  | 'deltaMag'
  | 'fluxRatio'
  | 'bolometric'
  | 'luminosity'
  | 'luminositySun'
  | 'flux'
  | 'wien'
  | 'totalFlux'
  | 'bandFraction'
  | 'peakRadiance'
  | 'mass'
  | 'lifetime'
  | 'sahaRatio'
  | 'ionizedFraction'
  | 'boltzmannRatio'
  | 'levelTwoFraction'
  | 'schwarzschild'
  | 'redshift'
  | 'eddington'
  | 'escape'
  | 'jeansMass'
  | 'jeansLength'
  | 'freeFall'
  | 'depth'
  | 'semiMajor'
  | 'duration'
  | 'semiAmplitude'
  | 'massFunction'
  | 'equilibrium'
  | 'hzRecentVenus'
  | 'hzRunaway'
  | 'hzMoist'
  | 'hzMaximum'
  | 'hzEarlyMars'
  | 'planckPlot'
  | 'hrPlot'
  | 'rvPlot'
  | 'wavelengthNm'
  | 'radiance'
  | 'temperatureK'
  | 'luminosityAxis'
  | 'timeDays'
  | 'velocity';

export const STAR_SOURCES = [
  'Kopparapu et al. (2013), ApJ 765, 131, with the erratum ApJ 770, 82 (arXiv:1301.6674v2 Table 3): habitable-zone coefficients.',
  'IAU 2015 Resolution B2: absolute bolometric magnitude of the Sun, 4.74.',
  'NIST Atomic Spectra Database: hydrogen ionization energy, 13.598434 eV.',
] as const;

/** The hydrogen ionization energy in eV (NIST). */
export const CHI_H = 13.598434;
/** The Sun's absolute bolometric magnitude (IAU 2015 B2). */
export const MBOL_SUN = 4.74;
/** Wien's displacement constant hc / (x k), with x the root of x = 5(1 − e^−x). */
export const WIEN_B = (C.h * C.c) / (4.965114231744276 * C.kB);
/** The Thomson cross-section (8π/3) r_e², with r_e = α² a₀. */
export const SIGMA_T = ((8 * Math.PI) / 3) * (C.alpha ** 2 * C.a0) ** 2;

const pc = (meters: number) => meters / ASTRO.pc;

/** Distance from apparent and absolute magnitude, with extinction: m − M = 5 log10(d / 10 pc) + A. */
export function distanceFromMagnitudes(m: number, absolute: number, extinction = 0): Calc<StarKey> {
  const modulus = m - absolute;
  const d = 10 ** ((modulus - extinction) / 5 + 1);
  return {
    items: [
      fixed('distance', d, 'pc', 6),
      fixed('distanceLy', (d * ASTRO.pc) / ASTRO.ly, 'ly', 6),
      fixed('modulus', modulus, 'mag'),
    ],
    steps: [
      {
        key: 'distance',
        text:
          `d = 10^((m − M − A)/5 + 1) pc = 10^((${fmt(m)} − ${fmt(absolute)} − ${fmt(extinction)})/5 + 1) = ` +
          `${fmt(d, 6)} pc`,
        tex: `d = 10^{(m - M - A)/5 + 1}\\,\\mathrm{pc} = ${tex(d, 6)}\\,\\mathrm{pc}`,
      },
    ],
  };
}

/** Distance from a parallax in arcseconds, with the absolute magnitude when the apparent one is known. */
export function distanceFromParallax(parallax: number, m?: number): Calc<StarKey> {
  const d = 1 / positive(parallax, 'parallax');
  const items: Item<StarKey>[] = [
    fixed('distance', d, 'pc', 6),
    fixed('distanceLy', (d * ASTRO.pc) / ASTRO.ly, 'ly', 6),
  ];
  const steps: Step<StarKey>[] = [
    {
      key: 'distance',
      text: `d = 1 / p = 1 / ${fmt(parallax)}″ = ${fmt(d, 6)} pc`,
      tex: `d = \\frac{1}{p} = ${tex(d, 6)}\\,\\mathrm{pc}`,
    },
  ];
  if (m !== undefined) {
    const abs = m - 5 * Math.log10(d / 10);
    items.push(fixed('absolute', abs, 'mag'));
    steps.push({ key: 'absolute', text: `M = m − 5 log10(d / 10 pc) = ${fmt(abs)}` });
  }
  return { items, steps };
}

/** The flux ratio of two magnitudes; for B and V it is the color index B − V. */
export function fluxRatio(m1: number, m2: number): Calc<StarKey> {
  const ratio = 10 ** (-0.4 * (m1 - m2));
  return {
    items: [fixed('fluxRatio', ratio, ''), fixed('deltaMag', m1 - m2, 'mag')],
    steps: [
      { key: 'deltaMag', text: `m₁ − m₂ = ${fmt(m1)} − ${fmt(m2)} = ${fmt(m1 - m2)}` },
      {
        key: 'fluxRatio',
        text: `F₁ / F₂ = 10^(−0.4 (m₁ − m₂)) = ${fmt(ratio)}`,
        tex: `\\frac{F_1}{F_2} = 10^{-0.4(m_1 - m_2)} = ${tex(ratio)}`,
      },
    ],
  };
}

/** Luminosity from an absolute visual magnitude and a bolometric correction the student supplies. */
export function bolometric(absoluteV: number, correction: number): Calc<StarKey> {
  const mbol = absoluteV + correction;
  const lsun = 10 ** (-0.4 * (mbol - MBOL_SUN));
  return {
    items: [
      fixed('luminositySun', lsun, 'L☉'),
      auto('luminosity', lsun * ASTRO.lSun, 'W'),
      fixed('bolometric', mbol, 'mag'),
    ],
    steps: [
      { key: 'bolometric', text: `M_bol = M_V + BC = ${fmt(absoluteV)} + ${fmt(correction)} = ${fmt(mbol)}` },
      {
        key: 'luminositySun',
        text: `L / L☉ = 10^(−0.4 (M_bol − ${MBOL_SUN})) = ${fmt(lsun)}`,
        tex: `\\frac{L}{L_\\odot} = 10^{-0.4(M_{bol} - ${MBOL_SUN})} = ${tex(lsun)}`,
      },
    ],
  };
}

/** Luminosity 4πR²σT⁴ and, when a distance is given, the flux there. */
export function luminosity(radius: number, temperature: number, distance?: number): Calc<StarKey> {
  const l = 4 * Math.PI * positive(radius, 'radius') ** 2 * C.sigma * positive(temperature, 'temperature') ** 4;
  const items: Item<StarKey>[] = [auto('luminosity', l, 'W'), fixed('luminositySun', l / ASTRO.lSun, 'L☉')];
  const steps: Step<StarKey>[] = [
    {
      key: 'luminosity',
      text: `L = 4π R² σ T⁴ = 4π × (${fmt(radius)} m)² × ${fmt(C.sigma)} × (${fmt(temperature)} K)⁴ = ${fmt(l)} W`,
      tex: `L = 4\\pi R^2 \\sigma T^4 = ${tex(l)}\\,\\mathrm{W}`,
    },
    { key: 'luminositySun', text: `L / L☉ = ${fmt(l)} / ${fmt(ASTRO.lSun)} = ${fmt(l / ASTRO.lSun)}` },
  ];
  if (distance !== undefined) {
    const flux = l / (4 * Math.PI * positive(distance, 'distance') ** 2);
    items.push(auto('flux', flux, 'W/m²'));
    steps.push({ key: 'flux', text: `F = L / (4π d²) = ${prefixed(flux, 'W/m²')}` });
  }
  return { items, steps };
}

/** Planck's spectral radiance per wavelength, in W sr⁻¹ m⁻³. */
export function planck(lambda: number, temperature: number): number {
  const x = (C.h * C.c) / (lambda * C.kB * temperature);
  return (2 * C.h * C.c ** 2) / lambda ** 5 / Math.expm1(x);
}

/** The fraction of blackbody power at wavelengths below λ, by the exact series in x = hc / (λkT). */
export function fractionBelow(lambda: number, temperature: number): number {
  if (lambda <= 0) return 0;
  const x = (C.h * C.c) / (lambda * C.kB * temperature);
  let sum = 0;
  for (let n = 1; n <= 200000; n++) {
    const term = (Math.exp(-n * x) / n) * (x ** 3 + (3 * x ** 2) / n + (6 * x) / n ** 2 + 6 / n ** 3);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return (15 / Math.PI ** 4) * sum;
}

function planckPlot(temperature: number, lo: number, hi: number): PlotSpec<StarKey> {
  const peak = WIEN_B / temperature;
  const top = Math.max(peak * 5, hi * 1.2);
  const curve: [number, number][] = [];
  for (let k = 1; k <= 240; k++) {
    const lam = (top * k) / 240;
    curve.push([lam * 1e9, planck(lam, temperature)]);
  }
  const band = curve.filter(([nm]) => nm >= lo * 1e9 && nm <= hi * 1e9);
  return {
    title: 'planckPlot',
    xLabel: 'wavelengthNm',
    yLabel: 'radiance',
    series: [
      { points: curve, kind: 'line', label: `${fmt(temperature)} K` },
      { points: band, kind: 'sticks', tone: 1 },
    ],
  };
}

/** Wien peak, total flux, and the fraction of the power in a band, with the Planck curve. */
export function blackbody(temperature: number, lo: number, hi: number): Calc<StarKey> {
  const t = positive(temperature, 'temperature');
  if (!(positive(hi, 'wavelength') > nonNegative(lo, 'wavelength'))) fail('badBand');
  const peak = WIEN_B / t;
  const share = fractionBelow(hi, t) - fractionBelow(lo, t);
  return {
    items: [
      auto('wien', peak, 'm', 6),
      auto('totalFlux', C.sigma * t ** 4, 'W/m²'),
      fixed('bandFraction', share, ''),
      fixed('peakRadiance', planck(peak, t), 'W sr⁻¹ m⁻³'),
    ],
    steps: [
      {
        key: 'wien',
        text: `λ_max = b / T = ${fmt(WIEN_B, 7)} m K / ${fmt(t)} K = ${prefixed(peak, 'm', 6)}`,
        tex: `\\lambda_{max} = \\frac{b}{T} = ${prefixedTex(peak, 'm', 6)}`,
      },
      { key: 'totalFlux', text: `F = σ T⁴ = ${prefixed(C.sigma * t ** 4, 'W/m²')}` },
      {
        key: 'bandFraction',
        text: `(15/π⁴) Σ e^(−nx)/n (x³ + 3x²/n + 6x/n² + 6/n³), x = hc/(λkT), between the band edges: ${fmt(share)}`,
      },
    ],
    plot: planckPlot(t, lo, hi),
  };
}

export interface StarRow {
  name: string;
  temperature: number;
  /** Luminosity in solar units. */
  luminosity: number;
}

/** Reads lines of "name, temperature K, luminosity L☉" (the name is optional). */
export function parseStars(text: string): StarRow[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const split = (by: RegExp) =>
        line
          .split(by)
          .map((part) => part.trim())
          .filter(Boolean);
      const good = (list: string[]) => list.length >= 2 && list.slice(-2).every((part) => Number(part) > 0);
      let parts = split(/[,;\t]+|\s{2,}/);
      // A row typed with single spaces, such as "9940 25.4" or "Sirius A 9940 25.4": the last two words are numbers.
      if (!good(parts) && !/[,;\t]/.test(line)) parts = split(/\s+/);
      const numbers = parts.slice(-2).map(Number);
      if (numbers.length < 2 || numbers.some((n) => !Number.isFinite(n) || n <= 0)) fail('badList');
      const name = parts.length > 2 ? parts.slice(0, -2).join(' ') : `${index + 1}`;
      return { name, temperature: numbers[0]!, luminosity: numbers[1]! };
    });
  if (rows.length === 0) fail('badList');
  return rows;
}

/** An HR diagram of typed stars, with main-sequence mass and lifetime from L ∝ M^3.5 and t ∝ M^−2.5. */
export function hrDiagram(stars: readonly StarRow[]): Calc<StarKey> {
  const items: Item<StarKey>[] = [];
  const steps: Step<StarKey>[] = [];
  for (const star of stars) {
    const mass = star.luminosity ** (1 / 3.5);
    const life = 10 * mass ** -2.5;
    items.push({ key: 'mass', value: mass, unit: 'M☉', fixed: true, text: `${star.name}: ${fmt(mass, 3)} M☉` });
    items.push({ key: 'lifetime', value: life, unit: 'Gyr', fixed: true, text: `${star.name}: ${fmt(life, 3)} Gyr` });
    steps.push({
      key: 'mass',
      text: `${star.name}: M ≈ (L/L☉)^(1/3.5) = ${fmt(mass, 3)} M☉, t ≈ 10 Gyr × M^−2.5 = ${fmt(life, 3)} Gyr`,
    });
  }
  const ms: [number, number][] = [];
  for (let k = 0; k <= 40; k++) {
    const mass = 0.1 * 600 ** (k / 40);
    const l = mass ** 3.5;
    // A rough main-sequence temperature from L = 4πR²σT⁴ with R ∝ M^0.8.
    ms.push([ASTRO.tSun * (l / mass ** 1.6) ** 0.25, l]);
  }
  return {
    items,
    steps,
    plot: {
      title: 'hrPlot',
      xLabel: 'temperatureK',
      yLabel: 'luminosityAxis',
      logX: true,
      logY: true,
      reverseX: true,
      series: [
        { points: ms, kind: 'dash', tone: 2, label: 'L ∝ M^3.5' },
        { points: stars.map((s) => [s.temperature, s.luminosity] as [number, number]), kind: 'dots', tone: 1 },
      ],
    },
  };
}

/** Saha ionization of hydrogen and Boltzmann excitation of its n = 2 level. */
export function saha(temperature: number, ne: number, chi = CHI_H, gRatio = 1): Calc<StarKey> {
  const t = positive(temperature, 'temperature');
  const kT = C.kB * t;
  const thermal = ((2 * Math.PI * C.me * kT) / C.h ** 2) ** 1.5;
  const r =
    (thermal * positive(gRatio, 'weights') * Math.exp((-positive(chi, 'energy') * C.e) / kT)) / positive(ne, 'density');
  const boltz = 4 * Math.exp((-CHI_H * 0.75 * C.e) / kT);
  const ionized = r / (1 + r);
  const levelTwo = (boltz / (1 + boltz)) * (1 - ionized);
  return {
    items: [
      fixed('sahaRatio', r, ''),
      fixed('ionizedFraction', ionized, ''),
      fixed('boltzmannRatio', boltz, ''),
      fixed('levelTwoFraction', levelTwo, ''),
    ],
    steps: [
      {
        key: 'sahaRatio',
        text:
          `n_II / n_I = (2π mₑ k T / h²)^(3/2) (2 g_II / g_I) e^(−χ/kT) / n_e = ${fmt(thermal)} × ${fmt(gRatio)} ` +
          `× e^(−${fmt(chi)} eV / ${fmt(kT / C.e)} eV) / ${fmt(ne)} = ${fmt(r)}`,
        tex:
          `\\frac{n_{II}}{n_I} = \\left(\\frac{2\\pi m_e ` +
          `kT}{h^2}\\right)^{3/2}\\frac{2g_{II}}{g_I}\\frac{e^{-\\chi/kT}}{n_e} = ${tex(r)}`,
      },
      { key: 'ionizedFraction', text: `n_II / (n_I + n_II) = ${fmt(ionized)}` },
      {
        key: 'boltzmannRatio',
        text:
          `N₂ / N₁ = (g₂ / g₁) e^(−(E₂ − E₁)/kT) = (8/2) e^(−${fmt(CHI_H * 0.75)} eV / ${fmt(kT / C.e)} eV) = ` +
          `${fmt(boltz)}`,
      },
      { key: 'levelTwoFraction', text: `N₂ / N_total = (N₂ / (N₁ + N₂)) × (1 − ${fmt(ionized)}) = ${fmt(levelTwo)}` },
    ],
  };
}

/** Schwarzschild radius, gravitational redshift at a radius, Eddington luminosity, and escape speed. */
export function compact(mass: number, radius: number): Calc<StarKey> {
  const m = positive(mass, 'mass');
  const rs = (2 * C.G * m) / C.c ** 2;
  const r = positive(radius, 'radius');
  const z = r > rs ? 1 / Math.sqrt(1 - rs / r) - 1 : Infinity;
  const edd = (4 * Math.PI * C.G * m * C.mp * C.c) / SIGMA_T;
  const esc = Math.sqrt((2 * C.G * m) / r);
  return {
    items: [
      auto('schwarzschild', rs, 'm'),
      fixed('redshift', z, ''),
      auto('eddington', edd, 'W'),
      auto('escape', esc, 'm/s'),
    ],
    steps: [
      {
        key: 'schwarzschild',
        text: `r_s = 2GM / c² = ${prefixed(rs, 'm')}`,
        tex: `r_s = \\frac{2GM}{c^2} = ${prefixedTex(rs, 'm')}`,
      },
      { key: 'redshift', text: `z = 1/√(1 − r_s/r) − 1 = ${fmt(z)}` },
      { key: 'eddington', text: `L_Edd = 4π G M mₚ c / σ_T = ${fmt(edd)} W (${fmt(edd / ASTRO.lSun)} L☉)` },
      { key: 'escape', text: `v_esc = √(2GM / r) = ${prefixed(esc, 'm/s')}` },
    ],
  };
}

/** Jeans mass and length and the free-fall time of a uniform cloud of mean molecular weight μ. */
export function jeans(temperature: number, n: number, mu: number): Calc<StarKey> {
  const mH = 1.00782503223 * C.u;
  const t = positive(temperature, 'temperature');
  const rho = positive(n, 'density') * positive(mu, 'meanMass') * mH;
  const mj = ((5 * C.kB * t) / (C.G * mu * mH)) ** 1.5 * (3 / (4 * Math.PI * rho)) ** 0.5;
  const lj = Math.sqrt((15 * C.kB * t) / (4 * Math.PI * C.G * mu * mH * rho));
  const tff = Math.sqrt((3 * Math.PI) / (32 * C.G * rho));
  return {
    items: [
      fixed('jeansMass', mj / MASS_SUN, 'M☉'),
      fixed('jeansLength', pc(lj), 'pc'),
      fixed('freeFall', tff / ASTRO.year, 'yr'),
    ],
    steps: [
      {
        key: 'jeansMass',
        text: `M_J = (5kT / (G μ m_H))^(3/2) (3 / (4πρ))^(1/2), ρ = ${fmt(rho)} kg/m³, so M_J = ${fmt(mj)} kg`,
        tex:
          `M_J = \\left(\\frac{5kT}{G\\mu m_H}\\right)^{3/2}\\left(\\frac{3}{4\\pi\\rho}\\right)^{1/2} = ` +
          `${tex(mj / MASS_SUN)}\\,M_\\odot`,
      },
      { key: 'jeansLength', text: `λ_J = √(15kT / (4π G μ m_H ρ)) = ${fmt(lj)} m` },
      { key: 'freeFall', text: `t_ff = √(3π / (32 G ρ)) = ${fmt(tff)} s` },
    ],
  };
}

/** Transit depth (Rp/R*)² and the full duration for an impact parameter b on a circular orbit. */
export function transit(rp: number, rs: number, period: number, starMass: number, b = 0): Calc<StarKey> {
  const k = positive(rp, 'planetRadius') / positive(rs, 'starRadius');
  const p = positive(period, 'period');
  const a = Math.cbrt((C.G * positive(starMass, 'mass') * p ** 2) / (4 * Math.PI ** 2));
  if (nonNegative(b, 'impact') >= 1 + k) fail('noTransit');
  const sinI = Math.sqrt(1 - ((b * rs) / a) ** 2);
  const t14 = (p / Math.PI) * Math.asin(Math.min(1, ((rs / a) * Math.sqrt((1 + k) ** 2 - b ** 2)) / sinI));
  return {
    items: [fixed('depth', k ** 2, ''), fixed('semiMajor', a / ASTRO.au, 'au'), fixed('duration', t14 / 3600, 'h')],
    steps: [
      {
        key: 'depth',
        text: `δ = (R_p / R*)² = (${fmt(rp)} / ${fmt(rs)})² = ${fmt(k ** 2)}`,
        tex: `\\delta = \\left(\\frac{R_p}{R_*}\\right)^2 = ${tex(k ** 2)}`,
      },
      { key: 'semiMajor', text: `a = (G M* P² / 4π²)^(1/3) = ${fmt(a / ASTRO.au)} au` },
      { key: 'duration', text: `T₁₄ = (P/π) arcsin((R*/a) √((1 + k)² − b²) / sin i) = ${fmt(t14 / 3600)} h` },
    ],
  };
}

/** Radial-velocity semi-amplitude and mass function, with a sketch of one orbit's velocity curve. */
export function radialVelocity(
  mp: number,
  ms: number,
  period: number,
  e = 0,
  inclination = Math.PI / 2,
): Calc<StarKey> {
  const p = positive(period, 'period');
  if (fraction(e, 'eccentricity') >= 1) fail('notBound');
  const k =
    ((2 * Math.PI * C.G) / p) ** (1 / 3) *
    ((positive(mp, 'planetMass') * Math.sin(inclination)) /
      ((positive(ms, 'mass') + mp) ** (2 / 3) * Math.sqrt(1 - e ** 2)));
  const fm = (p * k ** 3 * (1 - e ** 2) ** 1.5) / (2 * Math.PI * C.G);
  const curve: [number, number][] = Array.from({ length: 121 }, (_, i) => {
    const phase = i / 120;
    return [(phase * p) / 86400, k * Math.sin(2 * Math.PI * phase)];
  });
  return {
    items: [fixed('semiAmplitude', k, 'm/s'), auto('massFunction', fm, 'kg')],
    steps: [
      {
        key: 'semiAmplitude',
        text: `K = (2πG / P)^(1/3) M_p sin i / ((M* + M_p)^(2/3) √(1 − e²)) = ${fmt(k)} m/s`,
        tex:
          `K = \\left(\\frac{2\\pi G}{P}\\right)^{1/3}\\frac{M_p \\sin i}{(M_* + M_p)^{2/3}\\sqrt{1 - e^2}} = ` +
          `${tex(k)}\\,\\mathrm{m/s}`,
      },
      { key: 'massFunction', text: `f(M) = P K³ (1 − e²)^(3/2) / (2πG) = ${fmt(fm)} kg` },
    ],
    plot: { title: 'rvPlot', xLabel: 'timeDays', yLabel: 'velocity', series: [{ points: curve, kind: 'line' }] },
  };
}

/** Equilibrium temperature T* √(R* / 2a) (1 − A)^(1/4) for a planet that spreads the heat around. */
export function equilibrium(tStar: number, rStar: number, a: number, albedo: number): Calc<StarKey> {
  const t =
    positive(tStar, 'temperature') *
    Math.sqrt(positive(rStar, 'starRadius') / (2 * positive(a, 'distance'))) *
    (1 - fraction(albedo, 'albedo')) ** 0.25;
  return {
    items: [fixed('equilibrium', t, 'K')],
    steps: [
      {
        key: 'equilibrium',
        text:
          `T_eq = T* √(R* / 2a) (1 − A)^(1/4) = ${fmt(tStar)} K × √(${fmt(rStar)} / (2 × ${fmt(a)})) × (1 − ` +
          `${fmt(albedo)})^(1/4) = ${fmt(t)} K`,
        tex: `T_{eq} = T_*\\sqrt{\\frac{R_*}{2a}}(1 - A)^{1/4} = ${tex(t)}\\,\\mathrm{K}`,
      },
    ],
  };
}

/** Kopparapu et al. (2013) Table 3: S_eff☉, a, b, c, d for each habitable-zone limit. */
export const HZ_LIMITS: readonly [StarKey, readonly [number, number, number, number, number]][] = [
  ['hzRecentVenus', [1.7753, 1.4316e-4, 2.9875e-9, -7.5702e-12, -1.1635e-15]],
  ['hzRunaway', [1.0512, 1.3242e-4, 1.5418e-8, -7.9895e-12, -1.8328e-15]],
  ['hzMoist', [1.014, 8.1774e-5, 1.7063e-9, -4.3241e-12, -6.6462e-16]],
  ['hzMaximum', [0.3438, 5.8942e-5, 1.6558e-9, -3.0045e-12, -5.2983e-16]],
  ['hzEarlyMars', [0.3179, 5.4513e-5, 1.5313e-9, -2.7786e-12, -4.8997e-16]],
];

/** Habitable-zone distances d = √((L/L☉) / S_eff) au, with S_eff from the fit in T_eff − 5780 K. */
export function habitableZone(teff: number, lsun: number): Calc<StarKey> {
  if (positive(teff, 'temperature') < 2600 || teff > 7200) fail('outsideFit');
  const t = teff - 5780;
  const items: Item<StarKey>[] = [];
  const steps: Step<StarKey>[] = [];
  for (const [key, [s0, a, b, c, d]] of HZ_LIMITS) {
    const s = s0 + a * t + b * t ** 2 + c * t ** 3 + d * t ** 4;
    const dist = Math.sqrt(positive(lsun, 'luminosity') / s);
    items.push(fixed(key, dist, 'au', 4));
    steps.push({
      key,
      text:
        `S_eff = ${s0} + a T + b T² + c T³ + d T⁴ = ${fmt(s)}, d = √(${fmt(lsun)} / ${fmt(s)}) = ${fmt(dist, 4)} ` +
        `au`,
    });
  }
  return { items, steps };
}
