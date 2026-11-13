import { describe, expect, it } from 'vitest';
import { calculateTable, createTable, setCellInput, setColumnFormula } from './edit';
import type { FnSpec2 } from './formula/fn';
import { convertFormula, STORED, syntaxOf } from './formula/lexer';
import { parseFormula } from './formula/parser';
import { DE_DE, EN_US } from './locale';
import type { Table } from './model';
import { quickMath } from './quickMath';
import {
  DEFAULT_ENV,
  errorOrigin,
  needsCalculation,
  recalculate,
  recalculateWithCycles,
  spillRange,
  type EngineEnv,
} from './recalc';
import { bookErrorOrigin, recalculateBook, setBookCellInput } from './workbook';
import { ERROR_TOKENS, arrayOf, err, isArray, toNumber, toText, type Value } from './values';

const DATA = [
  ['10', '2'],
  ['5', '3'],
];

/** Runs a formula as a calculated column over two rows of Price and Qty. */
function calc(formula: string, data: string[][] = DATA): Value[] {
  const base = createTable(
    [{ name: 'Price', type: 'number' }, { name: 'Qty', type: 'number' }, { name: 'Out' }],
    data,
    EN_US,
  );
  const result = setColumnFormula(base, 2, formula);
  if (!result.ok) throw new Error(`${formula}: ${result.problem.message}`);
  return result.table.rows.map((row) => row.cells[2].value);
}

const first = (formula: string): Value => calc(formula)[0];

describe('precedence and operators', () => {
  it.each([
    ['-2^2', -4],
    ['2^-1', 0.5],
    ['2^3^2', 512],
    ['50%', 0.5],
    ['200*15%', 30],
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['10/4', 2.5],
    // Results keep the full double (ADR 0058); a cell shows 15 digits, 0.3.
    ['0.1+0.2', 0.1 + 0.2],
    ['1&2+3', '15'],
    ['"a"&"b"', 'ab'],
    ['1<2', true],
    ['"a"="A"', true],
    ['2<>2', false],
    ['3>=3', true],
    ['√16+9', 13],
    ['6×3÷2−1', 8],
    ['1e3+1.5E-1', 1000.15],
  ])('%s gives %j', (formula, expected) => {
    expect(first(formula)).toEqual(expected);
  });

  it('coerces empty and numeric text like Excel', () => {
    expect(calc('[Price]+[Qty]', [['', '2']])[0]).toBe(2);
    expect(first('"3"+4')).toBe(7);
    expect(first('TRUE+1')).toBe(2);
  });
});

describe('references', () => {
  it('uses the row of a column name, case-insensitively', () => {
    expect(calc('[price]*[Qty]')).toEqual([20, 15]);
  });

  it('means the whole column inside an aggregate', () => {
    expect(calc('[Price]/SUM([Price])')).toEqual([10 / 15, 5 / 15]);
  });

  it('reads A1 cells and ranges by data row', () => {
    expect(first('A1+B2')).toBe(13);
    expect(first('SUM(A1:B2)')).toBe(20);
    expect(first('SUM(A:A)')).toBe(15);
    expect(first('SUM($A$1,B1)')).toBe(12);
  });

  it('resolves references by column ID in stored form', () => {
    expect(calc('{c0}+{c1}')).toEqual([12, 8]);
  });

  it('reports a missing column or row as a reference error', () => {
    expect(first('[Nope]')).toEqual(err('REF'));
    expect(first('A99')).toEqual(err('REF'));
    expect(first('Z1')).toEqual(err('REF'));
  });
});

