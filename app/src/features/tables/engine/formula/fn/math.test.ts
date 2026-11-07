// The math and trigonometry family. Expected values are worked by hand or come from the documented examples; none
// is read back from the code. Formulas run through the engine, so argument delivery is tested too.

import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import type { Table } from '../../model';
import { DEFAULT_ENV, type EngineEnv } from '../../recalc';
import { ERROR_TOKENS, isError, type RowState, type Value } from '../../values';
import fixture from '../../../fixtures/fn/math.json';
import { fnMath } from '../../../../../strings/en/fnMath';
import { REGISTRY, arity, paramsOf } from '.';

const COLUMNS = 'ABCDEFGH'.split('').map((name) => ({ name, type: 'number' as const }));
const RESULT = { row: 0, col: 7 };

/** Runs a formula in cell H1 of a table with the given data in columns A to D. */
function calc(
  formula: string,
  data: string[][] = [],
  env: EngineEnv = DEFAULT_ENV,
  typed: [string, string][] = [],
): Value {
  const rows = Array.from({ length: Math.max(6, data.length) }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => data[r]?.[c] ?? ''),
  );
  let table: Table = createTable(COLUMNS, rows, EN_US, env, 1);
  for (const [ref, raw] of typed) {
    table = setCellInput(table, { row: Number(ref.slice(1)) - 1, col: ref.charCodeAt(0) - 65, raw }, EN_US, env);
  }
  table = setCellInput(table, { ...RESULT, raw: `=${formula}` }, EN_US, env);
  return table.rows[RESULT.row].cells[RESULT.col].value;
}

const NUMS = [['1'], ['2'], ['3'], ['4']];
const code = (v: Value) => (isError(v) ? ERROR_TOKENS[v.error] : v);

describe('conditional sums and products of arrays', () => {
  it('SUMIF, SUMIFS, SUMPRODUCT (lane test)', () => {
    expect(calc('SUMIF(A1:A4,">2")', NUMS)).toBe(7);
    const data = [
      ['1', 'x', '10'],
      ['2', 'x', '20'],
      ['3', 'y', '30'],
      ['4', 'x', '40'],
    ];
    expect(calc('SUMIFS(C1:C4,A1:A4,">1",B1:B4,"x")', data)).toBe(60);
    expect(calc('SUMPRODUCT({1,2,3},{4,5,6})')).toBe(32);
  });

  it('SUMIF sums another range, matches text with wildcards, and skips text in the sum range', () => {
    const data = [
      ['apple', '5'],
      ['apricot', '7'],
      ['banana', 'n/a'],
    ];
    expect(calc('SUMIF(A1:A3,"ap*",B1:B3)', data)).toBe(12);
    expect(calc('SUMIF(A1:A3,"banana",B1:B3)', data)).toBe(0);
    expect(calc('SUMIF(A1:A4,"<=2")', NUMS)).toBe(3);
  });

  it('SUMPRODUCT treats text as zero and SUMX2MY2 and its kin pair numbers', () => {
    expect(calc('SUMPRODUCT({1,2,3})')).toBe(6);
    expect(calc('SUMPRODUCT({1,"a",3},{2,2,2})')).toBe(8);
    expect(calc('SUMX2MY2({3,4},{1,2})')).toBe(20); // 9-1 and 16-4
    expect(calc('SUMX2PY2({3,4},{1,2})')).toBe(30); // 9+1 and 16+4
    expect(calc('SUMXMY2({3,4},{1,2})')).toBe(8); // 4 and 4
  });

  it('SERIESSUM, PRODUCT, SUMSQ, PERCENTOF, and the operator names', () => {
    expect(calc('SERIESSUM(2,0,1,{1,1,1})')).toBe(7); // 1 + 2 + 4
    expect(calc('SERIESSUM(2,1,2,{1,1})')).toBe(10); // 2 + 8
    expect(calc('PRODUCT(2,3,4)')).toBe(24);
    expect(calc('PRODUCT(A1:A4)', NUMS)).toBe(24);
    expect(calc('SUMSQ(3,4)')).toBe(25);
    expect(calc('PERCENTOF(A1:A2,A1:A4)', NUMS)).toBeCloseTo(0.3);
    expect([calc('ADD(2,3)'), calc('MINUS(5,3)'), calc('MULTIPLY(4,3)'), calc('DIVIDE(6,3)')]).toEqual([5, 2, 12, 2]);
  });
});

