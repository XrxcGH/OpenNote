import { describe, expect, it } from 'vitest';
import { createTable, setCellInput, setColumnFormula } from './edit';
import { convertFormula, STORED, syntaxOf } from './formula/lexer';
import { parseFormula } from './formula/parser';
import { DE_DE, EN_US } from './locale';
import { recalculateWithCycles } from './recalc';
import { ERROR_TOKENS, err, type Value } from './values';

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
    ['0.1+0.2', 0.3],
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
    expect(calc('[Price]/SUM([Price])')).toEqual([0.666666666666667, 0.333333333333333]);
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
    ['DATE(2026,9,30)', 20726],
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
