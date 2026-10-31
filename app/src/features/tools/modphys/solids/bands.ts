// Electrons and phonons in solids: the free-electron gas in one, two, and three dimensions, Kronig-Penney bands found
// with kit-core's root scan, and dispersion of a tight-binding chain and of monatomic and diatomic phonon chains.
import { bracketScan } from '../../kits/num/roots';
import { auto, fixed } from '../shared/calc';
import type { Calc, Item } from '../shared/calc';
import { C } from '../shared/constants';
import { fail, positive } from '../shared/errors';
import { fmt, prefixed, tex } from '../shared/format';
import type { Series } from '../shared/plot';

export type SolidKey =
  | 'fermiEnergy'
  | 'fermiTemperature'
  | 'fermiVelocity'
  | 'fermiWavevector'
  | 'dos'
  | 'band'
  | 'gap'
  | 'kpPlot'
  | 'alphaAxis'
  | 'fAxis'
  | 'bandwidth'
  | 'omegaMax'
  | 'acousticEdge'
  | 'opticalEdge'
  | 'soundSpeed'
  | 'dispersionPlot'
  | 'kAxis'
  | 'energyAxis'
  | 'omegaAxis'
  | 'gapEnergy'
  | 'ni'
  | 'n'
  | 'p'
  | 'fermiLevel'
  | 'fermiBelowCb'
  | 'ionizedDonors'
  | 'ionizedAcceptors'
  | 'nc'
  | 'nv'
  | 'conductivity'
  | 'resistivity'
  | 'drift'
  | 'diffusionN'
  | 'diffusionP'
  | 'diffusionCurrent'
  | 'hall'
  | 'vbi'
  | 'width'
  | 'xn'
  | 'xp'
  | 'peakField'
  | 'capacitance'
  | 'current'
  | 'ivPlot'
  | 'voltAxis'
  | 'currentAxis'
  | 'phiF'
  | 'cox'
  | 'vfb'
  | 'vt'
  | 'cmin'
  | 'wmax'
  | 'cvPlot'
  | 'cAxis'
  | 'voc'
  | 'isc'
  | 'vmp'
  | 'imp'
  | 'pmax'
  | 'fillFactor'
  | 'efficiency';

const EV = C.e;

/** The Fermi energy (J) of a free-electron gas of density n in d dimensions, with effective mass m. */
export function fermiEnergy(n: number, m: number, d: 1 | 2 | 3): number {
  if (d === 3) return (C.hbar ** 2 * (3 * Math.PI ** 2 * n) ** (2 / 3)) / (2 * m);
  if (d === 2) return (Math.PI * C.hbar ** 2 * n) / m;
  return (C.hbar ** 2 * ((Math.PI * n) / 2) ** 2) / (2 * m);
}

/** The Fermi energy, temperature, velocity, wavevector, and density of states at E_F. */
export function freeElectron(n: number, massRatio: number, d: 1 | 2 | 3): Calc<SolidKey> {
  positive(n, 'density');
  positive(massRatio, 'massRatio');
  const m = massRatio * C.me;
  const ef = fermiEnergy(n, m, d);
  const kf = Math.sqrt(2 * m * ef) / C.hbar;
  // g(E_F) per unit length, area, or volume per joule: d n / (2 E_F).
  const dos = (d * n) / (2 * ef);
  const unit = ['m⁻¹', 'm⁻²', 'm⁻³'][d - 1]!;
  return {
    items: [
      fixed('fermiEnergy', ef / EV, 'eV', 6),
      fixed('fermiTemperature', ef / C.kB, 'K', 5),
      auto('fermiVelocity', (C.hbar * kf) / m, 'm/s', 5),
      fixed('fermiWavevector', kf, 'm⁻¹', 5),
      fixed('dos', dos * EV, `eV⁻¹ ${unit}`, 5),
    ],
    steps: [
      {
        key: 'fermiEnergy',
        text:
          d === 3
            ? `E_F = ħ²(3π²n)^(2/3) / 2m = ${fmt(ef / EV, 6)} eV`
            : d === 2
              ? `E_F = πħ²n / m = ${fmt(ef / EV, 6)} eV`
              : `E_F = ħ²(πn/2)² / 2m = ${fmt(ef / EV, 6)} eV`,
        tex:
          d === 3
            ? `E_F = \\frac{\\hbar^2}{2m}(3\\pi^2 n)^{2/3} = ${tex(ef / EV, 6)}\\ \\mathrm{eV}`
            : d === 2
              ? `E_F = \\frac{\\pi\\hbar^2 n}{m} = ${tex(ef / EV, 6)}\\ \\mathrm{eV}`
              : `E_F = \\frac{\\hbar^2}{2m}\\left(\\frac{\\pi n}{2}\\right)^2 = ${tex(ef / EV, 6)}\\ \\mathrm{eV}`,
      },
      {
        key: 'fermiVelocity',
        text:
          `k_F = √(2mE_F)/ħ = ${fmt(kf)} m⁻¹; v_F = ħk_F/m = ${prefixed((C.hbar * kf) / m, 'm/s')}; T_F = E_F/k = ` +
          `${fmt(ef / C.kB, 5)} K`,
      },
    ],
  };
}

