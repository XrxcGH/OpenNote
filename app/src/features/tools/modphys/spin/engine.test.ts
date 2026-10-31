import { describe, expect, it } from 'vitest';
import { cabs } from '../../kits/num/complex';
import { PhysicsError } from '../shared/errors';
import { clebschGordan, couplingTable, exactText, halfText, parseHalf, threeJ } from './cg';
import { PRESETS, parseCircuit, run } from './circuit';
import {
  circuit,
  commutators,
  coupling,
  hermitianEigenvalues,
  larmor,
  parseAnalyzers,
  spinMatrices,
  sternGerlach,
} from './engine';
import { NAMED, parseComplex, parseMatrix } from './matrices';

const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;
// Doubled angular momenta: 1 is 2, 1/2 is 1.
const cg = (j1: number, m1: number, j2: number, m2: number, J: number, M: number) =>
  clebschGordan(2 * j1, 2 * m1, 2 * j2, 2 * m2, 2 * J, 2 * M);

describe('Clebsch-Gordan coefficients', () => {
  it('gives the planning values exactly', () => {
    const a = cg(0.5, 0.5, 0.5, -0.5, 1, 0);
    expect(exactText(a)).toBe('1/√2');
    expect(Math.abs(a.value - Math.SQRT1_2)).toBeLessThan(1e-12);
    const b = cg(1, 1, 1, -1, 0, 0);
    expect(exactText(b)).toBe('1/√3');
    expect(Math.abs(b.value - 1 / Math.sqrt(3))).toBeLessThan(1e-12);
    const c = cg(1, 0, 1, 0, 2, 0);
    expect(exactText(c)).toBe('√(2/3)');
    expect(Math.abs(c.value - Math.sqrt(2 / 3))).toBeLessThan(1e-12);
    expect(cg(1, 0, 1, 0, 1, 0).value).toBe(0);
  });

  it('gives the singlet sign and the stretched state', () => {
    expect(cg(0.5, -0.5, 0.5, 0.5, 0, 0).value).toBeCloseTo(-Math.SQRT1_2, 14);
    expect(exactText(cg(1.5, 1.5, 1, 1, 2.5, 2.5))).toBe('1');
  });

  it('obeys the selection rules and orthonormality of a full table', () => {
    expect(cg(1, 1, 1, 0, 2, 0).zero).toBe('projection');
    expect(cg(1, 0, 0.5, 0.5, 2.5, 0.5).zero).toBe('triangle');
    // Σ over m1, m2 of ⟨…|J M⟩² is 1 for every J, M of 1 × 3/2.
    const sums = new Map<string, number>();
    for (const e of couplingTable(2, 3)) sums.set(`${e.J} ${e.M}`, (sums.get(`${e.J} ${e.M}`) ?? 0) + e.c.value ** 2);
    expect(sums.size).toBe(12);
    for (const sum of sums.values()) expect(sum).toBeCloseTo(1, 12);
  });

  it('gives the 3j symbol with its phase', () => {
    // (1/2 1/2 1; 1/2 −1/2 0) = (−1)^(1/2 − 1/2 + 0) ⟨…|1 0⟩ / √3 = 1/√6.
    expect(threeJ(1, 1, 1, -1, 2, 0)).toBeCloseTo(1 / Math.sqrt(6), 14);
    expect(item(coupling(1, 1, 1, -1, 2, 0), 'threeJ')).toBeCloseTo(1 / Math.sqrt(6), 14);
  });

  it('reads half-whole values and refuses impossible ones', () => {
    expect(parseHalf('3/2')).toBe(3);
    expect(parseHalf('−1/2')).toBe(-1);
    expect(parseHalf('0.5')).toBe(1);
    expect(halfText(-3)).toBe('−3/2');
    expect(() => parseHalf('1/3')).toThrow(PhysicsError);
    expect(() => parseHalf('0.3')).toThrow(PhysicsError);
    expect(() => cg(0.5, 1.5, 0.5, 0.5, 1, 1)).toThrow(PhysicsError);
    expect(() => clebschGordan(2, 1, 1, 1, 1, 2)).toThrow(PhysicsError);
    expect(() => couplingTable(20, 2)).toThrow(PhysicsError);
  });
});