describe('rounding', () => {
  it.each([
    ['MROUND(10,3)', 9],
    ['MROUND(-10,-3)', -9],
    ['MROUND(5,-2)', '#NUM!'],
    ['MROUND(1.5,1)', 2],
    ['MROUND(7,0)', 0],
    ['CEILING(2.5,1)', 3],
    ['CEILING(-2.5,2)', -2],
    ['CEILING(-2.5,-2)', -4],
    ['CEILING(2.5,-1)', '#NUM!'],
    ['CEILING(2.1,0.1)', 2.1],
    ['CEILING.MATH(-4.5)', -4],
    ['CEILING.MATH(4.3)', 5],
    ['CEILING.MATH(-5.5,2,1)', -6],
    ['CEILING.PRECISE(-4.1,2)', -4],
    ['ISO.CEILING(4.3)', 5],
    ['FLOOR(3.7,2)', 2],
    ['FLOOR(-2.5,2)', -4],
    ['FLOOR(-2.5,-2)', -2],
    ['FLOOR(3.7,0)', '#DIV/0!'],
    ['FLOOR(3.7,-2)', '#NUM!'],
    ['FLOOR.MATH(-5.5,2,-1)', -4],
    ['FLOOR.MATH(-5.5,2)', -6],
    ['FLOOR.MATH(5.5,2)', 4],
    ['FLOOR.PRECISE(-3.1)', -4],
    ['TRUNC(-8.9)', -8],
    ['TRUNC(8.987,2)', 8.98],
    ['TRUNC(1234.5,-2)', 1200],
    ['INT(-8.9)', -9],
    ['EVEN(-1)', -2],
    ['EVEN(1.5)', 2],
    ['EVEN(0)', 0],
    ['ODD(2)', 3],
    ['ODD(0)', 1],
    ['ODD(-2)', -3],
    ['QUOTIENT(-10,3)', -3],
    ['QUOTIENT(5,2)', 2],
    ['QUOTIENT(1,0)', '#DIV/0!'],
  ])('%s is %s', (formula, expected) => {
    const got = code(calc(formula));
    if (typeof expected === 'number') expect(got).toBeCloseTo(expected, 12);
    else expect(got).toBe(expected);
  });
});

describe('whole numbers, Roman numerals, and bases', () => {
  it.each([
    ['ROMAN(499)', 'CDXCIX'],
    ['ROMAN(499,1)', 'LDVLIV'],
    ['ROMAN(499,2)', 'XDIX'],
    ['ROMAN(499,3)', 'VDIV'],
    ['ROMAN(499,4)', 'ID'],
    ['ROMAN(0)', ''],
    ['ROMAN(3999)', 'MMMCMXCIX'],
    ['ROMAN(4000)', '#VALUE!'],
    ['ARABIC("MCMXCIX")', 1999],
    ['ARABIC("-iv")', -4],
    ['ARABIC("")', 0],
    ['ARABIC("ABC")', '#VALUE!'],
    ['GCD(24,36)', 12],
    ['GCD(7,0)', 7],
    ['GCD(5)', 5],
    ['GCD(-1,2)', '#NUM!'],
    ['LCM(4,6)', 12],
    ['LCM(4,6,10)', 60],
    ['LCM(5,0)', 0],
    ['FACT(5)', 120],
    ['FACT(0)', 1],
    ['FACT(5.9)', 120],
    ['FACT(171)', '#NUM!'],
    ['FACTDOUBLE(7)', 105],
    ['FACTDOUBLE(6)', 48],
    ['FACTDOUBLE(-1)', 1],
    ['COMBIN(5,2)', 10],
    ['COMBIN(52,5)', 2598960],
    ['COMBINA(4,3)', 20],
    ['COMBINA(3,2)', 6],
    ['MULTINOMIAL(2,3,4)', 1260],
    ['BASE(7,2)', '111'],
    ['BASE(255,16)', 'FF'],
    ['BASE(7,2,8)', '00000111'],
    ['DECIMAL("FF",16)', 255],
    ['DECIMAL("111",2)', 7],
    ['DECIMAL("2",2)', '#NUM!'],
  ])('%s is %s', (formula, expected) => {
    expect(code(calc(formula))).toBe(expected);
  });
});