describe('functions', () => {
  it.each([
    ['SUM([Price])', 15],
    ['AVERAGE([Price])', 7.5],
    ['MIN([Price])', 5],
    ['MAX([Price],[Qty])', 10],
    ['COUNT([Price],5)', 3],
    ['COUNT([Price])', 2],
    ['COUNTA([Price])', 2],
    ['MEDIAN(1,2,3,4)', 2.5],
    ['IF([Qty]>2,"many","few")', 'few'],
    ['IF(0,1)', false],
    ['ROUND(2.5)', 3],
    ['ROUND(-2.5)', -3],
    ['ROUND(1.005,2)', 1.01],
    ['ROUND(1234.5678,-2)', 1200],
    ['ROUNDUP(1.21,1)', 1.3],
    ['ROUNDDOWN(-1.29,1)', -1.2],
    ['ABS(-3)+INT(2.9)+MOD(-1,3)', 7],
    ['SQRT(16)+POWER(2,3)', 12],
    ['LOG(100)+LOG(8,2)+LOG10(10)+LN(1)', 6],
    ['DEGREES(PI())', 180],
    ['SIN(0)+COS(0)', 1],
    ['AND(1<2,2<3)', true],
    ['OR(1>2,FALSE)', false],
    ['NOT(TRUE)', false],
    ['ISBLANK(A9)', false],
    ['CONCAT("a",1,TRUE)', 'a1TRUE'],
    ['LEFT("abc",1)&LEN("ab")', 'a2'],
    ['UPPER(LEFT("abc",2))&RIGHT("abc",1)', 'ABc'],
    ['TRIM("  a   b ")', 'a b'],
    ['DATE(2026,9,30)', 46295],
    ['YEAR(DATE(2026,9,30))*10000+MONTH(DATE(2026,9,30))*100+DAY(DATE(2026,9,30))', 20260930],
    ['DAYS(DATE(2026,3,1),DATE(2026,2,1))', 28],
  ])('%s gives %j', (formula, expected) => {
    expect(first(formula)).toEqual(expected);
  });
});

describe('function edge cases', () => {
  it('reads blank cells with ISBLANK', () => {
    expect(calc('ISBLANK([Price])', [['', '1']])[0]).toBe(true);
    expect(calc('ISBLANK([Price])', [['3', '1']])[0]).toBe(false);
  });

  it('gives average of nothing as a division error and a missing function as a name error', () => {
    expect(first('AVERAGE("x")')).toEqual(err('VALUE'));
    expect(first('SUMM(1)')).toEqual(err('NAME'));
    expect(first('SQRT()')).toEqual(err('VALUE'));
  });

  it('reads TODAY from the environment', () => {
    const base = createTable([{ name: 'D' }], [['']], EN_US);
    const result = setColumnFormula(base, 0, 'TODAY()+1', { today: () => 100 });
    expect(result.ok && result.table.rows[0].cells[0].value).toBe(101);
  });
});

describe('error values', () => {
  it.each([
    ['1/0', 'DIV0'],
    ['"a"+1', 'VALUE'],
    ['SQRT(-1)', 'NUM'],
    ['LN(0)', 'NUM'],
    ['0^-1', 'DIV0'],
    ['POWER(0,0)', 'NUM'],
    ['1e308*10', 'NUM'],
    ['1+1/0', 'DIV0'],
    ['SUM(1/0)', 'DIV0'],
    ['IF(1/0,1,2)', 'DIV0'],
  ])('%s gives %s', (formula, code) => {
    expect(first(formula)).toEqual(err(code as 'DIV0'));
  });

  it('lets IFERROR catch them, and stores Excel tokens', () => {
    expect(first('IFERROR(1/0,"none")')).toBe('none');
    expect(ERROR_TOKENS.DIV0).toBe('#DIV/0!');
    expect(ERROR_TOKENS.CYCLE).toBe('#REF!');
  });
});

describe('syntax', () => {
  it.each(['', '1+', '(1', '1)', 'SUM(1,', '[Price', '"open', '1 2', 'foo', 'A0', '@', '1+*2', '{'])(
    'refuses %j',
    (src) => {
      const parsed = parseFormula(src);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.problem.pos).toBeGreaterThanOrEqual(0);
    },
  );

  it('reports the position of the problem', () => {
    const parsed = parseFormula('1+*2');
    expect(!parsed.ok && parsed.problem.pos).toBe(2);
  });

  it('never throws on deep or odd input', () => {
    for (const src of ['('.repeat(5000), '-'.repeat(5000), '1+'.repeat(3000) + '1', '\u0000', '[]]]', 'A1:', ':A1']) {
      expect(() => parseFormula(src)).not.toThrow();
    }
  });

  it('converts between regional and stored forms', () => {
    const typed = 'IF([Preis]>1,5;SUM(1,5;2))';
    const stored = convertFormula(typed, syntaxOf(DE_DE), STORED);
    expect(stored).toBe('IF([Preis]>1.5,SUM(1.5,2))');
    expect(convertFormula('SUM(1.5,2)', STORED, syntaxOf(DE_DE))).toBe('SUM(1,5;2)');
    expect(
      convertFormula(convertFormula('A1*2.5+SUM(1,2)', STORED, syntaxOf(DE_DE)) as string, syntaxOf(DE_DE), STORED),
    ).toBe('A1*2.5+SUM(1,2)');
  });

  it('keeps names with brackets and quotes out of the conversion', () => {
    expect(first('LEN("a,b;c.d")')).toBe(7);
    const table = createTable([{ name: 'Unit price [EUR]' }, { name: 'Out' }], [['4', '']], EN_US);
    const result = setColumnFormula(table, 1, '[Unit price [EUR]]]*2');
    expect(result.ok && result.table.rows[0].cells[1].value).toBe(8);
  });
});

