// Excel's coercion and precision (ADR 0058). Expected values come from Microsoft's documentation of Excel's
// calculation (the two 0.5-0.4-0.1 examples, 15-digit input, and 0^0 as #NUM!) or are worked by hand: "$5" is 5,
// "50%" is 0.5, "1 1/2" is 1.5, and "1:30" is 1.5 hours, 1.5/24 of a day.

import { describe, expect, it } from 'vitest';
import { createTable, setColumnFormula } from './edit';
import { rewriteLegacy } from './formula/legacy';
import { STORED } from './formula/lexer';
import { EN_US } from './locale';
import type { Table } from './model';
import {
  ERROR_TOKENS,
  ERROR_WORDS,
  arrayOf,
  err,
  errorFromToken,
  isArray,
  isError,
  isLambda,
  isRef,
  numberToText,
  textToNumber,
  toNumber,
  toScalar,
  toText,
  truncate15,
  type ErrorCode,
  type Value,
} from './values';

/** The value of a one-cell formula. `version` is the table's data.sheet.v; unset means a table written before it. */
function calc(formula: string, version: number | null = 1): Value {
  const table = createTable([{ name: 'Out' }], [['']], EN_US);
  const base: Table = version === null ? table : { ...table, sheetVersion: version };
  const result = setColumnFormula(base, 0, formula);
  if (!result.ok) throw new Error(`${formula}: ${result.problem.message}`);
  return result.table.rows[0].cells[0].value;
}

describe('coercion of text in arithmetic', () => {
  it.each([
    ['"$5"+1', 6],
    ['"50%"*2', 1],
    ['"1 1/2"+0', 1.5],
    ['"1,234"+1', 1235],
    ['"(5)"+0', -5],
    ['" 7 "*1', 7],
    ['"-$2.50"*2', -5],
    ['"1:30"*24', 1.5],
    ['"1:30 PM"*24', 13.5],
    ['"2026-11-01"+0', 46327],
    ['"Nov 1, 2026"+1', 46328],
    ['TRUE+1', 2],
  ])('=%s is %d', (formula, expected) => {
    expect(calc(formula)).toBe(expected);
  });

  it('gives #VALUE! for text that is not a number', () => {
    expect(calc('"apples"+1')).toEqual(err('VALUE'));
    expect(calc('"1/0 1"+1')).toEqual(err('VALUE'));
    expect(textToNumber('$5$')).toBeNull();
    expect(textToNumber('1 1/0')).toBeNull();
    expect(textToNumber('25:61')).toBeNull();
  });

  it('makes zero to the power of zero #NUM! for the operator, as for POWER', () => {
    expect(calc('0^0')).toEqual(err('NUM'));
    expect(calc('POWER(0,0)')).toEqual(err('NUM'));
    expect(calc('0^-1')).toEqual(err('DIV0'));
  });
});

describe('precision', () => {
  it('sets a final subtraction within rounding error of zero to 0', () => {
    expect(calc('0.5-0.4-0.1')).toBe(0);
  });

  it('keeps the full double when the last operation is not + or -', () => {
    const value = calc('1*(0.5-0.4-0.1)');
    expect(value).toBe(0.5 - 0.4 - 0.1);
    expect(numberToText(value as number)).toBe('-2.77555756156289e-17');
  });

  it('compares numbers on their 15-digit form', () => {
    expect(calc('0.1+0.2=0.3')).toBe(true);
    expect(calc('0.1+0.2')).toBe(0.1 + 0.2);
    expect(calc('1/3*3=1')).toBe(true);
  });

  it('keeps 15 significant digits of a typed number', () => {
    expect(calc('12345678901234567890')).toBe(12345678901234500000);
    expect(truncate15('12345678901234567890')).toBe(12345678901234500000);
    expect(truncate15('0.000123456789012345678')).toBe(0.000123456789012345);
    expect(truncate15('-1.23456789012345678e5')).toBe(-123456.789012345);
    expect(truncate15('42')).toBe(42);
  });
});

describe('legacy formulas', () => {
  it('computes a table without data.sheet.v with the old rules', () => {
    expect(calc('-2^2', null)).toBe(-4);
    expect(calc('2^3^2', null)).toBe(512);
    expect(numberToText(calc('E', null) as number)).toBe('2.71828182845905');
  });

  it('computes a table with data.sheet.v with Excel rules', () => {
    expect(calc('-2^2')).toBe(4);
    expect(calc('2^3^2')).toBe(64);
    expect(calc('E')).toEqual(err('NAME'));
  });

  it.each([
    ['-2^2', '-(2^2)'],
    ['2^3^2', '2^(3^2)'],
    ['E', 'EXP(1)'],
    ['-E^2', '-(EXP(1)^2)'],
    ['2^-3^2', '2^-(3^2)'],
    ['2^3^4^5', '2^(3^(4^(5)))'.replace('(5)', '5')],
    ['(-2)^2', '(-2)^2'],
    ['-(2^2)', '-(2^2)'],
    ['(2^3)^2', '(2^3)^2'],
    ['SUM(A1:B2)*-[Price]^2', 'SUM(A1:B2)*-([Price]^2)'],
    ['"E"&e', '"E"&EXP(1)'],
  ])('rewrites %s as %s', (before, after) => {
    expect(rewriteLegacy(before, STORED)).toBe(after);
  });

  it('refuses what the old rules refused', () => {
    expect(() => rewriteLegacy('bad name', STORED)).toThrow();
    expect(calc('Rate*2')).toEqual(err('NAME'));
    expect(() => calc('Rate*2', null)).toThrow(/Rate/);
  });
});

describe('value kinds and errors', () => {
  const codes: ErrorCode[] = ['DIV0', 'VALUE', 'REF', 'NAME', 'NUM', 'NA', 'NULL', 'SPILL', 'CALC', 'FIELD', 'BUSY'];

  it('has a token and plain words for every error, and reads every token back', () => {
    expect(codes.map((code) => ERROR_TOKENS[code])).toEqual([
      '#DIV/0!',
      '#VALUE!',
      '#REF!',
      '#NAME?',
      '#NUM!',
      '#N/A',
      '#NULL!',
      '#SPILL!',
      '#CALC!',
      '#FIELD!',
      '#BUSY!',
    ]);
    for (const code of codes) {
      expect(errorFromToken(ERROR_TOKENS[code])).toBe(err(code));
      expect(ERROR_WORDS[code].length).toBeGreaterThan(0);
    }
    expect(errorFromToken('\\#N/A')).toBe(err('NA'));
    expect(ERROR_TOKENS.CYCLE).toBe('#REF!');
  });

  it('tells arrays, references, and lambdas apart from errors', () => {
    const array = arrayOf([
      [1, 'a'],
      [true, null],
    ]);
    const ref: Value = { kind: 'ref', r1: 0, c1: 0, r2: 1, c2: 1 };
    const lambda: Value = { kind: 'lambda', params: ['x'], call: () => 1 };
    expect(array).toEqual({ kind: 'array', rows: 2, cols: 2, data: [1, 'a', true, null] });
    expect([isArray(array), isRef(ref), isLambda(lambda)]).toEqual([true, true, true]);
    expect([isError(array), isError(ref), isError(lambda), isError(err('NA'))]).toEqual([false, false, false, true]);
    expect(toScalar(array)).toBe(1);
    expect(toNumber(array)).toBe(1);
    expect(toText(arrayOf([['x']]))).toBe('x');
    expect(toScalar(ref)).toEqual(err('VALUE'));
    expect(toScalar(lambda)).toEqual(err('CALC'));
  });
});
