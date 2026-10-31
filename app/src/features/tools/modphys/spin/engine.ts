// Angular momentum, spin, and qubits: exact Clebsch-Gordan coefficients (cg.ts), spin and typed matrices with their
// commutators and eigenvalues, spin-1/2 states through Stern-Gerlach analyzers, Larmor precession, and small
// circuits (circuit.ts). Angular momenta are in units of ħ.
import { cabs, cadd, cmul, conj, csub, ctext, cx, ZERO } from '../../kits/num/complex';
import type { Complex } from '../../kits/num/complex';
import { eigSymmetric } from '../../kits/num/matrix';
import { auto, fixed } from '../shared/calc';
import type { Calc, Item, Step } from '../shared/calc';
import { C } from '../shared/constants';
import { fail, positive } from '../shared/errors';
import { fmt, tex } from '../shared/format';
import type { Series } from '../shared/plot';
import { MAX_J2, clebschGordan, couplingTable, exactText, halfText, threeJ } from './cg';
import { basisLabel, gateText, run, stateText } from './circuit';
import type { Gate } from './circuit';

export type SpinKey =
  | 'coefficient'
  | 'decimal'
  | 'squared'
  | 'threeJ'
  | 'racah'
  | 'selection'
  | 'entry'
  | 'sx'
  | 'sy'
  | 'sz'
  | 'sPlus'
  | 'sMinus'
  | 'sSquared'
  | 'eigenvalues'
  | 'commutator'
  | 'anticommutator'
  | 'eigenA'
  | 'hermitian'
  | 'probability'
  | 'total'
  | 'stage'
  | 'bloch'
  | 'blochPlot'
  | 'blochX'
  | 'blochZ'
  | 'larmor'
  | 'larmorHz'
  | 'precession'
  | 'gamma'
  | 'state'
  | 'amplitude'
  | 'afterGate'
  | 'probPlot'
  | 'basis'
  | 'probAxis';

/** CODATA 2022 g-factors (NIST, public domain): the electron's magnitude and the proton's. */
export const G_ELECTRON = 2.00231930436092;
export const G_PROTON = 5.5856946893;
export const SPIN_SOURCES = ['CODATA 2022 electron and proton g-factors (NIST, public domain).'] as const;

/** The coefficient ⟨j1 m1; j2 m2 | J M⟩ with its exact form, square, 3j symbol, and Racah's sum. Doubled inputs. */
export function coupling(j1: number, m1: number, j2: number, m2: number, J: number, M: number): Calc<SpinKey> {
  const c = clebschGordan(j1, m1, j2, m2, J, M);
  const name = `⟨${halfText(j1)} ${halfText(m1)}; ${halfText(j2)} ${halfText(m2)} | ${halfText(J)} ${halfText(M)}⟩`;
  const squared = c.sign === 0 ? '0' : c.den === 1n ? `${c.num}` : `${c.num}/${c.den}`;
  const steps: Step<SpinKey>[] = [];
  if (c.zero)
    steps.push({
      key: 'selection',
      text:
        c.zero === 'projection' ? `M ≠ m₁ + m₂, so ${name} = 0` : `J is outside |j₁ − j₂| … j₁ + j₂, so ${name} = 0`,
    });
  else
    steps.push(
      {
        key: 'racah',
        text: `Racah's sum Σ_k (−1)^k / [k!(j₁+j₂−J−k)!(j₁−m₁−k)!(j₂+m₂−k)!(J−j₂+m₁+k)!(J−j₁−m₂+k)!] = ${c.terms.join(' ') || '0'}`,
        tex: `\\sum_k \\frac{(-1)^k}{k!\\,(j_1+j_2-J-k)!\\,(j_1-m_1-k)!\\,(j_2+m_2-k)!\\,(J-j_2+m_1+k)!\\,(J-j_1-m_2+k)!}`,
      },
      {
        key: 'coefficient',
        text: `${name} = ${exactText(c)} = ${fmt(c.value, 8)}`,
        tex: `\\langle j_1 m_1; j_2 m_2 | J M\\rangle = ${tex(c.value, 8)}`,
      },
    );
  return {
    items: [
      { key: 'coefficient', value: c.value, unit: '', text: `${name} = ${exactText(c)}` },
      fixed('decimal', c.value, '', 10),
      { key: 'squared', value: c.value ** 2, unit: '', text: squared },
      fixed('threeJ', threeJ(j1, m1, j2, m2, J, M), '', 10),
    ],
    steps,
  };
}

