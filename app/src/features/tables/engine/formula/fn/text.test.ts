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
    expect(regexLimitProblem('abc', 'a'.repeat(1001))).toMatch(/1000 characters/);
    expect(regexLimitProblem('a'.repeat(32769), 'a')).toMatch(/32768 characters/);
    expect(regexLimitProblem('abc', 'a')).toBeNull();
    expect(evaluate(`REGEXTEST("abc",REPT("a",1001))`)).toEqual({ error: 'VALUE' });
  });

  it('keeps a pattern that backtracks on a short input fast', () => {
    const started = Date.now();
    expect(evaluate('REGEXTEST("aaaaaaaaaaaaaaaaaaaa!","^(a+)+$")')).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
