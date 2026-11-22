import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../engine/edit';
import { REGISTRY } from '../../engine/formula/fn';
import { EN_US } from '../../engine/locale';
import type { Table } from '../../engine/model';
import { accept, complete, hintAt } from './complete';
import { explainError, callArgs } from './explain';
import { fnInfo, hintParts } from './functions';
import { nameBoxText, readNameBox } from './nameBox';
import { originCellName, traceError } from './origin';
import { canPick, coloredRefs, cycleAnchor, gridRange, insertRef, refCells } from './refs';
import { matchingBracket, scanFormula } from './scan';

const ENV = { today: () => 45000 };
const COLUMNS = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'number' as const }));
const table = (data: string[][]): Table => createTable(COLUMNS, data, EN_US, ENV, 1);
const type = (t: Table, ref: string, raw: string): Table =>
  setCellInput(t, { row: Number(ref.slice(1)) - 1, col: ref.charCodeAt(0) - 65, raw }, EN_US, ENV);

describe('scanning a formula as it is typed', () => {
  it('finds functions, references, ranges, names, text, and errors, and never fails', () => {
    const kinds = (text: string) =>
      scanFormula(text)
        .filter((t) => t.kind !== 'space')
        .map((t) => `${t.kind}:${t.text}`);
    expect(kinds('=SUM(A1:B3, $C$2)*Rate&"x')).toEqual([
      'equals:=',
      'function:SUM',
      'open:(',
      'ref:A1:B3',
      'sep:,',
      'ref:$C$2',
      'close:)',
      'op:*',
      'name:Rate',
      'op:&',
      'string:"x',
    ]);
    expect(kinds("=Table2!B4+'My table'!A1+#N/A")).toEqual([
      'equals:=',
      'ref:Table2!B4',
      'op:+',
      "ref:'My table'!A1",
      'op:+',
      'error:#N/A',
    ]);
    // LOG10 is a function before a bracket; without one it is the cell in column LOG, row 10.
    expect(kinds('=LOG10(2)')[1]).toBe('function:LOG10');
  });

  it('matches brackets from either side', () => {
    const text = '=IF(A1>(2+3),1,0)';
    const tokens = scanFormula(text);
    expect(matchingBracket(tokens, 3)).toEqual([3, 16]);
    expect(matchingBracket(tokens, 12)).toEqual([7, 11]);
  });
});

describe('autocomplete and argument hints (lane test)', () => {
  it('lists VLOOKUP first for =VLO, Tab inserts VLOOKUP(, and the hint bolds lookup_value then table_array', () => {
    const typed = '=VLO';
    const found = complete(typed, typed.length);
    expect(found?.items[0]?.label).toBe('VLOOKUP');
    const done = accept(typed, found!, found!.items[0]!);
    expect(done).toEqual({ text: '=VLOOKUP(', caret: 9 });
    expect(fnInfo('VLOOKUP')?.args.lookup_value).toBeTruthy();
    const parts = hintParts(REGISTRY.get('VLOOKUP')!);
    const first = hintAt(done.text, done.caret);
    expect(first).toMatchObject({ name: 'VLOOKUP', arg: 0 });
    expect(parts[first!.part]?.name).toBe('lookup_value');
    const after = '=VLOOKUP(9,';
    const second = hintAt(after, after.length);
    expect(parts[second!.part]?.name).toBe('table_array');
  });

  it('offers names, tables, and columns after "Table["', () => {
    const context = {
      names: [{ name: 'TaxRate', ref: '0.0825' }],
      tables: [{ name: 'Sales', columns: ['Amount', 'Region'] }],
    };
    expect(complete('=Tax', 4, context)?.items.map((i) => i.label)).toEqual(['TaxRate']);
    expect(complete('=Sal', 4, context)?.items.map((i) => i.insert)).toContain('Sales[');
    const columns = complete('=Sales[A', 8, context);
    expect(columns?.items.map((i) => i.insert)).toEqual(['Amount]']);
    expect(complete('Plain text', 5)).toBeNull();
  });

  it('hints the inner call, and a repeating argument cycles through its group', () => {
    expect(hintAt('=ROUND(SUM(1,', 13)).toMatchObject({ name: 'SUM', arg: 1 });
    expect(hintAt('=ROUND(SUM(1,2),', 16)).toMatchObject({ name: 'ROUND', arg: 1 });
    expect(hintAt('=NOPE(1,', 8)).toBeNull();
  });
});

