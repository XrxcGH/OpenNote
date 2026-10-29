// Mass spectra from a formula: monoisotopic and average masses, the isotope pattern by expanding each element's
// isotope distribution with pruning, the M+1 and M+2 ratios, the nitrogen rule, and the degree of unsaturation.
// Isotope masses and abundances are typed from the NIST table of atomic weights and isotopic compositions.
import { parseFormula } from '../../chem/calc/formula';
import { fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail } from '../shared/errors';
import { fmt } from '../shared/format';
import type { MolKey } from './spectra';

export const ISOTOPE_SOURCE =
  'NIST Atomic Weights and Isotopic Compositions (Coursey et al., NIST Standard Reference Database 144), public domain.';

/** Isotopes as [mass number, mass in u, abundance]. */
export const ISOTOPES: Record<string, readonly (readonly [number, number, number])[]> = {
  H: [
    [1, 1.00782503223, 0.999885],
    [2, 2.01410177812, 0.000115],
  ],
  B: [
    [10, 10.01293695, 0.199],
    [11, 11.00930536, 0.801],
  ],
  C: [
    [12, 12, 0.9893],
    [13, 13.00335483507, 0.0107],
  ],
  N: [
    [14, 14.00307400443, 0.99636],
    [15, 15.00010889888, 0.00364],
  ],
  O: [
    [16, 15.99491461957, 0.99757],
    [17, 16.9991317565, 0.00038],
    [18, 17.99915961286, 0.00205],
  ],
  F: [[19, 18.99840316273, 1]],
  Na: [[23, 22.989769282, 1]],
  Si: [
    [28, 27.97692653465, 0.92223],
    [29, 28.9764946649, 0.04685],
    [30, 29.973770136, 0.03092],
  ],
  P: [[31, 30.97376199842, 1]],
  S: [
    [32, 31.9720711744, 0.9499],
    [33, 32.9714589098, 0.0075],
    [34, 33.967867004, 0.0425],
    [36, 35.96708071, 0.0001],
  ],
  Cl: [
    [35, 34.968852682, 0.7576],
    [37, 36.965902602, 0.2424],
  ],
  K: [
    [39, 38.9637064864, 0.932581],
    [40, 39.963998166, 0.000117],
    [41, 40.9618252579, 0.067302],
  ],
  Br: [
    [79, 78.9183376, 0.5069],
    [81, 80.9162897, 0.4931],
  ],
  I: [[127, 126.9044719, 1]],
};

/** A typed isotope such as 12C, 13C, 35Cl, or D; or a number taken as a mass in u. */
export function isotopeMass(text: string): number {
  const raw = text.trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw === 'D') return ISOTOPES.H![1]![1];
  const m = /^(\d+)([A-Z][a-z]?)$/.exec(raw);
  if (!m) fail('badIsotope');
  const found = ISOTOPES[m[2]!]?.find(([a]) => a === Number(m[1]));
  if (!found) fail('badIsotope');
  return found[1];
}

/** The parsed formula, with every element in the isotope table. */
export function composition(formula: string): Map<string, number> {
  const parts = parseFormula(formula);
  if (!parts || parts.size === 0) fail('badFormula');
  for (const [symbol, count] of parts) {
    if (!ISOTOPES[symbol]) fail('unknownElement');
    if (!Number.isInteger(count) || count > 500) fail('badFormula');
  }
  return parts;
}

type Peak = [number, number];

/** Convolves two peak lists, keeping peaks at least `floor` times the largest. */
function convolve(a: readonly Peak[], b: readonly Peak[], floor: number): Peak[] {
  const out = new Map<string, Peak>();
  for (const [ma, pa] of a)
    for (const [mb, pb] of b) {
      const mass = ma + mb;
      const key = mass.toFixed(4);
      const old = out.get(key);
      out.set(key, old ? [(old[0] * old[1] + mass * pa * pb) / (old[1] + pa * pb), old[1] + pa * pb] : [mass, pa * pb]);
    }
  const peaks = [...out.values()];
  const top = Math.max(...peaks.map(([, p]) => p));
  return peaks.filter(([, p]) => p >= floor * top);
}

