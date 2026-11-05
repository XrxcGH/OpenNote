// Text and date functions. Dates are serials (days since 1899-12-30), so a date minus a date is a number of days.

import { daysToYmd, ymdToSerial } from '../dates';
import { err, finish, toNumber, toNumbers, toText, type Value } from '../values';
import type { Env, FnSpec } from './functions';

function text1(f: (s: string) => Value): FnSpec {
  return {
    kind: 'scalar',
    min: 1,
    max: 1,
    run: ([v]) => {
      const s = toText(v);
      return typeof s === 'string' ? f(s) : s;
    },
  };
}

function edge(pick: (s: string, n: number) => string): FnSpec {
  return {
    kind: 'scalar',
    min: 1,
    max: 2,
    run: ([v, count = 1]) => {
      const s = toText(v);
      const n = toNumber(count);
      if (typeof s !== 'string') return s;
      if (typeof n !== 'number') return n;
      return n < 0 ? err('VALUE') : pick(s, Math.trunc(n));
    },
  };
}

function datePart(pick: (ymd: ReturnType<typeof daysToYmd>) => number): FnSpec {
  return {
    kind: 'scalar',
    min: 1,
    max: 1,
    run: ([v]) => {
      const n = toNumber(v);
      return typeof n === 'number' ? pick(daysToYmd(n)) : n;
    },
  };
}

export const DATE_TEXT_FUNCTIONS: Record<string, FnSpec> = {
  CONCAT: {
    kind: 'scalar',
    min: 1,
    max: Infinity,
    run: (args) => {
      let out = '';
      for (const v of args) {
        const s = toText(v);
        if (typeof s !== 'string') return s;
        out += s;
      }
      return out;
    },
  },
  LEN: text1((s) => s.length),
  LOWER: text1((s) => s.toLowerCase()),
  UPPER: text1((s) => s.toUpperCase()),
  TRIM: text1((s) => s.trim().replace(/\s+/g, ' ')),
  LEFT: edge((s, n) => s.slice(0, n)),
  RIGHT: edge((s, n) => (n === 0 ? '' : s.slice(-n))),
  TODAY: { kind: 'scalar', min: 0, max: 0, run: (_args: Value[], env: Env) => env.today() },
  DATE: {
    kind: 'scalar',
    min: 3,
    max: 3,
    run: (args) => {
      const nums = toNumbers(args);
      if (!Array.isArray(nums)) return nums;
      const [year, m, d] = nums.map(Math.trunc);
      // Years 0 to 99 mean 1900 to 1999. Other years count as written, so 1899-12-30 is serial 0 and earlier
      // dates are negative serials, as in Sheets (DIFFERENCES.md lists Excel's rule).
      const y = year >= 0 && year < 100 ? year + 1900 : year;
      return y < 0 || y > 9999 ? err('NUM') : finish(ymdToSerial(y, m, d));
    },
  },
  YEAR: datePart((p) => p.y),
  MONTH: datePart((p) => p.m),
  DAY: datePart((p) => p.d),
  DAYS: {
    kind: 'scalar',
    min: 2,
    max: 2,
    run: (args) => {
      const nums = toNumbers(args);
      return Array.isArray(nums) ? Math.floor(nums[0]) - Math.floor(nums[1]) : nums;
    },
  },
};