/** Every non-zero coefficient of j1 × j2 (doubled), as rows. */
export function table(j1: number, j2: number): Calc<SpinKey> {
  if (j1 < 0 || j2 < 0 || j1 > MAX_J2 || j2 > MAX_J2) fail('badSpin');
  const entries = couplingTable(j1, j2);
  return {
    items: entries.map(({ m1, m2, J, M, c }) => ({
      key: 'entry' as const,
      value: c.value,
      unit: '',
      text: `⟨${halfText(m1)}, ${halfText(m2)} | ${halfText(J)}, ${halfText(M)}⟩ = ${exactText(c)} = ${fmt(c.value, 6)}`,
    })),
    steps: [
      {
        key: 'entry',
        text:
          `j₁ = ${halfText(j1)}, j₂ = ${halfText(j2)}: J runs from ${halfText(Math.abs(j1 - j2))} to ` +
          `${halfText(j1 + j2)}; ${entries.length} non-zero coefficients`,
      },
    ],
  };
}

export type CMatrix = Complex[][];

/** Sx, Sy, Sz, S+, S− for spin s (doubled), rows and columns from m = s down to m = −s, in units of ħ. */
export function spinMatrices(s2: number): Record<'sx' | 'sy' | 'sz' | 'sPlus' | 'sMinus', CMatrix> {
  if (!Number.isInteger(s2) || s2 < 1 || s2 > 20) fail('badSpin');
  const n = s2 + 1;
  const s = s2 / 2;
  const zero = (): CMatrix => Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO));
  const plus = zero();
  const z = zero();
  for (let row = 0; row < n; row += 1) {
    const m = s - row;
    z[row]![row] = cx(m);
    // S+ |s m⟩ = √(s(s+1) − m(m+1)) |s m+1⟩: from column `row` (m) to row `row − 1` (m + 1).
    if (row > 0) plus[row - 1]![row] = cx(Math.sqrt(s * (s + 1) - m * (m + 1)));
  }
  const minus = adjoint(plus);
  const sx = combine(plus, minus, cx(0.5), cx(0.5));
  const sy = combine(plus, minus, cx(0, -0.5), cx(0, 0.5));
  return { sx, sy, sz: z, sPlus: plus, sMinus: minus };
}

const adjoint = (a: CMatrix): CMatrix => a[0]!.map((_, j) => a.map((row) => conj(row[j]!)));
const combine = (a: CMatrix, b: CMatrix, ka: Complex, kb: Complex): CMatrix =>
  a.map((row, i) => row.map((x, j) => cadd(cmul(ka, x), cmul(kb, b[i]![j]!))));

export function multiply(a: CMatrix, b: CMatrix): CMatrix {
  return a.map((row) => b[0]!.map((_, j) => row.reduce((sum, x, k) => cadd(sum, cmul(x, b[k]![j]!)), ZERO)));
}

export const isHermitian = (a: CMatrix): boolean =>
  a.every((row, i) => row.every((x, j) => cabs(csub(x, conj(a[j]![i]!))) <= 1e-12 * (1 + cabs(x))));

/** The eigenvalues of a Hermitian matrix, from the real symmetric matrix [[Re, −Im], [Im, Re]] (each twice). */
export function hermitianEigenvalues(a: CMatrix): number[] {
  const n = a.length;
  const big = Array.from({ length: 2 * n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) => {
      const x = a[i % n]![j % n]!;
      if (i < n === j < n) return x.re;
      return i < n ? -x.im : x.im;
    }),
  );
  const values = eigSymmetric(big).values.filter((_, k) => k % 2 === 0);
  // An exact zero eigenvalue comes back as rounding noise (−4.4×10⁻¹⁶); snap it so it prints as 0.
  const scale = Math.max(1, ...values.map(Math.abs));
  return values.map((v) => (Math.abs(v) < 1e-12 * scale ? 0 : v));
}

export const matrixText = (a: CMatrix): string =>
  a.map((row) => `[${row.map((x) => ctext(x, 6)).join(', ')}]`).join(' ');

