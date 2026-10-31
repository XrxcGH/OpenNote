// First-order NMR multiplets as splitting trees with Pascal intensities, integration to proton counts, and polymer
// chain statistics: molar-mass averages, Carothers' equation, freely jointed and worm-like chains, and Flory-Huggins.
import { fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { fail, fraction, positive, whole } from '../shared/errors';
import { fmt, tex } from '../shared/format';
import type { MolKey } from './spectra';

/** Reads lines of numbers separated by spaces or commas (also semicolons between lines). */
export function parseRows(text: string, width: number): number[][] {
  const rows = text
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((part) => Number(part.replace(/[−–]/g, '-'))),
    );
  if (
    rows.length === 0 ||
    rows.length > 500 ||
    rows.some((row) => row.length !== width || row.some((x) => !Number.isFinite(x)))
  )
    fail('badList');
  return rows;
}

/** Splits one line by each coupling J (Hz) to n equivalent spin-½ nuclei, in turn. */
export function multiplet(couplings: readonly (readonly [number, number])[]): {
  lines: [number, number][];
  tree: [number, number][][];
} {
  if (couplings.length === 0 || couplings.length > 8) fail('badCouplings');
  for (const [j, n] of couplings) {
    if (!Number.isFinite(j) || j < 0) fail('badCouplings');
    if (!Number.isInteger(n) || n < 1 || n > 12) fail('badCouplings');
  }
  let lines: [number, number][] = [[0, 1]];
  const tree = [lines];
  for (const [j, n] of couplings) {
    const next = new Map<string, [number, number]>();
    for (const [x, w] of lines)
      for (let k = 0; k <= n; k += 1) {
        // Pascal's row n: C(n, k).
        let c = 1;
        for (let q = 1; q <= k; q += 1) c = (c * (n - q + 1)) / q;
        const at = x + (k - n / 2) * j;
        const key = at.toFixed(6);
        const old = next.get(key);
        next.set(key, [at, (old?.[1] ?? 0) + (w * c) / 2 ** n]);
      }
    lines = [...next.values()].sort((a, b) => a[0] - b[0]);
    tree.push(lines);
  }
  return { lines, tree };
}

/** A multiplet at a shift (ppm) on a spectrometer of a given frequency (MHz): positions in Hz and ppm. */
export function nmr(couplings: readonly (readonly [number, number])[], shift: number, mhz: number): Calc<MolKey> {
  positive(mhz, 'spectrometer');
  if (!Number.isFinite(shift)) fail('badList');
  const { lines, tree } = multiplet(couplings);
  const smallest = Math.min(...lines.map(([, w]) => w));
  const name = couplings.map(([, n]) => 'dtqp'[n - 1] ?? `(${n + 1})`).join('');
  return {
    items: [
      { key: 'multiplicity', value: lines.length, unit: '', text: `${name}, ${lines.length}` },
      ...lines.map(([hz, w]): Item<MolKey> => ({
        key: 'nmrLine',
        value: hz,
        unit: 'Hz',
        text: `${fmt(hz + 0, 6)} Hz (${fmt(shift + hz / mhz, 6)} ppm): ${fmt(w / smallest, 4)}`,
      })),
    ],
    steps: tree.slice(1).map((stage, k): Step<MolKey> => ({
      key: 'tree',
      text: `J = ${fmt(couplings[k]![0])} Hz to ${couplings[k]![1]} nuclei: ${stage.map(([x]) => fmt(x + 0, 6)).join(', ')} Hz`,
    })),
    plot: {
      title: 'nmrPlot',
      xLabel: 'hzAxis',
      yLabel: 'intensityAxis',
      series: [
        { points: lines.map(([x, w]) => [x, w / Math.max(...lines.map(([, v]) => v))]), kind: 'sticks', tone: 0 },
      ],
      y: [0, 1.1],
      reverseX: true,
    },
  };
}

/** Integrals scaled to a total proton count, each rounded to the nearest whole proton. */
export function integration(integrals: readonly number[], total: number): Calc<MolKey> {
  whole(total, 'protons', 1);
  if (integrals.length === 0 || integrals.some((x) => !(x > 0))) fail('badList');
  const sum = integrals.reduce((a, b) => a + b, 0);
  const counts = integrals.map((x) => (x / sum) * total);
  return {
    items: counts.map((n, k): Item<MolKey> => ({
      key: 'protons',
      value: n,
      unit: 'H',
      text: `${k + 1}: ${fmt(n, 4)} → ${Math.round(n)} H`,
    })),
    steps: [{ key: 'protons', text: `n_i = I_i / ΣI × ${total} with ΣI = ${fmt(sum)}` }],
  };
}