describe('trigonometry and powers', () => {
  it.each([
    ['ATAN2(1,1)', 0.785398163397448],
    ['ATAN2(-1,0)', Math.PI],
    ['SQRTPI(1)', 1.77245385090552],
    ['SQRTPI(2)', 2.5066282746310002],
    ['ACOT(1)', 0.785398163397448],
    ['ACOT(0)', 1.5707963267949],
    ['ACOT(-1)', 2.35619449019234],
    ['ACOTH(2)', 0.549306144334055],
    ['COT(1)', 0.642092615934331],
    ['COTH(1)', 1.31303528549933],
    ['CSC(1)', 1.18839510577812],
    ['CSCH(1)', 0.850918128239322],
    ['SEC(0)', 1],
    ['SECH(0)', 1],
    ['SINH(0)', 0],
    ['COSH(0)', 1],
    ['TANH(0)', 0],
    ['ASINH(0)', 0],
    ['ACOSH(1)', 0],
    ['ATANH(0)', 0],
    ['LOG(8,2)', 3],
    ['POWER(2,10)', 1024],
    ['MOD(-7,3)', 2],
    ['ROUND(2.675,2)', 2.68],
  ])('%s is %s', (formula, expected) => {
    expect(calc(formula) as number).toBeCloseTo(expected, 12);
  });

  it('RAND and RANDBETWEEN are volatile and stay in range', () => {
    expect(REGISTRY.get('RAND')?.volatile).toBe(true);
    expect(REGISTRY.get('RANDBETWEEN')?.volatile).toBe(true);
    for (let i = 0; i < 50; i++) {
      const r = calc('RAND()') as number;
      expect(r >= 0 && r < 1).toBe(true);
      const b = calc('RANDBETWEEN(3,5)') as number;
      expect([3, 4, 5]).toContain(b);
    }
  });
});

describe('SUBTOTAL and AGGREGATE', () => {
  // Row 2 of A1:A5 is filtered out, row 3 is hidden by hand: only 1, 4, and 5 show.
  const env: EngineEnv = {
    ...DEFAULT_ENV,
    rowState: (_sheet, row): RowState => (row === 1 ? 2 : row === 2 ? 1 : 0),
  };
  const data = [['1'], ['2'], ['3'], ['4'], ['5']];

  it('107 and 109 skip both kinds of hidden row, 7 and 9 keep the hand-hidden one (lane test)', () => {
    expect(calc('SUBTOTAL(109,A1:A5)', data, env)).toBe(10); // 1 + 4 + 5
    expect(calc('SUBTOTAL(9,A1:A5)', data, env)).toBe(13); // 1 + 3 + 4 + 5
    expect(calc('SUBTOTAL(9,A1:A5)', data)).toBe(15);
  });

  it('covers every function number', () => {
    const shown = (n: number) => calc(`SUBTOTAL(${n},A1:A5)`, data, env);
    // Shown by 1 to 11: 1, 3, 4, 5. Shown by 101 to 111: 1, 4, 5.
    expect([1, 2, 3, 4, 5, 6, 9].map(shown)).toEqual([13 / 4, 4, 4, 5, 1, 60, 13]);
    expect(shown(8) as number).toBeCloseTo(Math.sqrt(2.1875), 12); // population variance of 1, 3, 4, 5
    expect(shown(7) as number).toBeCloseTo(Math.sqrt(2.91666666666667), 10);
    expect(shown(11) as number).toBeCloseTo(2.1875, 12);
    expect(shown(10) as number).toBeCloseTo(35 / 12, 12);
    expect([101, 102, 103, 104, 105, 106, 109].map(shown)).toEqual([10 / 3, 3, 3, 5, 1, 20, 10]);
  });

  it('AGGREGATE ignores errors and hidden rows by option (lane test)', () => {
    const typed: [string, string][] = [['A6', '=1/0']];
    expect(calc('AGGREGATE(14,6,A1:A6,1)', data, DEFAULT_ENV, typed)).toBe(5);
    expect(calc('AGGREGATE(9,4,A1:A6,1)', data, DEFAULT_ENV, typed)).toEqual({ error: 'DIV0' });
    expect(calc('AGGREGATE(9,5,A1:A5)', data, env)).toBe(10);
    expect(calc('AGGREGATE(9,4,A1:A5)', data, env)).toBe(15);
    expect(calc('AGGREGATE(9,7,A1:A6)', data, env, typed)).toBe(10);
  });

  it('AGGREGATE array forms', () => {
    const d = [['5'], ['9'], ['2'], ['7'], ['3']];
    expect(calc('AGGREGATE(14,6,A1:A5,2)', d)).toBe(7);
    expect(calc('AGGREGATE(15,6,A1:A5,2)', d)).toBe(3);
    expect(calc('AGGREGATE(16,6,A1:A5,0.5)', d)).toBe(5);
    expect(calc('AGGREGATE(17,6,A1:A5,1)', d)).toBe(3);
    expect(calc('AGGREGATE(18,6,A1:A5,0.5)', d)).toBe(5);
    expect(calc('AGGREGATE(19,6,A1:A5,2)', d)).toBe(5);
    expect(calc('AGGREGATE(12,6,A1:A5)', d)).toBe(5);
    expect(calc('AGGREGATE(13,6,A1:A5)', d)).toEqual({ error: 'NA' });
    expect(calc('AGGREGATE(14,6,A1:A5,6)', d)).toEqual({ error: 'NUM' });
  });
});