describe('recalculation', () => {
  it('runs calculated columns in dependency order', () => {
    const table = createTable(
      [
        { name: 'C', formula: '[B]*2' },
        { name: 'B', formula: '[A]+1' },
        { name: 'A', type: 'number' },
      ],
      [['', '', '4']],
      EN_US,
    );
    expect(table.rows[0].cells.map((c) => c.value)).toEqual([10, 5, 4]);
  });

  it('updates dependents when an input changes and keeps unchanged rows', () => {
    const table = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', formula: '[A]*2' },
      ],
      [
        ['1', ''],
        ['2', ''],
      ],
      EN_US,
    );
    const next = setCellInput(table, { row: 0, col: 0, raw: '5' }, EN_US);
    expect(next.rows.map((r) => r.cells[1].value)).toEqual([10, 4]);
    expect(next.rows[1]).toBe(table.rows[1]);
    expect(setCellInput(next, { row: 0, col: 0, raw: '5' }, EN_US).rows[0].cells[1]).toBe(next.rows[0].cells[1]);
  });
});

describe('recalculating single cells', () => {
  it('calculates single cells typed as formulas, and keeps a broken one as text', () => {
    const table = createTable(
      [
        { name: 'A', type: 'number' },
        { name: 'B', type: 'number' },
      ],
      [
        ['3', ''],
        ['4', ''],
      ],
      EN_US,
    );
    const next = setCellInput(table, { row: 0, col: 1, raw: '=A1+A2' }, EN_US);
    expect(next.rows[0].cells[1].value).toBe(7);
    expect(setCellInput(next, { row: 0, col: 0, raw: '10' }, EN_US).rows[0].cells[1].value).toBe(14);
    expect(setCellInput(table, { row: 0, col: 1, raw: '=1+' }, EN_US).rows[0].cells[1]).toEqual({
      raw: '=1+',
      value: '=1+',
    });
  });
});

describe('refused formulas and cycles', () => {
  it('refuses a formula that has a syntax error or would use its own result', () => {
    const table = createTable([{ name: 'A', type: 'number' }, { name: 'B' }], [['1', '']], EN_US);
    const bad = setColumnFormula(table, 1, '[A]+');
    expect(bad.ok).toBe(false);
    const self = setColumnFormula(table, 1, 'SUM([B])');
    expect(self.ok).toBe(false);
    const ok = setColumnFormula(table, 1, '[A]+1');
    expect(ok.ok).toBe(true);
    const loop = ok.ok ? setColumnFormula(ok.table, 0, '[B]') : ok;
    expect(loop.ok).toBe(false);
    expect(!loop.ok && loop.problem.message).toContain('its own result');
  });
});

describe('cycles from outside edits', () => {
  it('marks cycles that come from outside edits, and passes the error on to readers', () => {
    const table = createTable(
      [
        { name: 'X', formula: '[Y]+1' },
        { name: 'Y', formula: '[X]+1' },
        { name: 'Z', formula: '[X]+1' },
        { name: 'W', formula: '2' },
      ],
      [
        ['', '', '', ''],
        ['', '', '', ''],
      ],
      EN_US,
    );
    const row = table.rows[0].cells.map((c) => c.value);
    expect(row).toEqual([err('CYCLE'), err('CYCLE'), err('CYCLE'), 2]);
    const { cycles } = recalculateWithCycles(table);
    expect(cycles.map((c) => c.col).sort()).toEqual([0, 1]);
  });
});

