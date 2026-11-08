// The text and regular expression functions. Expected values come from fixtures/fn/text.json, worked by hand from each
// function's documented behavior.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import { DEFAULT_ENV, spillRange } from '../../recalc';
import { arrayOf, isArray, type Scalar, type Value } from '../../values';
import { en } from '../../../../../strings/en';
import { REGISTRY, paramsOf } from '.';
import { needsWorker } from '../../worker/client';
import { REGEX_MAX_INPUT, REGEX_MAX_PATTERN, regexLimitProblem } from './regex';

type Expected = Scalar | { array: Scalar[][] } | { error: string };

interface Fixture {
  cases: [string, Expected][];
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../fixtures/fn/text.json'), 'utf8'),
) as Fixture;

const ENV = DEFAULT_ENV;
const NAMES = ['A', 'B', 'C', 'D', 'E'];

/** Types a formula into the first cell of a blank grid and reads what it gives, spilled results as an array. */
function evaluate(formula: string): Value {
  const columns = NAMES.map((name) => ({ name, type: 'number' as const }));
  const data = Array.from({ length: 5 }, () => NAMES.map(() => ''));
  const base = createTable(columns, data, EN_US, ENV, 1);
  const t = setCellInput(base, { row: 0, col: 0, raw: `=${formula}` }, EN_US, ENV);
  const box = spillRange(t, 0, 0);
  const cell = t.rows[0].cells[0].value;
  if (box === undefined || (box.r1 === box.r2 && box.c1 === box.c2)) return cell;
  const rows: Scalar[][] = [];
  for (let r = box.r1; r <= box.r2; r++) {
    rows.push(t.rows[r].cells.slice(box.c1, box.c2 + 1).map((c) => c.value as Scalar));
  }
  return arrayOf(rows);
}

function expectedValue(e: Expected): Value {
  if (typeof e === 'object' && e !== null && 'array' in e) return arrayOf(e.array);
  if (typeof e === 'object' && e !== null && 'error' in e) return { error: e.error } as Value;
  return e;
}

describe('text and regular expression fixtures', () => {
  it('has a case for every function of both families', () => {
    const used = fixture.cases.map(([formula]) => formula);
    const missing = [...REGISTRY.values()]
      .filter((spec) => spec.family === 'text' || spec.family === 'regex')
      .filter((spec) => !used.some((formula) => formula.includes(`${spec.name}(`)))
      .map((spec) => spec.name);
    expect(missing).toEqual([]);
  });

  it.each(fixture.cases.map((c) => [c[0], c] as const))('%s', (_, [formula, expected]) => {
    const got = evaluate(formula);
    const want = expectedValue(expected);
    if (isArray(want)) {
      expect(isArray(got), formula).toBe(true);
      expect(got).toEqual(want);
    } else expect(got).toEqual(want);
  });
});

describe('descriptions', () => {
  it('gives every function a summary and a line for each argument', () => {
    const strings = en.fnText as unknown as Record<string, { summary: string; args: Record<string, string> }>;
    for (const spec of REGISTRY.values()) {
      if (spec.family !== 'text' && spec.family !== 'regex') continue;
      expect(strings[spec.name]?.summary, spec.name).toBeTruthy();
      for (const p of paramsOf(spec)) expect(strings[spec.name].args[p.name], `${spec.name} ${p.name}`).toBeTruthy();
    }
  });
});

