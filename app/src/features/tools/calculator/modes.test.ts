// The calculator's other modes: programmer, statistics, matrix, and the history they share.
import { describe, expect, it } from 'vitest';
import { addEntry, restoreEntries } from './modeHistory';
import {
  add,
  determinant,
  inverse,
  matrixLatex,
  multiply,
  rank,
  readMatrix,
  rref,
  solve,
  transpose,
  writeMatrix,
} from './matrix';
import { evaluateProgrammer, inBases, writeIn } from './programmer';
import type { ProgrammerOptions } from './programmer';
import { quantile, readData, regress, summarize } from './statistics';

const value = (source: string, options?: Partial<ProgrammerOptions>) => {
  const result = evaluateProgrammer(source, { base: 10, bits: 32, signed: true, ...options });
  return result.ok ? result.value : result.error;
};

describe('programmer mode', () => {
  it('works in each base, with prefixes that override it', () => {
    expect(value('FF + 1', { base: 16 })).toBe(256n);
    expect(value('1010 + 1', { base: 2 })).toBe(11n);
    expect(value('17', { base: 8 })).toBe(15n);
    expect(value('0xFF + 0b11 + 0o10 + 5')).toBe(271n);
    expect(value('9', { base: 8 })).toBe('bad-digit');
  });

  it('has bitwise operators, as signs and as words, with the usual precedence', () => {
    expect(value('6 & 3')).toBe(2n);
    expect(value('6 | 3')).toBe(7n);
    expect(value('6 ^ 3')).toBe(5n);
    expect(value('6 xor 3 and 1')).toBe(7n);
    expect(value('1 << 4 + 1')).toBe(32n);
    expect(value('~0')).toBe(-1n);
    expect(value('not 0', { signed: false })).toBe(4294967295n);
    expect(value('-16 >> 2')).toBe(-4n);
    expect(value('7 / 2')).toBe(3n);
    expect(value('-7 mod 3')).toBe(-1n);
    expect(value('(1 + 2) * 3')).toBe(9n);
  });

  it('wraps every step to the word, signed or not', () => {
    expect(value('0x7F + 1', { bits: 8 })).toBe(-128n);
    expect(value('255 + 1', { bits: 8, signed: false })).toBe(0n);
    expect(value('0xFFFFFFFFFFFFFFFF', { bits: 64, signed: false })).toBe(18446744073709551615n);
    expect(value('1 << 63', { bits: 64 })).toBe(-9223372036854775808n);
  });

  it('says what went wrong instead of throwing', () => {
    expect(value('')).toBe('empty');
    expect(value('1 / 0')).toBe('divide-by-zero');
    expect(value('1 +')).toBe('syntax');
    expect(value('(1')).toBe('syntax');
    expect(value('2 $ 3')).toBe('syntax');
    expect(value('1'.repeat(2000))).toBe('too-long');
  });

  it('shows a value in all four bases, with the word bits for a negative value', () => {
    expect(inBases(-1n, { bits: 8 })).toEqual({ hex: 'FF', dec: '-1', oct: '377', bin: '1111 1111' });
    expect(inBases(48879n, { bits: 32 })).toEqual({
      hex: 'BEEF',
      dec: '48879',
      oct: '137357',
      bin: '1011 1110 1110 1111',
    });
    expect(writeIn(-2n, { base: 16, bits: 16, signed: true })).toBe('FFFE');
  });
});

