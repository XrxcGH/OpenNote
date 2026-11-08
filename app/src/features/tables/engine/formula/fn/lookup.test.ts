// The lookup and reference family (tables:fn-lookup). The fixture's cases run through the whole engine with Excel's
// rules; each expected value was worked by hand from the documented rule in its note, or is Microsoft's own example.

import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/fn/lookup.json';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import type { Table } from '../../model';
import type { EngineEnv } from '../../recalc';
import { arrayOf, err, type ErrorCode, type Scalar, type Value } from '../../values';
import { addressText, columnLetters, functions, hyperlinkOf, parseRefText } from './lookup';

const ENV: EngineEnv = { today: () => 46_000 };
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function blank(): Table {
  const columns = LETTERS.map((name) => ({ name, type: 'number' as const }));
  const data = Array.from({ length: 6 }, () => LETTERS.map(() => ''));
  return createTable(columns, data, EN_US, ENV, 1);
}

const where = (ref: string) => ({ col: ref.charCodeAt(0) - 65, row: Number(ref.slice(1)) - 1 });

function type(t: Table, ref: string, raw: string): Table {
  return setCellInput(t, { ...where(ref), raw }, EN_US, ENV);
}

/** A cell's value. A formula that spills reads as one array from its cell. */
function at(t: Table, ref: string, rows = 1, cols = 1): Value {
  const { row, col } = where(ref);
  if (rows === 1 && cols === 1) return t.rows[row].cells[col].value;
  const out: Scalar[][] = [];
  for (let r = 0; r < rows; r++) {
    out.push(Array.from({ length: cols }, (_, c) => t.rows[row + r].cells[col + c].value as Scalar));
  }
  return arrayOf(out);
}

type Expected = Scalar | { error: ErrorCode } | { array: Scalar[][] };
interface Case {
  at?: string;
  formula: string;
  cells?: Record<string, string>;
  expected: Expected;
  source: string;
  note: string;
}

function want(e: Expected): Value {
  if (e !== null && typeof e === 'object' && 'error' in e) return err(e.error);
  if (e !== null && typeof e === 'object' && 'array' in e) return arrayOf(e.array);
  return e;
}

describe('lookup fixture cases', () => {
  for (const c of (fixture as { cases: Case[] }).cases) {
    it(`${c.formula} (${c.note})`, () => {
      let t = blank();
      for (const [ref, raw] of Object.entries(c.cells ?? {})) t = type(t, ref, raw);
      const cell = c.at ?? 'F1';
      t = type(t, cell, c.formula);
      const e = want(c.expected);
      const size = typeof e === 'object' && e !== null && 'kind' in e && e.kind === 'array' ? e : null;
      expect(at(t, cell, size?.rows ?? 1, size?.cols ?? 1)).toEqual(e);
    });
  }
});