const ERRORS: Record<string, [string, string]> = {
  ABS: ['ABS("x")', '#VALUE!'],
  ACOS: ['ACOS(2)', '#NUM!'],
  ACOSH: ['ACOSH(0.5)', '#NUM!'],
  ACOT: ['ACOT("x")', '#VALUE!'],
  ACOTH: ['ACOTH(0.5)', '#NUM!'],
  ADD: ['ADD("x",1)', '#VALUE!'],
  AGGREGATE: ['AGGREGATE(99,0,A1:A4)', '#VALUE!'],
  ARABIC: ['ARABIC("ABC")', '#VALUE!'],
  ASIN: ['ASIN(2)', '#NUM!'],
  ASINH: ['ASINH("x")', '#VALUE!'],
  ATAN: ['ATAN("x")', '#VALUE!'],
  ATAN2: ['ATAN2(0,0)', '#DIV/0!'],
  ATANH: ['ATANH(1)', '#NUM!'],
  BASE: ['BASE(5,1)', '#NUM!'],
  CEILING: ['CEILING(2,-1)', '#NUM!'],
  'CEILING.MATH': ['CEILING.MATH("x")', '#VALUE!'],
  'CEILING.PRECISE': ['CEILING.PRECISE("x")', '#VALUE!'],
  COMBIN: ['COMBIN(2,3)', '#NUM!'],
  COMBINA: ['COMBINA(-1,2)', '#NUM!'],
  COS: ['COS("x")', '#VALUE!'],
  COSH: ['COSH("x")', '#VALUE!'],
  COT: ['COT(0)', '#DIV/0!'],
  COTH: ['COTH(0)', '#DIV/0!'],
  CSC: ['CSC(0)', '#DIV/0!'],
  CSCH: ['CSCH(0)', '#DIV/0!'],
  DECIMAL: ['DECIMAL("G",16)', '#NUM!'],
  DEGREES: ['DEGREES("x")', '#VALUE!'],
  DIVIDE: ['DIVIDE(1,0)', '#DIV/0!'],
  EVEN: ['EVEN("x")', '#VALUE!'],
  EXP: ['EXP("x")', '#VALUE!'],
  FACT: ['FACT(-1)', '#NUM!'],
  FACTDOUBLE: ['FACTDOUBLE(-2)', '#NUM!'],
  FLOOR: ['FLOOR(2,0)', '#DIV/0!'],
  'FLOOR.MATH': ['FLOOR.MATH("x")', '#VALUE!'],
  'FLOOR.PRECISE': ['FLOOR.PRECISE("x")', '#VALUE!'],
  GCD: ['GCD(-1)', '#NUM!'],
  INT: ['INT("x")', '#VALUE!'],
  'ISO.CEILING': ['ISO.CEILING("x")', '#VALUE!'],
  LCM: ['LCM(-1)', '#NUM!'],
  LN: ['LN(0)', '#NUM!'],
  LOG: ['LOG(0)', '#NUM!'],
  LOG10: ['LOG10(0)', '#NUM!'],
  MINUS: ['MINUS("x",1)', '#VALUE!'],
  MOD: ['MOD(1,0)', '#DIV/0!'],
  MROUND: ['MROUND(5,-2)', '#NUM!'],
  MULTINOMIAL: ['MULTINOMIAL(-1)', '#NUM!'],
  MULTIPLY: ['MULTIPLY("x",1)', '#VALUE!'],
  ODD: ['ODD("x")', '#VALUE!'],
  PERCENTOF: ['PERCENTOF({1},{0})', '#DIV/0!'],
  PI: ['PI(1)', '#VALUE!'],
  POWER: ['POWER(0,-1)', '#DIV/0!'],
  PRODUCT: ['PRODUCT(1/0)', '#DIV/0!'],
  QUOTIENT: ['QUOTIENT(1,0)', '#DIV/0!'],
  RADIANS: ['RADIANS("x")', '#VALUE!'],
  RAND: ['RAND(1)', '#VALUE!'],
  RANDBETWEEN: ['RANDBETWEEN(5,1)', '#NUM!'],
  ROMAN: ['ROMAN(4000)', '#VALUE!'],
  ROUND: ['ROUND("x")', '#VALUE!'],
  ROUNDDOWN: ['ROUNDDOWN("x")', '#VALUE!'],
  ROUNDUP: ['ROUNDUP("x")', '#VALUE!'],
  SEC: ['SEC("x")', '#VALUE!'],
  SECH: ['SECH("x")', '#VALUE!'],
  SERIESSUM: ['SERIESSUM(2,0,1,{1,"a"})', '#VALUE!'],
  SIGN: ['SIGN("x")', '#VALUE!'],
  SIN: ['SIN("x")', '#VALUE!'],
  SINH: ['SINH("x")', '#VALUE!'],
  SQRT: ['SQRT(-1)', '#NUM!'],
  SQRTPI: ['SQRTPI(-1)', '#NUM!'],
  SUBTOTAL: ['SUBTOTAL(12,A1:A4)', '#VALUE!'],
  SUM: ['SUM(1/0)', '#DIV/0!'],
  SUMIF: ['SUMIF(A1:A4)', '#VALUE!'],
  SUMIFS: ['SUMIFS(A1:A4,A1:A2,">1")', '#VALUE!'],
  SUMPRODUCT: ['SUMPRODUCT({1,2},{1,2,3})', '#VALUE!'],
  SUMSQ: ['SUMSQ(1/0)', '#DIV/0!'],
  SUMX2MY2: ['SUMX2MY2({1,2},{1})', '#N/A'],
  SUMX2PY2: ['SUMX2PY2({1,2},{1})', '#N/A'],
  SUMXMY2: ['SUMXMY2({1,2},{1})', '#N/A'],
  TAN: ['TAN("x")', '#VALUE!'],
  TANH: ['TANH("x")', '#VALUE!'],
  TRUNC: ['TRUNC("x")', '#VALUE!'],
};

