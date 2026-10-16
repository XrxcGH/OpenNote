// A differential test of the table formulas against an independent Excel-style engine, `gridcraft-cli eval`
// (tests/crosscheck, docs/CHECKS.md "Cross-checks"). The other engine is alpha software and not ground truth, so a
// difference means "look". It runs only when the tool is installed, and a normal `npm test` skips it.
//
// Every formula uses the function set that both engines share. A difference that is understood goes in KNOWN with
// the reason, so the test fails only for a new difference. A KNOWN entry that now agrees prints a note.

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { findTool } from '../../../../../tests/crosscheck/tools';
import { createTable, setColumnFormula } from './edit';
import { FUNCTIONS } from './formula/functions';
import { EN_US } from './locale';
import { ERROR_TOKENS, type Value } from './values';

/** Days from 1900-based Excel serials to the day numbers since 1970 that OpenNote's dates use. */
const EPOCH_GAP = 25569;

/** Formulas, grouped by the functions they exercise. A date result is written with `DATE(...)` and shifted. */
const CASES: Record<string, string[]> = {
  SUM: ['SUM(1,2,3)', 'SUM(1.5,2.25)', 'SUM(-1,1)', 'SUM(0.1,0.2)', 'SUM("3",4)', 'SUM(TRUE,1)'],
  AVERAGE: ['AVERAGE(1,2,3,4)', 'AVERAGE(10)', 'AVERAGE(-5,5)', 'AVERAGE(1,2.5)'],
  MIN: ['MIN(3,1,2)', 'MIN(-1,5)', 'MIN(2.5,2.25)'],
  MAX: ['MAX(3,1,2)', 'MAX(-1,-5)', 'MAX(2.5,2.25)'],
  COUNT: ['COUNT(1,2,3)', 'COUNT(1,"a",2)', 'COUNT(1,TRUE)'],
  COUNTA: ['COUNTA(1,"a",TRUE)', 'COUNTA("","x")'],
  MEDIAN: ['MEDIAN(1,3,2)', 'MEDIAN(1,2,3,4)', 'MEDIAN(5)'],
  ABS: ['ABS(-3)', 'ABS(2.5)', 'ABS(0)'],
  INT: ['INT(2.7)', 'INT(-2.7)', 'INT(5)'],
  SIGN: ['SIGN(-4)', 'SIGN(0)', 'SIGN(9)'],
  SQRT: ['SQRT(16)', 'SQRT(2)', 'SQRT(-1)', 'SQRT(0)'],
  EXP: ['EXP(0)', 'EXP(1)', 'EXP(-2)'],
  LN: ['LN(1)', 'LN(10)', 'LN(0)', 'LN(-1)'],
  LOG10: ['LOG10(1000)', 'LOG10(2)', 'LOG10(0)'],
  LOG: ['LOG(8,2)', 'LOG(100)', 'LOG(81,3)', 'LOG(0,2)'],
  SIN: ['SIN(0)', 'SIN(1)', 'SIN(PI()/2)'],
  COS: ['COS(0)', 'COS(1)', 'COS(PI())'],
  TAN: ['TAN(0)', 'TAN(1)'],
  ASIN: ['ASIN(0.5)', 'ASIN(1)', 'ASIN(2)'],
  ACOS: ['ACOS(0.5)', 'ACOS(1)', 'ACOS(-2)'],
  ATAN: ['ATAN(1)', 'ATAN(0)', 'ATAN(-1)'],
  DEGREES: ['DEGREES(PI())', 'DEGREES(1)'],
  RADIANS: ['RADIANS(180)', 'RADIANS(90)'],
  PI: ['PI()', 'PI()*2'],
  POWER: ['POWER(2,10)', 'POWER(2,0.5)', 'POWER(-8,1/3)', 'POWER(0,-1)', 'POWER(0,0)'],
  MOD: ['MOD(10,3)', 'MOD(-10,3)', 'MOD(10,-3)', 'MOD(5.5,2)', 'MOD(5,0)'],
  ROUND: ['ROUND(2.5,0)', 'ROUND(-2.5,0)', 'ROUND(1.005,2)', 'ROUND(1234.5678,-2)', 'ROUND(2.345,2)', 'ROUND(7)'],
  ROUNDUP: ['ROUNDUP(2.1,0)', 'ROUNDUP(-2.1,0)', 'ROUNDUP(1.231,2)', 'ROUNDUP(1234,-2)'],
  ROUNDDOWN: ['ROUNDDOWN(2.9,0)', 'ROUNDDOWN(-2.9,0)', 'ROUNDDOWN(1.239,2)', 'ROUNDDOWN(1299,-2)'],
  AND: ['AND(TRUE,TRUE)', 'AND(TRUE,FALSE)', 'AND(1,2)', 'AND(1,0)'],
  OR: ['OR(FALSE,FALSE)', 'OR(FALSE,TRUE)', 'OR(0,0)', 'OR(0,3)'],
  NOT: ['NOT(TRUE)', 'NOT(0)', 'NOT(5)'],
  ISBLANK: ['ISBLANK("")', 'ISBLANK(1)'],
  IF: ['IF(1<2,"yes","no")', 'IF(FALSE,1,2)', 'IF(0,1)', 'IF(1,10)', 'IF(2>1,5,1/0)'],
  IFERROR: ['IFERROR(1/0,"bad")', 'IFERROR(5,"bad")', 'IFERROR(SQRT(-1),0)'],
  CONCAT: ['CONCAT("a","b","c")', 'CONCAT("n=",5)', 'CONCAT(1.5,"x")', 'CONCAT(TRUE,"x")'],
  LEN: ['LEN("hello")', 'LEN("")', 'LEN(12345)', 'LEN("a b")'],
  LOWER: ['LOWER("HeLLo")', 'LOWER("ÀB")'],
  UPPER: ['UPPER("HeLLo")', 'UPPER("straße")'],
  TRIM: ['TRIM("  a   b  ")', 'TRIM("x")'],
  LEFT: ['LEFT("hello",2)', 'LEFT("hello")', 'LEFT("hi",10)', 'LEFT("hello",0)', 'LEFT("hello",-1)'],
  RIGHT: ['RIGHT("hello",2)', 'RIGHT("hello")', 'RIGHT("hi",10)', 'RIGHT("hello",0)'],
  DATE: ['DATE(2024,1,15)', 'DATE(2024,2,30)', 'DATE(2024,14,1)', 'DATE(2000,1,1)'],
  YEAR: ['YEAR(DATE(2024,1,15))', 'YEAR(DATE(1999,12,31))'],
  MONTH: ['MONTH(DATE(2024,1,15))', 'MONTH(DATE(2024,12,31))'],
  DAY: ['DAY(DATE(2024,1,15))', 'DAY(DATE(2024,2,29))'],
  DAYS: ['DAYS(DATE(2024,3,1),DATE(2024,2,1))', 'DAYS(DATE(2024,1,1),DATE(2024,12,31))'],
  OPERATORS: [
    '2+3*4',
    '(2+3)*4',
    '10/4',
    '2^3^2',
    '-2^2',
    '50%',
    '200*15%',
    '1&2',
    '"a"&"b"',
    '1<2',
    '"a"="A"',
    '2<>2',
    '3>=3',
    '1/0',
    '"x"+1',
    '0.1+0.2',
    '1e3+1',
    '7/2*2',
  ],
};