describe('cells and cycles', () => {
  it('detects a cycle between single cells but not a range beside them', () => {
    const table = createTable([{ name: 'A', type: 'number' }], [['1'], ['2'], ['3']], EN_US);
    const fine = setCellInput(table, { row: 2, col: 0, raw: '=SUM(A1:A2)' }, EN_US);
    expect(fine.rows[2].cells[0].value).toBe(3);
    const loop = setCellInput(table, { row: 2, col: 0, raw: '=SUM(A1:A3)' }, EN_US);
    expect(loop.rows[2].cells[0].value).toEqual(err('CYCLE'));
  });

  it('finds the cycle at the top of a long running total in linear time', () => {
    const rows = Array.from({ length: 1500 }, (_, r) => [r === 0 ? '=A1+1' : `=A${r}+1`]);
    const started = performance.now();
    const table = createTable([{ name: 'A', type: 'number' }], rows, EN_US);
    const { cycles } = recalculateWithCycles(table);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(cycles).toEqual([{ col: 0, row: 0 }]);
    expect(table.rows[1499].cells[0].value).toEqual(err('CYCLE'));
  });

  it('refuses a formula too deep to walk and still recalculates the rest of the table', () => {
    const sum = (inner: string): string => `(${inner}${'+1'.repeat(1900)})`;
    const table = createTable(
      [
        { name: 'A', formula: sum(sum(sum(sum('1')))) },
        { name: 'B', formula: sum(sum('1')) },
        { name: 'C', formula: '2+3' },
      ],
      [['', '', '']],
      EN_US,
    );
    expect(table.rows[0].cells.map((c) => c.value)).toEqual([err('VALUE'), err('VALUE'), 5]);
  });

  it('treats a formula that no longer parses as a value error', () => {
    const table = createTable([{ name: 'A', formula: '1+' }], [['']], EN_US);
    expect(table.rows[0].cells[0].value).toEqual(err('VALUE'));
  });
});

// Stand-ins for library functions that other lanes add (SEQUENCE in fn-arrays, VLOOKUP in fn-lookup), written from
// their documented behavior and kept to what these tests need. They come in through the engine's `functions`.
const meta = { signature: '', example: '' };
const SEQUENCE: FnSpec2 = {
  name: 'SEQUENCE',
  family: 'arrays',
  params: [
    { name: 'rows', kind: 'number' },
    { name: 'columns', kind: 'number', optional: true },
  ],
  run: ([rows, cols]) => {
    const r = toNumber(rows);
    const c = cols === undefined ? 1 : toNumber(cols);
    if (typeof r !== 'number' || typeof c !== 'number') return err('VALUE');
    return arrayOf(Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => i * c + j + 1)));
  },
  meta,
};
const VLOOKUP: FnSpec2 = {
  name: 'VLOOKUP',
  family: 'lookup',
  params: [
    { name: 'lookup_value', kind: 'value' },
    { name: 'table_array', kind: 'range' },
    { name: 'col_index_num', kind: 'number' },
    { name: 'range_lookup', kind: 'bool', optional: true },
  ],
  run: ([value, table, index]) => {
    if (!isArray(table)) return err('VALUE');
    const n = Number(index);
    if (n < 1 || n > table.cols) return err('REF');
    for (let r = 0; r < table.rows; r++) {
      if (table.data[r * table.cols] === value) return table.data[r * table.cols + n - 1];
    }
    return err('NA');
  },
  meta,
};
let counter = 0;
/** REFTO("A2"): a reference named by text, as INDIRECT gives, so what it reads is only known when it runs. */
const REFTO: FnSpec2 = {
  name: 'REFTO',
  family: 'lookup',
  returnsRef: true,
  params: [{ name: 'text', kind: 'text' }],
  run: ([text]) => {
    const t = toText(text);
    if (typeof t !== 'string') return t;
    const m = /^([A-Z])(\d+)$/.exec(t);
    if (!m) return err('REF');
    const c = m[1].charCodeAt(0) - 65;
    const r = Number(m[2]) - 1;
    return { kind: 'ref', r1: r, c1: c, r2: r, c2: c };
  },
  meta,
};
const ENV: EngineEnv = {
  today: () => 46_000 + counter,
  functions: new Map([
    ['SEQUENCE', SEQUENCE],
    ['VLOOKUP', VLOOKUP],
    ['REFTO', REFTO],
  ]),
};