describe('references', () => {
  it('cycles $ marks with F4: $B$2, B$2, $B2, B2 (lane test)', () => {
    let text = '=B2';
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      text = cycleAnchor(text, text.length)!.text;
      seen.push(text.slice(1));
    }
    expect(seen).toEqual(['$B$2', 'B$2', '$B2', 'B2']);
    expect(cycleAnchor('=SUM(A1:B3)+1', 6)?.text).toBe('=SUM($A$1:$B$3)+1');
    expect(cycleAnchor('=1+2', 4)).toBeNull();
  });

  it('colors each distinct reference in order, so C3 in =A1+C3 takes the second color', () => {
    const colors = coloredRefs(scanFormula('=A1+C3+$A$1')).map((r) => [r.token.text, r.color]);
    expect(colors).toEqual([
      ['A1', 1],
      ['C3', 2],
      ['$A$1', 1],
    ]);
  });

  it('picks after an operator, a bracket, or a separator, and a second pick replaces the first', () => {
    expect(canPick('=A1+', 4)).toBe(true);
    expect(canPick('=SUM(', 5)).toBe(true);
    expect(canPick('=A1', 3)).toBe(false);
    expect(canPick('A1+', 3)).toBe(false);
    const one = insertRef('=A1+', 4, 'C3');
    expect(one.text).toBe('=A1+C3');
    expect(insertRef(one.text, one.caret, 'C3:D5', one.picked).text).toBe('=A1+C3:D5');
  });

  it('turns grid cells into addresses with and without a header row', () => {
    expect(gridRange({ row: 3, column: 2 }, { row: 3, column: 2 }, true)).toBe('C3');
    expect(gridRange({ row: 3, column: 2 }, { row: 1, column: 1 }, false)).toBe('B2:C4');
    const [c3] = scanFormula('=C3').filter((t) => t.kind === 'ref');
    expect(refCells(c3!, true)).toEqual({ top: 3, left: 2, bottom: 3, right: 2 });
  });
});

describe('the name box', () => {
  it('shows an address, a range, or the name defined for exactly that range, and reads them back', () => {
    const names = [{ name: 'Totals', ref: '$B$1:$B$3' }];
    expect(nameBoxText({ top: 2, left: 1, bottom: 2, right: 1 }, true, names)).toBe('B2');
    expect(nameBoxText({ top: 1, left: 1, bottom: 3, right: 1 }, true, names)).toBe('Totals');
    expect(nameBoxText({ top: 0, left: 1, bottom: 0, right: 1 }, true)).toBe('B');
    const size = { rows: 5, columns: 3 };
    expect(readNameBox('totals', true, size, names)).toEqual({ top: 1, left: 1, bottom: 3, right: 1 });
    expect(readNameBox('A1:C2', false, size)).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
    expect(readNameBox('Z9', false, size)).toBeNull();
  });
});

describe('error explanations (lane test)', () => {
  it('names 9 and A1:B3 when =VLOOKUP(9,A1:B3,2,FALSE) finds nothing', () => {
    const t = type(
      table([
        ['1', '10', '', ''],
        ['2', '20', '', ''],
        ['3', '30', '', ''],
      ]),
      'C1',
      '=VLOOKUP(9,A1:B3,2,FALSE)',
    );
    const page = { raws: [t], own: 0, names: [''] };
    const { first } = traceError(page, 2, 0);
    expect(first?.origin.code).toBe('NA');
    const words = explainError(first!.origin, first!.formula, originCellName(page));
    expect(words.cause).toBe('VLOOKUP found no match for 9 in A1:B3.');
  });

  it('traces an error back through the cells that read it', () => {
    let t = type(table([['1', '0', '', '']]), 'C1', '=A1/B1');
    t = type(t, 'D1', '=C1+1');
    const page = { raws: [t], own: 0, names: [''] };
    const { first, last } = traceError(page, 3, 0);
    expect(explainError(first!.origin, first!.formula, originCellName(page)).cause).toBe(
      'The formula reads C1, which already shows an error.',
    );
    expect(last?.cell).toEqual({ table: 0, col: 2, row: 0 });
    expect(explainError(last!.origin, last!.formula, originCellName(page)).cause).toBe(
      'A number was divided by zero or by an empty cell.',
    );
  });

  it('splits a call into its arguments as typed', () => {
    expect(callArgs('VLOOKUP(9, A1:B3, IF(1,2,3), {1,2})', 0, 35)).toEqual(['9', 'A1:B3', 'IF(1,2,3)', '{1,2}']);
  });
});
