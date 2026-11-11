// Tests for the verification gaps of the text and regex functions. Owner: tables:fn-text.
import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import { DEFAULT_ENV } from '../../recalc';
import { bookErrorOrigin, recalculateBook } from '../../workbook';
import { reasonOf, type Value } from '../../values';
import { guardInputLimit, guardPattern } from './regexGuard';

const ENV = DEFAULT_ENV;
const COLUMNS = [
  { name: 'A', type: 'number' as const },
  { name: 'B', type: 'number' as const },
];

/** Opens a table whose first cell holds the formula, as a saved note does, and gives the cell's value. */
function opened(formula: string): { value: Value; ms: number; table: ReturnType<typeof createTable> } {
  const started = Date.now();
  const table = createTable(COLUMNS, [[`=${formula}`, '']], EN_US, ENV, 1);
  return { value: table.rows[0].cells[0].value as Value, ms: Date.now() - started, table };
}

/** Types a formula into the first cell, as a person does, and gives the cell's value. Column B holds `others`. */
function typed(formula: string, others: readonly string[] = ['']): { value: Value; ms: number } {
  const base = createTable(
    [
      { name: 'A', type: 'number' as const },
      { name: 'B', type: 'text' as const },
    ],
    others.map((x) => ['', x]),
    EN_US,
    ENV,
    1,
  );
  const started = Date.now();
  const t = setCellInput(base, { row: 0, col: 0, raw: `=${formula}` }, EN_US, ENV);
  return { value: t.rows[0].cells[0].value as Value, ms: Date.now() - started };
}

describe('the regular expression guard', () => {
  it('refuses nested repeats, back-references, and overlapping choices in a repeated group', () => {
    expect(guardPattern('^(a+)+$')).toBe('regexNestedRepeat');
    expect(guardPattern('(a*)*b')).toBe('regexNestedRepeat');
    expect(guardPattern('(\\w+\\s?)+$')).toBe('regexNestedRepeat');
    expect(guardPattern('(?:a|a)+')).toBe('regexNestedRepeat');
    expect(guardPattern('([ab]|a)*')).toBe('regexNestedRepeat');
    expect(guardPattern('((a|a))+')).toBe('regexNestedRepeat');
    expect(guardPattern('(a)\\1')).toBe('regexBackreference');
    expect(guardPattern('(?<x>a)\\k<x>')).toBe('regexBackreference');
  });

  it('admits ordinary patterns and counts their repeating parts', () => {
    expect(guardPattern('^[0-9]{4}-[0-9]{2}$')).toBe(0);
    expect(guardPattern('[0-9]+')).toBe(1);
    expect(guardPattern('^(\\d+)-(\\d+)$')).toBe(2);
    expect(guardPattern('(ab|cd)+')).toBe(1);
    expect(guardPattern('colou?r')).toBe(0);
    expect(guardPattern('\\(a+\\)')).toBe(1);
    expect(guardPattern('[(]a[+]')).toBe(0);
  });

  it('shortens the allowed text as the repeating parts grow', () => {
    expect(guardInputLimit(0)).toBe(Infinity);
    expect(guardInputLimit(1)).toBeGreaterThan(30000);
    expect(guardInputLimit(2)).toBe(1000);
    expect(guardInputLimit(4)).toBeLessThan(100);
  });
});