/** The Kronig-Penney function f(αa) = cos αa + P sin(αa)/(αa); a band is allowed where |f| ≤ 1. */
export const kpF = (p: number, x: number) => Math.cos(x) + (p * Math.sin(x)) / x;

/** The first allowed bands of the Kronig-Penney model in αa, with energies when a lattice constant is given. */
export function kronigPenney(p: number, bands: number, a?: number, massRatio = 1): Calc<SolidKey> {
  positive(p, 'barrierStrength');
  if (p > 1e4) fail('badPotential');
  if (!Number.isInteger(bands) || bands < 1 || bands > 8) fail('badBands');
  const hi = bands * Math.PI + 0.25;
  const edges = bracketScan((x) => kpF(p, x) ** 2 - 1, 1e-9, hi, 4000 * bands, 1e-14).filter(
    (x) => x <= bands * Math.PI + 1e-9,
  );
  const energy = (x: number) => (a === undefined ? NaN : (C.hbar * x) ** 2 / (2 * massRatio * C.me * a * a) / EV);
  const items: Item<SolidKey>[] = [];
  const pairs: [number, number][] = [];
  for (let k = 0; k + 1 < edges.length; k += 2) pairs.push([edges[k]!, edges[k + 1]!]);
  pairs.forEach(([lo, top], k) => {
    items.push({
      key: 'band',
      value: lo,
      unit: '',
      text:
        `${k + 1}: αa ${fmt(lo, 7)} to ${fmt(top, 7)}` +
        (a === undefined ? '' : ` (${fmt(energy(lo), 5)} to ${fmt(energy(top), 5)} eV)`),
    });
    const next = pairs[k + 1];
    if (next)
      items.push({
        key: 'gap',
        value: next[0] - top,
        unit: '',
        text:
          `${k + 1}: αa ${fmt(top, 7)} to ${fmt(next[0], 7)}` +
          (a === undefined ? '' : ` (${fmt(energy(next[0]) - energy(top), 5)} eV)`),
      });
  });
  if (a !== undefined) positive(a, 'latticeConstant');
  const curve: [number, number][] = Array.from({ length: 801 }, (_, i) => {
    const x = 1e-6 + ((hi - 1e-6) * i) / 800;
    return [x, Math.max(-4, Math.min(4, kpF(p, x)))];
  });
  const series: Series[] = [
    { points: curve, kind: 'line', tone: 0 },
    {
      points: [
        [0, 1],
        [hi, 1],
      ],
      kind: 'dash',
      tone: 2,
      label: '+1',
    },
    {
      points: [
        [0, -1],
        [hi, -1],
      ],
      kind: 'dash',
      tone: 2,
      label: '−1',
    },
  ];
  return {
    items,
    steps: [
      {
        key: 'band',
        text:
          `cos ka = cos αa + P sin(αa)/(αa) with P = ${fmt(p)}; a band is allowed where the right side lies between ` +
          `−1 and 1. Edges come from a root scan with Brent's method.`,
        tex: `\\cos ka = \\cos\\alpha a + P\\,\\frac{\\sin\\alpha a}{\\alpha a}`,
      },
    ],
    plot: { title: 'kpPlot', xLabel: 'alphaAxis', yLabel: 'fAxis', series, y: [-4, 4] },
  };
}

export type ChainKind = 'tight' | 'mono' | 'di';

export interface Chain {
  kind: ChainKind;
  /** Lattice constant, m. */
  a: number;
  /** Tight binding: on-site energy and hopping, eV. */
  e0: number;
  hop: number;
  /** Phonons: spring constant (N/m) and masses (kg). */
  k: number;
  m1: number;
  m2: number;
}

