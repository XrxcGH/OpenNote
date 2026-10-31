// Hydrogen-like atoms. Bohr levels use the reduced mass, and lines get a vacuum and an air wavelength. Radial
// wavefunctions come from associated Laguerre polynomials and angular densities from associated Legendre functions.
// The Dirac fine structure is to order α². Moseley's law and Bragg's law give characteristic X-rays.
import { auto, fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { C, RY_EV } from '../shared/constants';
import { fail, need, positive, whole } from '../shared/errors';
import { fmt, prefixed, tex } from '../shared/format';
import type { Level, Series } from '../shared/plot';

export type AtomKey =
  | 'upper'
  | 'lower'
  | 'photon'
  | 'vacuum'
  | 'air'
  | 'wavenumber'
  | 'frequency'
  | 'reduced'
  | 'rydberg'
  | 'levelPlot'
  | 'blank'
  | 'energyEv'
  | 'meanR'
  | 'peakR'
  | 'invR'
  | 'energy'
  | 'radialNodes'
  | 'radialPlot'
  | 'radiusA0'
  | 'density'
  | 'angularNodes'
  | 'azimuthalNodes'
  | 'angularPlot'
  | 'axisX'
  | 'axisY'
  | 'axisZ'
  | 'orbitalName'
  | 'orbitalPeak'
  | 'realPlot'
  | 'jLow'
  | 'jHigh'
  | 'splitting'
  | 'splittingCm'
  | 'shiftLow'
  | 'shiftHigh'
  | 'xray'
  | 'xrayWavelength'
  | 'bragg'
  | 'terms'
  | 'ground'
  | 'microstates'
  | 'landeG'
  | 'level'
  | 'table'
  | 'extract'
  | 'gUpper'
  | 'gLower'
  | 'line'
  | 'zeemanPlot'
  | 'shiftAxis'
  | 'strengthAxis'
  | 'allowed'
  | 'rule';

export const ATOM_SOURCES = [
  'Edlén (1953) and Morton (1991), ApJS 77, 119: the IAU standard air-to-vacuum conversion, valid above 200 nm.',
] as const;

/** μ/mₑ for a nucleus of mass M (kg); an infinite nucleus when M is 0. */
export const reducedRatio = (nucleus: number) => (nucleus === 0 ? 1 : nucleus / (nucleus + C.me));

/** E_n = −Ry (μ/mₑ) Z² / n² in eV. */
export const levelEv = (z: number, n: number, ratio = 1) => (-RY_EV * ratio * z * z) / (n * n);

/** The refractive index of standard air at a vacuum wavelength (m), by the IAU standard formula. */
export function airIndex(vacuum: number): number {
  const s2 = (1e-6 / vacuum) ** 2;
  return 1 + 6.4328e-5 + 2.94981e-2 / (146 - s2) + 2.554e-4 / (41 - s2);
}

/** A line between levels n2 → n1 of a hydrogen-like atom. Nucleus mass in kg, 0 for an infinite nucleus. */
export function line(z: number, nucleus: number, n2: number, n1: number): Calc<AtomKey> {
  whole(z, 'charge', 1);
  whole(n2, 'upper', 1);
  whole(n1, 'lower', 1);
  if (nucleus < 0 || !Number.isFinite(nucleus)) need('nonNegative', 'mass');
  if (n2 <= n1) fail('badLevels');
  const ratio = reducedRatio(nucleus);
  const eu = levelEv(z, n2, ratio);
  const el = levelEv(z, n1, ratio);
  const photon = eu - el;
  const kayser = (C.Rinf * ratio * z * z * (1 / n1 ** 2 - 1 / n2 ** 2)) / 100;
  const vacuum = 1 / (kayser * 100);
  const items: Item<AtomKey>[] = [
    auto('vacuum', vacuum, 'm', 7),
    fixed('photon', photon, 'eV', 7),
    fixed('wavenumber', kayser, 'cm⁻¹', 8),
    auto('frequency', C.c / vacuum, 'Hz', 7),
    fixed('upper', eu, 'eV', 7),
    fixed('lower', el, 'eV', 7),
    fixed('reduced', ratio, '', 9),
  ];
  if (vacuum > 2e-7) items.splice(1, 0, auto('air', vacuum / airIndex(vacuum), 'm', 7));
  const top = Math.max(n2 + 1, 6);
  const levels: Level[] = Array.from({ length: top }, (_, k) => ({
    y: levelEv(z, k + 1, ratio),
    label: `n = ${k + 1}`,
    from: 0,
    to: 1,
  }));
  const series: Series[] = [
    {
      points: [
        [0.5, eu],
        [0.5, el],
      ],
      kind: 'line',
      tone: 1,
      label: `${n2} → ${n1}`,
    },
  ];
  const steps: Step<AtomKey>[] = [
    {
      key: 'reduced',
      text: `μ/mₑ = M/(M + mₑ) = ${fmt(ratio, 9)}`,
      tex: `\\frac{\\mu}{m_e} = \\frac{M}{M + m_e} = ${tex(ratio, 9)}`,
    },
    {
      key: 'photon',
      text:
        `E = Ry (μ/mₑ) Z² (1/n₁² − 1/n₂²) = ${fmt(RY_EV, 9)} eV × ${fmt(ratio, 9)} × ${z}² × ` +
        `(1/${n1}² − 1/${n2}²) = ${fmt(photon, 7)} eV`,
      tex: `E = R_y\\frac{\\mu}{m_e}Z^2\\left(\\frac{1}{n_1^2} - \\frac{1}{n_2^2}\\right) = ${tex(photon, 7)}\\ \\mathrm{eV}`,
    },
    {
      key: 'vacuum',
      text: `λ = 1 / (R∞ (μ/mₑ) Z² (1/n₁² − 1/n₂²)) = 1 / ${fmt(kayser, 8)} cm⁻¹ = ${prefixed(vacuum, 'm', 7)}`,
      tex: `\\lambda = \\frac{1}{R_\\infty (\\mu/m_e) Z^2 (n_1^{-2} - n_2^{-2})} = ${tex(vacuum * 1e9, 7)}\\ \\mathrm{nm}`,
    },
  ];
  if (vacuum > 2e-7)
    steps.push({
      key: 'air',
      text: `λ_air = λ_vac / n_air, with n_air = ${fmt(airIndex(vacuum), 9)}: ${prefixed(vacuum / airIndex(vacuum), 'm', 7)}`,
    });
  return { items, steps, plot: { title: 'levelPlot', xLabel: 'blank', yLabel: 'energyEv', series, levels } };
}

const factorial = (n: number) => {
  let f = 1;
  for (let k = 2; k <= n; k += 1) f *= k;
  return f;
};

/** The associated Laguerre polynomial L_k^α(x) by its three-term recurrence. */
export function laguerre(k: number, alpha: number, x: number): number {
  if (k === 0) return 1;
  let prev = 1;
  let cur = 1 + alpha - x;
  for (let j = 1; j < k; j += 1) [prev, cur] = [cur, ((2 * j + 1 + alpha - x) * cur - (j + alpha) * prev) / (j + 1)];
  return cur;
}

/** R_nl(r) in units of a₀^(−3/2), with r in a₀. */
export function radial(z: number, n: number, l: number, r: number): number {
  const rho = (2 * z * r) / n;
  const norm = Math.sqrt(((2 * z) / n) ** 3 * (factorial(n - l - 1) / (2 * n * factorial(n + l))));
  return norm * rho ** l * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho);
}

