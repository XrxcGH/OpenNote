// Logical and information functions. Expected values come from fixtures/fn/logicInfo.json: documented examples and
// hand-worked values, never the code's own output. The lane tests at the top repeat the contract's examples.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import type { Table } from '../../model';
import { DEFAULT_ENV, recalculate, type EngineEnv } from '../../recalc';
import { ERROR_TOKENS, err, type ErrorCode, type Value } from '../../values';
import { recalculateBook, setBookCellInput } from '../../workbook';
import { fnLogicInfo } from '../../../../../strings/en/fnLogicInfo';
import { REGISTRY, paramsOf } from '.';

interface Fixture {
  data: string[][];
  cases: { formula: string; expect: Value | { error: string }; source: string }[];
}
const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../../../fixtures/fn/logicInfo.json'), 'utf8')) as Fixture;

const LETTERS = ['A', 'B', 'C', 'D'];

function sheet(data: string[][]): Table {
  const columns = LETTERS.map((name) => ({ name, type: 'number' as const }));
  return createTable(columns, data, EN_US, DEFAULT_ENV, 1);
}

/** Types a formula in D3 of the fixture's sheet and reads the result. */
function run(formula: string): Value {
  const t = setCellInput(sheet(FIXTURE.data), { row: 2, col: 3, raw: formula }, EN_US, DEFAULT_ENV);
  return t.rows[2].cells[3].value;
}

function expected(value: unknown): Value {
  if (typeof value !== 'object' || value === null || !('error' in value)) return value as Value;
  const token = (value as { error: string }).error;
  const code = (Object.keys(ERROR_TOKENS) as ErrorCode[]).find((c) => c !== 'CYCLE' && ERROR_TOKENS[c] === token);
  if (code === undefined) throw new Error(`Unknown error token ${token}`);
  return err(code);
}

describe('the contract examples (lane test)', () => {
  it('reads logical functions', () => {
    expect(run('=IFS(FALSE,1,TRUE,2)')).toBe(2);
    expect(run('=IFS(FALSE,1)')).toEqual(err('NA'));
    expect(run('=SWITCH(2,1,"a",2,"b","z")')).toBe('b');
    expect(run('=XOR(TRUE,TRUE,TRUE)')).toBe(true);
    expect(run('=IFNA(NA(),"x")')).toBe('x');
  });

  it('reads information functions', () => {
    expect(run('=ISNUMBER("1")')).toBe(false);
    expect(run('=N(TRUE)')).toBe(1);
    expect(run('=TYPE("a")')).toBe(2);
    expect(run('=TYPE({1,2})')).toBe(64);
    expect(run('=ERROR.TYPE(1/0)')).toBe(2);
    expect(run('=ERROR.TYPE(NA())')).toBe(7);
    expect(run('=ISEVEN(-2)')).toBe(true);
    expect(run('=ISODD(2.9)')).toBe(false);
  });
});

describe('the fixture cases', () => {
  it.each(FIXTURE.cases.map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    expect(c.source).toMatch(/\S/);
    expect(run(c.formula)).toEqual(expected(c.expect));
  });
});