const LETTERS = ['A', 'B', 'C', 'D'];

/** A table with Excel's rules (data.sheet.v 1) and number columns A to D. */
function sheet(data: string[][], extra: Partial<Table> = {}): Table {
  const columns = LETTERS.map((name) => ({ name, type: 'number' as const }));
  const table = createTable(columns, data, EN_US, ENV, 1);
  return Object.keys(extra).length === 0 ? table : recalculate({ ...table, ...extra }, ENV);
}

function type(t: Table, ref: string, raw: string): Table {
  const col = ref.charCodeAt(0) - 65;
  const row = Number(ref.slice(1)) - 1;
  return setCellInput(t, { row, col, raw }, EN_US, ENV);
}
const at = (t: Table, ref: string): Value => t.rows[Number(ref.slice(1)) - 1].cells[ref.charCodeAt(0) - 65].value;
const column = (t: Table, col: number): Value[] => t.rows.map((r) => r.cells[col].value);
const blank = (rows: number): string[][] => Array.from({ length: rows }, () => ['', '', '', '']);
const row1 = (...values: string[]): string[][] => [values];

describe('arrays and spill (ADR 0059)', () => {
  it('spills SEQUENCE, blocks on a typed cell, and spills again when it is cleared (lane test)', () => {
    let t = type(sheet(blank(4)), 'A1', '=SEQUENCE(3)');
    expect(column(t, 0)).toEqual([1, 2, 3, null]);
    expect(t.rows[1].cells[0].spill).toBe(true);
    expect(spillRange(t, 0, 0)).toEqual({ s: 0, r1: 0, c1: 0, r2: 2, c2: 0 });
    t = type(t, 'A2', 'x');
    expect(at(t, 'A1')).toEqual(err('SPILL'));
    expect(at(t, 'A2')).toBe('x');
    expect(at(t, 'A3')).toBe(null);
    expect(errorOrigin(t, 0, 0)).toMatchObject({ code: 'SPILL', kind: 'spill', cell: { table: 0, col: 0, row: 1 } });
    t = type(t, 'A2', '');
    expect(column(t, 0)).toEqual([1, 2, 3, null]);
    t = type(t, 'B1', '=SUM(A1#)');
    expect(at(t, 'B1')).toBe(6);
  });

  it('orders a reader of a spill after it, whichever was typed first', () => {
    let t = type(sheet(blank(4)), 'B1', '=SUM(A1#)');
    expect(at(t, 'B1')).toEqual(err('REF'));
    t = type(t, 'B2', '=A3*10');
    t = type(t, 'A1', '=SEQUENCE(3)');
    expect(at(t, 'B1')).toBe(6);
    expect(at(t, 'B2')).toBe(30);
    t = type(t, 'A1', '=SEQUENCE(2)');
    expect(column(t, 0)).toEqual([1, 2, null, null]);
    expect(at(t, 'B1')).toBe(3);
    expect(at(t, 'B2')).toBe(0);
  });

  it('spills ranges and array constants, and refuses to spill past the table', () => {
    let t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
      ['3', '', '', ''],
    ]);
    t = type(t, 'B1', '=A1:A3*2');
    expect(column(t, 1)).toEqual([2, 4, 6]);
    t = type(t, 'C1', '={1,2;3,4}');
    expect([at(t, 'C1'), at(t, 'D1'), at(t, 'C2'), at(t, 'D2')]).toEqual([1, 2, 3, 4]);
    t = type(t, 'D3', '=SEQUENCE(2)');
    expect(at(t, 'D3')).toEqual(err('SPILL'));
    expect(errorOrigin(t, 3, 2)).toMatchObject({ kind: 'spill' });
  });

  it('broadcasts operators: a column against a row, and #N/A where sizes differ', () => {
    let t = type(sheet(blank(3)), 'A1', '={1;2}+{10,20}');
    expect([at(t, 'A1'), at(t, 'B1'), at(t, 'A2'), at(t, 'B2')]).toEqual([11, 21, 12, 22]);
    t = type(t, 'C1', '={1;2;3}+{1;2}');
    expect(column(t, 2)).toEqual([2, 4, err('NA')]);
  });

  it('reads one value with @ and keeps a legacy array formula in its block', () => {
    let t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
      ['3', '', '', ''],
    ]);
    t = type(t, 'B2', '=@A1:A3');
    expect(at(t, 'B2')).toBe(2);
    expect(at(t, 'B3')).toBe(null);
    const legacyCell = { raw: '={1;2}', value: null, formula: '{1;2}', array: { rows: 3, cols: 1 } };
    const rows = t.rows.map((row, r) =>
      r === 0 ? { ...row, cells: row.cells.map((c, i) => (i === 2 ? legacyCell : c)) } : row,
    );
    const legacy = recalculate({ ...t, rows }, ENV);
    expect(column(legacy, 2)).toEqual([1, 2, err('NA')]);
  });

  it('gives #SPILL! for an array in a calculated column, and #CALC! for a LAMBDA left uncalled', () => {
    const t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
    ]);
    const result = setColumnFormula(t, 1, '{1,2}', ENV);
    expect(result.ok && column(result.table, 1)).toEqual([err('SPILL'), err('SPILL')]);
    expect(at(type(t, 'C1', '=LAMBDA(x,x)'), 'C1')).toEqual(err('CALC'));
  });
});