/** Dispersion across the first Brillouin zone for a tight-binding band or a phonon chain. */
export function chainDispersion(c: Chain): Calc<SolidKey> {
  positive(c.a, 'latticeConstant');
  const zone = Math.PI / c.a;
  const ks = Array.from({ length: 201 }, (_, i) => -zone + (2 * zone * i) / 200);
  const kx = (k: number) => (k * c.a) / Math.PI;
  if (c.kind === 'tight') {
    if (!Number.isFinite(c.e0) || !Number.isFinite(c.hop)) fail('badList');
    const e = (k: number) => c.e0 - 2 * c.hop * Math.cos(k * c.a);
    return {
      items: [fixed('bandwidth', 4 * Math.abs(c.hop), 'eV', 6)],
      steps: [
        {
          key: 'bandwidth',
          text:
            `E(k) = E₀ − 2t cos ka, from ${fmt(c.e0 - 2 * Math.abs(c.hop))} to ${fmt(c.e0 + 2 * Math.abs(c.hop))} eV; ` +
            `width 4|t| = ${fmt(4 * Math.abs(c.hop))} eV`,
          tex: `E(k) = E_0 - 2t\\cos ka`,
        },
      ],
      plot: {
        title: 'dispersionPlot',
        xLabel: 'kAxis',
        yLabel: 'energyAxis',
        series: [{ points: ks.map((k) => [kx(k), e(k)]), kind: 'line', tone: 0 }],
      },
    };
  }
  positive(c.k, 'spring');
  positive(c.m1, 'mass');
  if (c.kind === 'mono') {
    const w = (k: number) => 2 * Math.sqrt(c.k / c.m1) * Math.abs(Math.sin((k * c.a) / 2));
    return {
      items: [
        fixed('omegaMax', 2 * Math.sqrt(c.k / c.m1), 'rad/s', 6),
        auto('soundSpeed', c.a * Math.sqrt(c.k / c.m1), 'm/s', 6),
      ],
      steps: [
        {
          key: 'omegaMax',
          text:
            `ω(k) = 2√(K/m) |sin(ka/2)|; ω_max = ${fmt(2 * Math.sqrt(c.k / c.m1))} rad/s; v_s = a√(K/m) = ` +
            `${fmt(c.a * Math.sqrt(c.k / c.m1))} m/s`,
          tex: `\\omega(k) = 2\\sqrt{K/m}\\,\\left|\\sin\\frac{ka}{2}\\right|`,
        },
      ],
      plot: {
        title: 'dispersionPlot',
        xLabel: 'kAxis',
        yLabel: 'omegaAxis',
        series: [{ points: ks.map((k) => [kx(k), w(k)]), kind: 'line', tone: 0 }],
      },
    };
  }
  positive(c.m2, 'mass');
  const sum = 1 / c.m1 + 1 / c.m2;
  const branch = (k: number, sign: number) =>
    Math.sqrt(
      c.k * (sum + sign * Math.sqrt(Math.max(0, sum * sum - (4 * Math.sin((k * c.a) / 2) ** 2) / (c.m1 * c.m2)))),
    );
  const heavy = Math.max(c.m1, c.m2);
  const light = Math.min(c.m1, c.m2);
  return {
    items: [
      fixed('acousticEdge', Math.sqrt((2 * c.k) / heavy), 'rad/s', 6),
      fixed('opticalEdge', Math.sqrt((2 * c.k) / light), 'rad/s', 6),
      fixed('omegaMax', Math.sqrt(2 * c.k * sum), 'rad/s', 6),
      auto('soundSpeed', (c.a / 2) * Math.sqrt((2 * c.k) / (c.m1 + c.m2)), 'm/s', 6),
    ],
    steps: [
      {
        key: 'omegaMax',
        text:
          `ω² = K(1/m₁ + 1/m₂) ± K√((1/m₁ + 1/m₂)² − 4 sin²(ka/2)/(m₁m₂)); at the zone edge √(2K/M) and √(2K/m) bound ` +
          `the gap`,
        tex:
          `\\omega^2 = K\\left(\\frac{1}{m_1} + \\frac{1}{m_2}\\right) \\pm K\\sqrt{\\left(\\frac{1}{m_1} + ` +
          `\\frac{1}{m_2}\\right)^2 - \\frac{4\\sin^2(ka/2)}{m_1 m_2}}`,
      },
    ],
    plot: {
      title: 'dispersionPlot',
      xLabel: 'kAxis',
      yLabel: 'omegaAxis',
      series: [
        { points: ks.map((k) => [kx(k), branch(k, -1)]), kind: 'line', tone: 0, label: 'acoustic' },
        { points: ks.map((k) => [kx(k), branch(k, 1)]), kind: 'dash', tone: 1, label: 'optical' },
      ],
    },
  };
}