function checkNl(z: number, n: number, l: number) {
  whole(z, 'charge', 1);
  whole(n, 'principal', 1);
  whole(l, 'orbital', 0);
  if (l >= n || n > 30) fail('badQuantumNumbers');
}

/** ⟨r⟩, the most probable radius, ⟨1/r⟩, the energy, and the radial probability density r²R². */
export function radialCalc(z: number, n: number, l: number): Calc<AtomKey> {
  checkNl(z, n, l);
  const mean = (3 * n * n - l * (l + 1)) / (2 * z);
  const top = (n * n * 4 + 10) / z;
  const points: [number, number][] = [];
  let peak = 0;
  let best = -1;
  const count = 600;
  for (let i = 0; i <= count; i += 1) {
    const r = (top * i) / count;
    const p = r * r * radial(z, n, l, r) ** 2;
    points.push([r, p]);
    if (p > best) [best, peak] = [p, r];
  }
  // Golden-section refinement of the highest peak between its neighbors.
  let lo = Math.max(0, peak - top / count);
  let hi = peak + top / count;
  const pr = (r: number) => r * r * radial(z, n, l, r) ** 2;
  for (let k = 0; k < 80; k += 1) {
    const a = hi - (hi - lo) * 0.618033988749895;
    const b = lo + (hi - lo) * 0.618033988749895;
    if (pr(a) > pr(b)) hi = b;
    else lo = a;
  }
  peak = (lo + hi) / 2;
  return {
    items: [
      fixed('meanR', mean, 'a₀', 8),
      fixed('peakR', peak, 'a₀', 7),
      fixed('invR', z / (n * n), '1/a₀', 8),
      fixed('energy', levelEv(z, n), 'eV', 7),
      fixed('radialNodes', n - l - 1, '', 3),
    ],
    steps: [
      {
        key: 'meanR',
        text: `⟨r⟩ = (a₀/2Z)(3n² − l(l+1)) = (1/${2 * z})(3 × ${n}² − ${l} × ${l + 1}) a₀ = ${fmt(mean, 8)} a₀`,
        tex: `\\langle r\\rangle = \\frac{a_0}{2Z}\\left(3n^2 - l(l+1)\\right) = ${tex(mean, 8)}\\,a_0`,
      },
      {
        key: 'density',
        text: `R_nl = N ρ^l e^(−ρ/2) L_(n−l−1)^(2l+1)(ρ), ρ = 2Zr/(n a₀); the radial density r²R² peaks at ${fmt(peak, 7)} a₀`,
        tex: `R_{nl}(r) = N\\rho^l e^{-\\rho/2} L_{n-l-1}^{2l+1}(\\rho),\\quad \\rho = \\frac{2Zr}{n a_0}`,
      },
    ],
    plot: { title: 'radialPlot', xLabel: 'radiusA0', yLabel: 'density', series: [{ points, kind: 'line', tone: 0 }] },
  };
}