describe('statistics mode', () => {
  it('reads a list or pairs from typed or pasted text', () => {
    expect(readData('1, 2, 3\n4')).toEqual({ ok: true, data: { xs: [1, 2, 3, 4] } });
    expect(readData('1 2\n3 4\n5 6')).toEqual({ ok: true, data: { xs: [1, 3, 5], ys: [2, 4, 6] } });
    expect(readData('1, two')).toEqual({ ok: false, error: 'not-a-number', text: 'two' });
    expect(readData('  ')).toEqual({ ok: false, error: 'empty', text: '' });
  });

  it('summarizes a list', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.count).toBe(8);
    expect(s.sum).toBe(40);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.modes).toEqual([4]);
    expect(s.range).toBe(7);
    expect(s.populationSd).toBe(2);
    expect(s.sampleVariance).toBeCloseTo(32 / 7, 12);
    expect(s.q1).toBe(4);
    expect(s.q3).toBe(5.5);
    expect(s.iqr).toBe(1.5);
    expect(summarize([3])!.sampleSd).toBeNaN();
    expect(summarize([1, 2, 3])!.modes).toEqual([]);
    expect(summarize([])).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('fits a line to pairs', () => {
    expect(regress([1, 2, 3, 4], [3, 5, 7, 9])).toEqual({ slope: 2, intercept: 1, r: 1, r2: 1 });
    const noisy = regress([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])!;
    expect(noisy.slope).toBeCloseTo(0.6, 12);
    expect(noisy.intercept).toBeCloseTo(2.2, 12);
    expect(noisy.r2).toBeCloseTo(0.6, 12);
    expect(regress([1, 1], [1, 2])).toBeNull();
  });
});

describe('matrix mode', () => {
  const m = (text: string) => {
    const read = readMatrix(text);
    if (!read.ok) throw new Error(read.error);
    return read.value;
  };

  it('reads matrices as typed, with or without brackets', () => {
    expect(m('1 2\n3 4')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(m('[1 2; 3 4]')).toEqual(m('[[1, 2], [3, 4]]'));
    expect(readMatrix('1 2\n3')).toEqual({ ok: false, error: 'ragged' });
    expect(readMatrix('1 x')).toEqual({ ok: false, error: 'not-a-number' });
    expect(readMatrix('')).toEqual({ ok: false, error: 'empty' });
  });

  it('adds, subtracts, multiplies, and transposes', () => {
    expect(add(m('1 2; 3 4'), m('1 1; 1 1'))).toEqual({ ok: true, value: m('2 3; 4 5') });
    expect(add(m('1 2; 3 4'), m('1 1; 1 1'), -1)).toEqual({ ok: true, value: m('0 1; 2 3') });
    expect(multiply(m('1 2; 3 4'), m('5; 6'))).toEqual({ ok: true, value: m('17; 39') });
    expect(multiply(m('1 2'), m('1 2'))).toEqual({ ok: false, error: 'shape' });
    expect(transpose(m('1 2 3'))).toEqual(m('1; 2; 3'));
  });

  it('finds the determinant, inverse, rank, and reduced form', () => {
    expect(determinant(m('1 2; 3 4'))).toEqual({ ok: true, value: -2 });
    expect(determinant(m('2 0 1; 1 3 2; 1 1 2'))).toEqual({ ok: true, value: 6 });
    expect(determinant(m('1 2; 2 4'))).toEqual({ ok: true, value: 0 });
    expect(inverse(m('4 7; 2 6'))).toEqual({ ok: true, value: m('0.6 -0.7; -0.2 0.4') });
    expect(inverse(m('1 2; 2 4'))).toEqual({ ok: false, error: 'singular' });
    expect(rank(m('1 2; 2 4'))).toBe(1);
    expect(rref(m('1 2 3; 4 5 6'))).toEqual(m('1 0 -1; 0 1 2'));
  });

  it('solves A x = b', () => {
    expect(solve(m('2 1; 1 -1'), m('3; 0'))).toEqual({ ok: true, value: m('1; 1') });
    expect(solve(m('1 1 1; 0 2 5; 2 5 -1'), m('6 -4 27'))).toEqual({ ok: true, value: m('5; 3; -2') });
    expect(solve(m('1 1; 1 1'), m('1; 2'))).toEqual({ ok: false, error: 'singular' });
  });

  it('writes matrices as text and as LaTeX', () => {
    expect(writeMatrix(m('1 0.5; 3 4'))).toBe('1 0.5\n3 4');
    expect(matrixLatex(m('1 2; 3 4'))).toBe('\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}');
  });
});

describe('mode history', () => {
  it('adds entries newest last and reads a saved list defensively', () => {
    const one = addEntry([], '1 + 1', '2');
    const two = addEntry(one, '2 + 2', '4');
    expect(two.map((entry) => entry.id)).toEqual([1, 2]);
    expect(restoreEntries([...two, { id: 'x' }, null, 4])).toEqual(two);
    expect(restoreEntries('nope')).toEqual([]);
  });
});
