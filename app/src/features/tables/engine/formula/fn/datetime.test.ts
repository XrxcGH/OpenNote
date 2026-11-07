// Date and time functions. Every expected value comes from fixtures/fn/datetime.json, worked by hand from each
// function's documented rule (serial numbers, weekend codes, day-count bases), never from this code's output.

import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/fn/datetime.json';
import { createTable, setCellInput } from '../../edit';
import { EN_US } from '../../locale';
import { ERROR_TOKENS, type Value } from '../../values';
import { REGISTRY } from '.';

interface Case {
  formula: string;
  cells?: Record<string, number>;
  expected: number | string;
  tolerance?: number;
}

const COLUMNS = ['A', 'B', 'C', 'D'].map((name) => ({ name, type: 'number' as const }));
const ENV = { today: () => 45292 };

/** Types the cells, then the formula in D1, and returns D1's value. */
function run(c: Case): Value {
  const data = Array.from({ length: 4 }, () => ['', '', '', '']);
  let t = createTable(COLUMNS, data, EN_US, ENV, 1);
  for (const [ref, v] of Object.entries(c.cells ?? {})) {
    t = setCellInput(t, { row: Number(ref.slice(1)) - 1, col: ref.charCodeAt(0) - 65, raw: String(v) }, EN_US, ENV);
  }
  t = setCellInput(t, { row: 0, col: 3, raw: c.formula }, EN_US, ENV);
  return t.rows[0].cells[3].value;
}

const tokens = Object.values(ERROR_TOKENS);

describe('date and time functions (fixture cases)', () => {
  it.each((fixture.cases as Case[]).map((c) => [c.formula, c] as const))('%s', (_formula, c) => {
    const got = run(c);
    if (typeof c.expected === 'string' && tokens.includes(c.expected)) {
      expect(got).toEqual({ error: expect.any(String) });
      expect(ERROR_TOKENS[(got as { error: keyof typeof ERROR_TOKENS }).error]).toBe(c.expected);
    } else if (typeof c.expected === 'number' && c.tolerance !== undefined) {
      expect(got).toBeCloseTo(c.expected, 8);
    } else {
      expect(got).toBe(c.expected);
    }
  });
});

describe('the date and time family', () => {
  it('registers the 26 functions', () => {
    const names = [...REGISTRY.values()].filter((s) => s.family === 'datetime').map((s) => s.name);
    expect(names.sort()).toEqual(
      [
        'DATE',
        'DATEDIF',
        'DATEVALUE',
        'DAY',
        'DAYS',
        'DAYS360',
        'EDATE',
        'EOMONTH',
        'EPOCHTODATE',
        'HOUR',
        'ISOWEEKNUM',
        'MINUTE',
        'MONTH',
        'NETWORKDAYS',
        'NETWORKDAYS.INTL',
        'NOW',
        'SECOND',
        'TIME',
        'TIMEVALUE',
        'TODAY',
        'WEEKDAY',
        'WEEKNUM',
        'WORKDAY',
        'WORKDAY.INTL',
        'YEAR',
        'YEARFRAC',
      ].sort(),
    );
  });

  it('marks TODAY and NOW as volatile', () => {
    expect(REGISTRY.get('TODAY')?.volatile).toBe(true);
    expect(REGISTRY.get('NOW')?.volatile).toBe(true);
  });

  it('gives NOW today plus a time of day under one day', () => {
    const now = run({ formula: '=NOW()', expected: 0 }) as number;
    expect(Math.floor(now)).toBe(45292);
    expect(now).toBeLessThan(45293);
  });

  it('skips whole weeks quickly for far-off workdays', () => {
    // 1 January 2024 is a Monday. 1,000,000 working days is 200,000 five-day weeks: the same weekday, 1,400,000 days on.
    expect(run({ formula: '=WORKDAY(DATE(2024,1,1),1000000)', expected: 0 })).toBe(45292 + 1_400_000);
  });

  it('refuses a day count too large to be sensible', () => {
    expect(run({ formula: '=WORKDAY(DATE(2024,1,1),100000000)', expected: '#NUM!' })).toEqual({ error: 'NUM' });
  });
});