/** The associated Legendre function P_l^m(x), m ≥ 0, without the Condon-Shortley phase. */
export function legendre(l: number, m: number, x: number): number {
  let pmm = 1;
  const s = Math.sqrt(Math.max(0, 1 - x * x));
  for (let k = 1; k <= m; k += 1) pmm *= (2 * k - 1) * s;
  if (l === m) return pmm;
  let pm1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pm1;
  let pl = 0;
  for (let k = m + 2; k <= l; k += 1) {
    pl = ((2 * k - 1) * x * pm1 - (k + m - 1) * pmm) / (k - m);
    pmm = pm1;
    pm1 = pl;
  }
  return pl;
}

/** |Y_lm(θ)|², which does not depend on φ. */
export function ylm2(l: number, m: number, theta: number): number {
  const am = Math.abs(m);
  const norm = ((2 * l + 1) / (4 * Math.PI)) * (factorial(l - am) / factorial(l + am));
  return norm * legendre(l, am, Math.cos(theta)) ** 2;
}

/** The angular density |Y_lm|² drawn as a polar curve in the x-z plane, with its nodes. */
export function angular(l: number, m: number): Calc<AtomKey> {
  whole(l, 'orbital', 0);
  if (!Number.isInteger(m) || Math.abs(m) > l || l > 20) fail('badQuantumNumbers');
  const points: [number, number][] = [];
  for (let i = 0; i <= 360; i += 1) {
    const theta = (i * Math.PI) / 180;
    const rho = ylm2(l, m, theta);
    points.push([rho * Math.sin(theta), rho * Math.cos(theta)]);
  }
  const span = Math.max(...points.map(([x, y]) => Math.hypot(x, y))) * 1.1 || 1;
  return {
    items: [
      fixed('angularNodes', l - Math.abs(m), '', 3),
      fixed('azimuthalNodes', Math.abs(m), '', 3),
      fixed('density', ylm2(l, m, 0), '', 6),
    ],
    steps: [
      {
        key: 'density',
        text: `|Y_lm|² = ((2l+1)/4π) ((l−|m|)!/(l+|m|)!) [P_l^|m|(cos θ)]², drawn at φ = 0 and φ = π`,
        tex: `|Y_l^m|^2 = \\frac{2l+1}{4\\pi}\\frac{(l-|m|)!}{(l+|m|)!}\\left[P_l^{|m|}(\\cos\\theta)\\right]^2`,
      },
    ],
    plot: {
      title: 'angularPlot',
      xLabel: 'axisX',
      yLabel: 'axisZ',
      series: [{ points, kind: 'line', tone: 0 }],
      x: [-span, span],
      y: [-span, span],
    },
  };
}