describe('LET, LAMBDA, and names (ADR 0062)', () => {
  it('binds LET names, calls a LAMBDA in place, and recurses through a named LAMBDA (lane test)', () => {
    const names = [{ name: 'Fact', ref: 'LAMBDA(n, IF(n<2,1,n*Fact(n-1)))' }];
    let t = sheet(blank(2), { names });
    t = type(t, 'A1', '=LET(x,2,y,x*3,x+y)');
    t = type(t, 'B1', '=LAMBDA(x,x+1)(2)');
    t = type(t, 'C1', '=Fact(10)');
    expect([at(t, 'A1'), at(t, 'B1'), at(t, 'C1')]).toEqual([8, 3, 3628800]);
  });

  it('knows optional parameters with ISOMITTED, LAMBDA values in LET, and ranges in LET', () => {
    let t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
      ['3', '', '', ''],
    ]);
    t = type(t, 'B1', '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1)');
    t = type(t, 'B2', '=LAMBDA(a,[b],IF(ISOMITTED(b),a,a+b))(1,2)');
    t = type(t, 'C1', '=LET(f,LAMBDA(x,x*x),f(4)+f(1))');
    t = type(t, 'D1', '=LET(r,A1:A3,SUM(r))');
    expect([at(t, 'B1'), at(t, 'B2'), at(t, 'C1'), at(t, 'D1')]).toEqual([1, 3, 17, 6]);
    expect(at(type(t, 'C2', '=LAMBDA(x,x)(1,2)'), 'C2')).toEqual(err('VALUE'));
  });

  it('stops recursion deeper than 1,024 with #NUM!', () => {
    const names = [{ name: 'Down', ref: 'LAMBDA(n, IF(n=0, 0, Down(n-1)))' }];
    let t = sheet(blank(1), { names });
    t = type(t, 'A1', '=Down(100)');
    t = type(t, 'B1', '=Down(5000)');
    expect(at(t, 'A1')).toBe(0);
    expect(at(t, 'B1')).toEqual(err('NUM'));
  });

  it('reads constant, range, and formula names', () => {
    const names = [
      { name: 'Rate', ref: '0.5' },
      { name: 'Prices', ref: 'A1:A3' },
      { name: 'Twice', ref: 'SUM(Prices)*2' },
    ];
    const data = [
      ['10', '', '', ''],
      ['20', '', '', ''],
      ['30', '', '', ''],
    ];
    let t = sheet(data, { names });
    t = type(t, 'B1', '=A1*Rate');
    t = type(t, 'B2', '=SUM(Prices)');
    t = type(t, 'B3', '=Twice');
    expect(column(t, 1)).toEqual([5, 60, 120]);
    t = type(t, 'A1', '40');
    expect(column(t, 1)).toEqual([20, 90, 180]);
    expect(at(type(t, 'C1', '=Nope+1'), 'C1')).toEqual(err('NAME'));
  });
});