/** Mn, Mw, Mz, and dispersity from chains given as rows of [count, molar mass]. */
export function molarMasses(rows: readonly (readonly number[])[], p?: number): Calc<MolKey> {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (const [n, m] of rows) {
    positive(n!, 'count');
    positive(m!, 'molarMass');
    s0 += n!;
    s1 += n! * m!;
    s2 += n! * m! ** 2;
    s3 += n! * m! ** 3;
  }
  const mn = s1 / s0;
  const mw = s2 / s1;
  const items: Item<MolKey>[] = [
    fixed('mn', mn, 'g/mol', 8),
    fixed('mw', mw, 'g/mol', 8),
    fixed('mz', s3 / s2, 'g/mol', 8),
    fixed('dispersity', mw / mn, '', 6),
  ];
  const steps: Step<MolKey>[] = [
    {
      key: 'mn',
      text: `Mn = ΣNM / ΣN = ${fmt(s1)} / ${fmt(s0)} = ${fmt(mn, 8)}; Mw = ΣNM² / ΣNM = ${fmt(mw, 8)}; Đ = Mw/Mn = ${fmt(mw / mn, 6)}`,
      tex: `M_n = \\frac{\\sum N_i M_i}{\\sum N_i},\\quad M_w = \\frac{\\sum N_i M_i^2}{\\sum N_i M_i},\\quad Đ = ${tex(mw / mn, 6)}`,
    },
  ];
  if (p !== undefined) {
    fraction(p, 'conversion');
    if (p === 1) fail('fullConversion');
    items.push(fixed('xn', 1 / (1 - p), '', 8));
    steps.push({
      key: 'xn',
      text: `Carothers: Xn = 1 / (1 − p) = 1 / (1 − ${fmt(p)}) = ${fmt(1 / (1 - p), 8)}`,
      tex: `X_n = \\frac{1}{1-p}`,
    });
  }
  return { items, steps };
}

/** A freely jointed chain of N segments of length b, and a worm-like chain of contour N b and persistence P. */
export function chain(n: number, b: number, persistence?: number): Calc<MolKey> {
  positive(n, 'segments');
  positive(b, 'segmentLength');
  const rms = Math.sqrt(n) * b;
  const contour = n * b;
  const items: Item<MolKey>[] = [
    { key: 'rms', value: rms, unit: 'm', sig: 6 },
    { key: 'radiusGyration', value: rms / Math.sqrt(6), unit: 'm', sig: 6 },
    { key: 'contour', value: contour, unit: 'm', sig: 6 },
  ];
  const steps: Step<MolKey>[] = [
    {
      key: 'rms',
      text: `R_rms = √N b = √${fmt(n)} × ${fmt(b)} m = ${fmt(rms, 6)} m; R_g = R_rms / √6`,
      tex: `R_\\mathrm{rms} = \\sqrt{N}\\,b,\\quad R_g = R_\\mathrm{rms}/\\sqrt6`,
    },
  ];
  if (persistence !== undefined) {
    positive(persistence, 'persistence');
    const x = contour / persistence;
    const r2 = 2 * persistence * contour * (1 + Math.expm1(-x) / x);
    items.push({ key: 'wlc', value: Math.sqrt(r2), unit: 'm', sig: 6 });
    steps.push({
      key: 'wlc',
      text: `⟨R²⟩ = 2PL[1 − (P/L)(1 − e^(−L/P))] with L = ${fmt(contour)} m, P = ${fmt(persistence)} m: R = ${fmt(Math.sqrt(r2), 6)} m`,
      tex: `\\langle R^2\\rangle = 2PL\\left[1 - \\frac{P}{L}\\left(1 - e^{-L/P}\\right)\\right]`,
    });
  }
  return { items, steps };
}

/** Flory-Huggins ΔG_mix / (RT per lattice site) = (φ/N₁) ln φ + ((1 − φ)/N₂) ln(1 − φ) + χ φ (1 − φ), and χc. */
export function floryHuggins(n1: number, n2: number, chi: number, phi: number): Calc<MolKey> {
  positive(n1, 'chainLength');
  positive(n2, 'chainLength');
  if (!Number.isFinite(chi)) fail('badList');
  fraction(phi, 'volumeFraction');
  if (phi === 0 || phi === 1) fail('pureComponent');
  const g = (x: number) => (x / n1) * Math.log(x) + ((1 - x) / n2) * Math.log(1 - x) + chi * x * (1 - x);
  const chiC = 0.5 * (1 / Math.sqrt(n1) + 1 / Math.sqrt(n2)) ** 2;
  const phiC = Math.sqrt(n2) / (Math.sqrt(n1) + Math.sqrt(n2));
  const curve: [number, number][] = Array.from({ length: 99 }, (_, i) => [(i + 1) / 100, g((i + 1) / 100)]);
  return {
    items: [fixed('mixing', g(phi), 'RT per site', 6), fixed('chiC', chiC, '', 8), fixed('phiC', phiC, '', 6)],
    steps: [
      {
        key: 'mixing',
        text: `ΔG/RT = (φ/N₁) ln φ + ((1 − φ)/N₂) ln(1 − φ) + χφ(1 − φ) = ${fmt(g(phi), 6)} at φ = ${fmt(phi)}`,
        tex: `\\frac{\\Delta G_\\mathrm{mix}}{RT} = \\frac{\\phi}{N_1}\\ln\\phi + \\frac{1-\\phi}{N_2}\\ln(1-\\phi) + \\chi\\phi(1-\\phi)`,
      },
      {
        key: 'chiC',
        text: `χc = ½(1/√N₁ + 1/√N₂)² = ${fmt(chiC, 8)}; φc = √N₂ / (√N₁ + √N₂) = ${fmt(phiC, 6)}`,
        tex: `\\chi_c = \\tfrac12\\left(\\frac{1}{\\sqrt{N_1}} + \\frac{1}{\\sqrt{N_2}}\\right)^2 = ${tex(chiC, 8)}`,
      },
    ],
    plot: {
      title: 'mixPlot',
      xLabel: 'phiAxis',
      yLabel: 'freeAxis',
      series: [{ points: curve, kind: 'line', tone: 0 }],
    },
  };
}