describe('every function of the family', () => {
  const names = [...REGISTRY.values()].filter((spec) => spec.family === 'math').map((spec) => spec.name);

  it('has an error case', () => {
    expect(names.filter((name) => ERRORS[name] === undefined)).toEqual([]);
    for (const name of names) {
      const [formula, expected] = ERRORS[name];
      expect(formula.startsWith(`${name}(`), name).toBe(true);
      expect(code(calc(formula, NUMS)), formula).toBe(expected);
    }
  });

  it('refuses too few arguments', () => {
    for (const name of names) {
      const spec = REGISTRY.get(name)!;
      if (arity(spec).min > 0) expect(isError(calc(`${name}()`)), name).toBe(true);
    }
  });

  it('has a signature and an example of its own', () => {
    for (const name of names) {
      const meta = REGISTRY.get(name)!.meta;
      expect(meta.signature.startsWith(`${name}(`), name).toBe(true);
      expect(meta.example, name).toMatch(/^=/);
    }
  });

  it('has a description for the function and for each argument', () => {
    const text = fnMath as Record<string, { description: string; params: Record<string, string> }>;
    for (const name of names) {
      expect(text[name]?.description, name).toMatch(/^[A-Z].*\.$/);
      for (const param of paramsOf(REGISTRY.get(name)!))
        expect(text[name].params[param.name], `${name} ${param.name}`).toBeTruthy();
    }
    expect(Object.keys(text).filter((name) => !names.includes(name))).toEqual([]);
  });

  it('holds the 77 names of the design and the Sheets operators', () => {
    expect(names.length).toBeGreaterThanOrEqual(77);
  });
});

describe('the fixture of hand-worked cases', () => {
  interface Case {
    formula: string;
    cells?: Record<string, number | string>;
    expected: number | string;
    tolerance?: number;
  }
  it.each((fixture as { cases: Case[] }).cases.map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    const data: string[][] = [];
    for (const [ref, v] of Object.entries(c.cells ?? {})) {
      const col = ref.charCodeAt(0) - 65;
      const row = Number(ref.slice(1)) - 1;
      (data[row] ??= [])[col] = String(v);
    }
    const got = code(calc(c.formula.slice(1), data));
    if (typeof c.expected === 'number')
      expect(got as number).toBeCloseTo(c.expected, c.tolerance === undefined ? 9 : 11);
    else expect(String(got)).toBe(c.expected);
  });
});