/** The spin matrices for spin s (doubled), with S² and the eigenvalues of Sx. */
export function spinCalc(s2: number): Calc<SpinKey> {
  const m = spinMatrices(s2);
  const s = s2 / 2;
  const values = hermitianEigenvalues(m.sx);
  const items: Item<SpinKey>[] = (['sx', 'sy', 'sz', 'sPlus', 'sMinus'] as const).map((key) => ({
    key,
    value: 0,
    unit: '',
    text: matrixText(m[key]),
  }));
  items.unshift({ key: 'eigenvalues', value: values[0]!, unit: '', text: values.map((v) => fmt(v + 0, 6)).join(', ') });
  items.push(fixed('sSquared', s * (s + 1), 'ħ²', 6));
  return {
    items,
    steps: [
      {
        key: 'sPlus',
        text: `S₊|s m⟩ = ħ√(s(s+1) − m(m+1)) |s m+1⟩, with s = ${halfText(s2)} and m from ${halfText(s2)} down to ${halfText(-s2)}`,
        tex: `S_+|s\\,m\\rangle = \\hbar\\sqrt{s(s+1) - m(m+1)}\\,|s\\,m{+}1\\rangle`,
      },
      {
        key: 'sx',
        text: 'Sx = (S₊ + S₋)/2, Sy = (S₊ − S₋)/(2i), and S² = s(s+1)ħ² on every state',
        tex: `S_x = \\tfrac{1}{2}(S_+ + S_-),\\quad S_y = \\tfrac{1}{2i}(S_+ - S_-)`,
      },
    ],
  };
}

/** [A, B], {A, B}, and the eigenvalues of A when it is Hermitian. */
export function commutators(a: CMatrix, b: CMatrix): Calc<SpinKey> {
  if (a.length === 0 || b.length !== a.length || b[0]!.length !== a.length) fail('badMatrix');
  const ab = multiply(a, b);
  const ba = multiply(b, a);
  const items: Item<SpinKey>[] = [
    { key: 'commutator', value: 0, unit: '', text: matrixText(combine(ab, ba, cx(1), cx(-1))) },
    { key: 'anticommutator', value: 0, unit: '', text: matrixText(combine(ab, ba, cx(1), cx(1))) },
  ];
  const hermitian = isHermitian(a);
  if (hermitian) {
    const values = hermitianEigenvalues(a);
    items.push({ key: 'eigenA', value: values[0]!, unit: '', text: values.map((v) => fmt(v + 0, 6)).join(', ') });
  }
  return {
    items,
    steps: [
      {
        key: 'commutator',
        text: '[A, B] = AB − BA and {A, B} = AB + BA',
        tex: '[A,B] = AB - BA,\\quad \\{A,B\\} = AB + BA',
      },
      {
        key: 'hermitian',
        text: hermitian ? 'A equals its conjugate transpose, so its eigenvalues are real.' : 'A is not Hermitian.',
      },
    ],
  };
}

/** The spin-up state along the direction (θ, φ). */
export const spinor = (theta: number, phi: number): [Complex, Complex] => [
  cx(Math.cos(theta / 2)),
  cmul(cx(Math.cos(phi), Math.sin(phi)), cx(Math.sin(theta / 2))),
];
/** The spin-down state along (θ, φ). */
const spinorDown = (theta: number, phi: number): [Complex, Complex] => [
  cx(Math.sin(theta / 2)),
  cmul(cx(-Math.cos(phi), -Math.sin(phi)), cx(Math.cos(theta / 2))),
];

const inner = (a: readonly Complex[], b: readonly Complex[]) =>
  a.reduce((s, x, i) => cadd(s, cmul(conj(x), b[i]!)), ZERO);

export function blochVector(psi: readonly [Complex, Complex]): [number, number, number] {
  const [a, b] = psi;
  const ab = cmul(conj(a), b);
  return [2 * ab.re, 2 * ab.im, cabs(a) ** 2 - cabs(b) ** 2];
}

export interface Analyzer {
  /** The axis direction, radians. */
  theta: number;
  phi: number;
  /** Which beam goes on: +1 or −1. */
  keep: 1 | -1;
  name: string;
}

/** Reads analyzers such as "x+ z+ y- 45+" (a number is θ in degrees in the x-z plane). */
export function parseAnalyzers(text: string): Analyzer[] {
  const tokens = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 20) fail('badAnalyzers');
  return tokens.map((token) => {
    const m = /^([xyz]|[+-]?\d+(?:\.\d+)?)([+-])$/i.exec(token.replace(/[−–]/g, '-'));
    if (!m) fail('badAnalyzers');
    const axis = m[1]!.toLowerCase();
    const keep = m[2] === '+' ? 1 : -1;
    const deg = Math.PI / 180;
    const dir =
      axis === 'x'
        ? [90 * deg, 0]
        : axis === 'y'
          ? [90 * deg, 90 * deg]
          : axis === 'z'
            ? [0, 0]
            : [Number(axis) * deg, 0];
    return { theta: dir[0]!, phi: dir[1]!, keep, name: token };
  });
}