describe('REGEX functions on the page thread', () => {
  it('opens a table that holds a catastrophic pattern at once, with #VALUE! and the reason', () => {
    // 40 characters would run for hours unguarded (measured: 25 characters took 1.8 s, and each more doubles it).
    const f = 'REGEXTEST(REPT("a",40)&"!","^(a+)+$")';
    const { value, ms, table } = opened(f);
    expect(value).toEqual({ error: 'VALUE' });
    expect(ms).toBeLessThan(1000);
    expect(reasonOf(value)).toBe('regexNestedRepeat');
    const book = recalculateBook([table], ENV);
    expect(bookErrorOrigin(book, 0, 0, 0)).toMatchObject({
      kind: 'function',
      name: 'REGEXTEST',
      reason: 'regexNestedRepeat',
    });
  });

  it('ends a typed catastrophic pattern at once, and a high-power one on a long text', () => {
    expect(typed('REGEXTEST(REPT("a",40)&"!","^(a+)+$")').ms).toBeLessThan(1000);
    const slow = typed('REGEXTEST(REPT("a",8000)&"!","a*a*a*b")');
    expect(slow.value).toEqual({ error: 'VALUE' });
    expect(slow.ms).toBeLessThan(1000);
    expect(reasonOf(slow.value)).toBe('regexTooComplex');
  });

  it('names the limit it hit', () => {
    expect(reasonOf(typed('REGEXTEST("abc",REPT("a",1001))').value)).toBe('regexPatternTooLong');
    expect(reasonOf(typed('REGEXTEST(REPT("a",32767)&"aa","a")').value)).toBe('regexInputTooLong');
    expect(reasonOf(typed('REGEXTEST("aa","(a)\\1")').value)).toBe('regexBackreference');
  });

  it('still runs ordinary patterns', () => {
    expect(typed('REGEXTEST("note 12","[0-9]+")').value).toBe(true);
    expect(typed('REGEXEXTRACT("a-1 b-22","[a-z]-([0-9]+)",2)').value).toBe('1');
  });
});

describe('delimiter work is bounded', () => {
  it('ends TEXTSPLIT and TEXTBEFORE with many long delimiters sharing a prefix', () => {
    // Ten delimiters of about 400 characters: 4,000 in all, within the cap, each sharing the text's prefix.
    const delims = Array.from({ length: 10 }, (_, i) => `=REPT("a",${390 + i})&"b"`);
    for (const f of ['TEXTSPLIT(REPT("a",32767),B1:B10)', 'TEXTBEFORE(REPT("a",32767),B1:B10)']) {
      const r = typed(f, delims);
      expect(r.ms).toBeLessThan(3000);
      expect(r.value).not.toEqual({ error: 'VALUE' });
    }
  });

  it('gives #VALUE! when the delimiters together are too long', () => {
    const delims = Array.from({ length: 12 }, (_, i) => `=REPT("a",${400 + i})&"b"`);
    expect(typed('TEXTSPLIT(REPT("a",32767),B1:B12)', delims).value).toEqual({ error: 'VALUE' });
    expect(typed('TEXTBEFORE(REPT("a",32767),B1:B12)', delims).value).toEqual({ error: 'VALUE' });
  });
});

describe('FIXED and DOLLAR limits', () => {
  it('give #VALUE! for more than 127 decimals and format large numbers in full', () => {
    expect(typed('FIXED(1.5,400)').value).toEqual({ error: 'VALUE' });
    expect(typed('DOLLAR(1.5,200)').value).toEqual({ error: 'VALUE' });
    expect(typed('FIXED(1.5,127)').value).toMatch(/^1\.5000/);
    const big = typed('FIXED(1E+308,2,TRUE)').value;
    expect(typeof big).toBe('string');
    expect(big).toMatch(/^1\d{15,}\.00$/);
    expect(typed('FIXED(2.675,2)').value).toBe('2.68');
  });
});

describe('case and positions', () => {
  it('keeps UPPER one character to one character', () => {
    expect(typed('UPPER("straße")').value).toBe('STRAßE');
    expect(typed('LEN(UPPER("ß"))').value).toBe(1);
    expect(typed('UPPER("ink")').value).toBe('INK');
  });

  it('keeps SEARCH positions in the original text when lowercasing changes the length', () => {
    // U+0130 lowercases to two units; the match after it must still count it as one.
    expect(typed('SEARCH("b","İb")').value).toBe(2);
    expect(typed('SEARCH("?b","İb")').value).toBe(1);
  });

  it('counts ? as one UTF-16 unit, as LEN does', () => {
    // An emoji is two units, so "?x" finds x at its second unit and "??x" at the start.
    expect(typed('SEARCH("?x","😀x")').value).toBe(2);
    expect(typed('SEARCH("??x","😀x")').value).toBe(1);
  });
});