/** The isotope pattern grouped by nominal mass: [nominal mass, mean exact mass, abundance]. */
export function isotopePattern(parts: Map<string, number>, floor = 1e-9): [number, number, number][] {
  let peaks: Peak[] = [[0, 1]];
  for (const [symbol, count] of parts) {
    const iso: Peak[] = ISOTOPES[symbol]!.map(([, mass, p]) => [mass, p]);
    // Raise the element's distribution to the count by repeated squaring.
    let power: Peak[] = iso;
    let n = count;
    let acc: Peak[] = [[0, 1]];
    while (n > 0) {
      if (n & 1) acc = convolve(acc, power, floor);
      n >>= 1;
      if (n > 0) power = convolve(power, power, floor);
    }
    peaks = convolve(peaks, acc, floor);
  }
  const groups = new Map<number, [number, number]>();
  for (const [mass, p] of peaks) {
    const nominal = Math.round(mass);
    const old = groups.get(nominal) ?? [0, 0];
    groups.set(nominal, [old[0] + mass * p, old[1] + p]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([nominal, [sum, p]]) => [nominal, sum / p, p]);
}

/** Degree of unsaturation: C − H/2 − X/2 + N/2 + 1, with Si counted as C and P as N. */
export function unsaturation(parts: Map<string, number>): number {
  const n = (symbol: string) => parts.get(symbol) ?? 0;
  const c = n('C') + n('Si');
  const h = n('H') + n('F') + n('Cl') + n('Br') + n('I') + n('Na') + n('K');
  return c - h / 2 + (n('N') + n('P') + n('B')) / 2 + 1;
}

/** Masses, the isotope pattern relative to the monoisotopic peak, the nitrogen rule, and unsaturation. */
export function massSpectrum(formula: string): Calc<MolKey> {
  const parts = composition(formula);
  let mono = 0;
  let average = 0;
  let nominal = 0;
  for (const [symbol, count] of parts) {
    const iso = ISOTOPES[symbol]!;
    const main = [...iso].sort((a, b) => b[2] - a[2])[0]!;
    // The monoisotopic mass uses each element's most abundant isotope.
    mono += count * main[1];
    nominal += count * main[0];
    average += count * iso.reduce((s, [, m, p]) => s + m * p, 0);
  }
  const pattern = isotopePattern(parts);
  const base = pattern.find(([m]) => m === nominal)?.[2] ?? 1;
  const ratio = (k: number) => (pattern.find(([m]) => m === nominal + k)?.[2] ?? 0) / base;
  const dbe = unsaturation(parts);
  const nitrogen = (parts.get('N') ?? 0) % 2 === 1;
  const items: Item<MolKey>[] = [
    fixed('mono', mono, 'u', 10),
    fixed('average', average, 'u', 8),
    fixed('nominal', nominal, 'u', 6),
    fixed('mPlus1', 100 * ratio(1), '%', 5),
    fixed('mPlus2', 100 * ratio(2), '%', 5),
    fixed('dbe', dbe, '', 4),
    {
      key: nitrogen ? 'nitrogenOdd' : 'nitrogenEven',
      value: parts.get('N') ?? 0,
      unit: '',
      text: `N = ${parts.get('N') ?? 0}`,
    },
    ...pattern
      .filter(([, , p]) => p / base >= 1e-4)
      .map(([m, exact, p]): Item<MolKey> => ({
        key: 'peak',
        value: p / base,
        unit: '',
        text: `M${m === nominal ? '' : `${m > nominal ? '+' : '−'}${Math.abs(m - nominal)}`} (${fmt(exact, 8)}): ${fmt(p / base, 5)}`,
      })),
  ];
  const steps: Step<MolKey>[] = [
    {
      key: 'mono',
      text: [...parts]
        .map(([symbol, count]) => {
          const main = [...ISOTOPES[symbol]!].sort((a, b) => b[2] - a[2])[0]!;
          return `${count} × ${main[0]}${symbol} ${fmt(main[1], 11)} u`;
        })
        .join(' + '),
    },
    {
      key: 'peak',
      text:
        'Each element’s isotope distribution is raised to its count and the results are convolved; peaks below ' +
        '1e-9 of the largest are dropped.',
    },
    {
      key: 'dbe',
      text: `DBE = C − H/2 − X/2 + N/2 + 1 = ${fmt(dbe, 4)}`,
      tex: `\\mathrm{DBE} = C - \\frac{H}{2} - \\frac{X}{2} + \\frac{N}{2} + 1 = ${fmt(dbe, 4)}`,
    },
  ];
  return {
    items,
    steps,
    plot: {
      title: 'patternPlot',
      xLabel: 'massAxis',
      yLabel: 'relativeAxis',
      series: [
        {
          points: pattern.filter(([, , p]) => p / base >= 1e-4).map(([m, , p]) => [m, p / base]),
          kind: 'sticks',
          tone: 0,
        },
      ],
      y: [0, Math.max(1, ...pattern.map(([, , p]) => p / base)) * 1.1],
    },
  };
}