const ORBITAL_NAMES: Record<string, string> = {
  '0,0': 's',
  '1,0': 'pz',
  '1,1': 'px',
  '1,-1': 'py',
  '2,0': 'dz²',
  '2,1': 'dxz',
  '2,-1': 'dyz',
  '2,2': 'dx²−y²',
  '2,-2': 'dxy',
  '3,0': 'fz³',
  '3,1': 'fxz²',
  '3,-1': 'fyz²',
  '3,2': 'fz(x²−y²)',
  '3,-2': 'fxyz',
  '3,3': 'fx(x²−3y²)',
  '3,-3': 'fy(3x²−y²)',
};

/**
 * The real orbital of l and m: √2 N P_l^|m|(cos θ) cos(mφ) for m > 0, √2 N P_l^|m|(cos θ) sin(|m|φ) for m < 0, and
 * N P_l^0(cos θ) for m = 0, with N² = ((2l+1)/4π)((l−|m|)!/(l+|m|)!) and no Condon-Shortley phase, so px points along +x.
 */
export function realY(l: number, m: number, theta: number, phi: number): number {
  const am = Math.abs(m);
  const norm = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - am) / factorial(l + am)));
  const p = norm * legendre(l, am, Math.cos(theta));
  if (m === 0) return p;
  return Math.SQRT2 * p * (m > 0 ? Math.cos(m * phi) : Math.sin(am * phi));
}

/**
 * A real orbital (px, dxy, …) drawn in a plane section as the polar curve r = |Y|: the x-z plane (φ = 0 to the right,
 * φ = π to the left) or the x-y plane (θ = π/2). Positive lobes and negative lobes are separate series, told apart by tone.
 */
export function realOrbital(l: number, m: number, plane: 'xz' | 'xy'): Calc<AtomKey> {
  whole(l, 'orbital', 0);
  if (!Number.isInteger(m) || Math.abs(m) > l || l > 20) fail('badQuantumNumbers');
  const plus: [number, number][] = [];
  const minus: [number, number][] = [];
  let peak = 0;
  for (let i = 0; i <= 720; i += 1) {
    // a runs once round the section: the angle from +x (x-y plane) or from +z towards +x (x-z plane).
    const a = (i * Math.PI) / 360;
    const y =
      plane === 'xy'
        ? realY(l, m, Math.PI / 2, a)
        : realY(l, m, Math.acos(Math.cos(a)), Math.sin(a) >= 0 ? 0 : Math.PI);
    const r = Math.abs(y);
    peak = Math.max(peak, r);
    const at: [number, number] =
      plane === 'xy' ? [r * Math.cos(a), r * Math.sin(a)] : [r * Math.sin(a), r * Math.cos(a)];
    // A break (NaN) lifts the pen where the sign changes, so each lobe is its own curve.
    (y >= 0 ? plus : minus).push(at);
    (y >= 0 ? minus : plus).push([Number.NaN, Number.NaN]);
  }
  const span = peak * 1.1 || 1;
  const name = l <= 3 ? ORBITAL_NAMES[`${l},${m}`]! : `l = ${l}, m = ${m}`;
  return {
    items: [
      { key: 'orbitalName', value: m, unit: '', text: name },
      fixed('orbitalPeak', peak, '', 6),
      fixed('angularNodes', l - Math.abs(m), '', 3),
      fixed('azimuthalNodes', Math.abs(m), '', 3),
    ],
    steps: [
      {
        key: 'realPlot',
        text:
          `Y = √2 N P_l^|m|(cos θ) ${m > 0 ? `cos(${m}φ)` : m < 0 ? `sin(${-m}φ)` : ''}`.trim() +
          ` with N² = ((2l+1)/4π)((l−|m|)!/(l+|m|)!); the curve is r = |Y|, positive and negative lobes in two tones`,
        tex:
          m === 0
            ? 'Y_{l0} = N P_l(\\cos\\theta)'
            : `Y = \\sqrt{2}\\,N P_l^{|m|}(\\cos\\theta)\\,\\${m > 0 ? 'cos' : 'sin'}(${Math.abs(m)}\\varphi)`,
      },
    ],
    plot: {
      title: 'realPlot',
      xLabel: 'axisX',
      yLabel: plane === 'xy' ? 'axisY' : 'axisZ',
      series: [
        { points: plus, kind: 'line', tone: 0, label: '+' },
        { points: minus, kind: 'dash', tone: 1, label: '−' },
      ],
      x: [-span, span],
      y: [-span, span],
      equal: true,
    },
  };
}