describe('spin matrices', () => {
  it('gives the spin-1 Sx with eigenvalues −1, 0, 1', () => {
    const { sx } = spinMatrices(2);
    const r = Math.SQRT1_2;
    const want = [
      [0, r, 0],
      [r, 0, r],
      [0, r, 0],
    ];
    sx.forEach((row, i) =>
      row.forEach((x, j) => expect(Math.abs(x.re - want[i]![j]!) + Math.abs(x.im)).toBeLessThan(1e-12)),
    );
    const values = hermitianEigenvalues(sx);
    [-1, 0, 1].forEach((v, k) => expect(Math.abs(values[k]! - v)).toBeLessThan(1e-12));
    // The middle eigenvalue of spin-1 Sx is exactly 0 (m = 0), not rounding noise.
    expect(values[1]).toBe(0);
  });

  it('obeys [Sx, Sy] = i Sz for spin 3/2', () => {
    const m = spinMatrices(3);
    const calc = commutators(m.sx, m.sy);
    expect(calc.items[0]!.key).toBe('commutator');
    const n = 4;
    const ab = m.sx.map((row) =>
      m.sy[0]!.map((_, j) => row.reduce((s, x, k) => s + x.re * m.sy[k]![j]!.im + x.im * m.sy[k]![j]!.re, 0)),
    );
    const ba = m.sy.map((row) =>
      m.sx[0]!.map((_, j) => row.reduce((s, x, k) => s + x.re * m.sx[k]![j]!.im + x.im * m.sx[k]![j]!.re, 0)),
    );
    for (let i = 0; i < n; i += 1) expect(ab[i]![i]! - ba[i]![i]!).toBeCloseTo(m.sz[i]![i]!.re, 12);
  });

  it('gives the Pauli and Dirac algebra', () => {
    expect(hermitianEigenvalues(NAMED.pauliY!)).toEqual([expect.closeTo(-1, 12), expect.closeTo(1, 12)]);
    // {γ0, γ1} = 0, and γ0 is Hermitian with eigenvalues −1, −1, 1, 1.
    expect(commutators(NAMED.gamma0!, NAMED.gamma1!).items[1]!.text).toBe(
      '[0, 0, 0, 0] [0, 0, 0, 0] [0, 0, 0, 0] [0, 0, 0, 0]',
    );
    expect(commutators(NAMED.gamma1!, NAMED.gamma0!).items.some((one) => one.key === 'eigenA')).toBe(false);
  });

  it('reads typed complex matrices and refuses a ragged one', () => {
    expect(parseComplex('1+2i')).toEqual({ re: 1, im: 2 });
    expect(parseComplex('-i')).toEqual({ re: 0, im: -1 });
    expect(parseComplex('1/2')).toEqual({ re: 0.5, im: 0 });
    expect(parseComplex('2-0.5i')).toEqual({ re: 2, im: -0.5 });
    expect(parseMatrix('0 -i\ni 0')[0]![1]).toEqual({ re: 0, im: -1 });
    expect(() => parseMatrix('1 2\n3')).toThrow(PhysicsError);
    expect(() => parseComplex('abc')).toThrow(PhysicsError);
    expect(() => spinMatrices(0)).toThrow(PhysicsError);
  });
});

describe('Stern-Gerlach analyzers and precession', () => {
  it('gives P(+x) = 1/2 and then P(+z) = 1/2 for spin up along z', () => {
    const calc = sternGerlach(0, 0, parseAnalyzers('x+ z+'));
    const stages = calc.items.filter((one) => one.key === 'stage').map((one) => one.value);
    expect(Math.abs(stages[0]! - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(stages[1]! - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(item(calc, 'total') - 0.25)).toBeLessThan(1e-12);
  });

  it('gives cos²(θ/2) for an analyzer at θ and blocks the opposite beam', () => {
    const calc = sternGerlach(0, 0, parseAnalyzers('60+'));
    expect(item(calc, 'total')).toBeCloseTo(Math.cos(Math.PI / 6) ** 2, 12);
    expect(item(sternGerlach(0, 0, parseAnalyzers('z-')), 'total')).toBeCloseTo(0, 14);
    expect(() => parseAnalyzers('q+')).toThrow(PhysicsError);
  });

  it('gives the electron Larmor frequency of 28.025 GHz in 1 T', () => {
    // γe/2π = 28 024.951 MHz/T (CODATA 2022).
    expect(item(larmor(1, 1e-9, 'electron'), 'larmorHz') / 1e9).toBeCloseTo(28.024951, 5);
    // γp/2π = 42.577 478 MHz/T (CODATA 2022).
    expect(item(larmor(1, 1e-9, 'proton'), 'larmorHz') / 1e6).toBeCloseTo(42.577478, 5);
    expect(() => larmor(0, 1, 'electron')).toThrow(PhysicsError);
  });
});

describe('qubit circuits', () => {
  it('gives (|00⟩ + |11⟩)/√2 from H then CNOT', () => {
    const state = run(parseCircuit('H 0\nCNOT 0 1', 2), 2).at(-1)!;
    expect(cabs(state[0]!) ** 2).toBeCloseTo(0.5, 14);
    expect(Math.abs(state[3]!.re - Math.SQRT1_2)).toBeLessThan(1e-12);
    expect(cabs(state[1]!) + cabs(state[2]!)).toBeLessThan(1e-14);
  });

  it('finds |11⟩ with certainty after one Grover iteration', () => {
    const calc = circuit(parseCircuit(PRESETS.grover.text, 2), 2);
    const state = run(parseCircuit(PRESETS.grover.text, 2), 2).at(-1)!;
    expect(Math.abs(cabs(state[3]!) ** 2 - 1)).toBeLessThan(1e-12);
    expect(calc.items.filter((one) => one.key === 'probability')).toHaveLength(1);
  });

  it('tells a balanced function from a constant one with Deutsch-Jozsa', () => {
    const p1 = (text: string) => {
      const state = run(parseCircuit(text, 2), 2).at(-1)!;
      return cabs(state[2]!) ** 2 + cabs(state[3]!) ** 2;
    };
    expect(p1(PRESETS.deutschBalanced.text)).toBeCloseTo(1, 12);
    expect(p1(PRESETS.deutschConstant.text)).toBeCloseTo(0, 12);
  });

  it('runs a Toffoli, a SWAP, and rotations', () => {
    const state = run(parseCircuit('X 0\nX 1\nCCX 0 1 2\nSWAP 0 2', 3), 3).at(-1)!;
    expect(cabs(state[0b111]!)).toBeCloseTo(1, 14);
    const rx = run(parseCircuit('RX 0 3.141592653589793', 1), 1).at(-1)!;
    expect(cabs(rx[1]!)).toBeCloseTo(1, 14);
  });

  it('refuses unknown gates, a qubit out of range, and six qubits', () => {
    expect(() => parseCircuit('FOO 0', 2)).toThrow(PhysicsError);
    expect(() => parseCircuit('H 2', 2)).toThrow(PhysicsError);
    expect(() => parseCircuit('CNOT 0 0', 2)).toThrow(PhysicsError);
    expect(() => parseCircuit('H 0', 6)).toThrow(PhysicsError);
    expect(parseCircuit('', 2)).toEqual([]);
  });
});