describe('iterative and manual calculation (ADR 0065)', () => {
  it('converges A1 = (A1+10)/2 with iteration on, and shows Circular with it off (lane test)', () => {
    const on = type(sheet(blank(1), { iterate: { max: 100, change: 0.001 } }), 'A1', '=(A1+10)/2');
    expect(Math.abs((at(on, 'A1') as number) - 10)).toBeLessThan(0.001);
    const off = type(sheet(blank(1)), 'A1', '=(A1+10)/2');
    expect(at(off, 'A1')).toEqual(err('CYCLE'));
    expect(recalculateWithCycles(off, ENV).cycles).toEqual([{ col: 0, row: 0 }]);
  });

  it('stops after the most passes allowed', () => {
    const t = type(sheet(blank(1), { iterate: { max: 3, change: 0.001 } }), 'A1', '=A1+1');
    expect(at(t, 'A1')).toBe(3);
  });

  it('waits for F9 in manual calculation, except for a formula typed now', () => {
    let t = sheet(row1('1', '', '', ''), { calc: 'manual' });
    t = type(t, 'B1', '=A1*2');
    expect(at(t, 'B1')).toBe(2);
    t = type(t, 'A1', '5');
    expect(at(t, 'B1')).toBe(2);
    expect(needsCalculation(t)).toBe(true);
    t = calculateTable(t, ENV);
    expect(at(t, 'B1')).toBe(10);
  });

  it('recalculates volatile functions on every edit', () => {
    let t = type(sheet(row1('1', '', '', '')), 'B1', '=TODAY()');
    const before = at(t, 'B1') as number;
    counter++;
    t = type(t, 'A1', '2');
    expect(at(t, 'B1')).toBe(before + 1);
  });

  it('follows a reference that is only known when the formula runs', () => {
    let t = sheet([
      ['1', '', '', ''],
      ['2', '', '', ''],
    ]);
    t = type(t, 'B1', '=REFTO("A2")*10');
    expect(at(t, 'B1')).toBe(20);
    t = type(t, 'A2', '7');
    expect(at(t, 'B1')).toBe(70);
  });
});

describe('other tables on the page (ADR 0062)', () => {
  const sales = (): Table => ({
    ...createTable(
      [{ name: 'Region' }, { name: 'Amount', type: 'number' }],
      [
        ['East', '10'],
        ['West', '20'],
      ],
      EN_US,
      ENV,
      1,
    ),
    name: 'Sales',
  });

  it('recalculates Sales[Amount] in another table when a Sales cell changes (lane test)', () => {
    const report = createTable(
      [{ name: 'Total', type: 'number' }],
      [['=SUM(Sales[Amount])'], ['=Sales!B2*2']],
      EN_US,
      ENV,
      1,
    );
    let book = recalculateBook([sales(), report], ENV);
    expect(column(book[1], 0)).toEqual([30, 40]);
    book = setBookCellInput(book, 0, { row: 0, col: 1, raw: '100' }, EN_US, ENV);
    expect(column(book[1], 0)).toEqual([120, 40]);
    book = setBookCellInput(book, 0, { row: 1, col: 1, raw: '1' }, EN_US, ENV);
    expect(column(book[1], 0)).toEqual([101, 2]);
  });

  it('names tables Table1, Table2 by default, and reads page names from any table', () => {
    const first = {
      ...sheet(row1('4', '', '', '')),
      names: [{ name: 'Shared', ref: 'A1*10', scope: 'page' as const }],
    };
    const second = createTable([{ name: 'X', type: 'number' }], [['=Table1!A1+1'], ['=Shared']], EN_US, ENV, 1);
    const book = recalculateBook([first, second], ENV);
    expect(column(book[1], 0)).toEqual([5, 40]);
    const broken = createTable([{ name: 'X', type: 'number' }], [['=Nowhere!A1']], EN_US, ENV, 1);
    expect(at(recalculateBook([broken], ENV)[0], 'A1')).toEqual(err('REF'));
  });

  it('reads this row of a column with [@Col] in a calculated column', () => {
    const t = createTable(
      [
        { name: 'Qty', type: 'number' },
        { name: 'Price', type: 'number' },
        { name: 'Total', type: 'number', formula: '[@Qty]*[@Price]' },
        { name: 'Share', type: 'number', formula: 'Table1[@Total]/SUM(Table1[Total])' },
      ],
      [
        ['2', '5'],
        ['3', '10'],
      ],
      EN_US,
      ENV,
      1,
    );
    expect(column(t, 2)).toEqual([10, 30]);
    expect(column(t, 3)).toEqual([0.25, 0.75]);
  });
});