/** Differences that are understood. The key is the formula; the value says why the two engines part. */
const KNOWN: Record<string, string> = {
  '2^3^2': 'OpenNote chains powers to the right, as in mathematics (512). Excel chains to the left (64).',
  '-2^2': 'OpenNote binds the power tighter than the minus sign (-4), as in mathematics. Excel negates first (4).',
  'ROUND(7)':
    'Decided to keep: OpenNote lets the digits argument go (ROUND(2.5) is 3), a kindness for typed formulas. Excel needs both.',
  'COUNTA("","x")':
    'Decided to keep: a table cell with empty text is an empty cell, and COUNTA over a column must not count those.',
};

/** Functions that cannot be compared with a fixed answer: their result depends on the day it runs. */
const NOT_COMPARABLE = new Set(['TODAY']);

const DATE_RESULTS = new Set(['DATE']);

function opennote(formula: string): Value {
  const base = createTable([{ name: 'A', type: 'number' }, { name: 'Out' }], [['1']], EN_US);
  const result = setColumnFormula(base, 1, formula);
  if (!result.ok) return { error: 'NAME' };
  return result.table.rows[0].cells[1].value;
}

type Other = number | string | boolean | null | { error: string };

function gridcraft(tool: string, formula: string): Other {
  const run = spawnSync(tool, ['eval', formula, '--json'], { encoding: 'utf8', timeout: 30_000 });
  if (run.status !== 0) return { error: `exit ${run.status}: ${run.stderr.trim().split('\n')[0]}` };
  return JSON.parse(run.stdout) as Other;
}

const NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(ERROR_TOKENS).map(([code, token]) => [code, token]),
);

/** A value in a form both engines can be compared in: numbers rounded to 12 digits, errors as their token. */
function normalize(value: Value | Other): string {
  if (value !== null && typeof value === 'object') {
    const code = String((value as { error: string }).error);
    return `error ${NAMES[code] ?? code}`;
  }
  if (typeof value === 'number') {
    return `number ${Number(value.toPrecision(12))}`;
  }
  if (value === null || value === '') return 'empty';
  return `${typeof value} ${String(value)}`;
}

const tool = findTool('gridcraft-cli');

describe('the formula function set', () => {
  it('has a differential case for every function', () => {
    const covered = new Set(Object.keys(CASES));
    const missing = Object.keys(FUNCTIONS).filter((name) => !covered.has(name) && !NOT_COMPARABLE.has(name));
    expect(missing, 'add cases for these functions to CASES').toEqual([]);
  });
});

describe.skipIf(tool === undefined)('table formulas against gridcraft-cli eval', () => {
  const all = Object.entries(CASES).flatMap(([group, formulas]) => formulas.map((formula) => ({ group, formula })));

  it('agrees on every case that is not a known difference', () => {
    const different: string[] = [];
    const resolved: string[] = [];
    for (const { group, formula } of all) {
      const mine = opennote(formula);
      const theirs = gridcraft(tool as string, formula);
      const shift = DATE_RESULTS.has(group);
      const same = normalize(mine) === normalize(theirs) || (shift && sameDate(mine, theirs));
      if (!same && KNOWN[formula] === undefined) {
        different.push(`${formula}: OpenNote ${JSON.stringify(mine)}, GridCraft ${JSON.stringify(theirs)}`);
      }
      if (same && KNOWN[formula] !== undefined) resolved.push(formula);
    }
    if (resolved.length > 0)
      console.warn(`These known differences now agree, so remove them from KNOWN: ${resolved.join(', ')}`);
    expect(different).toEqual([]);
  }, 300_000);
});

/** A date from OpenNote is days since 1970 and from Excel a serial since 1900. */
function sameDate(mine: Value, theirs: Other): boolean {
  return typeof mine === 'number' && typeof theirs === 'number' && Math.abs(mine + EPOCH_GAP - theirs) < 1e-9;
}