/** The Dirac fine structure of the level n, l: E_nj = E_n [1 + (α²Z²/n²)(n/(j + 1/2) − 3/4)], fixed nucleus. */
export function fineStructure(z: number, n: number, l: number): Calc<AtomKey> {
  checkNl(z, n, l);
  const en = levelEv(z, n);
  const az = (C.alpha * z) ** 2 / (n * n);
  const shift = (j: number) => en * az * (n / (j + 0.5) - 0.75);
  const jHigh = l + 0.5;
  const jLow = Math.max(0.5, l - 0.5);
  const split = shift(jHigh) - shift(jLow);
  const cm = (split * C.e) / (C.h * C.c * 100);
  return {
    items: [
      fixed('splitting', split, 'eV', 6),
      fixed('splittingCm', cm, 'cm⁻¹', 6),
      fixed('jHigh', en + shift(jHigh), 'eV', 9),
      fixed('jLow', en + shift(jLow), 'eV', 9),
      fixed('shiftHigh', shift(jHigh), 'eV', 6),
      fixed('shiftLow', shift(jLow), 'eV', 6),
    ],
    steps: [
      {
        key: 'shiftHigh',
        text: `E_nj = E_n [1 + (α²Z²/n²)(n/(j + ½) − ¾)] with E_n = ${fmt(en, 7)} eV and α²Z²/n² = ${fmt(az, 6)}`,
        tex: `E_{nj} = E_n\\left[1 + \\frac{\\alpha^2 Z^2}{n^2}\\left(\\frac{n}{j + \\frac12} - \\frac34\\right)\\right]`,
      },
      {
        key: 'splitting',
        text: `ΔE = E(j = ${fmt(jHigh)}) − E(j = ${fmt(jLow)}) = ${fmt(split, 6)} eV = ${fmt(cm, 6)} cm⁻¹`,
        tex: `\\Delta E = ${tex(split, 6)}\\ \\mathrm{eV} = ${tex(cm, 6)}\\ \\mathrm{cm^{-1}}`,
      },
    ],
  };
}

/** Moseley's law E = Ry (Z − σ)² (1/n₁² − 1/n₂²), and Bragg's angle on a crystal of spacing d (m) when given. */
export function moseley(z: number, n2: number, n1: number, screening: number, d?: number, order = 1): Calc<AtomKey> {
  whole(z, 'charge', 1);
  whole(n2, 'upper', 1);
  whole(n1, 'lower', 1);
  if (n2 <= n1) fail('badLevels');
  if (!(z - screening > 0)) fail('overScreened');
  const e = RY_EV * (z - screening) ** 2 * (1 / n1 ** 2 - 1 / n2 ** 2);
  const lambda = (C.h * C.c) / (e * C.e);
  const items: Item<AtomKey>[] = [fixed('xray', e, 'eV', 6), auto('xrayWavelength', lambda, 'm', 6)];
  const steps: Step<AtomKey>[] = [
    {
      key: 'xray',
      text: `E = Ry (Z − σ)² (1/n₁² − 1/n₂²) = ${fmt(RY_EV, 9)} eV × ${fmt(z - screening)}² × (1/${n1}² − 1/${n2}²) = ${fmt(e, 6)} eV`,
      tex: `E = R_y (Z - \\sigma)^2 \\left(\\frac{1}{n_1^2} - \\frac{1}{n_2^2}\\right) = ${tex(e, 6)}\\ \\mathrm{eV}`,
    },
  ];
  if (d !== undefined) {
    positive(d, 'spacing');
    whole(order, 'order', 1);
    const s = (order * lambda) / (2 * d);
    if (s > 1) fail('noBragg');
    const theta = (Math.asin(s) * 180) / Math.PI;
    items.push(fixed('bragg', theta, '°', 6));
    steps.push({
      key: 'bragg',
      text: `nλ = 2d sin θ: θ = asin(${order} × ${prefixed(lambda, 'm')} / (2 × ${prefixed(d, 'm')})) = ${fmt(theta, 6)}°`,
      tex: `\\theta = \\arcsin\\frac{n\\lambda}{2d} = ${tex(theta, 6)}^\\circ`,
    });
  }
  return { items, steps };
}
