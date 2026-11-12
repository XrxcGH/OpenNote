// The dynamic array, matrix, and LAMBDA helper functions. Expected values are worked by hand from each function's
// documented rules, or are the published examples (the 4 by 4 determinant of 88); none is read back from the code.
// Formulas run through the engine and spill, so argument delivery and spilling are tested too.

import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import type { Table } from '../../model';
import { DEFAULT_ENV, errorOrigin, spillRange } from '../../recalc';
import { err, isError, reasonOf, type ArrayValue, type Scalar, type Value } from '../../values';
import { explainOrigin } from '../explain';
import fixture from '../../../fixtures/fn/arrays.json';
import { fnArrays, type FnText } from '../../../../../strings/en/fnArrays';
import { REGISTRY, paramsOf } from '.';
import { MAX_ELEMENTS } from './matrix';
import { makeArray } from '../../arrays';

const COLUMNS = 'ABCDEFGHIJKLMN'.split('').map((name) => ({ name, type: 'number' as const }));
/** The formula goes in F1, with columns A to D for data and room to spill right and down. */
const HOME = { row: 0, col: 5 };

function run(formula: string, data: string[][] = []): Table {
  const rows = Array.from({ length: 14 }, (_, r) => Array.from({ length: 14 }, (_, c) => data[r]?.[c] ?? ''));
  const table = createTable(COLUMNS, rows, EN_US, DEFAULT_ENV, 1);
  return setCellInput(table, { ...HOME, raw: `=${formula}` }, EN_US, DEFAULT_ENV);
}

/** A formula's result: a single value, or the rows of the block it spilled. */
function calc(formula: string, data: string[][] = []): Value | Scalar[][] {
  const t = run(formula, data);
  const box = spillRange(t, HOME.col, HOME.row);
  if (box === undefined || (box.r1 === box.r2 && box.c1 === box.c2)) return t.rows[HOME.row].cells[HOME.col].value;
  const out: Scalar[][] = [];
  for (let r = box.r1; r <= box.r2; r++) {
    out.push(t.rows[r].cells.slice(box.c1, box.c2 + 1).map((cell) => cell.value as Scalar));
  }
  return out;
}

/** Numbers to 12 decimal places, for results of floating-point arithmetic. */
function near(value: Value | Scalar[][], expected: number[][]): void {
  expect(Array.isArray(value)).toBe(true);
  const rows = value as Scalar[][];
  expect(rows.map((row) => row.length)).toEqual(expected.map((row) => row.length));
  rows.forEach((row, r) => row.forEach((v, c) => expect(v as number).toBeCloseTo(expected[r][c], 12)));
}

const NA = err('NA');