describe('lane tests', () => {
  it('VLOOKUP: nearest smaller, exact miss, and the binary-search answer on unsorted keys', () => {
    let t = type(blank(), 'F1', '=VLOOKUP(2.5,{1,"a";2,"b";3,"c"},2,TRUE)');
    expect(at(t, 'F1')).toBe('b');
    t = type(t, 'F1', '=VLOOKUP(2.5,{1,"a";2,"b";3,"c"},2,FALSE)');
    expect(at(t, 'F1')).toEqual(err('NA'));
    // Keys 1,5,2,6,3: the middle item 2 fits, then the middle of the rest (6) does not, so the answer is c.
    t = type(t, 'F1', '=VLOOKUP(3,{1,"a";5,"b";2,"c";6,"d";3,"e"},2,TRUE)');
    expect(at(t, 'F1')).toBe('c');
  });

  it('MATCH types 1 and -1, XLOOKUP next smaller, and XLOOKUP from the end', () => {
    let t = type(blank(), 'F1', '=MATCH(25,{10,20,30},1)');
    expect(at(t, 'F1')).toBe(2);
    t = type(t, 'F1', '=MATCH(25,{30,20,10},-1)');
    expect(at(t, 'F1')).toBe(1);
    t = type(t, 'F1', '=XLOOKUP(5,{1,3,7},{"a","b","c"},"none",-1)');
    expect(at(t, 'F1')).toBe('b');
    t = type(t, 'F1', '=XLOOKUP(2,{2,1,2},{"x","y","z"},"none",0,-1)');
    expect(at(t, 'F1')).toBe('z');
  });

  it('INDEX, ADDRESS, COLUMNS, LOOKUP, and CHOOSE', () => {
    const cases: [string, Value][] = [
      ['=INDEX({1,2;3,4},2,1)', 3],
      ['=ADDRESS(2,3)', '$C$2'],
      ['=ADDRESS(2,3,4)', 'C2'],
      ['=COLUMNS(A1:C2)', 3],
      ['=LOOKUP(4.19,{4.14,4.19,5.17},{"red","orange","yellow"})', 'orange'],
      ['=CHOOSE(2,"a","b","c")', 'b'],
    ];
    for (const [formula, value] of cases) expect(at(type(blank(), 'F1', formula), 'F1'), formula).toEqual(value);
  });

  it('OFFSET and INDIRECT read B2 and recalculate when B2 changes', () => {
    let t = type(blank(), 'B2', '5');
    t = type(t, 'F1', '=OFFSET(A1,1,1)');
    t = type(t, 'F2', '=INDIRECT("B"&2)');
    expect([at(t, 'F1'), at(t, 'F2')]).toEqual([5, 5]);
    t = type(t, 'B2', '9');
    expect([at(t, 'F1'), at(t, 'F2')]).toEqual([9, 9]);
  });
});

describe('reference details', () => {
  it('follows a formula change through FORMULATEXT', () => {
    let t = type(blank(), 'A1', '=1+2');
    t = type(t, 'F1', '=FORMULATEXT(A1)');
    expect(at(t, 'F1')).toBe('=1+2');
    t = type(t, 'A1', '=2*3');
    expect(at(t, 'F1')).toBe('=2*3');
  });

  it('gives ROW() per cell', () => {
    let t = type(blank(), 'E3', '=ROW()*10+COLUMN()');
    t = type(t, 'F6', '=ROW()');
    expect([at(t, 'E3'), at(t, 'F6')]).toEqual([35, 6]);
  });

  it('marks OFFSET and INDIRECT volatile and returning references', () => {
    const by = new Map(functions.map((f) => [f.name, f]));
    for (const name of ['OFFSET', 'INDIRECT']) expect(by.get(name)).toMatchObject({ volatile: true, returnsRef: true });
    expect(by.get('INDEX')?.returnsRef).toBe(true);
    expect(by.get('INDEX')?.volatile).toBeUndefined();
    expect(by.size).toBe(18);
  });

  it('writes and reads reference text', () => {
    expect(columnLetters(1)).toBe('A');
    expect(columnLetters(26)).toBe('Z');
    expect(columnLetters(27)).toBe('AA');
    expect(columnLetters(702)).toBe('ZZ');
    expect(columnLetters(703)).toBe('AAA');
    expect(addressText(3, 2, 2, false, "Bob's")).toBe("'Bob''s'!R3C[2]");
    expect(addressText(1, 1, 1, true, 'A1')).toBe("'A1'!$A$1");
    expect(parseRefText("'My Sales'!$B$2:A1", true)).toEqual({
      kind: 'ref',
      table: 'My Sales',
      r1: 0,
      c1: 0,
      r2: 1,
      c2: 1,
    });
    expect(parseRefText('XFE1', true)).toBeNull();
    expect(parseRefText('A0', true)).toBeNull();
    expect(parseRefText('RC', false, { row: 4, col: 2, formulaAt: () => null })).toMatchObject({ r1: 4, c1: 2 });
    expect(parseRefText('A1', false)).toBeNull();
  });

  it('gives the display a link only for web and mail addresses written as text', () => {
    expect(hyperlinkOf('HYPERLINK("https://example.com","Site")')).toBe('https://example.com');
    expect(hyperlinkOf('HYPERLINK("mailto:someone@example.com")')).toBe('mailto:someone@example.com');
    expect(hyperlinkOf('HYPERLINK("javascript:alert(1)","x")')).toBeNull();
    expect(hyperlinkOf('HYPERLINK(A1)')).toBeNull();
    expect(hyperlinkOf('SUM(1)')).toBeNull();
  });
});