describe('error origins', () => {
  it('records the VLOOKUP node and its lookup value (lane test)', () => {
    let t = sheet([
      ['1', '10', '', ''],
      ['2', '20', '', ''],
      ['3', '30', '', ''],
    ]);
    t = type(t, 'C1', '=VLOOKUP(9,A1:B3,2,FALSE)');
    expect(at(t, 'C1')).toEqual(err('NA'));
    const origin = errorOrigin(t, 2, 0);
    expect(origin).toMatchObject({ code: 'NA', kind: 'function', name: 'VLOOKUP', start: 0 });
    expect(origin?.args?.[0]).toBe(9);
    expect(origin?.args?.[1]).toEqual({ rows: 3, cols: 2 });
    expect(at(type(t, 'C2', '=VLOOKUP(2,A1:B3,2,FALSE)'), 'C2')).toBe(20);
  });

  it('follows an error to the cell it came from, the operator, the name, and the cycle', () => {
    let t = sheet(row1('1', '0', '', ''));
    t = type(t, 'C1', '=A1/B1');
    t = type(t, 'D1', '=C1+1');
    expect(errorOrigin(t, 2, 0)).toMatchObject({ code: 'DIV0', kind: 'operator', name: '/' });
    expect(errorOrigin(t, 3, 0)).toMatchObject({ code: 'DIV0', kind: 'cell', cell: { table: 0, col: 2, row: 0 } });
    t = type(t, 'C1', '=nothing');
    expect(errorOrigin(t, 2, 0)).toMatchObject({ code: 'NAME', kind: 'name', name: 'nothing' });
    t = type(t, 'C1', '=D1');
    expect(errorOrigin(t, 2, 0)).toMatchObject({ kind: 'cycle' });
    t = type(t, 'C1', '1');
    expect(errorOrigin(t, 2, 0)).toBeUndefined();
  });

  it('keeps origins per table on a page', () => {
    const book = recalculateBook([sheet(row1('=1/0', '', '', ''))], ENV);
    expect(bookErrorOrigin(book, 0, 0, 0)).toMatchObject({ code: 'DIV0', kind: 'operator' });
  });
});

describe('quick math beside Excel rules', () => {
  it('keeps the calculator textbook rules while tables use Excel rules', () => {
    expect(quickMath('-2^2=', EN_US)).toMatchObject({ value: -4 });
    expect(quickMath('2^3^2=', EN_US)).toMatchObject({ value: 512 });
    expect(at(type(sheet(blank(1)), 'A1', '=-2^2'), 'A1')).toBe(4);
  });
});

describe('engine state', () => {
  it('gives the same results editing one table twice from the same starting point', () => {
    const base = sheet(row1('1', '=A1*2', '', ''));
    const a = type(base, 'A1', '3');
    const b = type(base, 'A1', '4');
    expect([at(a, 'B1'), at(b, 'B1'), at(base, 'B1')]).toEqual([6, 8, 2]);
    expect(at(type(a, 'A1', '5'), 'B1')).toBe(10);
  });

  it('recalculates from scratch under another env', () => {
    const t = sheet(row1('1', '', '', ''));
    expect(at(setCellInput(t, { row: 0, col: 1, raw: '=A1+1' }, EN_US, DEFAULT_ENV), 'B1')).toBe(2);
    const unknown = setCellInput(t, { row: 0, col: 1, raw: '=REFTO("A1")' }, EN_US, DEFAULT_ENV);
    expect(at(unknown, 'B1')).toEqual(err('NAME'));
  });
});