describe('lane tests', () => {
  it('formats with TEXT through the number formats', () => {
    expect(evaluate('TEXT(1234.567,"#,##0.00")')).toBe('1,234.57');
    expect(evaluate('TEXT(0.285,"0.0%")')).toBe('28.5%');
    expect(evaluate('TEXT(45292,"yyyy-mm-dd")')).toBe('2024-01-01');
  });

  it('reads numbers and characters', () => {
    expect(evaluate('VALUE("$1,000")')).toBe(1000);
    expect(evaluate('NUMBERVALUE("2.500,27",",",".")')).toBe(2500.27);
    expect(evaluate('CODE("A")')).toBe(65);
    expect(evaluate('UNICODE("\u20ac")')).toBe(8364);
    expect(evaluate('DOLLAR(1234.567,2)')).toBe('$1,234.57');
    expect(evaluate('FIXED(1234.567,1)')).toBe('1,234.6');
  });

  it('lifts a single-value function over an array', () => {
    expect(evaluate('UPPER({"a","b"})')).toEqual(arrayOf([['A', 'B']]));
    expect(evaluate('LEN({"a","bb";"ccc",""})')).toEqual(
      arrayOf([
        [1, 2],
        [3, 0],
      ]),
    );
  });

  it('names the regular expression limits', () => {
    expect(REGEX_MAX_PATTERN).toBe(1000);
    expect(REGEX_MAX_INPUT).toBe(32768);
    expect(regexLimitProblem('abc', 'a'.repeat(1001))).toBe('regexPatternTooLong');
    expect(regexLimitProblem('a'.repeat(32769), 'a')).toBe('regexInputTooLong');
    // The sentence behind each key names its limit, with the thousands separator.
    expect(en.fnText.regexPatternTooLong).toMatch(/1,000 characters/);
    expect(en.fnText.regexInputTooLong).toMatch(/32,768 characters/);
    expect(en.fnText.REGEXTEST.summary).toMatch(/1,000 characters/);
    expect(regexLimitProblem('abc', 'a')).toBeNull();
    expect(evaluate(`REGEXTEST("abc",REPT("a",1001))`)).toEqual({ error: 'VALUE' });
  });

  it('sends a page that calls a REGEX function to the worker, where the busy time ends a long match', () => {
    // 27 characters took 9.5 s on the page's thread and each more doubles it, so the page thread must never run it.
    const table = createTable([{ name: 'A', type: 'number' }], [['']], EN_US, ENV, 1);
    // Set by hand: typing the formula would run it here, on this thread.
    const withRegex = {
      ...table,
      rows: [{ ...table.rows[0], cells: [{ raw: '', value: null, formula: 'REGEXTEST(REPT("a",30)&"!","^(a+)+$")' }] }],
    };
    expect(needsWorker([withRegex], 20000)).toBe(true);
    expect(needsWorker([table], 20000)).toBe(false);
  });

  it('ends a wildcard SEARCH over a long text quickly', () => {
    const started = Date.now();
    expect(evaluate('SEARCH("*b",REPT("a",32767))')).toEqual({ error: 'VALUE' });
    expect(evaluate('SEARCH("a*a*a*b",REPT("a",32767))')).toEqual({ error: 'VALUE' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('bounds TEXTSPLIT, and many delimiters', () => {
    expect(evaluate('TEXTSPLIT(REPT(";",3000)&REPT(",",3000),",",";")')).toEqual({ error: 'VALUE' });
    const started = Date.now();
    const delims = arrayOf([Array.from({ length: 1001 }, (_, i) => `d${i}`)]);
    const source = 'ab'.repeat(16000);
    expect(REGISTRY.get('TEXTSPLIT')!.run([source, delims], ENV)).toEqual({ error: 'VALUE' });
    expect(REGISTRY.get('TEXTBEFORE')!.run([source, delims], ENV)).toEqual({ error: 'VALUE' });
    const ok = arrayOf([Array.from({ length: 1000 }, (_, i) => `d${i}`)]);
    expect(REGISTRY.get('TEXTSPLIT')!.run([source, ok], ENV)).toBe(source);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('gives #VALUE! at once when REGEXREPLACE would build too much', () => {
    expect(evaluate('REGEXREPLACE(REPT("a",32767),"",REPT("x",32767))')).toEqual({ error: 'VALUE' });
    expect(String(evaluate('REGEXREPLACE("abc","b",REPT("$0",10000))')).length).toBe(10002);
  });

  it('gives the whole match for the two-argument REGEXEXTRACT, as Excel does', () => {
    expect(evaluate('REGEXEXTRACT("2024-05-06","(\\d+)-(\\d+)")')).toBe('2024-05');
  });

  it('keeps the old TRIM and CONCAT in a table without data.sheet.v', () => {
    const run = (version: number | undefined, formula: string): Value => {
      const t = createTable([{ name: 'A', type: 'number' }], [['']], EN_US, ENV, version);
      return setCellInput(t, { row: 0, col: 0, raw: `=${formula}` }, EN_US, ENV).rows[0].cells[0].value;
    };
    const tab = 'TRIM("a"&CHAR(9)&"b")';
    expect(run(undefined, tab)).toBe('a b');
    expect(run(1, tab)).toBe(`a${String.fromCharCode(9)}b`);
    expect(run(undefined, 'TRIM("  a   b ")')).toBe('a b');
  });
});