/** A spin-1/2 state through analyzers in turn: each stage's probability, the total, and the Bloch vectors. */
export function sternGerlach(theta: number, phi: number, analyzers: readonly Analyzer[]): Calc<SpinKey> {
  let psi = spinor(theta, phi);
  let total = 1;
  const items: Item<SpinKey>[] = [];
  const steps: Step<SpinKey>[] = [];
  const points: [number, number][] = [[blochVector(psi)[0], blochVector(psi)[2]]];
  analyzers.forEach((one, k) => {
    const out = one.keep === 1 ? spinor(one.theta, one.phi) : spinorDown(one.theta, one.phi);
    const p = cabs(inner(out, psi)) ** 2;
    total *= p;
    items.push({ key: 'stage', value: p, unit: '', text: `${k + 1}. ${one.name}: ${fmt(p, 6)}` });
    steps.push({
      key: 'stage',
      text: `P(${one.name}) = |⟨${one.name}|ψ⟩|² = ${fmt(p, 6)}; running product ${fmt(total, 6)}`,
    });
    psi = out;
    const v = blochVector(psi);
    points.push([v[0], v[2]]);
  });
  const v = blochVector(psi);
  items.unshift(fixed('total', total, '', 6));
  items.push({ key: 'bloch', value: v[2], unit: '', text: `(${v.map((x) => fmt(x + 0, 4)).join(', ')})` });
  const circle: [number, number][] = Array.from({ length: 73 }, (_, i) => [
    Math.cos((i * Math.PI) / 36),
    Math.sin((i * Math.PI) / 36),
  ]);
  const series: Series[] = [
    { points: circle, kind: 'line', tone: 0, label: 'Bloch sphere, x-z plane' },
    { points, kind: 'dots', tone: 1, label: 'states' },
  ];
  return {
    items,
    steps,
    plot: { title: 'blochPlot', xLabel: 'blochX', yLabel: 'blochZ', series, x: [-1.2, 1.2], y: [-1.2, 1.2] },
  };
}

/** Larmor precession of an electron or proton spin in a field B for a time t. */
export function larmor(b: number, time: number, particle: 'electron' | 'proton'): Calc<SpinKey> {
  positive(b, 'field');
  positive(time, 'time');
  const muN = (C.e * C.hbar) / (2 * C.mp);
  const gamma = particle === 'electron' ? (G_ELECTRON * C.muB) / C.hbar : (G_PROTON * muN) / C.hbar;
  const omega = gamma * b;
  const angle = omega * time;
  return {
    items: [
      fixed('larmor', omega, 'rad/s', 6),
      auto('larmorHz', omega / (2 * Math.PI), 'Hz', 6),
      fixed('gamma', gamma, 'rad/(s T)', 6),
      fixed('precession', ((angle * 180) / Math.PI) % 360, '°', 5),
    ],
    steps: [
      {
        key: 'larmor',
        text: `ω = γB = ${fmt(gamma)} rad/(s T) × ${fmt(b)} T = ${fmt(omega)} rad/s; f = ω/2π = ${fmt(omega / (2 * Math.PI))} Hz`,
        tex: `\\omega_L = \\gamma B = ${tex(omega)}\\ \\mathrm{rad/s}`,
      },
      {
        key: 'precession',
        text: `angle = ωt = ${fmt(angle)} rad, or ${fmt(((angle * 180) / Math.PI) % 360, 5)}° past whole turns`,
      },
    ],
  };
}

/** Runs a circuit and gives the final state, every basis probability, and the state after each gate. */
export function circuit(gates: readonly Gate[], n: number): Calc<SpinKey> {
  const history = run(gates, n);
  const last = history[history.length - 1]!;
  const items: Item<SpinKey>[] = [{ key: 'state', value: 0, unit: '', text: stateText(last, n) }];
  last.forEach((amp, index) => {
    const p = cabs(amp) ** 2;
    if (p > 1e-12)
      items.push({ key: 'probability', value: p, unit: '', text: `${basisLabel(index, n)}: ${fmt(p, 6)}` });
  });
  const steps: Step<SpinKey>[] = gates.map((gate, k) => ({
    key: 'afterGate',
    text: `${k + 1}. ${gateText(gate)} → ${stateText(history[k + 1]!, n)}`,
  }));
  steps.unshift({ key: 'afterGate', text: `0. start → ${basisLabel(0, n)}` });
  const sticks: [number, number][] = last.map((amp, index) => [index, cabs(amp) ** 2]);
  return {
    items,
    steps,
    plot: {
      title: 'probPlot',
      xLabel: 'basis',
      yLabel: 'probAxis',
      series: [{ points: sticks, kind: 'sticks', tone: 0 }],
      x: [-0.5, 2 ** n - 0.5],
      y: [0, 1],
    },
  };
}