describe('dynamic arrays', () => {
  it('SEQUENCE, SORT, UNIQUE, and FILTER (lane test)', () => {
    expect(calc('SEQUENCE(2,3)')).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(calc('SEQUENCE(3,1,10,-2)')).toEqual([[10], [8], [6]]);
    expect(calc('SORT({3;1;2})')).toEqual([[1], [2], [3]]);
    expect(calc('UNIQUE({1;2;1;3})')).toEqual([[1], [2], [3]]);
    expect(calc('UNIQUE({1;2;1;3},,TRUE)')).toEqual([[2], [3]]);
    expect(calc('FILTER({1;2;3},{1;2;3}>5)')).toEqual(err('CALC'));
  });

  it('FILTER keeps rows or columns, gives if_empty, and reads ranges', () => {
    expect(calc('FILTER({1;2;3},{1;2;3}>5,"none")')).toBe('none');
    expect(calc('FILTER({1,2,3;4,5,6},{TRUE,FALSE,TRUE})')).toEqual([
      [1, 3],
      [4, 6],
    ]);
    const data = [
      ['a', '1'],
      ['b', '5'],
      ['c', '7'],
    ];
    expect(calc('FILTER(A1:A3,B1:B3>2)', data)).toEqual([['b'], ['c']]);
    expect(calc('FILTER({1;2;3},{TRUE;FALSE})')).toEqual(err('VALUE'));
  });

  it('SORT by another column, descending, by column, and with several keys', () => {
    expect(calc('SORT({1,"b";2,"a";3,"c"},2,-1)')).toEqual([
      [3, 'c'],
      [1, 'b'],
      [2, 'a'],
    ]);
    expect(calc('SORT({3,1,2},1,1,TRUE)')).toEqual([[1, 2, 3]]);
    expect(calc('SORT({1,2;1,1;0,9},{1,2},{1,-1})')).toEqual([
      [0, 9],
      [1, 2],
      [1, 1],
    ]);
    // Numbers sort before text, text before booleans, and text without regard to case.
    expect(calc('SORT({TRUE;"b";2;"A"})')).toEqual([[2], ['A'], ['b'], [true]]);
    expect(calc('SORT({1;2},3)')).toEqual(err('VALUE'));
    expect(calc('SORT({1;2},1,2)')).toEqual(err('VALUE'));
  });

  it('SORTBY sorts by other arrays and keeps ties in their order', () => {
    expect(calc('SORTBY({"x";"y";"z"},{2;1;2})')).toEqual([['y'], ['x'], ['z']]);
    expect(calc('SORTBY({"x";"y";"z"},{1;1;2},1,{3;2;1},-1)')).toEqual([['x'], ['y'], ['z']]);
    expect(calc('SORTBY({"x","y"},{2,1})')).toEqual([['y', 'x']]);
    expect(calc('SORTBY({"x";"y"},{1;2;3})')).toEqual(err('VALUE'));
  });

  it('UNIQUE ignores case, works by column, and is #CALC! when nothing appears once', () => {
    expect(calc('UNIQUE({"a";"A";"b"})')).toEqual([['a'], ['b']]);
    expect(calc('UNIQUE({1,1,2},TRUE)')).toEqual([[1, 2]]);
    expect(calc('UNIQUE({1,2;1,2;3,4})')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(calc('UNIQUE({1;1},,TRUE)')).toEqual(err('CALC'));
  });

  it('SORTN keeps the first rows, with ties, without repeats, or with every copy', () => {
    expect(calc('SORTN({3;1;2;1},2)')).toEqual([[1], [1]]);
    expect(calc('SORTN({3;1;2;2},2,1)')).toEqual([[1], [2], [2]]);
    expect(calc('SORTN({3;1;1;2},2,2)')).toEqual([[1], [2]]);
    expect(calc('SORTN({3;1;1;2},2,3)')).toEqual([[1], [1], [2]]);
    expect(calc('SORTN({1,"a";2,"b";3,"c"},1,0,1,FALSE)')).toEqual([[3, 'c']]);
  });

  it('ARRAYFORMULA gives its formula', () => {
    expect(calc('ARRAYFORMULA({1,2}*2)')).toEqual([[2, 4]]);
  });
});

describe('reshaping', () => {
  it('TAKE, TOCOL, WRAPROWS, and VSTACK (lane test)', () => {
    expect(calc('TAKE({1,2,3;4,5,6},1)')).toEqual([[1, 2, 3]]);
    expect(calc('TOCOL({1,2;3,4})')).toEqual([[1], [2], [3], [4]]);
    expect(calc('TOCOL({1,2;3,4},0,TRUE)')).toEqual([[1], [3], [2], [4]]);
    expect(calc('WRAPROWS({1,2,3,4,5},2)')).toEqual([
      [1, 2],
      [3, 4],
      [5, NA],
    ]);
    expect(calc('VSTACK({1,2},{3,4})')).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('TAKE and DROP count from the end, skip a left-out count, and are #CALC! when nothing is left', () => {
    expect(calc('TAKE({1,2,3;4,5,6},-1,-2)')).toEqual([[5, 6]]);
    expect(calc('TAKE({1,2,3;4,5,6},,1)')).toEqual([[1], [4]]);
    expect(calc('TAKE({1;2},9)')).toEqual([[1], [2]]);
    expect(calc('TAKE({1;2},0)')).toEqual(err('CALC'));
    expect(calc('DROP({1,2,3;4,5,6},1)')).toEqual([[4, 5, 6]]);
    expect(calc('DROP({1,2,3;4,5,6},,-1)')).toEqual([
      [1, 2],
      [4, 5],
    ]);
    expect(calc('DROP({1;2},2)')).toEqual(err('CALC'));
  });

  it('HSTACK pads the shorter array, and TOROW skips empty cells and errors', () => {
    expect(calc('HSTACK({1;2},3)')).toEqual([
      [1, 3],
      [2, NA],
    ]);
    expect(
      calc('TOROW(A1:B2)', [
        ['1', ''],
        ['', '4'],
      ]),
    ).toEqual([[1, null, null, 4]]);
    expect(
      calc('TOROW(A1:B2,1)', [
        ['1', ''],
        ['', '4'],
      ]),
    ).toEqual([[1, 4]]);
    expect(calc('TOROW(HSTACK(1,1/0,3),2)')).toEqual([[1, 3]]);
    expect(calc('TOROW(A1:B1,1)', [['', '']])).toEqual(err('CALC'));
  });

  it('WRAPCOLS and EXPAND pad, and WRAPROWS refuses a block and a count below 1', () => {
    expect(calc('WRAPCOLS({1,2,3},2,0)')).toEqual([
      [1, 3],
      [2, 0],
    ]);
    expect(calc('EXPAND({1,2},2,3,"-")')).toEqual([
      [1, 2, '-'],
      ['-', '-', '-'],
    ]);
    expect(calc('EXPAND({1;2},,2)')).toEqual([
      [1, NA],
      [2, NA],
    ]);
    expect(calc('EXPAND({1,2},1,1)')).toEqual(err('VALUE'));
    expect(calc('WRAPROWS({1,2;3,4},2)')).toEqual(err('VALUE'));
    expect(calc('WRAPROWS({1,2},0)')).toEqual(err('NUM'));
  });

  it('CHOOSEROWS and CHOOSECOLS pick lines, negative from the end', () => {
    expect(calc('CHOOSEROWS({1,2;3,4;5,6},3,1)')).toEqual([
      [5, 6],
      [1, 2],
    ]);
    expect(calc('CHOOSEROWS({1;2;3},{-1,-2})')).toEqual([[3], [2]]);
    expect(calc('CHOOSECOLS({1,2,3;4,5,6},2)')).toEqual([[2], [5]]);
    expect(calc('CHOOSECOLS({1,2},3)')).toEqual(err('VALUE'));
    expect(calc('CHOOSEROWS({1,2},0)')).toEqual(err('VALUE'));
  });

  it('TRIMRANGE drops empty edges, and FLATTEN puts every value in one column', () => {
    const data = [
      ['', '', ''],
      ['', '5', ''],
      ['', '6', '7'],
      ['', '', ''],
    ];
    expect(calc('TRIMRANGE(A1:C4)', data)).toEqual([
      [5, null],
      [6, 7],
    ]);
    expect(calc('TRIMRANGE(A1:C4,2,0)', data)).toEqual([
      [null, null, null],
      [null, 5, null],
      [null, 6, 7],
    ]);
    expect(calc('FLATTEN({1,2;3,4},5)')).toEqual([[1], [2], [3], [4], [5]]);
  });
});

describe('TOROW and TOCOL', () => {
  it('scan by column and skip empty cells', () => {
    expect(calc('TOCOL({1,2,3;4,5,6},0,TRUE)')).toEqual([[1], [4], [2], [5], [3], [6]]);
    expect(
      calc('TOROW(A1:C2,1,TRUE)', [
        ['1', '', '3'],
        ['', '5', '6'],
      ]),
    ).toEqual([[1, 5, 3, 6]]);
  });

  it('TOROW and TOCOL turn a million items into one line well inside the recalc budget', () => {
    const data = Array.from({ length: 1e6 }, (_, k) => (k % 7 === 0 ? null : k));
    const big = makeArray(1000, 1000, data);
    const ctx = { today: () => 0 };
    const started = performance.now();
    const row = REGISTRY.get('TOROW')!.run([big, 3], ctx);
    const col = REGISTRY.get('TOCOL')!.run([big, 1, true], ctx);
    // Filling a preallocated line by index takes tens of milliseconds here; the budget leaves room for a busy machine.
    expect(performance.now() - started).toBeLessThan(600);
    expect(row).toMatchObject({ rows: 1, cols: 1e6 - Math.ceil(1e6 / 7) });
    expect(col).toMatchObject({ rows: 1e6 - Math.ceil(1e6 / 7), cols: 1 });
    expect((col as ArrayValue).data.slice(0, 3)).toEqual([1000, 2000, 3000]);
  });
});

describe('matrices', () => {
  it('MMULT, MINVERSE, and MDETERM (lane test)', () => {
    expect(calc('MMULT({1,2;3,4},{5;6})')).toEqual([[17], [39]]);
    near(calc('MINVERSE({4,7;2,6})'), [
      [0.6, -0.7],
      [-0.2, 0.4],
    ]);
    expect(calc('MDETERM({1,3,8,5;1,3,6,1;1,1,1,0;7,3,10,2})') as number).toBeCloseTo(88, 9);
    expect(calc('MINVERSE({1,2;2,4})')).toEqual(err('NUM'));
  });

  it('refuses shapes that do not fit and items that are not numbers', () => {
    expect(calc('MMULT({1,2},{1,2})')).toEqual(err('VALUE'));
    expect(calc('MMULT({1,"a"},{1;2})')).toEqual(err('VALUE'));
    expect(calc('MDETERM({1,2,3;4,5,6})')).toEqual(err('VALUE'));
    expect(
      calc('MDETERM(A1:B2)', [
        ['1', '2'],
        ['3', ''],
      ]),
    ).toEqual(err('VALUE'));
    expect(calc('MDETERM({1,2;2,4})')).toBe(0);
  });

  it('MUNIT, TRANSPOSE, and RANDARRAY build arrays', () => {
    expect(calc('MUNIT(3)')).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
    expect(calc('MUNIT(0)')).toEqual(err('VALUE'));
    expect(calc('TRANSPOSE({1,2,3;4,5,6})')).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
    const dice = calc('RANDARRAY(3,4,1,6,TRUE)') as number[][];
    expect(dice.flat()).toHaveLength(12);
    for (const v of dice.flat()) expect(Number.isInteger(v) && v >= 1 && v <= 6).toBe(true);
    expect(calc('RANDARRAY(1,1,5,1)')).toEqual(err('VALUE'));
    expect(calc('SEQUENCE(0)')).toEqual(err('CALC'));
    expect(calc('SEQUENCE(-1)')).toEqual(err('VALUE'));
  });
});

describe('LAMBDA helpers', () => {
  it('MAP, REDUCE, SCAN, BYROW, and MAKEARRAY (lane test)', () => {
    expect(calc('MAP({1,2},LAMBDA(x,x*2))')).toEqual([[2, 4]]);
    expect(calc('REDUCE(0,{1,2,3},LAMBDA(a,b,a+b))')).toBe(6);
    expect(calc('SCAN(0,{1,2,3},LAMBDA(a,b,a+b))')).toEqual([[1, 3, 6]]);
    expect(calc('BYROW({1,2;3,4},LAMBDA(r,SUM(r)))')).toEqual([[3], [7]]);
    expect(calc('MAKEARRAY(2,2,LAMBDA(r,c,r*c))')).toEqual([
      [1, 2],
      [2, 4],
    ]);
  });

  it('MAP takes several arrays, BYCOL gives a row, and REDUCE may carry an array', () => {
    expect(calc('MAP({1,2},{10,20},LAMBDA(a,b,a+b))')).toEqual([[11, 22]]);
    expect(calc('BYCOL({1,2;3,4},LAMBDA(c,MAX(c)))')).toEqual([[3, 4]]);
    expect(calc('REDUCE(,{1,2,3},LAMBDA(a,b,a+b))')).toBe(6);
    expect(calc('REDUCE({0,0},{1,2},LAMBDA(a,b,a+b))')).toEqual([[3, 3]]);
  });

  it('gives #VALUE! for a missing function or a wrong count, and #CALC! for a nested array', () => {
    expect(calc('MAP({1,2},5)')).toEqual(err('VALUE'));
    expect(calc('MAP({1,2},LAMBDA(a,b,a+b))')).toEqual([[err('VALUE'), err('VALUE')]]);
    expect(calc('BYROW({1,2;3,4},LAMBDA(r,r))')).toEqual([[err('CALC')], [err('CALC')]]);
    expect(calc('MAKEARRAY(0,2,LAMBDA(r,c,r))')).toEqual(err('VALUE'));
  });

  it('refuses an empty parameter or name, as in LAMBDA(,x) and LET(,1,x)', () => {
    expect(calc('LAMBDA(,1)(2)')).toEqual(err('VALUE'));
    expect(calc('MAP({1,2},LAMBDA(,1))')).toEqual(err('VALUE'));
    expect(calc('LET(,1,2)')).toEqual(err('VALUE'));
    // An empty argument in a call, as UNIQUE(x,,TRUE), still reads as left out.
    expect(calc('UNIQUE({1;1;2},,TRUE)')).toBe(2);
  });
});

describe('documented choices', () => {
  it('SEQUENCE lifts over an array count: each item keeps the first value of its own result', () => {
    expect(calc('SEQUENCE({2,3})')).toEqual([[1, 1]]);
  });

  it('FILTER reads an empty include cell as FALSE', () => {
    expect(
      calc('FILTER(A1:A3,B1:B3)', [
        ['a', '1'],
        ['b', ''],
        ['c', '1'],
      ]),
    ).toEqual([['a'], ['c']]);
  });
});

describe('the size cap', () => {
  it('SEQUENCE(2000,1000) is #NUM! with Too many values, without allocating (lane test)', () => {
    const t = run('SEQUENCE(2000,1000)');
    const value = t.rows[0].cells[HOME.col].value;
    expect(value).toMatchObject({ error: 'NUM' });
    expect(reasonOf(value)).toBe('tooMany');
    const origin = errorOrigin(t, HOME.col, HOME.row);
    expect(origin).toMatchObject({ code: 'NUM', kind: 'function', name: 'SEQUENCE', reason: 'tooMany' });
    const reasons = fnArrays.reasons as Record<string, string>;
    expect(
      explainOrigin(
        origin!,
        () => '',
        (_key, values) => reasons[values.reason ?? ''],
      ),
    ).toBe('Too many values');
    // A request of 10^12 items would throw or stall if anything were allocated; it is refused at once.
    const started = performance.now();
    for (const formula of ['SEQUENCE(1000000,1000000)', 'MAKEARRAY(1E6,1E6,LAMBDA(r,c,1))', 'MUNIT(1E6)']) {
      expect(calc(formula), formula).toMatchObject({ error: 'NUM' });
    }
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('allows exactly the cap and refuses one more', () => {
    const spec = REGISTRY.get('SEQUENCE')!;
    const full = spec.run([MAX_ELEMENTS], { today: () => 0 });
    expect(isError(full)).toBe(false);
    const over = spec.run([MAX_ELEMENTS + 1], { today: () => 0 });
    expect(over).toMatchObject({ error: 'NUM' });
    expect(reasonOf(over)).toBe('tooMany');
    expect(reasonOf(calc('VSTACK(SEQUENCE(1000,1000),1)'))).toBe('tooMany');
  });
});

describe('the lane’s functions', () => {
  const names = (
    'ARRAYFORMULA BYCOL BYROW CHOOSECOLS CHOOSEROWS DROP EXPAND FILTER FLATTEN HSTACK MAKEARRAY MAP MDETERM ' +
    'MINVERSE MMULT MUNIT RANDARRAY REDUCE SCAN SEQUENCE SORT SORTBY SORTN TAKE TOCOL TOROW TRANSPOSE TRIMRANGE ' +
    'UNIQUE VSTACK WRAPCOLS WRAPROWS'
  ).split(' ');

  it('are all registered with a signature and an example of their own', () => {
    for (const name of names) {
      const spec = REGISTRY.get(name);
      expect(spec, name).toBeDefined();
      expect(spec!.meta.signature.startsWith(`${name}(`), name).toBe(true);
      expect(spec!.meta.example, name).toMatch(/^=/);
    }
  });

  it('have a description for the function and for each argument, and nothing else is described', () => {
    const text = fnArrays as Readonly<Record<string, FnText | undefined>>;
    for (const name of names) {
      expect(text[name]?.description, name).toMatch(/^[A-Z].*\.$/);
      for (const param of paramsOf(REGISTRY.get(name)!)) {
        expect(text[name]?.params[param.name], `${name} ${param.name}`).toBeTruthy();
      }
    }
    expect(Object.keys(text).filter((key) => key !== 'reasons' && !names.includes(key))).toEqual([]);
  });

  it('leave an argument left empty to its default, in any function', () => {
    expect(calc('IF(TRUE,,2)')).toBe(null);
    expect(calc('SEQUENCE(2,,5)')).toEqual([[5], [6]]);
  });
});

describe('the fixture of hand-worked cases', () => {
  interface Case {
    formula: string;
    cells?: Record<string, number | string>;
    expected: number | string | (number | string)[][];
  }
  const one = (v: Value): unknown => (isError(v) ? `#${v.error}` : v);
  const show = (v: Value | Scalar[][]): unknown => (Array.isArray(v) ? v.map((row) => row.map(one)) : one(v));
  it.each((fixture as { cases: Case[] }).cases.map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    const data: string[][] = [];
    for (const [ref, v] of Object.entries(c.cells ?? {})) {
      (data[Number(ref.slice(1)) - 1] ??= [])[ref.charCodeAt(0) - 65] = String(v);
    }
    expect(show(calc(c.formula.slice(1), data))).toEqual(c.expected);
  });
});