describe('functions that ask about cells', () => {
  it('sees formulas typed in single cells', () => {
    let t = sheet(FIXTURE.data);
    t = setCellInput(t, { row: 0, col: 3, raw: '=A1+1' }, EN_US, DEFAULT_ENV);
    t = setCellInput(t, { row: 2, col: 3, raw: '=ISFORMULA(D1)' }, EN_US, DEFAULT_ENV);
    expect(t.rows[2].cells[3].value).toBe(true);
    t = setCellInput(t, { row: 0, col: 3, raw: '5' }, EN_US, DEFAULT_ENV);
    expect(t.rows[2].cells[3].value).toBe(false);
  });

  it('follows the cell it reads when that cell changes', () => {
    let t = sheet(FIXTURE.data);
    t = setCellInput(t, { row: 2, col: 3, raw: '=CELL("contents",A1)' }, EN_US, DEFAULT_ENV);
    expect(t.rows[2].cells[3].value).toBe(1);
    t = setCellInput(t, { row: 0, col: 0, raw: '9' }, EN_US, DEFAULT_ENV);
    expect(t.rows[2].cells[3].value).toBe(9);
  });

  it('reads the format of a column and the page title', () => {
    const columns = [
      { name: 'A', type: 'currency' as const, decimals: 2 },
      { name: 'B', type: 'percent' as const, decimals: 0 },
      { name: 'C', type: 'date' as const },
      { name: 'D', type: 'number' as const, decimals: 3 },
    ];
    const env: EngineEnv = { ...DEFAULT_ENV, title: 'Budget' };
    const blank = ['', '', '', ''];
    let t = createTable(columns, [blank, blank, blank], EN_US, env, 1);
    const ask = (f: string): Value => {
      t = setCellInput(t, { row: 2, col: 3, raw: f }, EN_US, env);
      return t.rows[2].cells[3].value;
    };
    expect(ask('=CELL("format",A1)')).toBe('C2');
    expect(ask('=CELL("format",B1)')).toBe('P0');
    expect(ask('=CELL("format",C1)')).toBe('D1');
    expect(ask('=CELL("format",D1)')).toBe('F3');
    expect(ask('=CELL("filename")')).toBe('Budget');
  });

  it('numbers the tables of a page and names another table in an address', () => {
    const one = { ...sheet(FIXTURE.data), name: 'Sales' };
    const two = { ...sheet(FIXTURE.data), name: 'Costs' };
    let book = recalculateBook([one, two], DEFAULT_ENV);
    const ask = (raw: string, col: number): Value => {
      book = setBookCellInput(book, 1, { row: 2, col, raw }, EN_US, DEFAULT_ENV);
      return book[1].rows[2].cells[col].value;
    };
    expect(ask('=SHEET()', 3)).toBe(2);
    expect(ask('=SHEETS()', 2)).toBe(2);
    expect(ask('=SHEET("Sales")', 1)).toBe(1);
    expect(ask('=CELL("address",Sales!B2)', 0)).toBe('Sales!$B$2');
  });

  it('reports a manual page', () => {
    const t = recalculate({ ...sheet(FIXTURE.data), calc: 'manual' }, DEFAULT_ENV);
    const typed = setCellInput(t, { row: 2, col: 3, raw: '=INFO("recalc")' }, EN_US, DEFAULT_ENV);
    expect(typed.rows[2].cells[3].value).toBe('Manual');
  });
});

describe('the registry', () => {
  it('holds every function the design lists for these two families', () => {
    const logical = [
      'AND',
      'FALSE',
      'IF',
      'IFERROR',
      'IFNA',
      'IFS',
      'LAMBDA',
      'LET',
      'NOT',
      'OR',
      'SWITCH',
      'TRUE',
      'XOR',
    ];
    const info = [
      ...['CELL', 'ERROR.TYPE', 'INFO', 'ISBLANK', 'ISDATE', 'ISEMAIL', 'ISERR', 'ISERROR', 'ISEVEN', 'ISFORMULA'],
      ...['ISLOGICAL', 'ISNA', 'ISNONTEXT', 'ISNUMBER', 'ISODD', 'ISOMITTED', 'ISREF', 'ISTEXT', 'ISURL', 'N', 'NA'],
      ...['SHEET', 'SHEETS', 'TYPE'],
    ];
    const of = (family: string): string[] =>
      [...REGISTRY.values()]
        .filter((s) => s.family === family)
        .map((s) => s.name)
        .sort();
    expect(of('logical')).toEqual(logical);
    expect(of('info')).toEqual(info);
  });

  it('describes every function and every argument in the strings', () => {
    const strings = fnLogicInfo as unknown as Record<string, { about: string; args: Record<string, string> }>;
    for (const spec of REGISTRY.values()) {
      if (spec.family !== 'logical' && spec.family !== 'info') continue;
      const text = strings[spec.name];
      expect(text?.about, spec.name).toMatch(/\S/);
      expect(Object.keys(text.args).sort(), spec.name).toEqual(
        paramsOf(spec)
          .map((p) => p.name)
          .sort(),
      );
    }
  });
});
